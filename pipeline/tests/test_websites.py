import json

import pytest

from conftest import FIXTURES
from dfs.sources import websites
from dfs.sources.websites import (discover_links, extract_page, parse_player_text, pick_points_key, pos_from_url,
                                  records_from_rows)


@pytest.mark.parametrize("text,expected", [
    ("Josh Allen (BUF - QB)", ("Josh Allen", "BUF", "QB")),
    ("1. Josh Allen BUF QB", ("Josh Allen", "BUF", "QB")),
    ("Ja'Marr Chase CIN WR Q", ("Ja'Marr Chase", "CIN", "WR")),
    ("Allen, Josh", ("Josh Allen", None, None)),
    ("Kenneth Walker III (SEA)", ("Kenneth Walker III", "SEA", None)),
    ("Kansas City Chiefs", ("Kansas City Chiefs", "KC", "DST")),
    ("Chiefs D/ST", ("Chiefs D/ST", "KC", "DST")),
    ("A.J. Brown PHI - WR", ("A.J. Brown", "PHI", "WR")),
    ("Josh Allen QB - BUF", ("Josh Allen", "BUF", "QB")),
    ("Buffalo Bills DEF", ("Buffalo Bills", None, "DST")),
])
def test_parse_player_text(text, expected):
    assert parse_player_text(text) == expected


@pytest.mark.parametrize("url,pos", [
    ("https://x.com/nfl/projections/qb/", "QB"),
    ("https://x.com/projections?position=wr&week=4", "WR"),
    ("https://x.com/weekly-te-projections", "TE"),
    ("https://x.com/projections/def", "DST"),
    ("https://x.com/nfl/projections/", None),
    ("https://x.com/quarterbacks", None),
])
def test_pos_from_url(url, pos):
    assert pos_from_url(url) == pos


def test_points_column_prefers_dk_then_ppr_and_skips_other_formats():
    assert pick_points_key(["Player", "Half PPR", "PPR", "Std"]) == "PPR"
    assert pick_points_key(["Player", "FPTS", "DK Pts"]) == "DK Pts"
    assert pick_points_key(["Player", "Rank", "Season Pts", "Proj Fpts"]) == "Proj Fpts"
    assert pick_points_key(["Player", "Rank", "Avg"]) is None


def test_discover_links_ranks_weekly_nfl_and_drops_other_sports_and_hosts():
    html = """<a href="/nfl/week-4-ppr-projections">Week 4</a> <a href="/nba/projections">NBA</a>
              <a href="/dynasty-projections">Dynasty</a> <a href="https://other.com/projections">x</a>
              <a href="/projections">All projections</a> <a href="/news">News</a>"""
    assert discover_links(html, "https://www.site.com/") == [
        "https://www.site.com/nfl/week-4-ppr-projections", "https://www.site.com/projections"]


def test_discover_links_skips_images_and_archive_pages():
    html = """<a href="/fantasy-football-wr-projections/">WR</a>
              <a href="/wp-content/uploads/2025/06/Fantasy-Football-QB-Projections-Banner.jpg">banner</a>
              <a href="/tag/fantasy-football-qb-projections/">tag</a>
              <a href="/category/projections/">cat</a>"""
    assert discover_links(html, "https://fantasysixpack.net/x/", require_pos=True) == [
        "https://fantasysixpack.net/fantasy-football-wr-projections/"]


def test_season_long_pages_are_rejected():
    rows = [{"Player": f"Player {i}", "Team": "KC", "Pos": "WR", "Fantasy Points": 250 - i} for i in range(30)]
    recs, info = records_from_rows(rows, "x")
    assert recs == [] and "season-long" in info["reason"]


def test_embedded_window_state_json():
    players = [{"playerName": f"Player {i}", "teamAbbr": "KC", "position": "RB", "stats": {"projPts": 10 + i / 10}}
               for i in range(20)]
    html = f"<html><script>window.__INITIAL_STATE__ = {json.dumps({'data': {'rows': players}})};</script></html>"
    recs, diag = extract_page(html, "https://x.com/projections", "x")
    assert len(recs) == 20 and diag["best"]["from"].startswith("json")
    assert recs[0].team == "KC" and recs[0].pos == "RB" and recs[0].native


def test_crawl_respects_robots_and_reports_every_page(ctx):
    recs = websites.fetch(websites.SITES_BY_NAME["draftsharks"], ctx)
    pages = ctx.extra["probe"]["draftsharks"]
    statuses = {p["url"].rsplit("/", 1)[-1]: p["status"] for p in pages}
    assert statuses["premium-projections"] == "skipped: disallowed by robots.txt"
    assert len(recs) == 66
    burrow = next(r for r in recs if r.name == "Joe Burrow")
    assert not burrow.native and burrow.stats["pass_yd"] > 200  # stat line rescored, not the site's FPTS
    assert next(r for r in recs if r.pos == "DST" and r.team == "KC").native


def test_unreachable_site_fails_with_page_summary(ctx):
    with pytest.raises(Exception) as exc:
        websites.fetch(websites.SITES_BY_NAME["pff"], ctx)
    assert "PFF+" in str(exc.value) and "/fantasy/projections" in str(exc.value)


def test_fixture_names_exist_for_sample_sites():
    for url in ("https://www.draftsharks.com/", "https://fantasysixpack.net/fantasy-football-qb-projections/"):
        assert (FIXTURES / websites.fixture_name(url)).exists()


def test_discover_data_urls_finds_api_json_and_projection_iframes():
    html = """<iframe src="https://tools.partner.com/embed/nfl-projections?week=4"></iframe>
              <iframe src="https://ads.example.com/banner"></iframe>
              <script>var cfg = {"api": "/api/nfl/projections.json?week=4", "logo": "/img/projections.png",
                                 "tpl": "/api/{sport}/projections", "news": "/api/nfl/news.json"};</script>"""
    assert websites.discover_data_urls(html, "https://www.site.com/nfl/projections") == [
        "https://tools.partner.com/embed/nfl-projections?week=4", "https://www.site.com/api/nfl/projections.json?week=4"]


def test_nflcom_pages_rescored_including_defenses_and_paging_stops(ctx):
    recs = websites.fetch(websites.SITES_BY_NAME["nflcom"], ctx)
    pages = ctx.extra["probe"]["nflcom"]
    assert len(recs) == 66 and not any(r.native for r in recs)  # offense and DST rescored from stat lines
    bills = next(r for r in recs if r.pos == "DST" and r.team == "KC")
    assert bills.stats["pts_allow"] > 0
    # 57 offensive players fill 3 pages; the empty 4th page stops the remaining offsets
    offense_pages = [p for p in pages if "position=O" in p["url"]]
    assert len(offense_pages) == 4


def test_fantasypoints_follows_data_address(ctx):
    recs = websites.fetch(websites.SITES_BY_NAME["fantasypoints"], ctx)
    pages = ctx.extra["probe"]["fantasypoints"]
    assert len(recs) == 56 and pages[-1]["url"].endswith("projections.json?season=2026&week=4")
    assert any("data_urls" in p for p in pages)


def test_bot_check_stops_the_crawl(ctx, tmp_path):
    import shutil
    from dfs.http import Http
    fx = tmp_path / "fx"
    shutil.copytree(FIXTURES, fx)
    for p in ("qb", "rb", "wr", "te"):
        url = f"https://fantasysixpack.net/fantasy-football-{p}-projections/"
        (fx / websites.fixture_name(url)).write_text(
            "<html><head><meta http-equiv='refresh' content='0;url=/.well-known/sgcaptcha/'></head><body></body></html>")
    ctx.http = Http(fx)
    with pytest.raises(Exception) as exc:
        websites.fetch(websites.SITES_BY_NAME["fantasysixpack"], ctx)
    pages = ctx.extra["probe"]["fantasysixpack"]
    assert pages[-1]["status"].startswith("stopped: bot check")
    assert sum(p["status"].startswith("stopped") for p in pages) == 1  # no further pages requested
    assert "bot check" in str(exc.value)


def test_page_without_data_records_a_text_sample():
    recs, diag = extract_page("<html><title>Fantasy News | NFL.com</title><body><p>Latest news and analysis</p>"
                              + "<p>x</p>" * 2000 + "</body></html>", "https://fantasy.nfl.com/research/projections", "x")
    assert recs == [] and diag["text_sample"].startswith("Fantasy News | NFL.com Latest news")


@pytest.mark.parametrize("filename,expected", [
    ("fantasypros_week3_qb.csv", ("fantasypros", 3, "qb")),
    ("fantasypros_week3_flex.csv", ("fantasypros", 3, "flex")),
    ("FantasyPros_Week12_DST.csv", ("fantasypros", 12, "DST")),
    ("pff_week4.csv", ("pff", 4, None)),
    ("pff.csv", ("pff", None, None)),
    ("pff_qb.csv", ("pff", None, "qb")),
    ("notes.txt", None),
])
def test_parse_upload_name(filename, expected):
    assert websites.parse_upload_name(filename) == expected


def test_repeated_fantasypros_headers_are_grouped():
    qb = ["Player", "Team", "ATT", "CMP", "YDS", "TDS", "INTS", "ATT", "YDS", "TDS", "FL", "FPTS"]
    assert websites.disambiguate_headers(qb) == [
        "Player", "Team", "PASSING_ATT", "PASSING_CMP", "PASSING_YDS", "PASSING_TDS", "PASSING_INTS",
        "RUSHING_ATT", "RUSHING_YDS", "RUSHING_TDS", "FL", "FPTS"]
    flex = ["Player", "Team", "POS", "ATT", "YDS", "TDS", "REC", "YDS", "TDS", "FL", "FPTS"]
    assert websites.disambiguate_headers(flex)[3:9] == [
        "RUSHING_ATT", "RUSHING_YDS", "RUSHING_TDS", "RECEIVING_REC", "RECEIVING_YDS", "RECEIVING_TDS"]
    dst = ["Player", "Team", "SACK", "INT", "FR", "FF", "TD", "SAFETY", "PA", "YDS AGN", "FPTS"]
    assert websites.disambiguate_headers(dst) == dst  # nothing repeated: unchanged
