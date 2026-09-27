import json
import shutil
from datetime import timedelta

from conftest import FIXTURES, NOW
from dfs.build import build
from dfs.config import Config
from dfs.http import Http


def make_config():
    """The repo config, with every source switched on so each adapter is exercised."""
    cfg = Config.load()
    cfg.raw["sources"] = {k: True for k in cfg.raw["sources"]}
    return cfg


def run(tmp_path, fixtures=FIXTURES, now=NOW, cfg=None):
    data = tmp_path / "data"
    out = tmp_path / "out"
    code = build(cfg or make_config(), Http(fixtures), data, out, now)
    load = lambda n: json.loads((out / n).read_text()) if (out / n).exists() else None  # noqa: E731
    return code, load("players.json"), load("slate.json"), load("sources.json")


def statuses(sources):
    return {s["name"]: s["status"] for s in sources["sources"]}


def test_full_offline_build(tmp_path):
    code, players, slate, sources = run(tmp_path)
    assert code == 0
    assert (slate["season"], slate["week"], slate["week_source"]) == (2026, 4, "schedule")
    assert slate["byes"] == ["ATL", "DEN", "PIT", "TB"]
    st = statuses(sources)
    # Sample pages exist for DraftSharks, BettingPros and Fantasy Six Pack; RotoBaller's only page is
    # season-long; PFF, Yahoo and Fantasy Knockout are unreachable in the fixtures.
    assert set(sources["failed"]) == {"rotoballer", "fantasyknockout", "yahoo", "pff"}
    assert all(v == "ok" for k, v in st.items() if k not in sources["failed"])
    roto = next(s for s in sources["sources"] if s["name"] == "rotoballer")["error"]
    assert "season-long" in json.dumps(json.loads((tmp_path / "out" / "probe.json").read_text())["rotoballer"])
    assert "RotoBaller" in roto

    p = {r["name"]: r for r in players}
    moore = p["DJ Moore"]
    assert moore["n_sources"] == 6 and moore["proj_sd"] is not None
    assert set(moore["projections"]) == {"sleeper", "espn", "cbs", "draftsharks", "bettingpros", "fantasysixpack"}
    assert moore["proj_min"] <= moore["proj"] <= moore["proj_max"]
    assert 0 < moore["floor"] < moore["proj"] and moore["hist_games"] == 20
    assert p["Andrei Iosivas"]["missing_sources"] == ["espn"]
    assert p["Noah Gray"]["proj"] is None and not p["Noah Gray"]["in_pool"]
    assert p["Christian Watson"]["status"] == "O" and not p["Christian Watson"]["in_pool"]
    assert p["Tee Higgins"]["status"] == "Q" and p["Tee Higgins"]["in_pool"]
    assert p["Puka Nacua"]["late"] and not p["Travis Kelce"]["late"]
    assert p["Chiefs DST"]["team_total"] and p["Chiefs DST"]["n_sources"] == 4
    assert set(sources["match_report"]["calibration"]) == {"bettingpros", "fantasysixpack", "draftsharks"}
    # history snapshot written for real (non-sample) runs
    assert (tmp_path / "data" / "history" / "2026" / "week04" / "players.json").exists()


def test_failed_source_does_not_break_run(tmp_path):
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "espn_projections.json").unlink()
    for pos in ("QB", "RB", "WR", "TE"):
        (fx / f"cbs_{pos}.html").write_text("<html>Access denied</html>")
    code, players, _, sources = run(tmp_path, fixtures=fx)
    assert code == 0
    st = statuses(sources)
    assert st["espn"] == "failed" and st["cbs"] == "failed" and st["sleeper"] == "ok"
    assert {"espn", "cbs"} <= set(sources["failed"])
    err = next(s for s in sources["sources"] if s["name"] == "cbs")["error"]
    assert "no rows parsed" in err
    moore = next(r for r in players if r["name"] == "DJ Moore")
    assert set(moore["projections"]) == {"sleeper", "draftsharks", "bettingpros", "fantasysixpack"}


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
    cfg = make_config()
    cfg.raw["sanity"]["min_rows"]["sleeper"] = 1  # isolate the coverage check from the row-count check
    _, _, _, sources = run(tmp_path, fixtures=fx, cfg=cfg)
    sleeper = next(s for s in sources["sources"] if s["name"] == "sleeper")
    assert sleeper["status"] == "failed" and "covers" in sleeper["error"]
    assert "Rows by position" in sleeper["error"] and "Not covered e.g." in sleeper["error"]


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
    assert code == 0 and dk["status"] == "ok" and "csv_endpoint" in " ".join(dk["notes"])
    assert len(players) == 67 and slate["draft_group_id"] == 131004


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

    # Default: every game in the file is kept, including Sunday night and Monday night.
    code, players, slate, sources = run(tmp_path)
    csv_src = next(s for s in sources["sources"] if s["name"] == "draftkings_csv")
    assert code == 0 and csv_src["status"] == "ok"
    names = {r["name"]: r for r in players}
    assert len(players) == 69
    assert names["Josh Allen"]["late"] and names["A.J. Brown"]["opp"] == "LV"
    assert {"BUF@NE", "PHI@LV"} <= {g["game"] for g in slate["games"]}
    assert (slate["week"], slate["slate_date"]) == (4, "2026-09-27")
    assert names["Christian Watson"]["status"] == "O"

    # Opt-in: keep only the Sunday-afternoon games.
    cfg = make_config()
    cfg.raw["slate"]["csv_main_slate_only"] = True
    code, players, _, sources = run(tmp_path, cfg=cfg)
    csv_src = next(s for s in sources["sources"] if s["name"] == "draftkings_csv")
    assert "dropped: BUF@NE, PHI@LV" in " ".join(csv_src["notes"])
    assert len(players) == 67 and "Josh Allen" not in {r["name"] for r in players}


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


def test_uploaded_projection_csv_feeds_a_subscription_site(tmp_path):
    """A projections export uploaded as projections/pff_week4.csv stands in for scraping PFF."""
    rows = ["Player,Team,Pos,Pass Yds,Pass TD,Int,Rush Yds,Rush TD,Rec,Rec Yds,Rec TD"]
    rows += ["Joe Burrow,CIN,QB,280,2.1,0.5,8,0.1,0,0,0", "Ja'Marr Chase,CIN,WR,0,0,0,2,0,7.5,95,0.7"]
    rows += [f"Player {i},KC,WR,0,0,0,0,0,1,10,0" for i in range(3)]
    folder = tmp_path / "data" / "overrides" / "projections"
    folder.mkdir(parents=True)
    (folder / "pff_week4.csv").write_text("\ufeff" + "\n".join(rows))
    (folder / "pff_week3.csv").write_text("stale file that must be ignored")
    cfg = make_config()
    cfg.raw["sources"]["pff"] = False  # an upload is used even while scraping the site is switched off
    cfg.raw["sanity"]["min_coverage"] = 0.0  # two players can't cover a slate; this checks the plumbing
    code, players, _, sources = run(tmp_path, cfg=cfg)
    pff = next(s for s in sources["sources"] if s["name"] == "pff")
    assert code == 0 and pff["status"] == "ok" and "using uploaded projections/pff_week4.csv" in pff["notes"]
    chase = next(r for r in players if r["name"] == "Ja'Marr Chase")
    # 7.5 rec + 9.5 yds + 4.2 TD + 0.2 rush + ~1.4 expected 100-yd bonus = ~22.8 DraftKings points
    assert 22.3 < chase["projections"]["pff"] < 23.3
