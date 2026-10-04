import json
import shutil

import pytest
from conftest import FIXTURES
from dfs import backfill
from dfs.http import Http

AFTER = "2026-10-06T12:00:00Z"  # the sample slate (week 4) has been played


def fixtures(tmp_path, api=True, page=False):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    if api:
        (fx / "dk_contest_195541057.json").write_text(json.dumps(
            {"contestDetail": {"draftGroupId": 133456, "name": "League week 4", "gameType": "Classic"}}))
    if page:
        (fx / "dk_contest_195541057_page1.html").write_text('<script>var c = {"draftGroupId": 133999};</script>')
    return fx


def test_resolve_draft_group(tmp_path):
    gid, info, log = backfill.resolve_draft_group(Http(fixtures(tmp_path / "a")), "195541057")
    assert gid == 133456 and info["game_type"] == "Classic"
    gid, _, log = backfill.resolve_draft_group(Http(fixtures(tmp_path / "b", api=False, page=True)), "195541057")
    assert gid == 133999 and len(log) == 3  # API and first page failed, second page found it
    assert backfill.resolve_draft_group(Http(FIXTURES), "dg:42")[0] == 42
    with pytest.raises(ValueError, match="could not find the slate"):
        backfill.resolve_draft_group(Http(FIXTURES), "195541057")


def test_backfill_writes_a_marked_history_week(tmp_path, capsys):
    data = tmp_path / "data"
    code = backfill.main(["--data-dir", str(data), "--fixtures", str(fixtures(tmp_path)), "--now", AFTER,
                          "195541057"])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "2026 week 4, draft group 133456" in out
    hist = data / "history" / "2026" / "week04"
    slate = json.loads((hist / "slate.json").read_text())
    assert slate["backfilled"] and slate["draft_group_id"] == 133456 and slate["contest_id"] == "195541057"
    players = json.loads((hist / "players.json").read_text())
    assert sum(p["in_pool"] for p in players) > 50
    sources = {s["name"]: s for s in json.loads((hist / "sources.json").read_text())["sources"]}
    assert sources["sleeper_status"]["status"] == "disabled"
    assert sources["sleeper"]["status"] == "ok"
    # nothing live is touched: no latest slate, no cache
    assert not (data / "latest" / "players.json").exists() and not (data / "cache").exists()
    bundle = json.loads((data / "latest" / "backtest.json").read_text())
    assert bundle["weeks"] == []  # the fixture schedule has no final scores, so nothing to grade yet
    assert "not graded yet" in out


def test_backfill_leaves_live_snapshots_alone(tmp_path, capsys):
    data = tmp_path / "data"
    hist = data / "history" / "2026" / "week04"
    hist.mkdir(parents=True)
    (hist / "slate.json").write_text(json.dumps({"season": 2026, "week": 4}))
    (hist / "players.json").write_text("[]")
    fx = str(fixtures(tmp_path))
    assert backfill.main(["--data-dir", str(data), "--fixtures", fx, "--now", AFTER, "195541057"]) == 0
    assert "already has a live snapshot" in capsys.readouterr().out
    assert (hist / "players.json").read_text() == "[]"
    assert backfill.main(["--data-dir", str(data), "--fixtures", fx, "--now", AFTER, "--force", "195541057"]) == 0
    assert json.loads((hist / "slate.json").read_text())["backfilled"]


def test_one_failed_target_does_not_stop_the_others(tmp_path, capsys):
    data = tmp_path / "data"
    code = backfill.main(["--data-dir", str(data), "--fixtures", str(fixtures(tmp_path)), "--now", AFTER,
                          "999,195541057"])
    out = capsys.readouterr().out
    assert code == 1
    assert "999: FAILED: could not find the slate" in out and "195541057: 2026 week 4" in out


def test_fill_from_schedule_finds_the_week_by_matchups():
    from dfs.build import fill_from_schedule
    from dfs.models import Game, SlatePlayer

    def g(week, away, home, day, time):
        return Game(season=2026, week=week, game_type="REG", gameday=day, gametime=time, away=away, home=home,
                    spread_line=None, total_line=None)
    games = [g(1, "DAL", "PHI", "2026-09-10", "20:20"),  # Thursday: not on a Sun-Mon slate
             g(1, "KC", "LAC", "2026-09-13", "13:00"), g(1, "NYG", "WAS", "2026-09-14", "20:15"),
             g(2, "KC", "PHI", "2026-09-20", "16:25"), g(2, "LAC", "DAL", "2026-09-17", "20:15"),
             g(2, "NYG", "WAS", "2026-09-20", "13:00")]
    players = [SlatePlayer(dk_id=t, name=t, pos="WR", team=t, opp=None, salary=5000, home=None, game=None, kickoff=None)
               for t in ("KC", "LAC", "NYG", "WAS")]
    week, note = fill_from_schedule(players, games, 2026)
    assert week == 1 and "week 1" in note
    kc = players[0]
    assert (kc.game, kc.opp, kc.home, kc.kickoff) == ("KC@LAC", "LAC", False, "2026-09-13T17:00:00Z")
    assert players[2].kickoff == "2026-09-15T00:15:00Z"  # Monday 8:15pm ET
    with pytest.raises(ValueError, match="could not tell which week"):
        fill_from_schedule([SlatePlayer(dk_id="1", name="x", pos="WR", team="NYG", opp=None, salary=1, home=None,
                                        game=None, kickoff=None),
                            SlatePlayer(dk_id="2", name="y", pos="WR", team="WAS", opp=None, salary=1, home=None,
                                        game=None, kickoff=None)], games, 2026)  # NYG-WAS meet in both weeks
    assert fill_from_schedule(players[2:], games, 2026, week=2)[0] == 2


def test_backfill_of_a_finished_slate_without_game_details(tmp_path, capsys):
    fx = fixtures(tmp_path)
    (fx / "dk_draftables.json").unlink()  # GitHub gets 403 here; the CSV endpoint answers
    rows = (FIXTURES / "DKSalaries.csv").read_text(encoding="utf-8-sig").splitlines()
    header = rows[0].split(",")
    gi = header.index("Game Info")
    out_rows = [rows[0]]
    import csv as _csv
    import io as _io
    for r in _csv.reader(_io.StringIO("\n".join(rows[1:]))):
        r[gi] = "Final"
        buf = _io.StringIO()
        _csv.writer(buf).writerow(r)
        out_rows.append(buf.getvalue().strip())
    (fx / "dk_salaries_endpoint.csv").write_text("\n".join(out_rows) + "\n")
    data = tmp_path / "data"
    assert backfill.main(["--data-dir", str(data), "--fixtures", str(fx), "--now", AFTER, "dg:133456"]) == 0, \
        capsys.readouterr().out
    out = capsys.readouterr().out
    assert "2026 week 4, draft group 133456" in out
    players = json.loads((data / "history" / "2026" / "week04" / "players.json").read_text())
    assert all(p["kickoff"] and p["opp"] for p in players)
    slate = json.loads((data / "history" / "2026" / "week04" / "slate.json").read_text())
    assert slate["week_source"] == "schedule" and any("matched to week 4" in n for n in slate["notes"])
