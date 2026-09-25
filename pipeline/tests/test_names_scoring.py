import pytest

from dfs.names import normalize_name, normalize_team, team_from_text
from dfs.scoring import dk_points, expected_pa_points, offense_points, pa_points


@pytest.mark.parametrize("raw,expected", [
    ("D.J. Moore", "dj moore"),
    ("DJ Moore", "dj moore"),
    ("Amon-Ra St. Brown", "amon ra st brown"),
    ("Marvin Harrison Jr.", "marvin harrison"),
    ("Kenneth Walker III", "kenneth walker"),
    ("Aaron Jones Sr.", "aaron jones"),
    ("Ja'Marr Chase", "jamarr chase"),
    ("Ja’Marr Chase", "jamarr chase"),
    ("Hollywood Brown", "marquise brown"),
    ("Jaxon Smith-Njigba", "jaxon smith njigba"),
    ("Will Fuller V", "will fuller"),
])
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


def test_teams():
    assert normalize_team("JAC") == "JAX"
    assert normalize_team("WSH") == "WAS"
    assert normalize_team("LA") == "LAR"
    assert normalize_team("XYZ") is None
    assert team_from_text("Kansas City Chiefs") == "KC"
    assert team_from_text("Chiefs D/ST") == "KC"
    assert team_from_text("49ers") == "SF"


def test_actual_offense_scoring_matches_dk_rules():
    # 300 pass yds (12 + 3 bonus), 3 TD (12), 1 INT (-1), 20 rush yds (2)
    assert offense_points({"pass_yd": 300, "pass_td": 3, "pass_int": 1, "rush_yd": 20}, expected=False) == 28
    # 8 rec, 100 yds (10 + 3 bonus), 1 TD, 1 fumble lost
    assert offense_points({"rec": 8, "rec_yd": 100, "rec_td": 1, "fum_lost": 1}, expected=False) == 26


def test_expected_bonus_is_probability_weighted():
    base = offense_points({"rec_yd": 95}, expected=False)  # no bonus at the mean
    exp = offense_points({"rec_yd": 95}, expected=True)
    assert base == pytest.approx(9.5)
    assert 9.5 + 0.9 < exp < 9.5 + 1.8  # ~45% chance of the 100-yd bonus
    assert offense_points({"rec_yd": 20}) == pytest.approx(2.0, abs=0.01)


def test_points_allowed_tiers():
    assert [pa_points(x) for x in (0, 3, 10, 17, 24, 30, 40)] == [10, 7, 4, 1, 0, -1, -4]
    assert expected_pa_points(10) > expected_pa_points(20) > expected_pa_points(30)
    assert dk_points("DST", {"sack": 3, "def_int": 1, "pts_allow": 17}, expected=False) == 3 + 2 + 1
