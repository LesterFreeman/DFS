"""Player context for the site's Compare tab: game log, season summary and matchup.

Built from data the pipeline already has: nflverse weekly stats (actual points, stat lines,
opponents), the schedule, and our own earlier pre-kickoff projections saved under history/.
Context only: none of this changes projections or value.

    log           this season's games before this week, newest first (max 8):
                  {week, opp, actual, proj, line, dnp}; proj = our pre-kickoff consensus that week
    season_stats  games, average DK points, targets/carries per game, target share, 20+ point games
    matchup       how many DK points the opponent allows to this position per game, its rank
                  (1 = allows the most = best matchup) and the league average. DSTs get the
                  opponent offense's points scored per game instead (1 = scores the fewest).
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

from .models import Game
from .names import normalize_name

LOG_GAMES = 8
MIN_GAMES = 3  # below this, a defense's numbers also use last season's games


def _keys(gsis: str | None, name: str, pos: str) -> list[str]:
    return ([gsis] if gsis else []) + [f"{normalize_name(name)}|{pos}"]


def index_weekly(weekly: list[dict], season: int) -> dict[str, dict[int, dict]]:
    """{player key: {week: stats row}} for one season (keys: gsis_id and name|pos)."""
    out: dict[str, dict[int, dict]] = defaultdict(dict)
    for r in weekly:
        if r["season"] != season:
            continue
        for k in _keys(r.get("gsis_id"), r["name"], r["pos"]):
            out[k][r["week"]] = r
    return out


def past_projections(data_dir: Path, season: int, week: int) -> dict[int, dict[str, float]]:
    """{week: {player key: our pre-kickoff consensus}} from history snapshots before `week`."""
    out: dict[int, dict[str, float]] = {}
    root = data_dir / "history" / str(season)
    for wd in sorted(root.glob("week[0-9][0-9]")) if root.exists() else []:
        w = int(wd.name[4:])
        if w >= week or not (wd / "players.json").exists():
            continue
        try:
            rows = json.loads((wd / "players.json").read_text())
        except ValueError:
            continue
        proj: dict[str, float] = {}
        for p in rows:
            if p.get("proj") is None:
                continue
            for k in _keys(p.get("gsis_id"), p["name"], p["pos"]):
                proj.setdefault(k, p["proj"])
        out[w] = proj
    return out


def _opponents(games: list[Game], season: int) -> dict[tuple[str, int], str]:
    out = {}
    for g in games:
        if g.season == season and g.game_type == "REG":
            out[(g.home, g.week)] = g.away
            out[(g.away, g.week)] = g.home
    return out


def game_log(gsis: str | None, name: str, pos: str, team: str, weekly_idx: dict[str, dict[int, dict]],
             past_proj: dict[int, dict[str, float]], games: list[Game], season: int, week: int) -> list[dict]:
    keys = _keys(gsis, name, pos)
    played: dict[int, dict] = {}
    for k in keys:
        if k in weekly_idx:
            played = weekly_idx[k]
            break
    opps = _opponents(games, season)
    weeks = sorted({w for w in played} | {w for (t, w) in opps if t == team}, reverse=True)
    out = []
    for w in weeks:
        if w >= week:
            continue
        row = played.get(w)
        proj = next((past_proj.get(w, {})[k] for k in keys if k in past_proj.get(w, {})), None)
        if row is None:
            if proj is None and not played:
                continue  # no history at all for this player that week (e.g. rookie before his debut)
            out.append({"week": w, "opp": opps.get((team, w)), "actual": 0.0, "proj": proj, "line": {}, "dnp": True})
        else:
            out.append({"week": w, "opp": row.get("opp") or opps.get((row.get("team") or team, w)),
                        "actual": round(row["pts"], 2), "proj": proj, "line": row.get("line", {}), "dnp": False})
        if len(out) >= LOG_GAMES:
            break
    return out


def season_summary(log: list[dict]) -> dict | None:
    games = [g for g in log if not g["dnp"]]
    if not games:
        return None
    per = lambda key: round(mean(g["line"].get(key, 0) for g in games), 1)  # noqa: E731
    shares = [g["line"]["tgt_share"] for g in games if "tgt_share" in g["line"]]
    return {
        "games": len(games),
        "avg": round(mean(g["actual"] for g in games), 2),
        "tgt": per("tgt"), "car": per("car"),
        "tgt_share": round(mean(shares), 3) if shares else None,
        "games_20": sum(g["actual"] >= 20 for g in games),
    }


def defense_vs_position(weekly: list[dict], season: int, week: int) -> dict[tuple[str, str], dict]:
    """{(defense team, pos): {allowed, rank, pos_avg, games}}: DK points allowed per game."""
    def totals(s: int, max_week: int) -> dict[tuple[str, str], list[float]]:
        per_game: dict[tuple[str, str, int], float] = defaultdict(float)
        for r in weekly:
            if r["season"] == s and r["week"] < max_week and r.get("opp"):
                per_game[(r["opp"], r["pos"], r["week"])] += r["pts"]
        out: dict[tuple[str, str], list[float]] = defaultdict(list)
        for (team, pos, _), pts in per_game.items():
            out[(team, pos)].append(pts)
        return out

    cur, prev = totals(season, week), totals(season - 1, 99)
    result: dict[tuple[str, str], dict] = {}
    for pos in ("QB", "RB", "WR", "TE"):
        allowed = {}
        for team in {t for (t, p) in list(cur) + list(prev) if p == pos}:
            games = cur.get((team, pos), [])
            if len(games) < MIN_GAMES:
                games = games + prev.get((team, pos), [])
            if games:
                allowed[team] = (mean(games), len(games))
        avg = mean(a for a, _ in allowed.values()) if allowed else 0
        for rank, (team, (a, n)) in enumerate(sorted(allowed.items(), key=lambda kv: -kv[1][0]), start=1):
            result[(team, pos)] = {"allowed": round(a, 1), "rank": rank, "pos_avg": round(avg, 1), "games": n,
                                   "teams": len(allowed)}
    return result


def offense_points(games: list[Game], season: int, week: int) -> dict[str, dict]:
    """{team: {scored, rank, avg, games}}: points scored per game (rank 1 = fewest, best for a DST)."""
    pts: dict[str, list[float]] = defaultdict(list)
    for g in games:
        if g.season == season and g.week < week and g.home_score is not None and g.away_score is not None:
            pts[g.home].append(g.home_score)
            pts[g.away].append(g.away_score)
    if not pts:
        return {}
    avg = mean(mean(v) for v in pts.values())
    ordered = sorted(pts.items(), key=lambda kv: mean(kv[1]))
    return {t: {"scored": round(mean(v), 1), "rank": i, "avg": round(avg, 1), "games": len(v), "teams": len(pts)}
            for i, (t, v) in enumerate(ordered, start=1)}


def attach(rows: list[dict], weekly: list[dict], games: list[Game], data_dir: Path | None, season: int,
           week: int) -> None:
    """Add log, season_stats and matchup to every projected player row (in place)."""
    if not week:
        return
    idx = index_weekly(weekly, season)
    past = past_projections(data_dir, season, week) if data_dir else {}
    dvp = defense_vs_position(weekly, season, week)
    offense = offense_points(games, season, week)
    for r in rows:
        if r.get("proj") is None:
            continue
        if r["pos"] == "DST":
            o = offense.get(r.get("opp") or "")
            r["matchup"] = ({"kind": "offense", "allowed": o["scored"], "rank": o["rank"], "pos_avg": o["avg"],
                             "games": o["games"], "teams": o["teams"]} if o else None)
            continue
        log = game_log(r.get("gsis_id"), r["name"], r["pos"], r["team"], idx, past, games, season, week)
        r["log"] = log
        r["season_stats"] = season_summary(log)
        d = dvp.get((r.get("opp") or "", r["pos"]))
        r["matchup"] = {"kind": "defense", **d} if d else None
