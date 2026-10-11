import csv
import io
import json
from datetime import date
from pathlib import Path

from dfs import build, fantasypros_download as fpd
from dfs.config import Config
from dfs.http import Http
from dfs.sources import websites

ROOT = Path(__file__).resolve().parents[2]
TEAMS = ["BUF", "KC", "DET", "PHI", "BAL", "CIN", "SF", "DAL", "MIA", "GB", "LAR", "SEA", "MIN", "HOU", "NYJ", "PIT"]
DST_NAMES = ["Buffalo Bills", "Kansas City Chiefs", "Detroit Lions", "Philadelphia Eagles", "Baltimore Ravens",
             "Cincinnati Bengals", "San Francisco 49ers", "Dallas Cowboys", "Miami Dolphins", "Green Bay Packers",
             "Los Angeles Rams", "Seattle Seahawks", "Minnesota Vikings", "Houston Texans", "New York Jets",
             "Pittsburgh Steelers", "Denver Broncos", "Chicago Bears", "Cleveland Browns", "Atlanta Falcons",
             "New Orleans Saints", "Tampa Bay Buccaneers", "Carolina Panthers", "Arizona Cardinals",
             "Las Vegas Raiders", "Los Angeles Chargers", "New England Patriots", "New York Giants",
             "Washington Commanders", "Tennessee Titans", "Indianapolis Colts", "Jacksonville Jaguars"]


def page(part: str, n: int, week: int = 6) -> str:
    """A FantasyPros-style projections page with n players."""
    if part == "qb":
        head = ('<tr><th></th><th colspan="5">PASSING</th><th colspan="3">RUSHING</th><th colspan="2">MISC</th></tr>'
                '<tr><th>Player</th><th>ATT</th><th>CMP</th><th>YDS</th><th>TDS</th><th>INTS</th><th>ATT</th>'
                '<th>YDS</th><th>TDS</th><th>FL</th><th>FPTS</th></tr>')
        body = "".join(
            f'<tr><td><a class="player-name" href="#">{"Josh Allen" if i == 0 else f"Qb Number{i}"}</a> '
            f'{TEAMS[i % len(TEAMS)]}</td><td>32.2</td><td>20.8</td><td>{238.6 - i:.1f}</td><td>1.4</td><td>0.8</td>'
            f'<td>7.1</td><td>33.3</td><td>0.7</td><td>0.2</td><td>{21.0 - i * 0.2:.1f}</td></tr>' for i in range(n))
    elif part == "flex":
        head = ('<tr><th></th><th></th><th colspan="3">RUSHING</th><th colspan="3">RECEIVING</th><th colspan="2">MISC</th></tr>'
                '<tr><th>Player</th><th>POS</th><th>ATT</th><th>YDS</th><th>TDS</th><th>REC</th><th>YDS</th><th>TDS</th>'
                '<th>FL</th><th>FPTS</th></tr>')
        body = "".join(
            f'<tr><td><a class="player-name" href="#">{"Jahmyr Gibbs" if i == 0 else f"Flex Number{i}"}</a> '
            f'{TEAMS[i % len(TEAMS)]}</td><td>{"RB" if i % 3 == 0 else "WR"}{i // 3 + 1}</td><td>19.9</td><td>96.6</td>'
            f'<td>1.0</td><td>4.7</td><td>40.0</td><td>0.4</td><td>0.1</td><td>{26.5 - i * 0.05:.1f}</td></tr>' for i in range(n))
    else:
        head = ('<tr><th>Player</th><th>SACK</th><th>INT</th><th>FR</th><th>FF</th><th>TD</th><th>SAFETY</th>'
                '<th>PA</th><th>YDS AGN</th><th>FPTS</th></tr>')
        body = "".join(
            f'<tr><td><a class="player-name" href="#">{DST_NAMES[i]}</a></td><td>3.0</td><td>0.8</td><td>0.5</td>'
            f'<td>0.7</td><td>0.2</td><td>0.0</td><td>19.5</td><td>321.8</td><td>7.8</td></tr>' for i in range(n))
    return (f"<html><head><title>Week {week} {part.upper()} Projections | FantasyPros</title></head><body>"
            f"<h1>Week {week} Fantasy Football Projections: {part.upper()}</h1>"
            f'<table id="data"><thead>{head}</thead><tbody>{body}</tbody></table>'
            + "<p>" + "Projections for this week. " * 40 + "</p></body></html>")


def fixtures(tmp: Path, sizes=None, week: int = 6, robots: str | None = None, overrides: dict | None = None) -> Path:
    fx = tmp / "fx"
    fx.mkdir(parents=True, exist_ok=True)
    sizes = sizes or {"qb": 40, "flex": 200, "dst": 32}
    for part, url in fpd.PAGES.items():
        html = (overrides or {}).get(part) or page(part, sizes[part], week)
        (fx / websites.fixture_name(url)).write_text(html)
    if robots is not None:
        (fx / websites.fixture_name(fpd.ROBOTS)).write_text(robots)
    return fx


def enabled_config() -> Config:
    """The repo config with downloads switched on (they're off in config.toml; tests exercise them)."""
    cfg = Config.load()
    cfg.raw["fantasypros_download"] = {**cfg.raw.get("fantasypros_download", {}), "enabled": True}
    return cfg


def run(tmp: Path, fx: Path, **kw):
    return fpd.run(tmp / "repo", Http(fx), enabled_config(), date(2026, 10, 9), sleep=0, **kw)


def test_full_pages_are_saved_in_the_export_layout_and_read_back(tmp_path):
    s = run(tmp_path, fixtures(tmp_path))
    assert s["week"] == 6
    assert all(f["saved"] for f in s["files"].values()), s
    folder = tmp_path / "repo" / "projections"
    assert sorted(p.name for p in folder.iterdir()) == [
        "fantasypros_week6_dst.csv", "fantasypros_week6_flex.csv", "fantasypros_week6_qb.csv"]
    # same header line as the user's real exports
    for part in ("qb", "flex", "dst"):
        mine = (folder / f"fantasypros_week6_{part}.csv").read_text().splitlines()[0]
        real = (ROOT / "projections" / f"fantasypros_week5_{part}.csv").read_text(encoding="utf-8-sig").splitlines()[0]
        assert mine == real, part
    recs = websites.from_upload("fantasypros", [(p.name, p.read_text()) for p in folder.iterdir()])
    allen = next(r for r in recs if r.name == "Josh Allen")
    assert allen.pos == "QB" and allen.team == "BUF" and allen.stats["pass_yd"] == 238.6 and allen.stats["rush_yd"] == 33.3
    gibbs = next(r for r in recs if r.name == "Jahmyr Gibbs")
    assert gibbs.pos == "RB" and gibbs.stats["rec"] == 4.7
    bills = next(r for r in recs if r.pos == "DST" and r.team == "BUF")
    assert bills.stats["sack"] == 3.0 and bills.stats["pts_allow"] == 19.5
    row = next(csv.reader(io.StringIO((folder / "fantasypros_week6_dst.csv").read_text().splitlines()[1])))
    assert row[:3] == ["Buffalo Bills", "", "3.0"]


def test_top_10_pages_are_rejected_and_never_replace_a_complete_file(tmp_path):
    folder = tmp_path / "repo" / "projections"
    folder.mkdir(parents=True)
    (folder / "fantasypros_week6_qb.csv").write_text("complete manual export")
    s = run(tmp_path, fixtures(tmp_path, sizes={"qb": 10, "flex": 10, "dst": 10}))
    for f in s["files"].values():
        assert not f["saved"] and "incomplete: 10 players" in f["reason"]
    assert (folder / "fantasypros_week6_qb.csv").read_text() == "complete manual export"
    assert fpd.missing_files(tmp_path / "repo", 6) == ["fantasypros_week6_flex.csv", "fantasypros_week6_dst.csv"]


def test_bot_check_and_robots_block_are_failures(tmp_path):
    bot = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"
    s = run(tmp_path, fixtures(tmp_path, overrides={"qb": bot}))
    assert s["files"]["qb"]["reason"] == "bot check / block page"
    assert s["files"]["flex"]["saved"]
    s2 = run(tmp_path / "b", fixtures(tmp_path / "b", robots="User-agent: *\nDisallow: /nfl/projections/\n"))
    assert all(f["reason"] == "disallowed by robots.txt" for f in s2["files"].values())


def test_week_from_page_vs_schedule_and_override(tmp_path):
    fx = fixtures(tmp_path, week=7)
    (fx / "nflverse_games.csv").write_text(
        "game_id,season,game_type,week,gameday,gametime,away_team,home_team,spread_line,total_line\n"
        "x,2026,REG,6,2026-10-11,13:00,KC,BUF,,\ny,2026,REG,7,2026-10-18,13:00,KC,BUF,,\n")
    s = run(tmp_path, fx)
    assert s["week"] == 7 and any("page says week 7, schedule says 6" in n for n in s["notes"])
    s2 = run(tmp_path / "o", fx, week=9)
    assert s2["files"]["qb"]["file"] == "projections/fantasypros_week9_qb.csv"


def test_switched_off_and_dry_run(tmp_path):
    cfg = Config.load()
    cfg.raw["fantasypros_download"] = {"enabled": False}
    s = fpd.run(tmp_path, Http(fixtures(tmp_path)), cfg, date(2026, 10, 9), sleep=0)
    assert not s["enabled"] and s["files"] == {}
    s2 = run(tmp_path, fixtures(tmp_path), dry_run=True)
    assert not any(f["saved"] for f in s2["files"].values()) and not (tmp_path / "repo" / "projections").exists()


def test_cli_writes_github_outputs(tmp_path, monkeypatch, capsys):
    out = tmp_path / "gh_out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    fx = fixtures(tmp_path, sizes={"qb": 40, "flex": 10, "dst": 32})
    cfg = enabled_config()
    monkeypatch.setattr(fpd.Config, "load", staticmethod(lambda path=None: cfg))
    assert fpd.main(["--repo-root", str(tmp_path / "repo"), "--fixtures", str(fx), "--today", "2026-10-09"]) == 0
    text = out.read_text()
    assert "week=6" in text and "saved=true" in text and "missing=fantasypros_week6_flex.csv" in text
    assert json.loads(capsys.readouterr().out)["files"]["flex"]["rows"] == 10


def test_pipeline_uses_the_newest_of_duplicate_files(tmp_path):
    folder = tmp_path / "overrides" / "projections"
    folder.mkdir(parents=True)
    for name in ("fantasypros_week6_qb.csv", "FantasyPros_week6_QB.csv", "fantasypros_week6_dst.csv",
                 "fantasypros_week5_qb.csv"):
        (folder / name).write_text("x")
    (folder / "manifest.json").write_text(json.dumps({
        "fantasypros_week6_qb.csv": {"time": 1760000000, "auto": True},       # Saturday download
        "FantasyPros_week6_QB.csv": {"time": 1760100000, "auto": False},      # later manual upload
        "fantasypros_week6_dst.csv": {"time": 1760000000, "auto": True},
    }))
    uploads = build._projection_uploads(tmp_path, 6)
    assert [p.name for p in uploads["fantasypros"]] == ["FantasyPros_week6_QB.csv", "fantasypros_week6_dst.csv"]
    assert "downloaded automatically" in build._provenance(tmp_path, folder / "fantasypros_week6_dst.csv")
    assert build._provenance(tmp_path, folder / "fantasypros_week5_qb.csv") == ""
