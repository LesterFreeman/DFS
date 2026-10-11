"""Scheduled download of FantasyPros' weekly projections (QB, FLEX, DST) into projections/.

    python -m dfs.fantasypros_download --repo-root ..            # live
    python -m dfs.fantasypros_download --repo-root .. --dry-run  # fetch and report, write nothing

Run by .github/workflows/fantasypros.yml on Friday evening, Saturday evening and Sunday morning.
Each page is converted to the same CSV layout as FantasyPros' own "Export" button and saved as
projections/fantasypros_week<N>_<qb|flex|dst>.csv, overwriting the file of the same name, so the
newest complete file for the week is the one the pipeline uses (git history keeps the others).

Caveats, stated plainly:
- FantasyPros' terms of service prohibit scraping. The project owner chose to attempt this anyway
  (October 2026); it can be switched off in config.toml ([fantasypros_download] enabled = false).
- Without a login, the public pages have shown only the top 10 players per position to GitHub's
  servers (week 3, 2026). A download with fewer rows than [fantasypros_download.min_rows] is
  rejected and NOT saved, so it can never replace a complete file; the workflow then opens a
  reminder issue so the files can be exported and uploaded by hand.
- No login, no bot-check workarounds: a block page counts as a failed download. robots.txt is
  honored.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.robotparser import RobotFileParser

from .config import Config
from .htmltable import num, parse_table
from .http import Http
from .sources import nflverse, websites

PAGES = {
    "qb": "https://www.fantasypros.com/nfl/projections/qb.php?scoring=PPR",
    "flex": "https://www.fantasypros.com/nfl/projections/flex.php?scoring=PPR",
    "dst": "https://www.fantasypros.com/nfl/projections/dst.php?scoring=PPR",
}
ROBOTS = "https://www.fantasypros.com/robots.txt"
DEFAULT_MIN_ROWS = {"qb": 25, "flex": 150, "dst": 25}
PAUSE_SECONDS = 2.0

# Same columns, order and quoting as FantasyPros' "Export" CSVs (checked against the user's uploads).
HEADERS = {
    "qb": ["Player", "Team", "ATT", "CMP", "YDS", "TDS", "INTS", "ATT", "YDS", "TDS", "FL", "FPTS"],
    "flex": ["Player", "Team", "POS", "ATT", "YDS", "TDS", "REC", "YDS", "TDS", "FL", "FPTS"],
    "dst": ["Player", "Team", "SACK", "INT", "FR", "FF", "TD", "SAFETY", "PA", "YDS_AGN", "FPTS"],
}
WEEK_RE = re.compile(r"\bWeek\s+(\d{1,2})\b", re.I)


def page_week(html: str) -> int | None:
    """The week a projections page is for, from its heading or title ("Week 6 QB Projections")."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for el in [*soup.find_all(["h1", "h2"], limit=4), soup.title]:
        m = WEEK_RE.search(el.get_text(" ", strip=True)) if el else None
        if m:
            return int(m.group(1))
    return None


def _player_cell(cell) -> tuple[str, str]:
    """Name and team from the first cell ("Josh Allen BUF")."""
    link = cell.find("a", class_="player-name") or cell.find("a")
    name = link.get_text(strip=True) if link else cell.get_text(" ", strip=True)
    rest = cell.get_text(" ", strip=True).replace(name, "", 1)
    m = re.search(r"\b([A-Z]{2,3})\b", rest)
    return name, (m.group(1) if m else "")


def _f(x: float) -> str:
    return f"{x:.1f}"


def parse_page(html: str, part: str) -> list[list[str]]:
    """Rows in the export layout (without the header)."""
    rows = []
    for v, cell in parse_table(html, "table#data"):
        name, team = _player_cell(cell)
        if not name:
            continue
        fpts = num(v, "MISC_FPTS", "FPTS")
        if part == "qb":
            stats = [num(v, "PASSING_ATT"), num(v, "PASSING_CMP"), num(v, "PASSING_YDS"), num(v, "PASSING_TDS"),
                     num(v, "PASSING_INTS"), num(v, "RUSHING_ATT"), num(v, "RUSHING_YDS"), num(v, "RUSHING_TDS"),
                     num(v, "MISC_FL", "FL")]
            rows.append([name, team, *map(_f, stats), _f(fpts)])
        elif part == "flex":
            pos = (v.get("POS") or "").strip()
            stats = [num(v, "RUSHING_ATT"), num(v, "RUSHING_YDS"), num(v, "RUSHING_TDS"), num(v, "RECEIVING_REC"),
                     num(v, "RECEIVING_YDS"), num(v, "RECEIVING_TDS"), num(v, "MISC_FL", "FL")]
            rows.append([name, team, pos, *map(_f, stats), _f(fpts)])
        else:  # dst: the export leaves Team empty; the name ("Denver Broncos") identifies the team
            stats = [num(v, "SACK"), num(v, "INT"), num(v, "FR"), num(v, "FF"), num(v, "TD"), num(v, "SAFETY"),
                     num(v, "PA"), num(v, "YDS_AGN", "YDS")]
            rows.append([name, "", *map(_f, stats), _f(fpts)])
    return rows


def to_csv(part: str, rows: list[list[str]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writerow(HEADERS[part])
    w.writerows(rows)
    return buf.getvalue()


def schedule_week(http: Http, today: date) -> int | None:
    """The regular-season week of the next Sunday-or-later game (nflverse schedule)."""
    try:
        games = nflverse.parse_games(http.get_text(nflverse.GAMES_URL, fixture="nflverse_games.csv"))
    except Exception:  # noqa: BLE001
        return None
    upcoming = [g for g in games if g.game_type == "REG" and g.gameday and g.gameday >= today.isoformat()]
    return min((g.week for g in upcoming), default=None) if upcoming else None


def _allowed(http: Http, url: str) -> bool:
    rp = RobotFileParser()
    try:
        rp.parse(http.get_text(ROBOTS, fixture=websites.fixture_name(ROBOTS), quick=True).splitlines())
    except Exception:  # noqa: BLE001 - no robots.txt: nothing is disallowed
        return True
    return rp.can_fetch(http.session.headers.get("User-Agent", "*"), url)


def run(repo_root: Path, http: Http, cfg: Config, today: date, week: int | None = None, dry_run: bool = False,
        sleep: float = PAUSE_SECONDS) -> dict:
    """Download, check and save the three files. Returns a summary (also used by the workflow)."""
    settings = cfg.section("fantasypros_download")
    summary: dict = {"enabled": bool(settings.get("enabled", True)), "week": week, "files": {}, "notes": []}
    if not summary["enabled"]:
        summary["notes"].append("switched off in config.toml ([fantasypros_download] enabled = false)")
        return summary
    min_rows = {**DEFAULT_MIN_ROWS, **{k.lower(): int(v) for k, v in settings.get("min_rows", {}).items()}}
    sched = schedule_week(http, today)
    out_dir = repo_root / "projections"
    for i, (part, url) in enumerate(PAGES.items()):
        res: dict = {"url": url, "saved": False}
        summary["files"][part] = res
        if i and sleep:
            time.sleep(sleep)
        try:
            if not _allowed(http, url):
                res["reason"] = "disallowed by robots.txt"
                continue
            html = http.get_text(url, fixture=websites.fixture_name(url), quick=True,
                                 headers={"Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"})
        except Exception as exc:  # noqa: BLE001
            res["reason"] = f"download failed: {type(exc).__name__}: {exc}"[:300]
            continue
        blocked = websites.looks_blocked(html)
        if blocked:
            res["reason"] = blocked
            continue
        rows = parse_page(html, part)
        res["rows"] = len(rows)
        wk = week or page_week(html) or sched
        if week is None and page_week(html) and sched and page_week(html) != sched:
            summary["notes"].append(f"{part}: page says week {page_week(html)}, schedule says {sched}; using the page's")
        if not wk:
            res["reason"] = "could not tell which week the page is for"
            continue
        summary["week"] = summary["week"] or wk
        if len(rows) < min_rows[part]:
            res["reason"] = (f"incomplete: {len(rows)} players (minimum {min_rows[part]}); FantasyPros shows the "
                             "full list only when signed in")
            continue
        text = to_csv(part, rows)
        filename = f"fantasypros_week{wk}_{part}.csv"
        try:  # must read back through the same reader the pipeline uses
            recs = websites.from_upload("fantasypros", [(filename, text)])
        except Exception as exc:  # noqa: BLE001
            res["reason"] = f"converted file not readable: {exc}"[:300]
            continue
        res.update({"file": f"projections/{filename}", "players": len(recs), "week": wk})
        if not dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / filename).write_text(text, encoding="utf-8")
        res["saved"] = not dry_run
    return summary


def missing_files(repo_root: Path, week: int) -> list[str]:
    """This week's FantasyPros files that are not in projections/ (case-insensitive)."""
    have = {p.name.lower() for p in (repo_root / "projections").glob("*.csv")} if (repo_root / "projections").exists() else set()
    return [f"fantasypros_week{week}_{part}.csv" for part in PAGES if f"fantasypros_week{week}_{part}.csv" not in have]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    ap.add_argument("--config", type=Path, default=None)
    ap.add_argument("--week", type=int, default=None, help="force the week number")
    ap.add_argument("--fixtures", type=Path, default=None)
    ap.add_argument("--today", default=None, help="YYYY-MM-DD (tests)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    http = Http(args.fixtures)
    summary = run(args.repo_root, http, Config.load(args.config), today, args.week, args.dry_run)
    week = summary.get("week") or schedule_week(http, today)
    summary["week"] = week
    summary["missing"] = missing_files(args.repo_root, week) if week else []
    print(json.dumps(summary, indent=1))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write(f"week={week or ''}\n")
            fh.write(f"saved={'true' if any(f.get('saved') for f in summary['files'].values()) else 'false'}\n")
            fh.write(f"missing={','.join(summary['missing'])}\n")
            fh.write("summary<<EOF\n" + json.dumps(summary) + "\nEOF\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
