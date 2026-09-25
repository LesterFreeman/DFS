"""CBS Sports projections (scraped). Offense only.

Public HTML, no API. CBS terms restrict automated collection; markup changes periodically.
"""
from __future__ import annotations

from ..htmltable import num, parse_table
from ..models import ProjRecord, SourceError
from ..names import normalize_team
from ..scoring import dk_points, has_stats
from .base import Context, SourceMeta

META = SourceMeta("cbs", "CBS projections", "projections", "Scraped HTML")

URL = "https://www.cbssports.com/fantasy/football/stats/{pos}/{season}/{week}/projections/ppr/"


def _stats(v: dict[str, str]) -> dict[str, float]:
    return {
        "pass_yd": num(v, "PASSING_YDS"), "pass_td": num(v, "PASSING_TD"),
        "pass_int": num(v, "PASSING_INT"),
        "rush_yd": num(v, "RUSHING_YDS"), "rush_td": num(v, "RUSHING_TD"),
        "rec": num(v, "RECEIVING_REC"), "rec_yd": num(v, "RECEIVING_YDS"),
        "rec_td": num(v, "RECEIVING_TD"), "fum_lost": num(v, "MISC_FL"),
    }


def parse_page(html: str, pos: str) -> list[ProjRecord]:
    out = []
    for values, cell in parse_table(html, "table.TableBase-table"):
        wrap = cell.select_one(".CellPlayerName--long") or cell
        link = wrap.find("a")
        name = link.get_text(strip=True) if link else ""
        team_el = wrap.select_one(".CellPlayerName-team")
        team = normalize_team(team_el.get_text(strip=True)) if team_el else None
        stats = _stats(values)
        if not name or not has_stats(pos, stats):
            continue
        out.append(ProjRecord(source="cbs", name=name, pos=pos, team=team,
                              points=dk_points(pos, stats), stats=stats))
    return out


def fetch(ctx: Context) -> list[ProjRecord]:
    records, errors = [], []
    for pos in ("QB", "RB", "WR", "TE"):
        try:
            html = ctx.http.get_text(URL.format(pos=pos, season=ctx.season, week=ctx.week),
                                     fixture=f"cbs_{pos}.html")
            page = parse_page(html, pos)
            if not page:
                errors.append(f"{pos}: no rows parsed")
            records += page
        except Exception as exc:
            errors.append(f"{pos}: {type(exc).__name__}: {exc}"[:200])
    if not records:
        raise SourceError("; ".join(errors) or "no rows")
    ctx.extra.setdefault("notes", {})["cbs"] = errors
    return records
