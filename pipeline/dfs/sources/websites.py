"""Projection websites without an API: auto-discovered, format-agnostic scraping.

Each site gets the same treatment, because these pages couldn't be inspected in advance and
change often:

1. Read robots.txt and skip anything it disallows. Pause between requests.
2. Start from the site's seed URLs plus links on its homepage that mention projections
   (NFL/weekly/PPR links ranked first; season-long, draft, dynasty and other sports last).
   From a projections page, follow per-position links (QB/RB/WR/TE/DST) that also mention projections.
3. On every page, look for projection rows in HTML tables and in JSON embedded in the page
   (Next.js __NEXT_DATA__, window.__STATE__ = {...}, application/json scripts), or in the body
   itself if the URL returns JSON.
4. Map columns by name: player/team/position, stat lines (rescored with DraftKings rules), or a
   fantasy-points column (used as the site's own PPR total when no stat line is available).
5. Reject pages that look like season-long projections.

Every page tried is recorded (status, tables/JSON found, columns used) in probe.json, so a site
that's close to working can be tuned from real output. Logins and paywalls are not bypassed:
a subscription site can instead be fed by uploading its CSV export to projections/<site>.csv.
"""
from __future__ import annotations

import csv
import io
import json
import re
import time
from dataclasses import dataclass
from statistics import median
from typing import Any, Iterable
from urllib.parse import urldefrag, urljoin, urlparse
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup, Tag

from ..models import ProjRecord, SourceError
from ..names import normalize_name, normalize_pos, normalize_team, team_from_text
from ..scoring import dk_points, has_stats
from .base import Context, SourceMeta


@dataclass(frozen=True)
class Site:
    name: str
    label: str
    home: str
    seeds: tuple[str, ...] = ()  # may contain {season} and {week}
    note: str = ""
    max_pages: int = 12
    crawl_home: bool = True  # False when the seeds already list every page needed

    def seed_urls(self, season: int, week: int) -> list[str]:
        return [u.format(season=season, week=week) for u in self.seeds]

    @property
    def meta(self) -> SourceMeta:
        return SourceMeta(self.name, f"{self.label} projections", "projections", "Scraped (auto-discovered)")


NFL_URL = ("https://fantasy.nfl.com/research/projections?offset={offset}&position={position}&sort=projectedPts"
           "&statCategory=projectedStats&statSeason={{season}}&statType=weekProjectedStats&statWeek={{week}}")
NFL_SEEDS = tuple(NFL_URL.format(offset=o, position="O") for o in range(1, 300, 25)) + tuple(
    NFL_URL.format(offset=o, position="8") for o in (1, 26))

# Seed URLs are best guesses at public projection pages; discovery from the homepage covers the rest.
SITES = (
    Site("draftsharks", "DraftSharks", "https://www.draftsharks.com/", (),
         "DraftSharks' homepage links no projection pages (seen week 3, 2026); its projections are mostly for subscribers."),
    Site("rotoballer", "RotoBaller", "https://www.rotoballer.com/",
         ("https://www.rotoballer.com/fantasy-football-projections",),
         "RotoBaller's projections page loads its numbers with JavaScript after the page (Premium tool); "
         "data addresses and frames it mentions are followed."),
    Site("fantasyknockout", "Fantasy Knockout", "https://www.fantasyknockout.com/", (),
         "Fantasy Knockout's homepage links no projection pages (seen week 3, 2026)."),
    Site("yahoo", "Yahoo", "https://sports.yahoo.com/fantasy/",
         (), "Yahoo shows player projections inside leagues (login required)."),
    Site("pff", "PFF", "https://www.pff.com/",
         ("https://www.pff.com/fantasy/projections",),
         "PFF's projections page is a JavaScript app backed by PFF+ (subscription); the HTML has no data."),
    Site("bettingpros", "BettingPros", "https://www.bettingpros.com/",
         ("https://www.bettingpros.com/nfl/fantasy-football/projections/",),
         "BettingPros' homepage links no NFL projection page and the guessed URL returned 404 (week 3, 2026)."),
    Site("fantasypoints", "Fantasy Points", "https://www.fantasypoints.com/",
         ("https://www.fantasypoints.com/nfl/projections",),
         "Fantasy Points is largely a subscription site; its projections may need a login."),
    Site("nflcom", "NFL.com", "https://fantasy.nfl.com/", NFL_SEEDS,
         "NFL.com Fantasy research pages list 25 players per page (offense sorted by projection, then DST).",
         max_pages=len(NFL_SEEDS) + 2, crawl_home=False),
    Site("fantasysixpack", "Fantasy Six Pack", "https://fantasysixpack.net/",
         tuple(f"https://fantasysixpack.net/fantasy-football-{p}-projections/" for p in ("qb", "rb", "wr", "te"))),
)
SITES_BY_NAME = {s.name: s for s in SITES}

MAX_PAGES = 12
TIME_BUDGET_S = 90
POLITE_DELAY_S = 1.0
SEASON_LONG_MEDIAN = 45.0  # median of the top-20 weekly projections is ~20; season totals are 150+

POSITIONS = ("QB", "RB", "WR", "TE", "DST")
INJURY_TOKENS = {"Q", "D", "O", "IR", "OUT", "P", "PUP", "SUS", "NA", "DTD", "GTD", "PROB", "QUES"}
POS_TOKENS = {"QB", "RB", "WR", "TE", "DST", "DEF", "D/ST", "DST/DEF", "K", "PK", "FB"}


# ----------------------------------------------------------------------------- column mapping

def _norm(key: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


NAME_KEYS = ("player", "name", "playername", "fullname", "displayname", "athlete", "playerfullname")
TEAM_KEYS = ("team", "tm", "teamabbr", "teamabbreviation", "teamabbrev", "proteam", "teamcode", "nflteam")
POS_KEYS = ("pos", "position", "positionabbr", "positionabbreviation", "playerposition", "primaryposition")

STAT_KEYS: dict[str, tuple[str, ...]] = {
    "pass_yd": ("passingyds", "passyds", "passingyards", "passyd", "passyards", "pyds", "pyd", "passingyd"),
    "pass_td": ("passingtds", "passingtd", "passtd", "passtds", "passingtouchdowns", "ptd", "ptds"),
    "pass_int": ("passingints", "passingint", "passint", "passints", "passinginterceptions", "interceptions",
                 "ints", "int"),
    "rush_yd": ("rushingyds", "rushyds", "rushingyards", "rushyd", "rushyards", "ruyds", "rushingyd"),
    "rush_td": ("rushingtds", "rushingtd", "rushtd", "rushtds", "rushingtouchdowns", "rutd", "rutds"),
    "rec": ("receivingrec", "rec", "recs", "receptions", "receivingreceptions", "catches"),
    "rec_yd": ("receivingyds", "recyds", "receivingyards", "recyd", "recyards", "receivingyd", "reyds"),
    "rec_td": ("receivingtds", "receivingtd", "rectd", "rectds", "receivingtouchdowns", "retd"),
    "fum_lost": ("miscfl", "fl", "fumbleslost", "fumlost", "fumbles", "fum", "miscfum"),
}
DST_KEYS: dict[str, tuple[str, ...]] = {
    "sack": ("sack", "sacks", "defsack", "defsacks"),
    "def_int": ("int", "ints", "interceptions", "defint", "defints"),
    "fum_rec": ("fr", "fumrec", "fumblerecoveries", "fumblesrecovered", "deffr"),
    "def_td": ("td", "tds", "deftd", "deftds", "dsttd", "defensivetds"),
    "safety": ("safety", "safeties", "sfty", "saf"),
    "pts_allow": ("pa", "ptsallowed", "ptsallow", "pointsallowed", "ptsagainst", "pointsagainst", "ptsa"),
}
# Exact matches, best first. DraftKings-specific columns beat generic PPR, which beats unlabelled.
POINT_KEYS = ("dkpts", "dkpoints", "dkfpts", "draftkings", "draftkingspoints", "dkproj", "dkprojection",
              "pprpts", "pprpoints", "pprfpts", "fptsppr", "fantasypointsppr", "projppr", "ppr", "pprproj",
              "fpts", "fantasypoints", "projectedpoints", "projectedfantasypoints", "projpts", "projfpts",
              "projectedfpts", "proj", "projection", "projected", "points", "pts", "fp", "total", "miscfpts")
POINT_EXCLUDE = ("half", "std", "standard", "nonppr", "rank", "avg", "last", "ytd", "season", "fd",
                 "fanduel", "yahoo", "ceiling", "floor", "high", "low", "min", "max", "diff", "vs", "ecr",
                 "pct", "own", "salary", "value")


def _to_float(v: Any) -> float | None:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if not s or s in ("-", "—", "–", "N/A", "NA"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def pick_points_key(keys: Iterable[str]) -> str | None:
    by_norm = {_norm(k): k for k in keys}
    for want in POINT_KEYS:
        if want in by_norm:
            return by_norm[want]
    for nk, k in by_norm.items():
        if any(x in nk for x in POINT_EXCLUDE):
            continue
        if ("ppr" in nk and ("pt" in nk or "proj" in nk)) or "fpts" in nk or "fantasypoint" in nk or nk.startswith("proj"):
            return k
    return None


def _first_key(keys: Iterable[str], wanted: tuple[str, ...]) -> str | None:
    by_norm = {_norm(k): k for k in keys}
    for w in wanted:
        if w in by_norm:
            return by_norm[w]
    return None


def column_map(keys: list[str], pos_hint: str | None) -> dict[str, Any]:
    """Which input columns hold the name, team, position, points and stat fields."""
    offense = {canon: k for canon, aliases in STAT_KEYS.items() if (k := _first_key(keys, aliases))}
    dst = {canon: k for canon, aliases in DST_KEYS.items() if (k := _first_key(keys, aliases))}
    return {
        "name": _first_key(keys, NAME_KEYS),
        "team": _first_key(keys, TEAM_KEYS),
        "pos": _first_key(keys, POS_KEYS),
        "points": pick_points_key(keys),
        "stats": dst if pos_hint == "DST" else offense,
        # a defense-only page without a DST hint in its URL still has defense columns
        "dst_stats": dst if "pts_allow" in dst else {},
    }


# ----------------------------------------------------------------------------- player text

def parse_player_text(text: str) -> tuple[str, str | None, str | None]:
    """'Josh Allen (BUF - QB)', 'Josh Allen BUF QB Q', 'Allen, Josh', '1. Josh Allen' -> (name, team, pos)."""
    team = pos = None
    s = re.sub(r"\s+", " ", str(text)).strip()
    s = re.sub(r"^\d+[.)]?\s+", "", s)  # leading rank
    for inner in re.findall(r"\(([^)]*)\)", s):
        for tok in re.split(r"[\s,/\-|]+", inner):
            tok_u = tok.upper()
            if not team and normalize_team(tok_u):
                team = normalize_team(tok_u)
            elif not pos and tok_u in POS_TOKENS:
                pos = normalize_pos("DST" if tok_u in ("DEF", "D/ST", "DST/DEF") else tok_u)
    s = re.sub(r"\([^)]*\)", " ", s).strip()
    if s.count(",") == 1:
        last, first = [x.strip() for x in s.split(",")]
        if first and last and not normalize_team(first.upper()) and re.match(r"^[A-Za-z.'\- ]+$", first + last):
            s = f"{first} {last}"
    tokens = [t for t in re.split(r"[\s|•·]+", s) if t and t not in ("-", "–", "—")]
    while len(tokens) > 2:
        tok = tokens[-1].strip(",").upper()
        if tok in INJURY_TOKENS:
            tokens.pop()
        elif tok in POS_TOKENS and not pos:
            pos = normalize_pos("DST" if tok in ("DEF", "D/ST", "DST/DEF") else tok)
            tokens.pop()
        elif normalize_team(tok) and not team and tok.isupper():
            team = normalize_team(tok)
            tokens.pop()
        else:
            break
    name = " ".join(tokens).strip(" ,-")
    if pos is None and (t := team_from_text(name)) and len(name.split()) <= 4:
        pos, team = "DST", team or t
    return name, team, pos


def pos_from_url(url: str) -> str | None:
    m = re.search(r"(?:^|[/_\-=?&.])(qb|rb|wr|te|dst|def|k)(?=$|[/_\-.&?=])", urlparse(url).path.lower()
                  + "?" + (urlparse(url).query or "").lower())
    if not m:
        return None
    return "DST" if m.group(1) in ("dst", "def") else m.group(1).upper()


# ----------------------------------------------------------------------------- rows -> records

def records_from_rows(rows: list[dict[str, Any]], source: str, pos_hint: str | None = None
                      ) -> tuple[list[ProjRecord], dict[str, Any]]:
    """Map generic rows (from an HTML table, embedded JSON or an uploaded CSV) to projections."""
    if not rows:
        return [], {"reason": "no rows"}
    keys = list({k: None for r in rows[:50] for k in r})
    cols = column_map(keys, pos_hint)
    if not cols["name"]:
        # tables often leave the player column unlabelled: use the first mostly-text column
        for k in keys:
            vals = [str(r.get(k) or "") for r in rows[:30]]
            if sum(bool(re.search(r"[A-Za-z]{2,}\s+[A-Za-z]", v)) for v in vals) >= 0.6 * len(vals):
                cols["name"] = k
                break
    info: dict[str, Any] = {"columns": {k: v for k, v in cols.items() if v and k != "dst_stats"}, "rows": len(rows)}
    if not cols["name"] or not (cols["points"] or cols["stats"]):
        info["reason"] = "no player or projection columns"
        info["keys"] = [str(k)[:30] for k in keys[:20]]
        return [], info

    out: list[ProjRecord] = []
    rescored = native = 0
    for r in rows:
        name, team, pos = parse_player_text(r.get(cols["name"]) or "")
        if cols["team"] and (t := normalize_team(str(r.get(cols["team"]) or "")) or team_from_text(str(r.get(cols["team"]) or ""))):
            team = t
        if cols["pos"]:
            p = str(r.get(cols["pos"]) or "").upper().strip()
            p = re.sub(r"\d+$", "", p)  # "WR12" -> "WR"
            pos = normalize_pos("DST" if p in ("DEF", "D/ST", "D") else p) or pos
        pos = pos or pos_hint
        if pos not in POSITIONS and pos is not None:
            continue  # kickers, IDP, etc.
        if not name or len(name) < 3:
            continue
        stat_cols = cols["dst_stats"] if pos == "DST" and pos_hint != "DST" else cols["stats"]
        if pos == "DST" and not team:
            team = team_from_text(name)
        stats = {canon: (_to_float(r.get(k)) or 0.0) for canon, k in stat_cols.items()}
        if pos and stats and has_stats(pos, stats):
            points, is_native = dk_points(pos, stats), False
            rescored += 1
        else:
            pts = _to_float(r.get(cols["points"])) if cols["points"] else None
            if pts is None:
                continue
            points, is_native, stats = pts, True, None
            native += 1
        out.append(ProjRecord(source=source, name=name, pos=pos or "", team=team, points=round(points, 2),
                              stats=stats, native=is_native))
    info.update({"records": len(out), "rescored_from_stats": rescored, "site_points": native})
    top = sorted((r.points for r in out), reverse=True)[:20]
    if len(top) >= 10 and median(top) > SEASON_LONG_MEDIAN:
        info["reason"] = f"looks like season-long projections (top-20 median {median(top):.0f})"
        return [], info
    return out, info


# ----------------------------------------------------------------------------- page extraction

def _clean(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", text.strip().upper()).strip("_")


def _table_rows(table: Tag) -> list[dict[str, str]]:
    head_rows = table.select("thead tr") or [tr for tr in table.find_all("tr", limit=2) if tr.find("th")]
    if not head_rows:
        return []
    groups: list[str] = []
    labels: list[str] = []
    if len(head_rows) >= 2:
        for th in head_rows[-2].find_all(["th", "td"]):
            groups += [_clean(th.get_text(" ", strip=True))] * int(th.get("colspan") or 1)
    for th in head_rows[-1].find_all(["th", "td"]):
        label = th.find(class_=re.compile("label|abbr", re.I))
        txt = (label or th).get_text(" ", strip=True)
        labels += [_clean(txt)] * int(th.get("colspan") or 1)
    keys = []
    for i, label in enumerate(labels):
        group = groups[i] if i < len(groups) else ""
        keys.append(f"{group}_{label}" if group and label and group != label else (label or group or f"COL{i}"))
    body = table.select("tbody tr") or [tr for tr in table.find_all("tr") if tr not in head_rows]
    rows = []
    for tr in body:
        cells = tr.find_all(["td", "th"])
        if len(cells) >= 2:
            rows.append({k: c.get_text(" ", strip=True) for k, c in zip(keys, cells)})
    return rows


def _json_blobs(soup: BeautifulSoup, raw: str) -> list[Any]:
    blobs: list[Any] = []
    stripped = raw.lstrip()
    if stripped[:1] in "[{":
        try:
            blobs.append(json.loads(stripped))
        except ValueError:
            pass
    decoder = json.JSONDecoder()
    for script in soup.find_all("script"):
        text = script.string or script.get_text() or ""
        if not text or len(text) > 8_000_000:
            continue
        if "json" in (script.get("type") or "") or script.get("id") == "__NEXT_DATA__":
            try:
                blobs.append(json.loads(text))
                continue
            except ValueError:
                pass
        for i, m in enumerate(re.finditer(r"=\s*([\[{])", text)):
            if i >= 25:
                break
            try:
                obj, _ = decoder.raw_decode(text[m.start(1):])
            except ValueError:
                continue
            if isinstance(obj, (dict, list)) and len(json.dumps(obj)) > 500:
                blobs.append(obj)
    return blobs


def _flatten(d: dict) -> dict:
    """Pull one level of nested dicts (player{...}, stats{...}, projection{...}) up to the top."""
    flat = {k: v for k, v in d.items() if not isinstance(v, (dict, list))}
    for k, v in d.items():
        if isinstance(v, dict):
            for k2, v2 in v.items():
                if not isinstance(v2, (dict, list)):
                    flat.setdefault(k2, v2)
                    flat.setdefault(f"{k}_{k2}", v2)
    return flat


def _json_row_lists(obj: Any, depth: int = 0, found: list | None = None) -> list[list[dict]]:
    found = [] if found is None else found
    if depth > 12:
        return found
    if isinstance(obj, list):
        dicts = [x for x in obj if isinstance(x, dict)]
        if len(dicts) >= 15 and len(dicts) >= 0.8 * len(obj):
            found.append([_flatten(x) for x in dicts])
        for x in obj[:2000]:
            if isinstance(x, (dict, list)):
                _json_row_lists(x, depth + 1, found)
    elif isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, (dict, list)):
                _json_row_lists(v, depth + 1, found)
    return found


CHALLENGE = re.compile(r"captcha|just a moment|verify you are (a )?human|are you a robot|access denied|"
                       r"attention required|checking your browser|enable javascript and cookies|bot protection", re.I)


def looks_blocked(raw: str) -> str | None:
    """A bot check or block page rather than content. Crawling of the site stops if so."""
    if raw.lstrip()[:1] in "[{":
        return None  # a JSON response
    soup = BeautifulSoup(raw, "html.parser")
    text = soup.get_text(" ", strip=True)
    if CHALLENGE.search(raw[:20000]) and not soup.find("table"):
        return "bot check / block page"
    if (len(raw) < 5000 and len(text) < 300 and not soup.find("table") and not soup.find("a", href=True)
            and not discover_data_urls(raw, "https://x/")):
        return "near-empty page (often a bot check or script redirect)"
    return None


def extract_page(raw: str, url: str, source: str) -> tuple[list[ProjRecord], dict[str, Any]]:
    """Best set of projection records on one page, plus a description of what was found."""
    soup = BeautifulSoup(raw, "html.parser")
    pos_hint = pos_from_url(url)
    candidates: list[tuple[str, list[ProjRecord], dict]] = []
    first_line = raw.lstrip("\ufeff").split("\n", 1)[0]
    if urlparse(url).path.lower().endswith(".csv") or ("," in first_line and "<" not in first_line
                                                        and re.search(r"player|name", first_line, re.I)):
        recs, info = records_from_rows(list(csv.DictReader(io.StringIO(raw.lstrip("\ufeff")))), source, pos_hint)
        candidates.append(("csv", recs, info))
    tables = soup.find_all("table")
    for i, t in enumerate(tables):
        recs, info = records_from_rows(_table_rows(t), source, pos_hint)
        candidates.append((f"table {i + 1}", recs, info))
    row_lists = [rl for blob in _json_blobs(soup, raw) for rl in _json_row_lists(blob)]
    for i, rows in enumerate(sorted(row_lists, key=len, reverse=True)[:12]):
        recs, info = records_from_rows(rows, source, pos_hint)
        candidates.append((f"json list {i + 1}", recs, info))
    title = soup.title.get_text(" ", strip=True)[:100] if soup.title else ""
    diag: dict[str, Any] = {"title": title, "tables": len(tables), "json_lists": len(row_lists), "pos_hint": pos_hint}
    if not any(c[1] for c in candidates):
        # what the page actually said, to tell redirects, bot checks and JS shells apart
        diag["text_sample"] = " ".join(soup.get_text(" ", strip=True).split())[:240]
    if not candidates:
        return [], diag
    best = max(candidates, key=lambda c: len(c[1]))
    diag["best"] = {"from": best[0], **best[2]}
    # keep a little detail about near-misses for tuning
    diag["others"] = [{"from": c[0], **{k: v for k, v in c[2].items() if k in ("columns", "rows", "reason", "records")}}
                      for c in candidates if c is not best][:4]
    return best[1], diag


# ----------------------------------------------------------------------------- discovery & crawl

def _domain(url: str) -> str:
    host = urlparse(url).hostname or ""
    return ".".join(host.split(".")[-2:])


# Matched as whole words against the link's path and text (never the host: "draftsharks" isn't a draft page).
SEASON_WORDS = re.compile(r"(?<![a-z])(season|rest[- ]of|ros|dynasty|draft|keeper|best[- ]?ball|2027)(?![a-z])")
OTHER_SPORTS = re.compile(r"(?<![a-z])(mlb|nba|nhl|wnba|golf|pga|ncaa|college|cfb|soccer|nascar|mma|ufc|tennis|"
                          r"baseball|basketball|hockey)(?![a-z])")


# Files and WordPress-style archive listings are never projection tables.
NOT_A_PAGE = re.compile(r"\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js|xml|json|csv)$", re.I)
ARCHIVE_PATH = re.compile(r"/(tag|tags|category|author|page|feed|wp-content|wp-json|comments)(/|$)", re.I)


def discover_links(raw: str, base_url: str, require_pos: bool = False) -> list[str]:
    soup = BeautifulSoup(raw, "html.parser")
    domain = _domain(base_url)
    scored: dict[str, int] = {}
    for a in soup.find_all("a", href=True):
        url = urldefrag(urljoin(base_url, a["href"]))[0]
        if not url.startswith("http") or _domain(url) != domain:
            continue
        u = urlparse(url)
        if NOT_A_PAGE.search(u.path) or ARCHIVE_PATH.search(u.path):
            continue
        key = f"{u.path} {u.query} {a.get_text(' ', strip=True)}".lower()
        if "proj" not in key:
            continue
        if require_pos and not pos_from_url(url):
            continue
        score = 0
        score += 3 if ("nfl" in key or "football" in key) else 0
        score += 2 if "week" in key else 0
        score += 1 if ("ppr" in key or "dfs" in key or "draftkings" in key) else 0
        score -= 4 if SEASON_WORDS.search(key) else 0
        score -= 8 if OTHER_SPORTS.search(key) else 0
        if score > -4:
            scored[url] = max(score, scored.get(url, -99))
    return [u for u, _ in sorted(scored.items(), key=lambda x: -x[1])]


DATA_HINT = re.compile(r"json|/api/|wp-json|ajax|\.csv|/data/|/feed", re.I)
QUOTED_URL = re.compile(r"""["'](https?://[^"'\s<>]{4,300}|/[A-Za-z0-9_\-./?=&%{}]{4,300})["']""")


def discover_data_urls(raw: str, base_url: str) -> list[str]:
    """Where a JavaScript-rendered page gets its numbers: embedded frames about projections, and
    data addresses (JSON/API/CSV) mentioned in the page that mention projections. Only plain GETs."""
    soup = BeautifulSoup(raw, "html.parser")
    out: list[str] = []
    for f in soup.find_all("iframe", src=True):
        u = urldefrag(urljoin(base_url, f["src"]))[0]
        if u.startswith("http") and "proj" in u.lower():
            out.append(u)
    for m in QUOTED_URL.finditer(raw):
        cand = m.group(1).replace("\\/", "/")
        if "{" in cand or "proj" not in cand.lower() or not DATA_HINT.search(cand):
            continue
        u = urldefrag(urljoin(base_url, cand))[0]
        path = urlparse(u).path.lower()
        if NOT_A_PAGE.search(path) and not path.endswith((".json", ".csv")):
            continue
        out.append(u)
    return list(dict.fromkeys(out))[:6]


def fixture_name(url: str) -> str:
    p = urlparse(url)
    slug = re.sub(r"[^a-z0-9]+", "_", f"{p.hostname}{p.path}{'_' + p.query if p.query else ''}".lower()).strip("_")
    return f"web__{slug[:150]}.html"


def _get(ctx: Context, url: str) -> str:
    return ctx.http.get_text(url, fixture=fixture_name(url), quick=True,
                             headers={"Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"})


def _robots(ctx: Context, url: str) -> RobotFileParser | None:
    rp = RobotFileParser()
    try:
        rp.parse(_get(ctx, urljoin(url, "/robots.txt")).splitlines())
        return rp
    except Exception:  # noqa: BLE001 - no robots.txt: nothing is disallowed
        return None


def crawl(site: Site, ctx: Context) -> tuple[list[ProjRecord], list[dict[str, Any]]]:
    robots: dict[str, RobotFileParser | None] = {}
    agent = "*"
    pages: list[dict[str, Any]] = []
    started = time.monotonic()
    queue: list[str] = site.seed_urls(ctx.season, ctx.week)
    seen: set[str] = set()
    found: dict[tuple[str, str, str | None], ProjRecord] = {}
    data_followed = 0

    def allowed(url: str) -> bool:
        host = urlparse(url).netloc
        if host not in robots:
            robots[host] = _robots(ctx, url)
        rp = robots[host]
        return rp is None or rp.can_fetch(agent, url)

    def fetch(url: str) -> str | None:
        seen.add(url)
        if not allowed(url):
            pages.append({"url": url, "status": "skipped: disallowed by robots.txt"})
            return None
        if pages and not ctx.http.offline:
            time.sleep(POLITE_DELAY_S)
        try:
            return _get(ctx, url)
        except Exception as exc:  # noqa: BLE001
            pages.append({"url": url, "status": f"error: {str(exc)[:160]}"})
            return None

    home = fetch(site.home) if site.crawl_home else None
    if home is not None:
        links = discover_links(home, site.home)
        pages.append({"url": site.home, "status": "ok", "bytes": len(home), "projection_links": links[:12]})
        queue += [u for u in links if u not in queue]

    while queue and len(seen) < site.max_pages + 1 and time.monotonic() - started < TIME_BUDGET_S:
        url = queue.pop(0)
        if url in seen:
            continue
        raw = fetch(url)
        if raw is None:
            continue
        blocked = looks_blocked(raw)
        if blocked:
            sample = " ".join(BeautifulSoup(raw, "html.parser").get_text(" ", strip=True).split())[:200]
            pages.append({"url": url, "status": f"stopped: {blocked}", "bytes": len(raw), "text_sample": sample})
            break  # don't keep requesting pages from a site that is turning automated visitors away
        recs, diag = extract_page(raw, url, site.name)
        pages.append({"url": url, "status": "ok", "bytes": len(raw), **diag})
        for r in recs:
            found.setdefault((normalize_name(r.name), r.pos, r.team), r)
        if not recs and "offset=" in url:  # past the last page of a paged list: skip later offsets
            stem = re.sub(r"offset=\d+&?", "", url)
            queue = [u for u in queue if re.sub(r"offset=\d+&?", "", u) != stem]
        # position sub-pages of a projections page go to the front of the queue
        subpages = [u for u in discover_links(raw, url, require_pos=True) if u not in seen and u not in queue]
        # a page with no numbers may load them from a data address or an embedded frame
        if not recs and data_followed < 6:
            data = [u for u in discover_data_urls(raw, url) if u not in seen and u not in queue][:6 - data_followed]
            data_followed += len(data)
            if data:
                pages[-1]["data_urls"] = data
            subpages = data + subpages
        queue = subpages[:8] + queue
    return list(found.values()), pages


def summarize(pages: list[dict[str, Any]]) -> str:
    parts = []
    for p in pages:
        u = urlparse(p["url"])
        query = "&".join(q for q in u.query.split("&") if q.split("=")[0] in ("offset", "position", "week", "pos"))
        short = (u.path or "/") + (f"?{query}" if query else "")
        if p["status"] != "ok":
            parts.append(f"{short}: {p['status']}")
        elif "best" in p:
            b = p["best"]
            parts.append(f"{short}: {b.get('records', 0)} rows from {b['from']}"
                         + (f" ({b['reason']})" if b.get("reason") else ""))
        elif "projection_links" in p:
            parts.append(f"{short}: {len(p['projection_links'])} projection links")
        else:
            parts.append(f"{short}: {p.get('tables', 0)} tables, {p.get('json_lists', 0)} JSON lists, no projections")
    return "; ".join(parts)


def fetch(site: Site, ctx: Context) -> list[ProjRecord]:
    records, pages = crawl(site, ctx)
    ctx.extra.setdefault("probe", {})[site.name] = pages
    summary = summarize(pages)
    notes = ctx.extra.setdefault("notes", {}).setdefault(site.name, [])
    if not records:
        hint = f" {site.note}" if site.note else ""
        raise SourceError(f"no projections found.{hint} Pages: {summary}"[:780])
    native = sum(r.native for r in records)
    notes.append(f"{len(records)} players; " + (f"{native} use the site's own points total (no stat line). "
                                               if native else "rescored from stat lines. ") + summary[:500])
    return records


GROUP_OPENERS = {"CMP": "PASSING", "REC": "RECEIVING"}
GROUPED = {"ATT", "CMP", "YDS", "YD", "TDS", "TD", "INT", "INTS", "REC", "TGT", "LNG", "AVG"}


def disambiguate_headers(headers: list[str]) -> list[str]:
    """FantasyPros-style exports repeat YDS/TDS under passing, rushing and receiving:
    ATT CMP YDS TDS INTS | ATT YDS TDS | REC YDS TDS | FL FPTS.
    Prefix each repeated stat with its group so nothing is overwritten."""
    counts: dict[str, int] = {}
    for h in headers:
        counts[_clean(h)] = counts.get(_clean(h), 0) + 1
    if not any(n > 1 for k, n in counts.items() if k in GROUPED):
        return headers
    out, group = [], ""
    for i, h in enumerate(headers):
        k = _clean(h)
        nxt = _clean(headers[i + 1]) if i + 1 < len(headers) else ""
        if k == "ATT":
            group = "PASSING" if nxt == "CMP" else "RUSHING"
        elif k in GROUP_OPENERS and group != GROUP_OPENERS[k]:
            group = GROUP_OPENERS[k]
        out.append(f"{group}_{k}" if group and k in GROUPED else h)
    return out


UPLOAD_NAME = re.compile(r"^([a-z0-9]+?)(?:_week(\d+))?(?:[_\-]([a-z0-9_\-]+))?\.csv$", re.I)


def parse_upload_name(filename: str) -> tuple[str, int | None, str | None] | None:
    """'fantasypros_week3_qb.csv' -> ('fantasypros', 3, 'qb'); 'pff.csv' -> ('pff', None, None)."""
    m = UPLOAD_NAME.match(filename)
    if not m:
        return None
    return m.group(1).lower(), int(m.group(2)) if m.group(2) else None, (m.group(3) or None)


def from_upload(site_name: str, files: list[tuple[str, str]]) -> list[ProjRecord]:
    """Projection CSVs exported from a site (projections/<site>_week<N>[_<part>].csv).
    Several files (e.g. QB, FLEX, DST) are combined; a position in the part name ('qb', 'dst')
    is used when the file has no position column."""
    out: list[ProjRecord] = []
    problems = []
    for filename, text in files:
        reader = csv.reader(io.StringIO(text.lstrip("\ufeff")))
        header = next((r for r in reader if any(c.strip() for c in r)), [])
        header = disambiguate_headers([h.strip() for h in header])
        rows = [dict(zip(header, r)) for r in reader if any(c.strip() for c in r)]
        part = (parse_upload_name(filename) or (None, None, None))[2] or ""
        recs, info = records_from_rows(rows, site_name, pos_from_url(f"/{part.lower()}/"))
        if not recs:
            problems.append(f"{filename}: {info.get('reason', 'no rows')} (columns: {header[:12]})")
        out += recs
    if not out:
        raise SourceError("uploaded CSV not usable: " + "; ".join(problems))
    return out

