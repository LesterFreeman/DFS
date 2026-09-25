"""FantasyPros projections (scraped).

FantasyPros' API requires a partner key, so this parses the public projections pages. Their terms
prohibit scraping, and Cloudflare may block GitHub Actions servers. Expect this source to fail
more often than the others. FantasyPros is itself an expert consensus, so it gets one vote.
"""
from __future__ import annotations

import re

from ..htmltable import num, parse_table
from ..models import ProjRecord, SourceError
from ..names import normalize_team, team_from_text
from ..scoring import dk_points, has_stats
from .base import Context, SourceMeta

META = SourceMeta("fantasypros", "FantasyPros projections", "projections", "Scraped HTML")

URL = "https://www.fantasypros.com/nfl/projections/{pos}.php"


def _stats(pos: str, v: dict[str, str]) -> dict[str, float]:
    if pos == "DST":
        return {
            "sack": num(v, "SACK"), "def_int": num(v, "INT"), "fum_rec": num(v, "FR"),
            "def_td": num(v, "TD"), "safety": num(v, "SAFETY"), "pts_allow": num(v, "PA"),
        }
    return {
        "pass_yd": num(v, "PASSING_YDS"), "pass_td": num(v, "PASSING_TDS"),
        "pass_int": num(v, "PASSING_INTS"),
        "rush_yd": num(v, "RUSHING_YDS"), "rush_td": num(v, "RUSHING_TDS"),
        "rec": num(v, "RECEIVING_REC"), "rec_yd": num(v, "RECEIVING_YDS"),
        "rec_td": num(v, "RECEIVING_TDS"), "fum_lost": num(v, "MISC_FL"),
    }


def parse_page(html: str, pos: str) -> list[ProjRecord]:
    out = []
    for values, cell in parse_table(html, "table#data"):
        link = cell.find("a", class_="player-name") or cell.find("a")
        name = link.get_text(strip=True) if link else cell.get_text(" ", strip=True)
        rest = cell.get_text(" ", strip=True).replace(name, "", 1)
        m = re.search(r"\b([A-Z]{2,3})\b", rest)
        team = normalize_team(m.group(1)) if m else None
        ids = {}
        for a in cell.find_all("a"):
            for cls in a.get("class") or []:
                idm = re.match(r"fp-id-(\d+)", cls)
                if idm:
                    ids["fantasypros_id"] = idm.group(1)
        if pos == "DST":
            team = team or team_from_text(name)
            ids = {}
        stats = _stats(pos, values)
        if not name or not has_stats(pos, stats):
            continue
        out.append(ProjRecord(source="fantasypros", name=name, pos=pos, team=team,
                              points=dk_points(pos, stats), stats=stats, ids=ids))
    return out


def fetch(ctx: Context) -> list[ProjRecord]:
    records, errors = [], []
    for pos in ("QB", "RB", "WR", "TE", "DST"):
        try:
            html = ctx.http.get_text(
                URL.format(pos=pos.lower()), params={"week": ctx.week, "scoring": "PPR"},
                fixture=f"fp_{pos.lower()}.html",
            )
            page = parse_page(html, pos)
            if not page:
                errors.append(f"{pos}: no rows parsed")
            records += page
        except Exception as exc:  # one bad page shouldn't sink the other positions
            errors.append(f"{pos}: {type(exc).__name__}: {exc}"[:200])
    if not records:
        raise SourceError("; ".join(errors) or "no rows")
    ctx.extra.setdefault("notes", {})["fantasypros"] = errors
    return records
