import json

from conftest import FIXTURES, NOW
from dfs import context
from dfs.build import build
from dfs.http import Http
from dfs.models import Game
from test_build import make_config


def wk(name, pos, team, opp, week, pts, season=2026, gsis=None, **line):
    return {"gsis_id": gsis, "name": name, "pos": pos, "team": team, "opp": opp, "season": season, "week": week,
            "pts": pts, "line": line}


def game(week, away, home, a=None, h=None):
    return Game(season=2026, week=week, game_type="REG", gameday="", gametime=None, away=away, home=home,
                spread_line=None, total_line=None, away_score=a, home_score=h)


GAMES = [game(1, "KC", "LAC", 20, 27), game(2, "BUF", "KC", 31, 17), game(3, "KC", "DEN", 10, 13),
         game(4, "KC", "NYJ"), game(1, "BUF", "NYJ", 24, 6), game(2, "LAC", "DEN", 14, 21)]


def test_game_log_with_projections_dnp_and_cap(tmp_path):
    weekly = [wk("travis kelce", "TE", "KC", "LAC", 1, 12.5, gsis="00-1", tgt=8, rec=6),
              wk("travis kelce", "TE", "KC", "DEN", 3, 20.0, gsis="00-1", tgt=10, rec=8, tgt_share=0.28),
              wk("travis kelce", "TE", "KC", "LAC", 1, 99, season=2025, gsis="00-1")]
    hist = tmp_path / "history" / "2026"
    for w, proj in ((1, 11.0), (2, 12.0), (3, 13.0), (4, 14.0)):
        (hist / f"week{w:02d}").mkdir(parents=True)
        (hist / f"week{w:02d}" / "players.json").write_text(json.dumps(
            [{"name": "Travis Kelce", "pos": "TE", "gsis_id": None, "proj": proj}]))  # matched by name
    past = context.past_projections(tmp_path, 2026, 4)
    assert set(past) == {1, 2, 3}
    log = context.game_log("00-1", "Travis Kelce", "TE", "KC", context.index_weekly(weekly, 2026), past, GAMES, 2026, 4)
    assert [(g["week"], g["opp"], g["actual"], g["proj"], g["dnp"]) for g in log] == [
        (3, "DEN", 20.0, 13.0, False), (2, "BUF", 0.0, 12.0, True), (1, "LAC", 12.5, 11.0, False)]
    s = context.season_summary(log)
    assert s == {"games": 2, "avg": 16.25, "tgt": 9.0, "car": 0.0, "tgt_share": 0.28, "games_20": 1}
    many = [wk("x", "WR", "KC", "LAC", w, 10, gsis="9") for w in range(1, 13)]
    assert len(context.game_log("9", "x", "WR", "KC", context.index_weekly(many, 2026), {}, [], 2026, 13)) == 8


def test_defense_vs_position_ranks_softest_first():
    weekly = []
    for w in (1, 2, 3):
        weekly += [wk(f"wr{w}a", "WR", "KC", "DEN", w, 30), wk(f"wr{w}b", "WR", "KC", "DEN", w, 10),  # DEN allows 40/gm
                   wk(f"wr{w}c", "WR", "BUF", "NYJ", w, 15)]  # NYJ allows 15/gm
    d = context.defense_vs_position(weekly, 2026, 4)
    assert d[("DEN", "WR")]["allowed"] == 40.0 and d[("DEN", "WR")]["rank"] == 1
    assert d[("NYJ", "WR")]["rank"] == 2 and d[("NYJ", "WR")]["pos_avg"] == 27.5
    # early season: a defense with fewer than 3 games also uses last season
    early = [wk("a", "RB", "KC", "DEN", 1, 20), wk("b", "RB", "KC", "DEN", 5, 10, season=2025)]
    assert context.defense_vs_position(early, 2026, 2)[("DEN", "RB")] ["games"] == 2


def test_offense_points_for_dst_matchups():
    o = context.offense_points(GAMES, 2026, 4)
    assert o["KC"]["scored"] == round((20 + 17 + 10) / 3, 1)
    assert o["NYJ"]["rank"] == 1  # scores the fewest: the best matchup for a defense
    assert "NYJ" in o and all(v["teams"] == len(o) for v in o.values())


def test_build_attaches_context(tmp_path):
    assert build(make_config(), Http(FIXTURES), tmp_path / "data", tmp_path / "out", NOW) == 0
    players = {p["name"]: p for p in json.loads((tmp_path / "out" / "players.json").read_text())}
    moore = players["DJ Moore"]
    assert len(moore["log"]) == 3 and moore["log"][0]["week"] == 3 and moore["log"][0]["opp"]
    assert moore["season_stats"]["games"] == 3 and moore["season_stats"]["tgt"] > 0
    assert moore["matchup"]["kind"] == "defense" and 1 <= moore["matchup"]["rank"] <= moore["matchup"]["teams"]
    assert "log" not in players["Chiefs DST"]
