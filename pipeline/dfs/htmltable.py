"""Header-driven HTML table parsing for scraped projection pages.

Handles the common two-row header layout ("PASSING" spanning "YDS TDS INTS"), producing column
keys like PASSING_YDS. Adapters map those keys onto canonical stat names, so a reordered or
added column doesn't break the parse; a renamed one shows up as missing stats.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag


def _clean(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", text.strip().upper()).strip("_")


def _cell_label(th: Tag) -> str:
    # CBS nests a short label plus a tooltip; prefer the first text chunk.
    label = th.find(class_=re.compile("label|abbr", re.I))
    text = (label or th).get_text(" ", strip=True)
    return text.split(" ")[0] if text else ""


def parse_table(html: str, selector: str) -> list[tuple[dict[str, str], Tag]]:
    """Returns (column_key -> cell text, first cell Tag) per body row."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one(selector)
    if table is None:
        return []
    head_rows = table.select("thead tr") or table.find_all("tr", limit=1)
    groups: list[str] = []
    labels: list[str] = []
    if len(head_rows) >= 2:
        for th in head_rows[-2].find_all(["th", "td"]):
            groups += [_clean(th.get_text(" ", strip=True))] * int(th.get("colspan") or 1)
    for th in head_rows[-1].find_all(["th", "td"]):
        labels += [_clean(_cell_label(th))] * int(th.get("colspan") or 1)
    keys = []
    for i, label in enumerate(labels):
        group = groups[i] if i < len(groups) else ""
        keys.append(f"{group}_{label}" if group and group != label else label)
    rows = []
    body_rows = table.select("tbody tr") or table.find_all("tr")[len(head_rows):]
    for tr in body_rows:
        cells = tr.find_all(["td", "th"])
        if not cells or len(cells) < 2:
            continue
        rows.append(({k: c.get_text(" ", strip=True) for k, c in zip(keys, cells)}, cells[0]))
    return rows


def num(values: dict[str, str], *keys: str) -> float:
    for k in keys:
        v = values.get(k)
        if v not in (None, "", "-", "—"):
            try:
                return float(v.replace(",", ""))
            except ValueError:
                continue
    return 0.0
