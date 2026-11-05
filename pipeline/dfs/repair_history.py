"""Rebuild a week's history snapshot from the data branch's git history.

Until November 2026, games dropping out of DraftKings' feed after kickoff made the pipeline think
the week's slate had not started, so on Sunday evening it switched to the Primetime slate and
overwrote the week's snapshot (weeks 5-8 of 2026). Every earlier run is still in git, so the
snapshot can be rebuilt: for each player, the last row saved before his game kicked off.

    python -m dfs.repair_history --repo <checkout of the data branch> --week 5 --draft-group 154470

writes history/<season>/weekNN/{players,slate}.json in that checkout (commit them yourself). The
next pipeline run, or `python -m dfs.backfill --regrade`, grades the repaired week.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def snapshots(repo: Path, ref: str, base: str) -> list[tuple[dict, list[dict]]]:
    """(slate, players) for every commit of `base`/players.json on `ref`, oldest first."""
    out = []
    for commit in _git(repo, "log", "--format=%H", "--reverse", ref, "--", f"{base}/players.json").split():
        try:
            slate = json.loads(_git(repo, "show", f"{commit}:{base}/slate.json"))
            players = json.loads(_git(repo, "show", f"{commit}:{base}/players.json"))
        except (subprocess.CalledProcessError, ValueError):
            continue
        out.append((slate, players))
    return out


def rebuild(history: list[tuple[dict, list[dict]]], group: int) -> tuple[dict, list[dict]]:
    """Each player's last row from before his game kicked off, across the runs of draft group `group`."""
    runs = [(s, ps) for s, ps in history if s.get("draft_group_id") == group]
    if not runs:
        raise ValueError(f"no snapshots of draft group {group}")
    game_info: dict[str, dict] = {}
    rows: dict[str, dict] = {}
    for slate, players in runs:
        at = _parse_iso(slate["generated_at"])
        for p in players:
            if p.get("game") and p.get("kickoff"):
                game_info[p["id"]] = {k: p.get(k) for k in ("opp", "home", "game", "kickoff", "late")}
        for p in players:
            kick = game_info.get(p["id"], {}).get("kickoff")
            if kick and _parse_iso(kick) <= at and p["id"] in rows:
                continue  # his game had started: keep the row from before kickoff
            rows[p["id"]] = p
    out = []
    for pid, p in rows.items():
        p = {k: v for k, v in p.items() if k != "log"}
        if not p.get("game") and pid in game_info:
            p.update(game_info[pid])
        out.append(p)
    # The slate as first seen (all games listed), stamped with the last run's time.
    slate = max((s for s, _ in runs), key=lambda s: len(s.get("games", [])))
    kicks = sorted(g["kickoff"] for g in slate.get("games", []) if g.get("kickoff"))
    slate = {**slate, "generated_at": runs[-1][0]["generated_at"], "first_kickoff": kicks[0] if kicks else None,
             "notes": [*slate.get("notes", []), "rebuilt from git history (dfs.repair_history)"]}
    return slate, out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", type=Path, required=True, help="git checkout whose history holds the snapshots")
    ap.add_argument("--ref", default="HEAD", help="branch or commit to read history from")
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", type=int, required=True)
    ap.add_argument("--draft-group", type=int, required=True, help="the main slate's DraftKings draft group")
    ap.add_argument("--data-dir", type=Path, default=None, help="where to write (default: --repo)")
    args = ap.parse_args(argv)
    base = f"history/{args.season}/week{args.week:02d}"
    slate, players = rebuild(snapshots(args.repo, args.ref, base), args.draft_group)
    out = (args.data_dir or args.repo) / base
    out.mkdir(parents=True, exist_ok=True)
    (out / "players.json").write_text(json.dumps(players))
    (out / "slate.json").write_text(json.dumps(slate))
    print(f"{base}: {len(players)} players, {sum(1 for p in players if p.get('in_pool'))} in pool, "
          f"{len(slate.get('games', []))} games")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
