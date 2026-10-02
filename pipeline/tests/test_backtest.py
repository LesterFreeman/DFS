import csv
import io
import json
import shutil
from datetime import timedelta

from conftest import FIXTURES, NOW
from dfs import backtest
from dfs.build import build
from dfs.http import Http
from dfs.models import Game
from dfs.sources import nflverse
from test_build import make_config


def game(away, home, a_score=None, h_score=None, week=3):
    return Game(season=2026, week=week, game_type="REG", gameday="2026-09-20", gametime="13:00", away=away,
                home=home, spread_line=0, total_line=44, away_score=a_score, home_score=h_score)


def row(pid, name, pos, team, proj, floor, game="CIN@KC", kickoff="2026-09-20T17:00:00Z", **kw):
    return {"id": pid, "name": name, "pos": pos, "team": team, "game": game, "kickoff": kickoff, "salary": 5000,
            "proj": proj, "floor": floor, "projections": kw.pop("projections", {"sleeper": proj}), "in_pool": True,
            "status": "ACTIVE", **kw}


def test_freeze_keeps_pre_kickoff_rows_once_games_start():
    prev = [row("1", "A", "WR", "KC", 15, 8, kickoff="2026-09-20T17:00:00Z"),
            row("2", "B", "WR", "KC", 12, 6, kickoff="2026-09-21T00:20:00Z")]
    cur = [row("1", "A", "WR", "KC", 3, 1, kickoff="2026-09-20T17:00:00Z"),
           row("2", "B", "WR", "KC", 13, 7, kickoff="2026-09-21T00:20:00Z"),
           row("3", "C", "RB", "KC", 9, 4, kickoff="2026-09-20T17:00:00Z")]
    now = backtest._parse_iso("2026-09-20T18:00:00Z")
    out, frozen = backtest.freeze_locked(prev, cur, now)
    assert frozen == 1
    assert [r["proj"] for r in out] == [15, 13, 9]  # A frozen; B not started; C has no earlier row
    assert backtest.freeze_locked(None, cur, now) == (cur, 0)


def test_actual_points_offense_and_dst():
    weekly = [
        {"gsis_id": "00-1", "name": "ja marr chase", "pos": "WR", "team": "CIN", "season": 2026, "week": 3, "pts": 21.4},
        {"gsis_id": "00-2", "name": "travis kelce", "pos": "TE", "team": "KC", "season": 2026, "week": 3, "pts": 9.0},
        {"gsis_id": "00-2", "name": "travis kelce", "pos": "TE", "team": "KC", "season": 2026, "week": 2, "pts": 30.0},
    ]
    teams = [{"team": "KC", "season": 2026, "week": 3, "opp": "CIN", "sack": 3, "def_int": 1, "fum_rec": 1,
              "def_td": 0, "safety": 0, "blk_kick": 0}]
    rows = [row("1", "Ja'Marr Chase", "WR", "CIN", 18, 10, gsis_id="00-1"),
            row("2", "Travis Kelce", "TE", "KC", 12, 6),  # no gsis id: name + team
            row("3", "Benchwarmer", "RB", "KC", 6, 2),
            row("4", "Chiefs DST", "DST", "KC", 7, 2)]
    a = backtest.actual_points(rows, weekly, teams, [game("CIN", "KC", 17, 24)], 2026, 3)
    assert a["1"] == {"pts": 21.4, "played": True}
    assert a["2"] == {"pts": 9.0, "played": True}
    assert a["3"] == {"pts": 0.0, "played": False}
    # 3 sacks + INT (2) + fumble recovery (2) + 14-20 allowed (1) = 8
    assert a["4"] == {"pts": 8.0, "played": True}


def test_week_complete_waits_for_scores_and_stats():
    rows = [row("1", "A", "WR", "KC", 15, 8)]
    weekly = [{"season": 2026, "week": 3}]
    teams = [{"team": t, "season": 2026, "week": 3} for t in ("CIN", "KC")]
    assert "no final score" in backtest.week_complete(rows, weekly, teams, [game("CIN", "KC")], 2026, 3)
    assert "player stats" in backtest.week_complete(rows, [], teams, [game("CIN", "KC", 1, 2)], 2026, 3)
    assert "team stats" in backtest.week_complete(rows, weekly, teams[:1], [game("CIN", "KC", 1, 2)], 2026, 3)
    assert backtest.week_complete(rows, weekly, teams, [game("CIN", "KC", 1, 2)], 2026, 3) is None


def test_grade_metrics():
    rows = [
        {**row("1", "A", "WR", "KC", 10, 6, projections={"sleeper": 12, "espn": 8}), "actual": 14, "played": True},
        {**row("2", "B", "WR", "KC", 10, 6, projections={"sleeper": 12}), "actual": 4, "played": True},
        {**row("3", "C", "RB", "KC", 20, 12, projections={"espn": 18}), "actual": 22, "played": True},
        {**row("4", "D", "RB", "KC", 8, 3), "actual": 0, "played": False},
        {**row("5", "E", "QB", "KC", 1, 0, in_pool=False), "actual": 30, "played": True},
    ]
    m = backtest.grade(rows)
    assert (m["n_pool"], m["n_graded"]) == (4, 3)
    cons = m["projection"]["consensus"]["ALL"]
    assert cons["n"] == 3 and cons["mae"] == round((4 + 6 + 2) / 3, 2) and cons["bias"] == 0.0
    assert m["projection"]["sleeper"]["WR"] == {"n": 2, "mae": 5.0, "bias": -3.0, "rmse": 5.83, "corr": None,
                                                 "mae_consensus": 5.0}
    assert m["floor"]["WR"] == {"n": 2, "below": 1, "share": 0.5}
    assert [d["name"] for d in m["dnp"]] == ["D"]


def test_parse_team_weekly_and_scores():
    text = ("season,week,team,season_type,opponent_team,def_sacks,def_interceptions,fumble_recovery_opp,def_tds,"
            "special_teams_tds,def_safeties,def_punt_blocks,def_fg_blocks,def_pat_blocks\n"
            "2026,3,LA,REG,SF,2,1,0,1,1,0,0,1,0\n2026,3,SF,POST,LA,0,0,0,0,0,0,0,0,0\n")
    assert nflverse.parse_team_weekly(text) == [{"team": "LAR", "season": 2026, "week": 3, "opp": "SF", "sack": 2,
                                                 "def_int": 1, "fum_rec": 0, "def_td": 2, "safety": 0, "blk_kick": 1}]
    g = nflverse.parse_games("game_id,season,game_type,week,gameday,gametime,away_team,home_team,spread_line,"
                             "total_line,away_score,home_score\nx,2026,REG,3,2026-09-20,13:00,SF,LA,1,44,20,NA\n")
    assert (g[0].away_score, g[0].home_score) == (20.0, None)


def _with_week3_results(tmp_path, players_wk4):
    """Fixtures plus a played week 3 that mirrors the week-4 sample slate, and a week-3 snapshot."""
    fx = tmp_path / "fixtures"
    shutil.copytree(FIXTURES, fx)
    games = list(csv.DictReader(io.StringIO((fx / "nflverse_games.csv").read_text())))
    slate_games = {p["game"] for p in players_wk4 if p["game"]}
    fields = list(games[0]) + ["away_score", "home_score"]
    extra = []
    for i, g in enumerate(sorted(slate_games)):
        away, home = g.split("@")
        extra.append({**games[0], "game_id": f"2026_03_{away}_{home}", "week": "3", "gameday": "2026-09-20",
                      "away_team": "LA" if away == "LAR" else away, "home_team": "LA" if home == "LAR" else home,
                      "away_score": str(10 + i), "home_score": "24"})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields)
    w.writeheader()
    w.writerows([{**g, "away_score": "", "home_score": ""} for g in games] + extra)
    (fx / "nflverse_games.csv").write_text(buf.getvalue())
    teams = sorted({t for g in slate_games for t in g.split("@")})
    hdr = "season,week,team,season_type,opponent_team,def_sacks,def_interceptions,fumble_recovery_opp,def_tds\n"
    (fx / "nflverse_team_stats_2026.csv").write_text(hdr + "".join(
        f"2026,3,{'LA' if t == 'LAR' else t},REG,XX,3,1,0,0\n" for t in teams))
    wk3 = [{**p, "kickoff": "2026-09-20T17:00:00Z"} for p in players_wk4]
    hist = tmp_path / "data" / "history" / "2026" / "week03"
    hist.mkdir(parents=True)
    (hist / "players.json").write_text(json.dumps(wk3))
    (hist / "slate.json").write_text(json.dumps({"slate_label": "(Sun-Mon)", "generated_at": "2026-09-20T16:40:00Z"}))
    return fx


def test_build_grades_finished_weeks(tmp_path):
    first = tmp_path / "first"
    assert build(make_config(), Http(FIXTURES), first / "data", first / "out", NOW) == 0
    players = json.loads((first / "out" / "players.json").read_text())
    assert all("gsis_id" in p for p in players)
    # no history to grade yet: an empty bundle, and no team-stats fixture is not a failure
    bundle = json.loads((first / "out" / "backtest.json").read_text())
    assert bundle["weeks"] == [] and bundle["overall"] is None
    src = json.loads((first / "out" / "sources.json").read_text())
    assert {s["name"]: s["status"] for s in src["sources"]}["nflverse_team_stats"] == "ok"

    fx = _with_week3_results(tmp_path, players)
    assert build(make_config(), Http(fx), tmp_path / "data", tmp_path / "out", NOW) == 0
    actuals = json.loads((tmp_path / "data" / "history" / "2026" / "week03" / "actuals.json").read_text())["actuals"]
    bundle = json.loads((tmp_path / "out" / "backtest.json").read_text())
    [wk] = bundle["weeks"]
    assert (wk["season"], wk["week"], wk["slate_label"]) == (2026, 3, "(Sun-Mon)")
    by_name = {p["name"]: p for p in wk["players"]}
    moore = by_name["DJ Moore"]
    assert moore["played"] and moore["actual"] > 0 and moore["actual"] == actuals[moore["id"]]["pts"]
    dst = by_name["Chiefs DST"]  # 3 sacks + INT (2) + allowed 10-15 points
    assert dst["played"] and dst["actual"] in (3 + 2 + 4, 3 + 2 + 1)
    m = wk["metrics"]
    assert m["n_graded"] > 50 and m["projection"]["consensus"]["ALL"]["mae"] > 0
    assert {"sleeper", "espn", "cbs"} <= set(m["projection"])
    assert 0 <= m["floor"]["ALL"]["share"] <= 1
    assert bundle["overall"]["n_graded"] == m["n_graded"]
    # the current week (4) is not graded
    assert not (tmp_path / "data" / "history" / "2026" / "week04" / "actuals.json").exists()


def test_history_snapshot_freezes_at_kickoff(tmp_path):
    data, out = tmp_path / "data", tmp_path / "out"
    assert build(make_config(), Http(FIXTURES), data, out, NOW) == 0
    hist = data / "history" / "2026" / "week04" / "players.json"
    before = {p["id"]: p for p in json.loads(hist.read_text())}
    # tamper with the saved snapshot so we can tell whether a later run keeps or replaces each row
    for p in before.values():
        p["proj_marker"] = True
    hist.write_text(json.dumps(list(before.values())))
    later = NOW + timedelta(days=2, hours=6)  # Sunday 18:00Z: 1pm games started, 4pm games not yet
    assert build(make_config(), Http(FIXTURES), data, out, later) == 0
    after = json.loads(hist.read_text())
    early = [p for p in after if p["kickoff"] and p["kickoff"] <= "2026-09-27T18:00:00Z"]
    late = [p for p in after if p["kickoff"] and p["kickoff"] > "2026-09-27T18:00:00Z"]
    assert early and late
    assert all(p.get("proj_marker") for p in early) and not any(p.get("proj_marker") for p in late)
    notes = json.loads((out / "sources.json").read_text())["notes"]
    assert any("pre-kickoff projections" in n for n in notes)
