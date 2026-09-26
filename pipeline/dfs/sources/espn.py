"""ESPN fantasy projections.

Unofficial endpoint behind ESPN's fantasy web app (no auth for league-default views). ESPN has
moved this host before (fantasy.espn.com -> lm-api-reads.fantasy.espn.com). Stat IDs below are
ESPN's internal codes; we rescore with DraftKings rules because ESPN's own PPR scoring differs
(e.g. -2 per interception, no yardage bonuses).

Team defenses are skipped: ESPN's D/ST projections are in ESPN scoring (different
points-allowed and yards-allowed tiers) and the stat codes are not documented well enough to rescore.
"""
from __future__ import annotations

import json

from ..models import ProjRecord, SourceError
from ..names import normalize_team
from ..scoring import dk_points, has_stats
from .base import Context, SourceMeta

META = SourceMeta("espn", "ESPN projections", "projections", "Unofficial public endpoint")

URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3"

POSITION = {1: "QB", 2: "RB", 3: "WR", 4: "TE"}
PRO_TEAM = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB",
    10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE",
    18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF",
    26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}
STAT = {
    "3": "pass_yd", "4": "pass_td", "20": "pass_int", "24": "rush_yd", "25": "rush_td",
    "53": "rec", "42": "rec_yd", "43": "rec_td", "72": "fum_lost",
    "19": "two_pt", "26": "two_pt", "44": "two_pt",
}


def parse(data: dict, season: int, week: int) -> list[ProjRecord]:
    out = []
    for entry in data.get("players") or []:
        p = entry.get("player") or entry
        pos = POSITION.get(p.get("defaultPositionId"))
        if not pos:
            continue
        proj = next(
            (s for s in p.get("stats") or []
             if s.get("statSourceId") == 1 and s.get("scoringPeriodId") == week
             and int(s.get("seasonId") or season) == season),
            None,
        )
        if not proj:
            continue
        stats: dict[str, float] = {}
        for code, val in (proj.get("stats") or {}).items():
            key = STAT.get(str(code))
            if key:
                stats[key] = stats.get(key, 0.0) + float(val or 0)
        if not has_stats(pos, stats):
            continue
        out.append(ProjRecord(
            source="espn", name=p.get("fullName", ""), pos=pos,
            team=normalize_team(PRO_TEAM.get(p.get("proTeamId"))),
            points=dk_points(pos, stats), stats=stats, ids={"espn_id": str(p.get("id"))},
        ))
    return out


ENOUGH = 150  # a full week of QB/RB/WR/TE projections is several hundred players


def _variants(season: int, week: int) -> list[tuple[str, dict, dict | None]]:
    """(label, query params, X-Fantasy-Filter), best first. Without a filter ESPN returns only ~50
    players, and a limit without a sort is rejected with 400 ("Limit request must be accompanied
    by a sort"). Seen working from GitHub Actions: limit 1000 + sort by owned (week 3, 2026)."""
    view = {"view": "kona_player_info"}
    wk = {**view, "scoringPeriodId": week}
    slots = {"filterSlotIds": {"value": [0, 2, 4, 6]}}
    by_owned = {"sortPercOwned": {"sortAsc": False, "sortPriority": 1}}
    return [
        ("limit 1000 + sort by owned", wk, {"players": {"limit": 1000, **by_owned}}),
        ("limit 500 + slots", wk, {"players": {"limit": 500, **slots, **by_owned}}),
        ("limit 250", view, {"players": {"limit": 250, **by_owned}}),
        ("no filter", view, None),
    ]


def fetch(ctx: Context) -> list[ProjRecord]:
    notes = ctx.extra.setdefault("notes", {}).setdefault("espn", [])
    best: tuple[str, list[ProjRecord]] | None = None
    for label, params, flt in _variants(ctx.season, ctx.week):
        headers = {"Accept": "application/json"}
        if flt is not None:
            headers["X-Fantasy-Filter"] = json.dumps(flt)
        try:
            data = ctx.http.get_json(URL.format(season=ctx.season), params=params, headers=headers,
                                     fixture="espn_projections.json")
        except Exception as exc:  # noqa: BLE001 - record and try the next variant
            notes.append(f"{label}: {exc}"[:200])
            continue
        if not isinstance(data, dict) or "players" not in data:
            notes.append(f"{label}: unexpected payload")
            continue
        recs = parse(data, ctx.season, ctx.week)
        notes.append(f"{label}: {len(data['players'])} players, {len(recs)} week-{ctx.week} projections")
        if best is None or len(recs) > len(best[1]):
            best = (label, recs)
        if len(recs) >= ENOUGH:
            break
    if not best or not best[1]:
        raise SourceError("no request variant returned projections (see notes)")
    notes.append(f"using: {best[0]}")
    return best[1]
