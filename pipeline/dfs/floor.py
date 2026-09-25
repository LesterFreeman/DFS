"""Floor estimate from free historical data.

For each player we measure week-to-week volatility (coefficient of variation of actual DK points)
from nflverse weekly stats, shrink it toward a position prior when the sample is small
(empirical Bayes, weight n / (n + k)), and apply it to this week's consensus projection:

    sigma = proj * cv
    floor = max(0, proj - z * sigma)      z = 0.84  ->  ~20th percentile

DSTs, rookies and players missing from history get the position prior.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import mean, pstdev


def history_by_player(rows: list[dict], season: int, week: int) -> dict[str, list[float]]:
    """Games strictly before (season, week), keyed by gsis_id and by 'name|pos' as a fallback."""
    out: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        if (r["season"], r["week"]) >= (season, week):
            continue
        if r.get("gsis_id"):
            out[r["gsis_id"]].append(r["pts"])
        out[f"{r['name']}|{r['pos']}"].append(r["pts"])
    return out


def player_cv(points: list[float]) -> float | None:
    if len(points) < 3:
        return None
    m = mean(points)
    if m < 3.0:
        return None
    return pstdev(points) / m


def estimate(proj: float, pos: str, points: list[float] | None, cfg: dict) -> dict:
    prior = float(cfg.get("prior_cv", {}).get(pos, 0.6))
    k = float(cfg.get("shrink_games", 8))
    z = float(cfg.get("z", 0.84))
    pts = points or []
    raw = player_cv(pts)
    n = len(pts) if raw is not None else 0
    cv = (n * raw + k * prior) / (n + k) if raw is not None else prior
    sigma = proj * cv
    return {
        "floor": round(max(0.0, proj - z * sigma), 2),
        "sigma": round(sigma, 2),
        "cv": round(cv, 3),
        "hist_games": n,
        "hist_mean": round(mean(pts), 2) if pts else None,
    }
