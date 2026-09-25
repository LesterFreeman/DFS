"""Vegas-implied DST projections (derived, no network).

Few free sources project DST in DraftKings scoring, so this adds a simple market-based estimate:
points allowed ~ the opponent's implied team total, and sacks/turnovers scaled up against
low-total offenses. It's crude on purpose, so its consensus weight defaults to 0.5.
"""
from __future__ import annotations

from ..models import ProjRecord, SourceError
from ..scoring import dk_points
from .base import Context, SourceMeta

META = SourceMeta("vegas_dst", "Vegas DST model", "projections", "Derived from nflverse lines")

LEAGUE_AVG_TEAM_TOTAL = 22.0
BASE = {"sack": 2.4, "def_int": 0.75, "fum_rec": 0.55, "def_td": 0.13, "safety": 0.03, "blk_kick": 0.05}


def project(ctx: Context) -> list[ProjRecord]:
    out = []
    for g in ctx.games:
        if g.week != ctx.week or g.away not in ctx.slate_teams:
            continue
        implied = g.implied()
        if not implied:
            continue
        for team, opp in ((g.home, g.away), (g.away, g.home)):
            opp_total = implied[opp]
            scale = min(1.5, max(0.6, 1 + 0.04 * (LEAGUE_AVG_TEAM_TOTAL - opp_total)))
            stats = {k: round(v * scale, 3) for k, v in BASE.items()}
            stats["pts_allow"] = opp_total
            out.append(ProjRecord(source="vegas_dst", name=f"{team} DST", pos="DST", team=team,
                                  points=dk_points("DST", stats), stats=stats))
    if not out:
        raise SourceError("no Vegas lines for slate games")
    return out
