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
    assert st["nflcom"] == "ok" and st["fantasypoints"] == "ok"
    assert all(v == "ok" for k, v in st.items() if k not in sources["failed"])
    roto = next(s for s in sources["sources"] if s["name"] == "rotoballer")["error"]
    assert "season-long" in json.dumps(json.loads((tmp_path / "out" / "probe.json").read_text())["rotoballer"])
    assert "RotoBaller" in roto

    p = {r["name"]: r for r in players}
    moore = p["DJ Moore"]
    assert moore["n_sources"] == 8 and moore["proj_sd"] is not None
    assert set(moore["projections"]) == {"sleeper", "espn", "cbs", "draftsharks", "bettingpros", "fantasysixpack",
                                         "fantasypoints", "nflcom"}
    assert moore["proj_min"] <= moore["proj"] <= moore["proj_max"]
    assert 0 < moore["floor"] < moore["proj"] and moore["hist_games"] == 20
    assert p["Andrei Iosivas"]["missing_sources"] == ["espn"]
    assert p["Noah Gray"]["proj"] is None and not p["Noah Gray"]["in_pool"]
    assert p["Christian Watson"]["status"] == "O" and not p["Christian Watson"]["in_pool"]
    assert p["Tee Higgins"]["status"] == "Q" and p["Tee Higgins"]["in_pool"]
    assert p["Puka Nacua"]["late"] and not p["Travis Kelce"]["late"]
    assert p["Chiefs DST"]["team_total"] and p["Chiefs DST"]["n_sources"] == 5
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
    assert set(moore["projections"]) == {"sleeper", "draftsharks", "bettingpros", "fantasysixpack",
                                         "fantasypoints", "nflcom"}


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
    assert statuses(sources)["draftkings_csv"] == "disabled"


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


def test_fantasypros_exports_qb_flex_dst(tmp_path):
    """Three FantasyPros projection exports combine into one 'fantasypros' source."""
    folder = tmp_path / "data" / "overrides" / "projections"
    folder.mkdir(parents=True)
    (folder / "fantasypros_week4_qb.csv").write_text(
        '﻿"Player","Team","ATT","CMP","YDS","TDS","INTS","ATT","YDS","TDS","FL","FPTS"\n'
        '"","","","","","","","","","","",""\n'
        '"Joe Burrow","CIN","36.1","24.2","300.0","2.0","0.5","3.0","10.0","0.0","0.1","21.9"\n'
        '"Patrick Mahomes","KC","35.0","23.0","260.0","2.0","1.0","4.0","25.0","0.5","0.2","22.6"\n')
    (folder / "fantasypros_week4_flex.csv").write_text(
        '"Player","Team","POS","ATT","YDS","TDS","REC","YDS","TDS","FL","FPTS"\n'
        '"Ja\'Marr Chase","CIN","WR","0.3","2.0","0.0","7.5","95.0","0.7","0.0","21.4"\n'
        '"Chase Brown","CIN","RB","15.0","68.0","0.6","3.4","24.0","0.1","0.1","16.2"\n')
    (folder / "fantasypros_week4_dst.csv").write_text(
        '"Player","Team","SACK","INT","FR","FF","TD","SAFETY","PA","YDS AGN","FPTS"\n'
        '"Kansas City Chiefs","KC","3.0","1.0","0.5","0.6","0.2","0.0","17.0","320.0","8.9"\n')
    (folder / "fantasypros_week3_qb.csv").write_text("last week's file, ignored")
    cfg = make_config()
    cfg.raw["sanity"]["min_coverage"] = 0.0  # five players can't cover a slate; this checks the parsing
    code, players, _, sources = run(tmp_path, cfg=cfg)
    fp = next(s for s in sources["sources"] if s["name"] == "fantasypros")
    assert code == 0 and fp["status"] == "ok" and fp["label"] == "Fantasypros (uploaded)" and fp["rows"] == 5
    assert "projections/fantasypros_week4_dst.csv" in fp["notes"][0]
    p = {r["name"]: r["projections"].get("fantasypros") for r in players}
    # Burrow: 300 pass yds 12 + ~1.5 expected bonus + 2 TD 8 - 0.5 INT + 10 rush yds 1 - 0.1 FL = ~21.9.
    # Had the rushing YDS column overwritten passing YDS he would score ~9.
    assert 21.5 < p["Joe Burrow"] < 22.3
    assert 22.3 < p["Ja'Marr Chase"] < 23.3                     # REC/YDS/TDS read as receiving
    assert 16.5 < p["Chase Brown"] < 17.8  # 6.8 + 3.6 rush TD + 3.4 rec + 2.4 + 0.6 - 0.1 + ~0.5 bonus
    assert p["Chiefs DST"] is not None and 6 < p["Chiefs DST"] < 12  # DST file by name/team


def test_sleeper_players_file_downloaded_at_most_once_a_day(tmp_path):
    run(tmp_path)  # first run downloads and caches the players file
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    (fx / "sleeper_players.json").unlink()  # any further download would now fail
    _, players, _, sources = run(tmp_path, fixtures=fx, now=NOW + timedelta(hours=6))
    st = next(s for s in sources["sources"] if s["name"] == "sleeper_status")
    assert st["status"] == "ok" and "reused download from 6.0h ago" in st["notes"][0]
    assert st["fetched_at"] == "2026-09-25T12:00:00Z"
    assert next(r for r in players if r["name"] == "Tee Higgins")["status_detail"]["sleeper"] == "Q"
    # after 20 hours it downloads again (here: the file is gone, so the fetch fails and says so)
    _, _, _, sources = run(tmp_path, fixtures=fx, now=NOW + timedelta(hours=21))
    st = next(s for s in sources["sources"] if s["name"] == "sleeper_status")
    assert st["status"] in ("failed", "stale") and st["error"]


def test_expired_uploaded_csv_with_recent_cache_falls_through_to_draftkings(tmp_path):
    """Regression (week 3 -> 4, 2026): once the uploaded slate had been played, the CSV's cached
    copy was re-validated as raw dicts and crashed the run before DraftKings was tried."""
    overrides = tmp_path / "data" / "overrides"
    overrides.mkdir(parents=True)
    shutil.copy(FIXTURES / "DKSalaries.csv", overrides / "DKSalaries.csv")
    assert run(tmp_path)[0] == 0  # caches the CSV slate
    # 71h later: the slate (last kickoff Sun 20:25Z) is over, the cache is under 72h old
    code, _, _, sources = run(tmp_path, now=NOW + timedelta(hours=71))
    st = statuses(sources)
    csv_src = next(s for s in sources["sources"] if s["name"] == "draftkings_csv")
    # an expired upload is skipped with an explanation, not reported as a failure
    assert st["draftkings_csv"] == "disabled" and "draftkings_csv" not in sources["failed"]
    assert "slate that has been played" in csv_src["notes"][0]
    assert st["draftkings"] in ("ok", "failed")  # DraftKings was tried next (fixture slate is also over)
    assert sources is not None and code in (0, 1)


def test_unexpected_crash_still_writes_a_health_report(tmp_path, monkeypatch):
    from dfs import build as build_mod

    def boom(*a, **k):
        raise RuntimeError("simulated bug")

    monkeypatch.setattr(build_mod, "build", boom)
    out = tmp_path / "out"
    code = build_mod.main(["--fixtures", str(FIXTURES), "--data-dir", str(tmp_path / "data"), "--out", str(out)])
    report = json.loads((out / "sources.json").read_text())
    assert code == 1 and report["failed"] == ["pipeline"]
    assert "simulated bug" in report["sources"][0]["error"]



def test_rankings_export_files_are_explained(tmp_path):
    """FantasyPros' rankings export (week 4, 2026) instead of the projections export: QB/DST carry
    only PROJ. FPTS, FLEX has no projection column. Usable files are used, the rest are named."""
    folder = tmp_path / "data" / "overrides" / "projections"
    folder.mkdir(parents=True)
    (folder / "fantasypros_week4_qb.csv").write_text(
        '"RK","PLAYER NAME",TEAM,"OPP","UPSIDE ","BUST ","MATCHUP ","START/SIT","PROJ. FPTS"\n'
        '"1","Joe Burrow",CIN,"vs. KC","-","-","2 out of 5 stars","A+","22.7"\n'
        '"2","Patrick Mahomes",KC,"at CIN","5 out of 5","2 out of 5","3 out of 5 stars","A","21.4"\n')
    (folder / "fantasypros_week4_flex.csv").write_text(
        '"RK","PLAYER NAME",TEAM,"POS","OPP","UPSIDE ","BUST ","MATCHUP "\n'
        '"1","Ja\'Marr Chase",CIN,"WR1","vs. KC","-","-","5 out of 5 stars"\n')
    cfg = make_config()
    cfg.raw["sanity"]["min_coverage"] = 0.0
    code, players, _, sources = run(tmp_path, cfg=cfg)
    fp = next(s for s in sources["sources"] if s["name"] == "fantasypros")
    notes = " ".join(fp["notes"])
    assert code == 0 and fp["status"] == "ok" and fp["rows"] == 2
    assert "fantasypros_week4_qb.csv: points total only" in notes
    assert "fantasypros_week4_flex.csv skipped: no player or projection columns" in notes
    burrow = next(r for r in players if r["name"] == "Joe Burrow")
    assert burrow["projections"]["fantasypros"] == 22.7  # under 8 shared players per position: not scaled
