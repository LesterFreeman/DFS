from zoneinfo import ZoneInfo

import pytest

from conftest import FIXTURES
from dfs.match import SlateIndex
from dfs.models import SourceError
from dfs.sources import cbs, draftkings, espn, fantasypros, nflverse, sleeper

TZ = ZoneInfo("America/New_York")


def by_name(records, name):
    return next(r for r in records if r.name == name)


def test_draftkings_picks_main_slate_and_dedupes_flex(ctx):
    players, info = draftkings.fetch(ctx)
    assert info["draft_group_id"] == 131000
    assert len(players) == 67  # 57 players + 10 DST, FLEX duplicates collapsed
    kelce = by_name(players, "Travis Kelce")
    assert (kelce.team, kelce.opp, kelce.home, kelce.salary) == ("KC", "CIN", True, 5800)
    assert kelce.kickoff == "2026-09-27T17:00:00Z"
    assert by_name(players, "Christian Watson").dk_status == "O"
    assert by_name(players, "Chiefs DST").pos == "DST"


def test_draftkings_csv_matches_api(ctx):
    api, _ = draftkings.fetch(ctx)
    csv_players = draftkings.parse_salary_csv((FIXTURES / "DKSalaries.csv").read_text(), TZ)
    assert {(p.name, p.salary, p.kickoff) for p in api} == {(p.name, p.salary, p.kickoff) for p in csv_players}


def test_draftkings_no_main_slate(ctx):
    with pytest.raises(SourceError):
        draftkings.pick_main_draft_group({"DraftGroups": []}, 21, ctx.now, TZ)


def test_sleeper(ctx):
    recs = sleeper.fetch_projections(ctx)
    assert len(recs) == 66
    dst = next(r for r in recs if r.pos == "DST" and r.team == "KC")
    assert dst.stats["pts_allow"] > 0 and dst.points > 0
    statuses = sleeper.fetch_status(ctx)
    assert next(s for s in statuses if s.name == "Tee Higgins").status == "Q"


def test_espn_rescored_with_dk_rules(ctx):
    recs = espn.fetch(ctx)
    assert all(r.pos != "DST" for r in recs)
    mahomes = by_name(recs, "Patrick Mahomes")
    assert mahomes.team == "KC" and 15 < mahomes.points < 30
    assert "Andrei Iosivas" not in {r.name for r in recs}


def test_fantasypros_parses_grouped_headers(ctx):
    recs = fantasypros.fetch(ctx)
    moore = by_name(recs, "D.J. Moore")
    assert moore.team == "CHI" and moore.ids["fantasypros_id"]
    assert moore.stats["rec"] > 4
    chiefs = next(r for r in recs if r.pos == "DST" and r.team == "KC")
    assert chiefs.stats["pts_allow"] > 10


def test_cbs(ctx):
    recs = cbs.fetch(ctx)
    burrow = by_name(recs, "Joe Burrow")
    assert burrow.stats["pass_yd"] > 200 and burrow.stats["pass_td"] > 1
    assert by_name(recs, "Hollywood Brown").team == "KC"


def test_nflverse(ctx):
    games = nflverse.fetch_games(ctx, 2026)
    lar = next(g for g in games if g.home == "LAR")  # "LA" in nflverse -> LAR
    assert lar.implied()["LAR"] > lar.implied()["WAS"]
    assert len(nflverse.fetch_ids(ctx)) == 57
    weekly = nflverse.fetch_weekly(ctx, [2025, 2026])
    assert {r["season"] for r in weekly} == {2025, 2026}


def test_matching_without_ids(ctx):
    """Name-only matching must survive punctuation, suffixes, aliases and typos."""
    players, _ = draftkings.fetch(ctx)
    index = SlateIndex(players)  # no crosswalk -> forces name paths
    cases = {
        ("D.J. Moore", "WR", "CHI"): ("DJ Moore", "name"),
        ("Hollywood Brown", "WR", "KC"): ("Marquise Brown", "name"),
        ("Kenneth Walker", "RB", "SEA"): ("Kenneth Walker III", "name"),
        ("Aaron Jones", "RB", "MIN"): ("Aaron Jones Sr.", "name"),
        ("Davante Adams", "WR", "NYJ"): ("Davante Adams", "name_pos"),  # stale team
        ("Isaiah Pacheco", "RB", "KC"): ("Isiah Pacheco", "fuzzy"),
        ("Kansas City", "DST", "KC"): ("Chiefs DST", "team"),
    }
    names = {p.dk_id: p.name for p in players}
    for (name, pos, team), (expected, how) in cases.items():
        dk, method = index.match(name, pos, team)
        assert (names.get(dk), method) == (expected, how), name
    assert index.match("Justin Jefferson", "TE", "MIN") == (None, "unmatched")
    assert index.match("Nobody Real", "WR", "KC") == (None, "unmatched")
