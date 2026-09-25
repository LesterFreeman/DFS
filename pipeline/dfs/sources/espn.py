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


def fetch(ctx: Context) -> list[ProjRecord]:
    flt = {"players": {
        "filterSlotIds": {"value": [0, 2, 4, 6]},
        "filterStatsForSourceIds": {"value": [1]},
        "filterStatsForSplitTypeIds": {"value": [1]},
        "filterStatsForTopScoringPeriodIds": {"value": 1, "additionalValue": [f"11{ctx.season}{ctx.week}"]},
        "limit": 1200,
    }}
    data = ctx.http.get_json(
        URL.format(season=ctx.season),
        params={"view": "kona_player_info", "scoringPeriodId": ctx.week},
        headers={"X-Fantasy-Filter": json.dumps(flt), "Accept": "application/json"},
        fixture="espn_projections.json",
    )
    if not isinstance(data, dict) or "players" not in data:
        raise SourceError("unexpected payload (no 'players' key)")
    return parse(data, ctx.season, ctx.week)
