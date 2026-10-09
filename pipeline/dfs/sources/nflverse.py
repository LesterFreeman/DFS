"""nflverse / DynastyProcess open data (GitHub-hosted CSVs; free, stable, openly licensed).

- db_playerids.csv: cross-site player ID map (sleeper, espn, cbs, gsis, ...)
- games.csv: schedule with byes, kickoff times and closing spread/total
- weekly player stats: history for the floor model, and actual DK points for the backtest
- weekly team stats: defense/special-teams lines for DST actual points (backtest)
"""
from __future__ import annotations

import csv
import io

import requests

from ..models import Game, SourceError
from ..names import normalize_name, normalize_pos, normalize_team
from ..scoring import dk_points
from .base import Context, SourceMeta

IDS_META = SourceMeta("nflverse_ids", "Player ID crosswalk", "reference", "Open data (GitHub)")
SCHEDULE_META = SourceMeta("nflverse_schedule", "Schedule & Vegas lines", "reference", "Open data (GitHub)")
STATS_META = SourceMeta("nflverse_stats", "Historical stats", "reference", "Open data (GitHub)")
TEAM_STATS_META = SourceMeta("nflverse_team_stats", "Team stats (DST results)", "reference", "Open data (GitHub)")

IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
# nflverse renamed the weekly stats release in 2025; try the new name first.
STATS_URLS = (
    "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv",
    "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{season}.csv",
)
TEAM_STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_{season}.csv"
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
            away_score=_f(r.get("away_score")), home_score=_f(r.get("home_score")),
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
    """Reduce a weekly stats CSV to {gsis_id, name, pos, team, opp, season, week, pts, line}.

    pts is actual DK points; line is a compact stat line (yards, TDs, targets, carries, target share).
    """
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
        line = {k: v for k, v in {
            "pass_yd": stats["pass_yd"], "pass_td": stats["pass_td"], "int": stats["pass_int"],
            "car": _stat(r, "carries"), "rush_yd": stats["rush_yd"], "rush_td": stats["rush_td"],
            "tgt": _stat(r, "targets"), "rec": stats["rec"], "rec_yd": stats["rec_yd"], "rec_td": stats["rec_td"],
        }.items() if v}
        share = _f(r.get("target_share"))
        if share is not None:
            line["tgt_share"] = round(share, 3)
        out.append({
            "gsis_id": r.get("player_id"), "name": normalize_name(r.get("player_display_name") or r.get("player_name") or ""),
            "pos": pos, "team": normalize_team(r.get("team") or r.get("recent_team")), "season": int(r["season"]), "week": int(r["week"]),
            "opp": normalize_team(r.get("opponent_team")),
            "pts": dk_points(pos, stats, expected=False), "line": line,
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


def parse_team_weekly(text: str) -> list[dict]:
    """Reduce a weekly team stats CSV to the defense/special-teams counts DraftKings scores.

    Points allowed are not here: they come from the opponent's final score in the schedule.
    """
    out = []
    for r in _rows(text):
        if (r.get("season_type") or "REG") != "REG":
            continue
        team = normalize_team(r.get("team"))
        if not team:
            continue
        out.append({
            "team": team, "season": int(r["season"]), "week": int(r["week"]),
            "opp": normalize_team(r.get("opponent_team")),
            "sack": _stat(r, "def_sacks"), "def_int": _stat(r, "def_interceptions"),
            "fum_rec": _stat(r, "fumble_recovery_opp"),
            "def_td": _stat(r, "def_tds", "special_teams_tds"),
            "safety": _stat(r, "def_safeties"),
            "blk_kick": _stat(r, "def_punt_blocks", "def_fg_blocks", "def_pat_blocks"),
        })
    return out


def fetch_team_weekly(ctx: Context, seasons: list[int]) -> list[dict]:
    """Weekly team stats. A season the file does not exist for yet (before week 1) is skipped."""
    rows: list[dict] = []
    for season in seasons:
        try:
            rows += parse_team_weekly(ctx.http.get_text(TEAM_STATS_URL.format(season=season),
                                                        fixture=f"nflverse_team_stats_{season}.csv"))
        except (FileNotFoundError, requests.HTTPError) as exc:
            # 404: no file yet for this season (before week 1), so nothing to grade. Other errors raise.
            if isinstance(exc, requests.HTTPError) and getattr(exc.response, "status_code", None) != 404:
                raise
            continue
    return rows
