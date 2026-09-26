from zoneinfo import ZoneInfo

import pytest

from conftest import FIXTURES
from dfs.match import SlateIndex
from dfs.models import SourceError
from dfs.sources import cbs, draftkings, espn, nflverse, sleeper

TZ = ZoneInfo("America/New_York")


def by_name(records, name):
    return next(r for r in records if r.name == name)


def test_draftkings_picks_sun_mon_slate_and_dedupes_flex(ctx):
    players, info = draftkings.fetch(ctx)
    assert info["draft_group_id"] == 131004 and info["slate_label"] == "(Sun-Mon)"
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


def test_draftkings_no_slate(ctx):
    with pytest.raises(SourceError):
        draftkings.pick_draft_group({"DraftGroups": []}, 21, ctx.now, TZ)


def _group(gid, start, suffix, games, tag=""):
    return {"DraftGroupId": gid, "ContestTypeId": 21, "StartDateEst": start, "ContestStartTimeSuffix": suffix,
            "DraftGroupTag": tag, "GameCount": games}


SUN = "2026-09-27T13:00:00.0000000"
LOBBY = {"DraftGroups": [
    _group(1, SUN, None, 13, "Featured"),
    _group(2, SUN, " (Early)", 9),
    _group(3, "2026-09-24T20:15:00.0000000", " (Thu-Mon)", 16),
    _group(4, SUN, " (Sun-Mon)", 15),
    _group(5, "2026-09-27T20:20:00.0000000", " (Primetime)", 2),
    _group(6, "2026-10-04T13:00:00.0000000", " (Sun-Mon)", 14),  # next week
    {**_group(7, SUN, " (Sun-Mon)", 15), "ContestTypeId": 96},  # Showdown-type, ignored
]}


@pytest.mark.parametrize("lobby_ids,slate,expected,note", [
    ([1, 2, 3, 4, 5, 6, 7], "sun-mon", 4, "Sunday-Monday slate"),
    ([1, 2, 3, 4, 5, 6, 7], "main", 1, "Main slate"),
    # unusual label: pick the largest Sunday-starting slate
    ([1, 2, 3, 5], "sun-mon", 1, "no Sunday-Monday slate listed"),
    ([2, 5], "sun-mon", 2, "largest Sunday slate"),
])
def test_pick_draft_group(ctx, lobby_ids, slate, expected, note):
    lobby = {"DraftGroups": [g for g in LOBBY["DraftGroups"] if g["DraftGroupId"] in lobby_ids]}
    group, msg = draftkings.pick_draft_group(lobby, 21, ctx.now, TZ, slate=slate)
    assert group["DraftGroupId"] == expected and msg.startswith(note)


def test_pick_draft_group_unlabelled_bigger_slate(ctx):
    lobby = {"DraftGroups": [_group(1, SUN, None, 13, "Featured"), _group(9, SUN, " (All Day)", 15)]}
    group, msg = draftkings.pick_draft_group(lobby, 21, ctx.now, TZ)
    assert group["DraftGroupId"] == 9 and "largest Sunday slate" in msg


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
    assert index.match("Justin Jefferson", "QB", "MIN") == (None, "unmatched")  # no cross-position for QBs
    assert index.match("Justin Jefferson", "TE", "KC") == (None, "unmatched")  # wrong team
    assert index.match("Nobody Real", "WR", "KC") == (None, "unmatched")


def test_matching_across_positions_by_name_and_team(ctx):
    players, _ = draftkings.fetch(ctx)
    index = SlateIndex(players)
    dk, how = index.match("Tucker Kraft", "WR", "GB")  # a site listing a TE as WR
    assert (next(p.name for p in players if p.dk_id == dk), how) == ("Tucker Kraft", "name_team")
    assert index.match("Tucker Kraft", "WR", "KC") == (None, "unmatched")
