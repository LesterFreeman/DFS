"""DraftKings NFL Classic scoring, computed from stat lines.

Projection sources publish expected stat lines (means). DraftKings pays threshold bonuses
(300 pass yds, 100 rush yds, 100 rec yds), and E[bonus(X)] != bonus(E[X]), so for projections
we price each bonus as 3 * P(X >= threshold) under a normal approximation. Points allowed for
DSTs are handled the same way: expected tier points over a distribution of points allowed.

Canonical stat keys (every adapter maps into these):
  offense: pass_yd pass_td pass_int rush_yd rush_td rec rec_yd rec_td fum_lost two_pt ret_td
  DST:     sack def_int fum_rec def_td safety blk_kick pts_allow
"""
from __future__ import annotations

from math import erf, sqrt

OFFENSE_KEYS = ("pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd",
                "rec_td", "fum_lost", "two_pt", "ret_td")
DST_KEYS = ("sack", "def_int", "fum_rec", "def_td", "safety", "blk_kick", "pts_allow")

# (coefficient of variation, minimum sd) for weekly yardage, used to price yardage bonuses.
YARD_SPREAD = {"pass_yd": (0.28, 25.0), "rush_yd": (0.50, 12.0), "rec_yd": (0.55, 12.0)}
BONUS_THRESHOLD = {"pass_yd": 300, "rush_yd": 100, "rec_yd": 100}
PA_SD = 10.0

PA_TIERS = ((0, 0, 10), (1, 6, 7), (7, 13, 4), (14, 20, 1), (21, 27, 0), (28, 34, -1), (35, 10**6, -4))


def _phi(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def _g(stats: dict, key: str) -> float:
    v = stats.get(key)
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def prob_at_least(mean: float, sd: float, threshold: float) -> float:
    if mean <= 0 or sd <= 0:
        return 0.0
    return 1.0 - _phi((threshold - 0.5 - mean) / sd)


def offense_points(stats: dict, expected: bool = True) -> float:
    pts = (
        _g(stats, "pass_yd") * 0.04 + _g(stats, "pass_td") * 4 - _g(stats, "pass_int")
        + _g(stats, "rush_yd") * 0.1 + _g(stats, "rush_td") * 6
        + _g(stats, "rec") + _g(stats, "rec_yd") * 0.1 + _g(stats, "rec_td") * 6
        - _g(stats, "fum_lost") + _g(stats, "two_pt") * 2 + _g(stats, "ret_td") * 6
    )
    for key, threshold in BONUS_THRESHOLD.items():
        yards = _g(stats, key)
        if expected:
            cv, min_sd = YARD_SPREAD[key]
            pts += 3.0 * prob_at_least(yards, max(cv * yards, min_sd), threshold)
        elif yards >= threshold:
            pts += 3.0
    return pts


def pa_points(points_allowed: float) -> int:
    pa = max(0, int(round(points_allowed)))
    for lo, hi, pts in PA_TIERS:
        if lo <= pa <= hi:
            return pts
    return -4


def expected_pa_points(mean: float, sd: float = PA_SD) -> float:
    """E[tier points] with points allowed ~ Normal(mean, sd), discretized to integers >= 0."""
    total_p = 0.0
    total = 0.0
    for k in range(0, 80):
        lo = -float("inf") if k == 0 else (k - 0.5 - mean) / sd
        p = _phi((k + 0.5 - mean) / sd) - (_phi(lo) if k else 0.0)
        total_p += p
        total += p * pa_points(k)
    return total / total_p if total_p else 0.0


def dst_points(stats: dict, expected: bool = True) -> float:
    pts = (
        _g(stats, "sack") + _g(stats, "def_int") * 2 + _g(stats, "fum_rec") * 2
        + _g(stats, "def_td") * 6 + _g(stats, "safety") * 2 + _g(stats, "blk_kick") * 2
    )
    pa = _g(stats, "pts_allow")
    pts += expected_pa_points(pa) if expected else pa_points(pa)
    return pts


def dk_points(pos: str, stats: dict, expected: bool = True) -> float:
    return round(dst_points(stats, expected) if pos == "DST" else offense_points(stats, expected), 2)


def has_stats(pos: str, stats: dict) -> bool:
    keys = ("pts_allow",) if pos == "DST" else OFFENSE_KEYS
    return any(stats.get(k) not in (None, "", 0, 0.0) for k in keys)
