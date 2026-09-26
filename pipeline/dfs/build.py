"""Pipeline entry point: fetch every source, match, build consensus, write JSON.

    python -m dfs.build                       # live run, writes ../data/latest
    python -m dfs.build --fixtures tests/fixtures --now 2026-09-25T12:00:00Z --sample
    python -m dfs.build --dry-run             # probe sources, print the report, write nothing

Every source runs in isolation. A source that raises, returns too few rows, or covers too little
of the slate is marked "failed"; its last good snapshot (same week, <= max_stale_hours old)
is used instead and marked "stale". The run fails (exit 1) only when no salaries are available.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import pstdev
from typing import Any, Callable
from zoneinfo import ZoneInfo

from . import SCHEMA_VERSION
from .config import Config
from .floor import estimate, history_by_player
from .http import Http
from .match import SlateIndex
from .models import Game, ProjRecord, SlatePlayer, SourceError, SourceStatus, StatusRecord
from .names import TEAMS, normalize_name
from .sources import cbs, draftkings, espn, fantasypros, nflverse, sleeper, vegas
from .sources.base import Context, SourceMeta

SEVERITY = {"ACTIVE": 0, "Q": 1, "D": 2, "O": 3, "IR": 4}
PROJECTION_SOURCES = (
    (sleeper.META, sleeper.fetch_projections),
    (espn.META, espn.fetch),
    (fantasypros.META, fantasypros.fetch),
    (cbs.META, cbs.fetch),
    (vegas.META, vegas.project),
)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Cache:
    def __init__(self, root: Path | None):
        self.root = root

    def load(self, name: str) -> dict | None:
        if not self.root or not (self.root / f"{name}.json").exists():
            return None
        return json.loads((self.root / f"{name}.json").read_text())

    def save(self, name: str, key: str | None, fetched_at: str, records: list[dict]) -> None:
        if not self.root:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / f"{name}.json").write_text(json.dumps({"key": key, "fetched_at": fetched_at, "records": records}))


class Runner:
    def __init__(self, cfg: Config, cache: Cache, now: datetime):
        self.cfg, self.cache, self.now = cfg, cache, now
        self.statuses: dict[str, SourceStatus] = {}

    def run(
        self,
        meta: SourceMeta,
        fetch: Callable[[], list],
        *,
        key: str | None = None,
        encode: Callable[[Any], dict] = asdict,
        decode: Callable[[dict], Any] = lambda d: d,
        validate: Callable[[list], tuple[float | None, str | None]] | None = None,
    ) -> list | None:
        st = SourceStatus(name=meta.name, label=meta.label, kind=meta.kind, access=meta.access)
        self.statuses[meta.name] = st
        if not self.cfg.enabled(meta.name):
            st.status = "disabled"
            return None
        min_rows = int(self.cfg.sanity.get("min_rows", {}).get(meta.name, 1))
        try:
            records = fetch()
            if len(records) < min_rows:
                raise SourceError(f"only {len(records)} rows (minimum {min_rows})")
            if validate:
                st.coverage, problem = validate(records)
                if problem:
                    raise SourceError(problem)
            st.rows, st.fetched_at = len(records), _iso(self.now)
            self.cache.save(meta.name, key, st.fetched_at, [encode(r) for r in records])
            return records
        except Exception as exc:  # noqa: BLE001 - isolation is the point
            st.status = "failed"
            st.error = f"{type(exc).__name__}: {exc}"[:800]
        cached = self.cache.load(meta.name)
        if not cached or cached.get("key") != key:
            return None
        age = (self.now - _parse_iso(cached["fetched_at"])).total_seconds() / 3600
        if age > float(self.cfg.sanity.get("max_stale_hours", 72)):
            st.notes.append(f"cached snapshot too old ({age:.0f}h)")
            return None
        records = [decode(r) for r in cached["records"]]
        if validate:
            coverage, problem = validate(records)
            if problem:
                st.notes.append(f"cached snapshot rejected: {problem}")
                return None
            st.coverage = coverage
        st.status, st.fetched_at, st.rows, st.stale_hours = "stale", cached["fetched_at"], len(records), round(age, 1)
        return records


def _slate_is_current(players: list[SlatePlayer], now: datetime) -> tuple[None, str | None]:
    kicks = [_parse_iso(p.kickoff) for p in players if p.kickoff]
    if kicks and max(kicks).timestamp() < now.timestamp() - 12 * 3600:
        return None, "slate has already been played"
    return None, None


def detect_week(ctx: Context, games: list[Game] | None, state: dict | None) -> tuple[int, str]:
    if int(ctx.cfg.slate.get("week") or 0):
        return int(ctx.cfg.slate["week"]), "config"
    if games and ctx.slate_date:
        weeks = {g.week for g in games if g.gameday == ctx.slate_date and g.game_type == "REG"}
        if len(weeks) == 1:
            return weeks.pop(), "schedule"
    if state and str(state.get("season")) == str(ctx.season):
        return int(state.get("week") or 0), "sleeper_state"
    return 0, "unknown"


def build(cfg: Config, http: Http, data_dir: Path, out_dir: Path, now: datetime, sample: bool = False,
          write: bool = True) -> int:
    tz = ZoneInfo(cfg.slate.get("timezone", "America/New_York"))
    ctx = Context(cfg=cfg, http=http, now=now)
    runner = Runner(cfg, Cache(data_dir / "cache" if write else None), now)
    notes: list[str] = []

    # 1. Salaries: manual CSV override wins while it is current, else the DraftKings endpoints.
    players: list[SlatePlayer] | None = None
    draft_info: dict = {}
    csv_path = data_dir / "overrides" / "DKSalaries.csv"
    if csv_path.exists():
        dropped_games: list[str] = []

        def _csv() -> list[SlatePlayer]:
            recs = draftkings.parse_salary_csv(csv_path.read_text(encoding="utf-8-sig"), tz)
            if cfg.slate.get("csv_main_slate_only", False):
                recs, dropped = draftkings.main_slate_only(recs, tz)
                dropped_games.extend(dropped)
            return recs

        players = runner.run(draftkings.CSV_META, _csv, validate=lambda recs: _slate_is_current(recs, now))
        if players:
            note = runner.statuses[draftkings.CSV_META.name].notes
            note.append("using uploaded DKSalaries.csv")
            if dropped_games:
                note.append("not main slate, dropped: " + ", ".join(dropped_games))
    if not players:

        def _dk() -> list[SlatePlayer]:
            recs, info = draftkings.fetch(ctx)
            draft_info.update(info)
            return recs

        players = runner.run(draftkings.META, _dk, decode=lambda d: SlatePlayer(**d),
                             validate=lambda recs: _slate_is_current(recs, now))
        if draft_info.get("via") and players:
            runner.statuses["draftkings"].notes.append(f"draftables API refused; used fallback {draft_info['via']}")
    elif cfg.enabled("draftkings"):
        runner.statuses["draftkings"] = SourceStatus(
            name="draftkings", label=draftkings.META.label, kind="salaries", access=draftkings.META.access,
            status="disabled", notes=["skipped: manual CSV in use"])

    if not players:
        _write_sources(out_dir, runner, {}, notes, now, write)
        print(_report(runner), file=sys.stderr)
        print("FATAL: no salaries available (live, CSV or cache).", file=sys.stderr)
        return 1

    kickoffs = sorted(p.kickoff for p in players if p.kickoff)
    first_kick = _parse_iso(kickoffs[0]).astimezone(tz) if kickoffs else now.astimezone(tz)
    ctx.slate_date = first_kick.date().isoformat()
    ctx.season = int(cfg.slate.get("season") or 0) or (first_kick.year if first_kick.month >= 3 else first_kick.year - 1)
    ctx.slate_teams = {p.team for p in players}

    # 2. Reference data.
    crosswalk = runner.run(nflverse.IDS_META, lambda: nflverse.fetch_ids(ctx), encode=lambda r: r)
    games = runner.run(nflverse.SCHEDULE_META, lambda: nflverse.fetch_games(ctx, ctx.season),
                       key=str(ctx.season), decode=lambda d: Game(**d))
    ctx.games = games or []
    state = None
    try:
        state = sleeper.fetch_state(ctx)
    except Exception as exc:  # noqa: BLE001
        notes.append(f"sleeper state unavailable: {type(exc).__name__}")
    ctx.week, week_source = detect_week(ctx, games, state)
    if not ctx.week:
        notes.append("could not determine NFL week; projection sources skipped")

    index = SlateIndex(players, crosswalk)
    rel_salary = cfg.sanity.get("relevant_salary", {})
    min_cov = float(cfg.sanity.get("min_coverage", 0.6))

    def coverage(recs: list[ProjRecord]) -> tuple[float | None, str | None]:
        matched = {index.match(r.name, r.pos, r.team, r.ids)[0] for r in recs}
        positions = {r.pos for r in recs}
        relevant = [p for p in players if p.pos in positions and p.salary >= rel_salary.get(p.pos, 0)
                    and p.dk_status not in ("O", "IR")]
        if not relevant:
            return None, None
        cov = round(sum(p.dk_id in matched for p in relevant) / len(relevant), 3)
        return cov, (f"covers {cov:.0%} of relevant slate players (minimum {min_cov:.0%})" if cov < min_cov else None)

    # 3. Projections.
    week_key = f"{ctx.season}-{ctx.week}"
    projections: dict[str, list[ProjRecord]] = {}
    for meta, fn in PROJECTION_SOURCES:
        if not ctx.week:
            runner.statuses[meta.name] = SourceStatus(meta.name, meta.label, meta.kind, meta.access,
                                                      status="failed", error="NFL week unknown")
            continue
        recs = runner.run(meta, lambda fn=fn: fn(ctx), key=week_key,
                          decode=lambda d: ProjRecord(**d), validate=coverage)
        if recs:
            projections[meta.name] = recs
        for note in ctx.extra.get("notes", {}).get(meta.name, []):
            runner.statuses[meta.name].notes.append(note)

    # 4. Injury status and history.
    statuses = runner.run(sleeper.STATUS_META, lambda: sleeper.fetch_status(ctx), decode=lambda d: StatusRecord(**d))
    fcfg = cfg.floor
    seasons = [ctx.season - i for i in range(int(fcfg.get("seasons_back", 1)), -1, -1)]
    weekly = runner.run(nflverse.STATS_META, lambda: nflverse.fetch_weekly(ctx, seasons), key=week_key,
                        encode=lambda r: r)

    # 5. Assemble.
    out_players, match_report = assemble(cfg, ctx, players, index, projections, statuses or [], weekly or [], tz)
    slate = slate_json(cfg, ctx, players, draft_info, week_source, now, sample, notes)
    if write:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "players.json").write_text(json.dumps(out_players, indent=1))
        (out_dir / "slate.json").write_text(json.dumps(slate, indent=1))
        if ctx.week and not sample:
            hist = data_dir / "history" / str(ctx.season) / f"week{ctx.week:02d}"
            hist.mkdir(parents=True, exist_ok=True)
            (hist / "players.json").write_text(json.dumps(out_players))
            (hist / "slate.json").write_text(json.dumps(slate))
    _write_sources(out_dir, runner, match_report, notes, now, write)
    print(_report(runner))
    return 0


def assemble(cfg: Config, ctx: Context, players: list[SlatePlayer], index: SlateIndex,
             projections: dict[str, list[ProjRecord]], statuses: list[StatusRecord], weekly: list[dict],
             tz: ZoneInfo) -> tuple[list[dict], dict]:
    by_player: dict[str, dict[str, ProjRecord]] = {p.dk_id: {} for p in players}
    methods: dict[str, dict[str, str]] = {p.dk_id: {} for p in players}
    unmatched: dict[str, list[dict]] = {}
    source_positions = {src: {r.pos for r in recs} for src, recs in projections.items()}
    for src, recs in projections.items():
        misses = []
        for r in recs:
            dk, how = index.match(r.name, r.pos, r.team, r.ids)
            if dk:
                by_player[dk][src] = r
                methods[dk][src] = how
            elif r.team in ctx.slate_teams:
                misses.append({"name": r.name, "pos": r.pos, "team": r.team, "points": round(r.points, 2)})
        unmatched[src] = sorted(misses, key=lambda m: -m["points"])[:25]

    injury: dict[str, str] = {}
    for s in statuses:
        if s.team in ctx.slate_teams:
            dk, _ = index.match(s.name, s.pos, s.team, s.ids)
            if dk:
                injury[dk] = s.status

    implied: dict[str, float] = {}
    for g in ctx.games:
        if g.week == ctx.week and g.implied():
            implied.update(g.implied())

    hist = history_by_player(weekly, ctx.season, ctx.week or 99)
    pool_min = cfg.pool_min
    late_hour = int(cfg.slate.get("late_game_hour", 16))
    out = []
    no_projection = []
    for p in players:
        recs = by_player[p.dk_id]
        vals = {src: round(r.points, 2) for src, r in recs.items()}
        weights = {src: cfg.source_weight(src) for src in vals}
        wsum = sum(weights.values())
        proj = round(sum(vals[s] * weights[s] for s in vals) / wsum, 2) if wsum else None
        sd = round(pstdev(vals.values()), 2) if len(vals) >= 2 else None

        status = p.dk_status
        detail = {"draftkings": p.dk_status}
        conflict = False
        if p.dk_id in injury:
            detail["sleeper"] = injury[p.dk_id]
            if injury[p.dk_id] != status:
                conflict = True
                if SEVERITY[injury[p.dk_id]] >= SEVERITY["D"] and status == "ACTIVE":
                    status = injury[p.dk_id]

        kick_local = _parse_iso(p.kickoff).astimezone(tz) if p.kickoff else None
        row: dict[str, Any] = {
            "id": p.dk_id, "name": p.name, "pos": p.pos, "team": p.team, "opp": p.opp, "home": p.home,
            "game": p.game, "kickoff": p.kickoff, "late": bool(kick_local and kick_local.hour >= late_hour),
            "salary": p.salary, "status": status, "status_detail": detail, "status_conflict": conflict,
            "projections": vals, "n_sources": len(vals),
            "missing_sources": sorted(s for s, pos in source_positions.items() if p.pos in pos and s not in vals),
            "proj": proj, "proj_sd": sd,
            "proj_min": min(vals.values()) if vals else None, "proj_max": max(vals.values()) if vals else None,
            "team_total": implied.get(p.team), "opp_total": implied.get(p.opp or ""),
            "match": methods[p.dk_id],
        }
        if proj is not None:
            key = index.gsis_by_dk.get(p.dk_id)
            pts = hist.get(key) if key else None
            pts = pts or hist.get(f"{normalize_name(p.name)}|{p.pos}")
            row.update(estimate(proj, p.pos, pts, cfg.floor))
        else:
            row.update({"floor": None, "sigma": None, "cv": None, "hist_games": 0, "hist_mean": None})
            if p.salary >= cfg.sanity.get("relevant_salary", {}).get(p.pos, 0):
                no_projection.append({"name": p.name, "pos": p.pos, "team": p.team, "salary": p.salary})
        row["in_pool"] = bool(proj is not None and proj >= float(pool_min.get(p.pos, 0))
                              and SEVERITY.get(status, 0) < SEVERITY["D"])
        out.append(row)
    out.sort(key=lambda r: (-(r["proj"] or 0), r["name"]))
    return out, {"unmatched": unmatched, "no_projection": no_projection}


def slate_json(cfg: Config, ctx: Context, players: list[SlatePlayer], draft_info: dict, week_source: str,
               now: datetime, sample: bool, notes: list[str]) -> dict:
    games: dict[str, dict] = {}
    for p in players:
        if p.game and p.game not in games:
            away, home = p.game.split("@")
            games[p.game] = {"game": p.game, "away": away, "home": home, "kickoff": p.kickoff}
    for g in ctx.games:
        key = f"{g.away}@{g.home}"
        if g.week == ctx.week and key in games:
            games[key].update({"total": g.total_line, "spread": g.spread_line, "implied": g.implied()})
    week_teams = {t for g in ctx.games if g.week == ctx.week for t in (g.home, g.away)}
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _iso(now),
        "sample": sample,
        "season": ctx.season, "week": ctx.week, "week_source": week_source,
        "slate_date": ctx.slate_date,
        "draft_group_id": draft_info.get("draft_group_id"),
        "games": sorted(games.values(), key=lambda g: (g["kickoff"] or "", g["game"])),
        "byes": sorted(set(TEAMS) - week_teams) if week_teams else [],
        "off_slate_teams": sorted(week_teams - ctx.slate_teams),
        "salary_cap": 50000,
        "pool_min_projection": cfg.pool_min,
        "floor_z": cfg.floor.get("z", 0.84),
        "late_game_hour": cfg.slate.get("late_game_hour", 16),
        "timezone": cfg.slate.get("timezone", "America/New_York"),
        "notes": notes,
    }


def _write_sources(out_dir: Path, runner: Runner, match_report: dict, notes: list[str], now: datetime,
                   write: bool) -> None:
    if not write:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": _iso(now),
        "sources": [s.to_json() for s in runner.statuses.values()],
        "failed": [s.name for s in runner.statuses.values() if s.status in ("failed", "stale")],
        "match_report": match_report,
        "notes": notes,
    }
    (out_dir / "sources.json").write_text(json.dumps(payload, indent=1))


def _report(runner: Runner) -> str:
    lines = [f"{'source':<20}{'status':<10}{'rows':>6}{'cover':>8}  detail"]
    for s in runner.statuses.values():
        cov = f"{s.coverage:.0%}" if s.coverage is not None else ""
        detail = s.error or "; ".join(s.notes) or ""
        if s.status == "stale":
            detail = f"using cache from {s.stale_hours}h ago. {detail}"
        lines.append(f"{s.name:<20}{s.status:<10}{s.rows:>6}{cov:>8}  {detail}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=None)
    ap.add_argument("--data-dir", type=Path, default=root / "data", help="cache, overrides and history")
    ap.add_argument("--out", type=Path, default=None, help="where to write JSON (default <data-dir>/latest)")
    ap.add_argument("--fixtures", type=Path, default=None, help="read sources from fixture files (offline)")
    ap.add_argument("--now", default=None, help="ISO timestamp to treat as now (tests)")
    ap.add_argument("--sample", action="store_true", help="mark output as sample data")
    ap.add_argument("--dry-run", action="store_true", help="probe sources and print the report only")
    args = ap.parse_args(argv)
    now = _parse_iso(args.now) if args.now else datetime.now(timezone.utc)
    return build(Config.load(args.config), Http(args.fixtures), args.data_dir, args.out or args.data_dir / "latest",
                 now, sample=args.sample, write=not args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
