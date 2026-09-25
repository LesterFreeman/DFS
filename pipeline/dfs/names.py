"""Name, team and position normalization shared by every source."""
from __future__ import annotations

import re
import unicodedata

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# Normalized alias -> normalized canonical name. Add entries as the match report surfaces them.
NAME_ALIASES = {
    "hollywood brown": "marquise brown",
    "gabe davis": "gabriel davis",
    "chig okonkwo": "chigoziem okonkwo",
    "mitch trubisky": "mitchell trubisky",
    "josh palmer": "joshua palmer",
    "tank dell": "nathaniel dell",
    "bam knight": "zonovan knight",
    "jeff wilson": "jeffery wilson",
    "cam ward": "cameron ward",
}

TEAMS = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LAC": "Los Angeles Chargers", "LAR": "Los Angeles Rams",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks", "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}

TEAM_ALIASES = {
    "JAC": "JAX", "WSH": "WAS", "LA": "LAR", "STL": "LAR", "SD": "LAC", "OAK": "LV",
    "LVR": "LV", "ARZ": "ARI", "GNB": "GB", "KAN": "KC", "NWE": "NE", "NOR": "NO",
    "SFO": "SF", "TAM": "TB", "CLV": "CLE", "BLT": "BAL", "HST": "HOU", "WFT": "WAS",
}

_TEAM_BY_TEXT = {}
for _abbr, _full in TEAMS.items():
    _nick = _full.rsplit(" ", 1)[-1]
    _TEAM_BY_TEXT[_full.lower()] = _abbr
    _TEAM_BY_TEXT[_nick.lower()] = _abbr
    _TEAM_BY_TEXT[_full.lower().rsplit(" ", 1)[0]] = _abbr  # "kansas city" (ambiguous for LA/NY; overwritten below)
for _ambiguous in ("los angeles", "new york"):
    _TEAM_BY_TEXT.pop(_ambiguous, None)

POS_ALIASES = {"DEF": "DST", "D/ST": "DST", "D": "DST", "DST": "DST", "PK": "K"}
POSITIONS = ("QB", "RB", "WR", "TE", "DST")


def normalize_team(team: str | None) -> str | None:
    if not team:
        return None
    t = team.strip().upper()
    t = TEAM_ALIASES.get(t, t)
    return t if t in TEAMS else None


def team_from_text(text: str) -> str | None:
    """'Kansas City Chiefs', 'Chiefs', 'KC', 'Chiefs D/ST' -> 'KC'."""
    s = re.sub(r"\b(d/st|dst|defense|def)\b", "", text.strip().lower()).strip()
    if s.upper() in TEAMS or s.upper() in TEAM_ALIASES:
        return normalize_team(s)
    return _TEAM_BY_TEXT.get(s)


def normalize_pos(pos: str | None) -> str | None:
    if not pos:
        return None
    p = pos.strip().upper()
    return POS_ALIASES.get(p, p)


def normalize_name(name: str) -> str:
    """'D.J. Moore' -> 'dj moore', 'Amon-Ra St. Brown' -> 'amon ra st brown', drops Jr/III."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"[.'`’]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    tokens = [t for t in s.split() if t]
    while len(tokens) > 2 and tokens[-1] in SUFFIXES:
        tokens.pop()
    if len(tokens) == 2 and tokens[-1] in SUFFIXES:
        tokens.pop()
    key = " ".join(tokens)
    return NAME_ALIASES.get(key, key)
