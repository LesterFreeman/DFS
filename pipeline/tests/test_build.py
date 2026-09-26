import json
import shutil
from datetime import timedelta

from conftest import FIXTURES, NOW
from dfs.build import build
from dfs.config import Config
from dfs.http import Http


def run(tmp_path, fixtures=FIXTURES, now=NOW, cfg=None):
    data = tmp_path / "data"
    out = tmp_path / "out"
    code = build(cfg or Config.load(), Http(fixtures), data, out, now)
    load = lambda n: json.loads((out / n).read_text()) if (out / n).exists() else None  # noqa: E731
    return code, load("players.json"), load("slate.json"), load("sources.json")


def statuses(sources):
    return {s["name"]: s["status"] for s in sources["sources"]}


def test_full_offline_build(tmp_path):
    code, players, slate, sources = run(tmp_path)
    assert code == 0
    assert (slate["season"], slate["week"], slate["week_source"]) == (2026, 4, "schedule")
    assert slate["byes"] == ["ATL", "DEN", "PIT", "TB"]
    assert set(statuses(sources).values()) == {"ok"}
    assert sources["failed"] == []

    p = {r["name"]: r for r in players}
    moore = p["DJ Moore"]
    assert moore["n_sources"] == 4 and moore["proj_sd"] is not None
    assert moore["proj_min"] <= moore["proj"] <= moore["proj_max"]
    assert 0 < moore["floor"] < moore["proj"] and moore["hist_games"] == 20
    assert p["Andrei Iosivas"]["missing_sources"] == ["espn"]
    assert p["Noah Gray"]["proj"] is None and not p["Noah Gray"]["in_pool"]
    assert p["Christian Watson"]["status"] == "O" and not p["Christian Watson"]["in_pool"]
    assert p["Tee Higgins"]["status"] == "Q" and p["Tee Higgins"]["in_pool"]
    assert p["Puka Nacua"]["late"] and not p["Travis Kelce"]["late"]
    assert p["Chiefs DST"]["team_total"] and p["Chiefs DST"]["n_sources"] == 3
    # history snapshot written for real (non-sample) runs
    assert (tmp_path / "data" / "history" / "2026" / "week04" / "players.json").exists()


def test_failed_source_does_not_break_run(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "espn_projections.json").unlink()
    for pos in ("qb", "rb", "wr", "te", "dst"):
        (fx / f"fp_{pos}.html").write_text("<html>Access denied</html>")
    code, players, _, sources = run(tmp_path, fixtures=fx)
    assert code == 0
    st = statuses(sources)
    assert st["espn"] == "failed" and st["fantasypros"] == "failed" and st["sleeper"] == "ok"
    assert set(sources["failed"]) == {"espn", "fantasypros"}
    err = next(s for s in sources["sources"] if s["name"] == "fantasypros")["error"]
    assert "no rows parsed" in err
    moore = next(r for r in players if r["name"] == "DJ Moore")
    assert set(moore["projections"]) == {"sleeper", "cbs"}


def test_stale_cache_fallback(tmp_path):
    run(tmp_path)  # good run populates the cache
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "sleeper_projections.json").unlink()
    code, players, _, sources = run(tmp_path, fixtures=fx, now=NOW + timedelta(hours=6))
    sleeper = next(s for s in sources["sources"] if s["name"] == "sleeper")
    assert (sleeper["status"], sleeper["stale_hours"]) == ("stale", 6.0)
    assert "sleeper" in sources["failed"]
    assert all("sleeper" in r["projections"] for r in players if r["name"] == "DJ Moore")


def test_low_coverage_counts_as_failure(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    rows = json.loads((fx / "sleeper_projections.json").read_text())
    (fx / "sleeper_projections.json").write_text(json.dumps(rows[:20]))  # 20 of 57 players
    cfg = Config.load()
    cfg.raw["sanity"]["min_rows"]["sleeper"] = 1  # isolate the coverage check from the row-count check
    _, _, _, sources = run(tmp_path, fixtures=fx, cfg=cfg)
    sleeper = next(s for s in sources["sources"] if s["name"] == "sleeper")
    assert sleeper["status"] == "failed" and "covers" in sleeper["error"]


def test_no_salaries_is_fatal(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "dk_draftables.json").unlink()
    code, players, _, sources = run(tmp_path, fixtures=fx)
    assert code == 1 and players is None
    assert statuses(sources)["draftkings"] == "failed"


def test_manual_csv_override(tmp_path):
    overrides = tmp_path / "data" / "overrides"
    overrides.mkdir(parents=True)
    shutil.copy(FIXTURES / "DKSalaries.csv", overrides / "DKSalaries.csv")
    code, players, _, sources = run(tmp_path)
    st = statuses(sources)
    assert code == 0 and st["draftkings_csv"] == "ok" and st["draftkings"] == "disabled"
    assert len(players) == 67
    # after the slate is played, the stale CSV is ignored and the API is used again
    code, _, _, sources = run(tmp_path, now=NOW + timedelta(days=4))
    assert statuses(sources)["draftkings_csv"] == "failed"


def test_draftkings_falls_back_to_csv_endpoint(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "dk_draftables.json").unlink()  # simulate the 403 from the JSON API
    shutil.copy(FIXTURES / "DKSalaries.csv", fx / "dk_salaries_endpoint.csv")
    code, players, slate, sources = run(tmp_path, fixtures=fx)
    dk = next(s for s in sources["sources"] if s["name"] == "draftkings")
    assert code == 0 and dk["status"] == "ok" and "csv_endpoint" in dk["notes"][0]
    assert len(players) == 67 and slate["draft_group_id"] == 131000


def test_real_dk_export_with_bom_status_and_primetime_games(tmp_path):
    """Mirrors a real DraftKings export: BOM, a Status column, and Sunday-night/Monday games."""
    rows = (FIXTURES / "DKSalaries.csv").read_text().splitlines()
    header = rows[0] + ",Status"
    body = [r + (",O" if "Christian Watson" in r else ",") for r in rows[1:]]
    body += [
        "QB,Josh Allen (1),Josh Allen,1,QB,7600,BUF@NE 09/27/2026 08:20PM ET,BUF,25.0,",
        "WR,A.J. Brown (2),A.J. Brown,2,WR/FLEX,7000,PHI@LV 09/28/2026 08:15PM ET,PHI,15.0,",
    ]
    overrides = tmp_path / "data" / "overrides"
    overrides.mkdir(parents=True)
    (overrides / "DKSalaries.csv").write_text("\ufeff" + "\n".join([header, *body]) + "\n", encoding="utf-8")
    code, players, _, sources = run(tmp_path)
    csv_src = next(s for s in sources["sources"] if s["name"] == "draftkings_csv")
    assert code == 0 and csv_src["status"] == "ok"
    assert "dropped: BUF@NE, PHI@LV" in " ".join(csv_src["notes"])
    names = {r["name"]: r for r in players}
    assert len(players) == 67 and "Josh Allen" not in names
    assert names["Christian Watson"]["status"] == "O"


def test_csv_endpoint_with_bom(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "dk_draftables.json").unlink()
    (fx / "dk_salaries_endpoint.csv").write_text("\ufeff" + (FIXTURES / "DKSalaries.csv").read_text(), encoding="utf-8")
    code, players, _, _ = run(tmp_path, fixtures=fx)
    assert code == 0 and len(players) == 67


def test_all_draftkings_routes_blocked_explains_fallback(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "dk_draftables.json").unlink()
    (fx / "dk_salaries_endpoint.csv").write_text("<!DOCTYPE html><html>Log in</html>")
    code, _, _, sources = run(tmp_path, fixtures=fx)
    err = next(s for s in sources["sources"] if s["name"] == "draftkings")["error"]
    assert code == 1 and "<!DOCTYPE html>" in err and "DKSalaries.csv" in err
