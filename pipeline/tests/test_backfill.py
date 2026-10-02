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
