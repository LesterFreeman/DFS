"""Backtest: grade each finished week's pre-lock snapshot against what players actually scored.

    history/<season>/week<NN>/players.json   the week's projections; each row freezes at its kickoff
    history/<season>/week<NN>/actuals.json   actual DraftKings points per DK player id (written here)
    latest/backtest.json                      every graded week (compact) plus accuracy metrics,
                                              read by the site's Backtest tab

Actual points come from the same open nflverse files as the floor model: weekly player stats for
offense, weekly team stats plus the opponent's final score for DSTs. DST points allowed use the
opponent's final score, which can differ from DraftKings' figure when the opponent scored a
defensive or return touchdown (DraftKings may count those differently).

A week is graded only when every game on its slate has a final score and the stats files have
that week, so a Monday-night game still in progress never produces half-graded results. Graded
weeks are re-graded on later runs while the stats are still available, picking up stat corrections.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from math import sqrt
from pathlib import Path
from statistics import mean

from .models import Game
from .names import normalize_name
from .scoring import dk_points

FLOOR_TARGET = 0.20  # floor is the ~20th percentile, so about 20% of players should score below it
BUNDLE_MIN_ACTUAL = 8.0  # players outside the value pool are kept in backtest.json only if they scored this
POSITIONS = ("QB", "RB", "WR", "TE", "DST")
# Fields the site needs to rerun the value model and optimizer on a past week.
BUNDLE_KEYS = ("id", "name", "pos", "team", "opp", "home", "game", "kickoff", "late", "salary", "status",
               "projections", "n_sources", "proj", "proj_sd", "proj_min", "proj_max", "team_total", "opp_total",
               "floor", "sigma", "cv", "hist_games", "hist_mean", "in_pool")


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def freeze_locked(previous: list[dict] | None, current: list[dict], now: datetime) -> tuple[list[dict], int]:
    """Keep each player's last pre-kickoff row once his game has started.

    The history snapshot is rewritten on every run of the week, including runs after the games
    (Sunday afternoon, Monday). Without this, those rows would hold whatever the sources say
    after lock, not what we projected when lineups were set.
    """
    prev = {r["id"]: r for r in previous or []}
    out, frozen = [], 0
    for r in current:
        k = r.get("kickoff")
        if k and _parse_iso(k) <= now and r["id"] in prev:
            out.append(prev[r["id"]])
            frozen += 1
        else:
            out.append(r)
    return out, frozen


def _games_by_key(games: list[Game], season: int, week: int) -> dict[str, Game]:
    return {f"{g.away}@{g.home}": g for g in games if g.season == season and g.week == week}


def week_complete(rows: list[dict], weekly: list[dict], team_weekly: list[dict], games: list[Game],
                  season: int, week: int) -> str | None:
    """None when the week can be graded, else the reason it cannot yet."""
    sched = _games_by_key(games, season, week)
    slate_games = {r["game"] for r in rows if r.get("game")}
    if not slate_games:
        return "snapshot has no games"
    missing = sorted(g for g in slate_games if g not in sched)
    if missing:
        return f"games not in the schedule: {', '.join(missing[:3])}"
    unplayed = sorted(g for g in slate_games if sched[g].home_score is None or sched[g].away_score is None)
    if unplayed:
        return f"no final score yet for {', '.join(unplayed[:3])}"
    if not any(r["season"] == season and r["week"] == week for r in weekly):
        return "player stats not published yet"
    teams = {t for g in slate_games for t in g.split("@")}
    have = {r["team"] for r in team_weekly if r["season"] == season and r["week"] == week}
    if not teams <= have:
        return "team stats not published yet"
    return None


def actual_points(rows: list[dict], weekly: list[dict], team_weekly: list[dict], games: list[Game],
                  season: int, week: int) -> dict[str, dict]:
    """{dk_id: {"pts": float, "played": bool}} for every row of the snapshot.

    A player with no stat line scored 0 and is marked played=False (inactive, or never touched
    the ball); the metrics leave those out of accuracy figures and list them separately.
    """
    wk = [r for r in weekly if r["season"] == season and r["week"] == week]
    by_gsis = {r["gsis_id"]: r for r in wk if r.get("gsis_id")}
    by_npt = {f"{r['name']}|{r['pos']}|{r.get('team')}": r for r in wk}
    by_np: dict[str, list[dict]] = defaultdict(list)
    for r in wk:
        by_np[f"{r['name']}|{r['pos']}"].append(r)
    teams = {r["team"]: r for r in team_weekly if r["season"] == season and r["week"] == week}
    sched = _games_by_key(games, season, week)

    out: dict[str, dict] = {}
    for p in rows:
        if p["pos"] == "DST":
            t = teams.get(p["team"])
            g = sched.get(p.get("game") or "")
            if not t or not g:
                out[p["id"]] = {"pts": 0.0, "played": False}
                continue
            allowed = g.away_score if g.home == p["team"] else g.home_score
            stats = {k: t[k] for k in ("sack", "def_int", "fum_rec", "def_td", "safety", "blk_kick")}
            stats["pts_allow"] = allowed or 0.0
            out[p["id"]] = {"pts": dk_points("DST", stats, expected=False), "played": True}
            continue
        name = normalize_name(p["name"])
        hit = by_gsis.get(p.get("gsis_id") or "") or by_npt.get(f"{name}|{p['pos']}|{p['team']}")
        if hit is None and len(by_np.get(f"{name}|{p['pos']}", [])) == 1:
            hit = by_np[f"{name}|{p['pos']}"][0]
        out[p["id"]] = {"pts": round(hit["pts"], 2), "played": True} if hit else {"pts": 0.0, "played": False}
    return out


def _summary(pairs: list[tuple[float, float]]) -> dict:
    """pairs of (projected, actual)."""
    n = len(pairs)
    if not n:
        return {"n": 0}
    err = [a - p for p, a in pairs]
    out = {"n": n, "mae": round(mean(abs(e) for e in err), 2), "bias": round(mean(err), 2),
           "rmse": round(sqrt(mean(e * e for e in err)), 2), "corr": None}
    if n >= 3:
        mp, ma = mean(p for p, _ in pairs), mean(a for _, a in pairs)
        sp = sqrt(sum((p - mp) ** 2 for p, _ in pairs))
        sa = sqrt(sum((a - ma) ** 2 for _, a in pairs))
        if sp > 0 and sa > 0:
            out["corr"] = round(sum((p - mp) * (a - ma) for p, a in pairs) / (sp * sa), 3)
    return out


def grade(rows: list[dict]) -> dict:
    """Accuracy metrics over rows that carry "actual" and "played".

    Only players in the value pool at lock (a projection above the position minimum, not D/O/IR)
    who recorded a stat are scored; in-pool players who did not play are listed as "dnp".
    """
    pool = [r for r in rows if r.get("in_pool") and r.get("proj") is not None]
    played = [r for r in pool if r["played"]]
    groups = {"ALL": played, **{pos: [r for r in played if r["pos"] == pos] for pos in POSITIONS}}

    sources = sorted({s for r in played for s in r.get("projections", {})})
    projection: dict[str, dict] = {}
    for src in ["consensus", *sources]:
        by_pos = {}
        for key, grp in groups.items():
            if src == "consensus":
                rs = grp
                pairs = [(r["proj"], r["actual"]) for r in rs]
            else:
                rs = [r for r in grp if src in r.get("projections", {})]
                pairs = [(r["projections"][src], r["actual"]) for r in rs]
            if not pairs:
                continue
            s = _summary(pairs)
            if src != "consensus":  # the consensus on the same players, for a fair comparison
                s["mae_consensus"] = _summary([(r["proj"], r["actual"]) for r in rs])["mae"]
            by_pos[key] = s
        if by_pos:
            projection[src] = by_pos

    floor = {}
    for key, grp in groups.items():
        rs = [r for r in grp if r.get("floor") is not None]
        if rs:
            below = sum(r["actual"] < r["floor"] for r in rs)
            floor[key] = {"n": len(rs), "below": below, "share": round(below / len(rs), 3)}

    dnp = [{"name": r["name"], "pos": r["pos"], "team": r["team"], "salary": r["salary"], "proj": r["proj"],
            "status": r.get("status"), **({"week": r["week"]} if "week" in r else {})}
           for r in pool if not r["played"]]
    return {"n_pool": len(pool), "n_graded": len(played), "projection": projection,
            "floor": floor, "floor_target": FLOOR_TARGET, "dnp": sorted(dnp, key=lambda d: -(d["proj"] or 0))}


def _week_dirs(data_dir: Path) -> list[tuple[int, int, Path]]:
    out = []
    root = data_dir / "history"
    for season_dir in sorted(root.iterdir()) if root.exists() else []:
        if not season_dir.name.isdigit():
            continue
        for wd in sorted(season_dir.glob("week[0-9][0-9]")):
            if (wd / "players.json").exists():
                out.append((int(season_dir.name), int(wd.name[4:]), wd))
    return out


def update(data_dir: Path, out_dir: Path | None, weekly: list[dict], team_weekly: list[dict], games: list[Game],
           now: datetime, current: tuple[int, int] | None = None) -> list[str]:
    """Write actuals.json for every finished week and latest/backtest.json. Returns notes for the log."""
    notes: list[str] = []
    weeks = []
    for season, week, wd in _week_dirs(data_dir):
        if current and (season, week) >= current:
            continue  # this week's slate has not been played yet
        rows = json.loads((wd / "players.json").read_text())
        actuals_path = wd / "actuals.json"
        why = week_complete(rows, weekly, team_weekly, games, season, week)
        if why is None:
            actuals = actual_points(rows, weekly, team_weekly, games, season, week)
            actuals_path.write_text(json.dumps({"graded_at": _iso(now), "season": season, "week": week,
                                                "actuals": actuals}))
        elif actuals_path.exists():
            actuals = json.loads(actuals_path.read_text())["actuals"]  # keep the last grading
        else:
            notes.append(f"{season} week {week}: not graded yet ({why})")
            continue
        slate = {}
        if (wd / "slate.json").exists():
            slate = json.loads((wd / "slate.json").read_text())
        compact = []
        for r in rows:
            a = actuals.get(r["id"], {"pts": 0.0, "played": False})
            if not r.get("in_pool") and a["pts"] < BUNDLE_MIN_ACTUAL:
                continue  # outside the pool and scored little: only big scores matter (hindsight lineup)
            compact.append({**{k: r.get(k) for k in BUNDLE_KEYS}, "actual": a["pts"], "played": a["played"]})
        weeks.append({"season": season, "week": week, "slate_label": slate.get("slate_label"),
                      "snapshot_at": slate.get("generated_at"), "backfilled": bool(slate.get("backfilled")),
                      "players": compact,
                      "metrics": grade(compact)})
        m = weeks[-1]["metrics"]
        cons = m["projection"].get("consensus", {}).get("ALL", {})
        fl = m["floor"].get("ALL", {})
        notes.append(f"{season} week {week}: graded {m['n_graded']} players, consensus MAE {cons.get('mae')}, "
                     f"bias {cons.get('bias'):+}, {fl.get('share', 0):.0%} below floor" if cons else
                     f"{season} week {week}: nothing to grade")
    if out_dir is not None:
        everything = [{**r, "week": w["week"], "season": w["season"]} for w in weeks for r in w["players"]]
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "backtest.json").write_text(json.dumps({
            "generated_at": _iso(now),
            "weeks": weeks,
            "overall": grade(everything) if weeks else None,
        }))
    return notes
