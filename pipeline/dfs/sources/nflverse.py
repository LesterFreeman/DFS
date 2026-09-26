"""nflverse / DynastyProcess open data (GitHub-hosted CSVs; free, stable, openly licensed).

- db_playerids.csv: cross-site player ID map (sleeper, espn, cbs, gsis, ...)
- games.csv: schedule with byes, kickoff times and closing spread/total
- weekly player stats: history for the floor model
"""
from __future__ import annotations

import csv
import io

from ..models import Game, SourceError
from ..names import normalize_name, normalize_pos, normalize_team
from ..scoring import dk_points
from .base import Context, SourceMeta

IDS_META = SourceMeta("nflverse_ids", "Player ID crosswalk", "reference", "Open data (GitHub)")
SCHEDULE_META = SourceMeta("nflverse_schedule", "Schedule & Vegas lines", "reference", "Open data (GitHub)")
STATS_META = SourceMeta("nflverse_stats", "Historical stats", "reference", "Open data (GitHub)")

IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
# nflverse renamed the weekly stats release in 2025; try the new name first.
STATS_URLS = (
    "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv",
    "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{season}.csv",
)
ID_COLUMNS = ("gsis_id", "sleeper_id", "espn_id", "cbs_id", "yahoo_id")


def _rows(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def parse_ids(text: str) -> list[dict]:
    out = []
    for r in _rows(text):
        pos = normalize_pos(r.get("position"))
        if pos not in ("QB", "RB", "WR", "TE"):
            continue
        ids = {c: r[c].strip().removesuffix(".0") for c in ID_COLUMNS if (r.get(c) or "").strip() not in ("", "NA")}
        if not ids:
            continue
        out.append({"name": r.get("name") or r.get("merge_name") or "", "pos": pos,
                    "team": normalize_team(r.get("team")), "ids": ids})
    return out


def fetch_ids(ctx: Context) -> list[dict]:
    rows = parse_ids(ctx.http.get_text(IDS_URL, fixture="nflverse_ids.csv"))
    if not rows:
        raise SourceError("empty player ID crosswalk")
    return rows


def _f(v: str | None) -> float | None:
    try:
        return float(v) if v not in (None, "", "NA") else None
    except ValueError:
        return None


def parse_games(text: str, season: int | None = None) -> list[Game]:
    out = []
    for r in _rows(text):
        try:
            s = int(r["season"])
        except (KeyError, ValueError):
            continue
        if season and s != season:
            continue
        away, home = normalize_team(r.get("away_team")), normalize_team(r.get("home_team"))
        if not away or not home:
            continue
        out.append(Game(
            season=s, week=int(r.get("week") or 0), game_type=r.get("game_type") or "REG",
            gameday=r.get("gameday") or "", gametime=r.get("gametime") or None, away=away, home=home,
            spread_line=_f(r.get("spread_line")), total_line=_f(r.get("total_line")),
        ))
    return out


def fetch_games(ctx: Context, season: int) -> list[Game]:
    games = parse_games(ctx.http.get_text(GAMES_URL, fixture="nflverse_games.csv"), season)
    if not games:
        raise SourceError(f"no games for season {season}")
    return games


def _stat(r: dict, *cols: str) -> float:
    return sum(_f(r.get(c)) or 0.0 for c in cols)


def parse_weekly(text: str) -> list[dict]:
    """Reduce a weekly stats CSV to {gsis_id, name, pos, season, week, pts} (actual DK points)."""
    out = []
    for r in _rows(text):
        if (r.get("season_type") or "REG") != "REG":
            continue
        pos = normalize_pos(r.get("position"))
        if pos not in ("QB", "RB", "WR", "TE"):
            continue
        stats = {
            "pass_yd": _stat(r, "passing_yards"), "pass_td": _stat(r, "passing_tds"),
            "pass_int": _stat(r, "passing_interceptions") or _stat(r, "interceptions"),
            "rush_yd": _stat(r, "rushing_yards"), "rush_td": _stat(r, "rushing_tds"),
            "rec": _stat(r, "receptions"), "rec_yd": _stat(r, "receiving_yards"),
            "rec_td": _stat(r, "receiving_tds"),
            "fum_lost": _stat(r, "sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost"),
            "two_pt": _stat(r, "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions"),
            "ret_td": _stat(r, "special_teams_tds"),
        }
        out.append({
            "gsis_id": r.get("player_id"), "name": normalize_name(r.get("player_display_name") or r.get("player_name") or ""),
            "pos": pos, "season": int(r["season"]), "week": int(r["week"]),
            "pts": dk_points(pos, stats, expected=False),
        })
    return out


def fetch_weekly(ctx: Context, seasons: list[int]) -> list[dict]:
    rows: list[dict] = []
    errors = []
    for season in seasons:
        for url in STATS_URLS:
            try:
                rows += parse_weekly(ctx.http.get_text(url.format(season=season), fixture=f"nflverse_stats_{season}.csv"))
                break
            except Exception as exc:
                errors.append(f"{season}: {type(exc).__name__}")
    if not rows:
        raise SourceError("no weekly stats: " + "; ".join(errors))
    return rows
