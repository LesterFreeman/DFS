import pytest

from dfs.floor import estimate, history_by_player, player_cv

CFG = {"prior_cv": {"WR": 0.6, "DST": 0.8}, "shrink_games": 8, "z": 0.84}


def test_no_history_uses_prior():
    est = estimate(20.0, "WR", None, CFG)
    assert est["cv"] == 0.6 and est["hist_games"] == 0
    assert est["floor"] == pytest.approx(20 - 0.84 * 12)
    assert est["sigma"] == 12.0


def test_shrinkage_toward_prior():
    steady = [15.0, 16.0, 14.0, 15.0, 16.0, 14.0, 15.0, 15.0]  # cv ~0.05
    few = estimate(15.0, "WR", steady[:4], CFG)
    many = estimate(15.0, "WR", steady * 3, CFG)
    assert few["cv"] > many["cv"] > player_cv(steady)  # more games -> closer to the player's own cv
    assert many["floor"] > few["floor"]


def test_floor_never_negative():
    boom_bust = [0.0, 30.0, 1.0, 28.0, 2.0, 25.0]
    assert estimate(5.0, "WR", boom_bust, CFG)["floor"] >= 0


def test_history_excludes_current_and_future_weeks():
    rows = [{"gsis_id": "a", "name": "x", "pos": "WR", "season": s, "week": w, "pts": 10.0}
            for s, w in ((2025, 17), (2026, 3), (2026, 4), (2026, 5))]
    assert len(history_by_player(rows, 2026, 4)["a"]) == 2


def test_floor_scale_widens_by_position():
    pts = [10, 14, 18, 22, 26, 12, 20, 16]
    cfg = {**CFG, "scale": {"RB": 1.15}}
    rb = estimate(20.0, "RB", pts, cfg)
    wr = estimate(20.0, "WR", pts, cfg)
    assert rb["sigma"] == wr["sigma"]  # sigma itself is not scaled
    assert rb["floor"] == pytest.approx(20 - 0.84 * 1.15 * rb["sigma"], abs=0.01)
    assert wr["floor"] > rb["floor"]
