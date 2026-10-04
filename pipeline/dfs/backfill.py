"""Backfill past weeks into the backtest.

    python -m dfs.backfill --data-dir ../data 195541057 195736168     # DraftKings contest IDs
    python -m dfs.backfill --data-dir ../data dg:133456                # a draft group (slate) ID
    python -m dfs.backfill --data-dir ../data dg:133456:w1             # ... and its NFL week, if it can't be worked out

For each target: find the contest's DraftKings draft group (slate), download that slate's
salaries, and rebuild the week with the normal pipeline (projections requested for that week,
floors from games before it). The result goes to history/<season>/week<NN>/ marked "backfilled",
then latest/backtest.json is regenerated so the site shows it.

Backfilled weeks are less trustworthy than weeks saved live:
- today's injury statuses can't be applied to a past week, so only DraftKings' own status is used
  (projection sources usually cut a player ruled out before kickoff to ~0, which keeps him out of
  the value pool anyway);
- the projections are whatever each source serves for that week now, which should be its final
  pre-game numbers but can't be verified as such.

A week that already has a live snapshot is left alone unless --force is given.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import backtest
from .build import build
from .config import Config
from .http import Http
from .sources import nflverse
from .sources.base import Context
from .sources.draftkings import DK_HEADERS

CONTEST_API = "https://api.draftkings.com/contests/v1/contests/{id}"
CONTEST_PAGES = (
    "https://www.draftkings.com/contest/detailspop?contestId={id}",
    "https://www.draftkings.com/contest/gamecenter/{id}",
)
GROUP_RE = re.compile(r"""draft_?group_?id["']?\s*[:=]\s*["']?(\d{4,})""", re.IGNORECASE)


def resolve_draft_group(http: Http, target: str) -> tuple[int, dict, list[str]]:
    """(draft group id, contest info, log of attempts). Raises ValueError when nothing works."""
    log: list[str] = []
    if target.lower().startswith("dg:"):
        return int(target[3:]), {}, ["draft group given directly"]
    contest_id = int(target)
    try:
        data = http.get_json(CONTEST_API.format(id=contest_id), params={"format": "json"}, headers=DK_HEADERS,
                             fixture=f"dk_contest_{contest_id}.json")
        detail = data.get("contestDetail") or {}
        if detail.get("draftGroupId"):
            info = {"contest_name": detail.get("name"), "game_type": detail.get("gameType"),
                    "contest_start": detail.get("contestStartTime")}
            log.append(f"contests API: draft group {detail['draftGroupId']}")
            return int(detail["draftGroupId"]), info, log
        log.append("contests API: no draftGroupId in the response")
    except Exception as exc:  # noqa: BLE001 - try the pages below
        log.append(f"contests API: {type(exc).__name__}: {exc}"[:200])
    for i, url in enumerate(CONTEST_PAGES):
        try:
            html = http.get_text(url.format(id=contest_id), headers=DK_HEADERS,
                                 fixture=f"dk_contest_{contest_id}_page{i}.html")
            m = GROUP_RE.search(html)
            if m:
                log.append(f"{url.split('?')[0].format(id=contest_id)}: draft group {m.group(1)}")
                return int(m.group(1)), {}, log
            log.append(f"{url.format(id=contest_id)}: no draft group in the page")
        except Exception as exc:  # noqa: BLE001
            log.append(f"{url.format(id=contest_id)}: {type(exc).__name__}: {exc}"[:200])
    raise ValueError(
        f"could not find the slate for contest {contest_id}. DraftKings refuses these lookups from GitHub's servers; "
        f"open {CONTEST_API.format(id=contest_id)}?format=json in a browser, copy the draftGroupId, and backfill "
        f"with dg:<that number> instead. Attempts: " + " | ".join(log))


def backfill_one(cfg: Config, http: Http, data_dir: Path, target: str, now: datetime, force: bool = False) -> str:
    """Rebuild one past week. Returns a one-line summary (raises on failure)."""
    target, _, hint = target.partition(":w")  # optional week, e.g. dg:153069:w1
    group_id, info, log = resolve_draft_group(http, target)
    wcfg = Config(copy.deepcopy(cfg.raw))
    wcfg.raw.setdefault("slate", {})["draft_group_id"] = group_id
    wcfg.raw["slate"]["season"] = 0
    wcfg.raw["slate"]["week"] = int(hint) if hint.isdigit() else 0
    tmp = Path(tempfile.mkdtemp(prefix="backfill-"))
    try:
        code = build(wcfg, http, data_dir, tmp, now, backfill=True)
        if code != 0 or not (tmp / "slate.json").exists():
            sources = json.loads((tmp / "sources.json").read_text()) if (tmp / "sources.json").exists() else {}
            dk = next((s for s in sources.get("sources", []) if s["name"] == "draftkings"), {})
            raise ValueError(f"no salaries for draft group {group_id}: {dk.get('error') or 'see the log'}")
        slate = json.loads((tmp / "slate.json").read_text())
        season, week = slate["season"], slate["week"]
        if not week:
            raise ValueError(f"draft group {group_id}: could not tell which NFL week it is")
        hist = data_dir / "history" / str(season) / f"week{week:02d}"
        if (hist / "slate.json").exists() and not force:
            existing = json.loads((hist / "slate.json").read_text())
            if not existing.get("backfilled"):
                return f"{target}: {season} week {week} already has a live snapshot; left alone (use --force)"
        slate.update({"draft_group_id": group_id, "contest_id": None if target.lower().startswith("dg:") else target,
                      **{k: v for k, v in info.items() if v}, "backfill_log": log})
        hist.mkdir(parents=True, exist_ok=True)
        shutil.copy(tmp / "players.json", hist / "players.json")
        (hist / "slate.json").write_text(json.dumps(slate))
        shutil.copy(tmp / "sources.json", hist / "sources.json")
        (hist / "actuals.json").unlink(missing_ok=True)  # re-graded below
        sources = json.loads((tmp / "sources.json").read_text())["sources"]
        proj = ", ".join(f"{s['name']} {s['rows']}" for s in sources if s["kind"] == "projections" and s["status"] == "ok")
        players = json.loads((tmp / "players.json").read_text())
        return (f"{target}: {season} week {week}, draft group {group_id}, {len(slate['games'])} games, "
                f"{len(players)} players, {sum(p['in_pool'] for p in players)} in the value pool; projections: {proj or 'none'}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def regrade(cfg: Config, http: Http, data_dir: Path, now: datetime) -> list[str]:
    """Regenerate latest/backtest.json over every history week."""
    current = None
    latest = data_dir / "latest" / "slate.json"
    if latest.exists():
        s = json.loads(latest.read_text())
        if s.get("week"):
            current = (int(s["season"]), int(s["week"]))
    seasons = sorted({int(p.name) for p in (data_dir / "history").iterdir() if p.name.isdigit()})
    ctx = Context(cfg=cfg, http=http, now=now)
    weekly = nflverse.fetch_weekly(ctx, seasons)
    teams = nflverse.fetch_team_weekly(ctx, seasons)
    games = [g for season in seasons for g in nflverse.fetch_games(ctx, season)]
    return backtest.update(data_dir, data_dir / "latest", weekly, teams, games, now, current=current)


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("targets", nargs="+", help="DraftKings contest IDs, or dg:<draft group id>")
    ap.add_argument("--data-dir", type=Path, default=root / "data")
    ap.add_argument("--config", type=Path, default=None)
    ap.add_argument("--fixtures", type=Path, default=None, help="read sources from fixture files (offline)")
    ap.add_argument("--now", default=None, help="ISO timestamp to treat as now (tests)")
    ap.add_argument("--force", action="store_true", help="replace a week's live snapshot")
    args = ap.parse_args(argv)
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(timezone.utc)
    cfg = Config.load(args.config)
    http = Http(args.fixtures)
    targets = [t for arg in args.targets for t in re.split(r"[\s,]+", arg) if t]
    ok = 0
    for t in targets:
        try:
            print("BACKFILL " + backfill_one(cfg, http, args.data_dir, t, now, args.force))
            ok += 1
        except Exception as exc:  # noqa: BLE001 - one bad target must not stop the others
            print(f"BACKFILL {t}: FAILED: {exc}"[:1500])
    if ok:
        try:
            for line in regrade(cfg, http, args.data_dir, now):
                print("BACKTEST " + line)
        except Exception as exc:  # noqa: BLE001
            print(f"BACKTEST regrade failed: {type(exc).__name__}: {exc}")
    return 0 if ok == len(targets) else 1


if __name__ == "__main__":
    sys.exit(main())
