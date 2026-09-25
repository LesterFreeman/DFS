"""Sleeper.

- players/nfl + state/nfl: unofficial but publicly documented read API (docs.sleeper.com), no auth.
  The players file is ~5 MB; Sleeper asks callers to fetch it at most once a day.
- projections: undocumented endpoint used by Sleeper's own web app. Stat-level projections,
  including team defenses, which we rescore with DraftKings rules.
"""
from __future__ import annotations

from ..models import ProjRecord, SourceError, StatusRecord
from ..names import normalize_pos, normalize_team
from ..scoring import dk_points, has_stats
from .base import Context, SourceMeta

META = SourceMeta("sleeper", "Sleeper projections", "projections", "Undocumented public endpoint")
STATUS_META = SourceMeta("sleeper_status", "Sleeper injuries", "status", "Documented public API (unofficial)")

STATE_URL = "https://api.sleeper.app/v1/state/nfl"
PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
PROJ_URL = "https://api.sleeper.com/projections/nfl/{season}/{week}"

INJURY = {
    None: "ACTIVE", "": "ACTIVE", "Questionable": "Q", "Doubtful": "D", "Out": "O", "IR": "IR",
    "PUP": "O", "Sus": "O", "NA": "O", "COV": "O", "DNR": "O",
}


def fetch_state(ctx: Context) -> dict:
    return ctx.http.get_json(STATE_URL, fixture="sleeper_state.json")


def _stats(pos: str, s: dict) -> dict[str, float]:
    g = lambda k: float(s.get(k) or 0)  # noqa: E731
    if pos == "DST":
        return {
            "sack": g("sack"), "def_int": g("int"), "fum_rec": g("fum_rec"),
            "def_td": g("def_td") + g("def_st_td") + g("st_td"), "safety": g("safe"),
            "blk_kick": g("blk_kick"), "pts_allow": g("pts_allow"),
        }
    return {
        "pass_yd": g("pass_yd"), "pass_td": g("pass_td"), "pass_int": g("pass_int"),
        "rush_yd": g("rush_yd"), "rush_td": g("rush_td"), "rec": g("rec"), "rec_yd": g("rec_yd"),
        "rec_td": g("rec_td"), "fum_lost": g("fum_lost"),
        "two_pt": g("pass_2pt") + g("rush_2pt") + g("rec_2pt"),
    }


def parse_projections(rows: list[dict]) -> list[ProjRecord]:
    out = []
    for r in rows:
        player = r.get("player") or {}
        pos = normalize_pos(player.get("position"))
        if pos not in ("QB", "RB", "WR", "TE", "DST"):
            continue
        raw = r.get("stats") or {}
        stats = _stats(pos, raw)
        if not has_stats(pos, stats):
            continue
        team = normalize_team(r.get("team") or player.get("team"))
        name = f"{player.get('first_name', '')} {player.get('last_name', '')}".strip()
        pid = str(r.get("player_id"))
        out.append(ProjRecord(
            source="sleeper", name=name, pos=pos, team=team,
            points=dk_points(pos, stats), stats=stats,
            ids={} if pos == "DST" else {"sleeper_id": pid},
        ))
    return out


def fetch_projections(ctx: Context) -> list[ProjRecord]:
    params = [("season_type", "regular"), ("order_by", "ppr")] + [
        ("position[]", p) for p in ("QB", "RB", "WR", "TE", "DEF")
    ]
    rows = ctx.http.get_json(
        PROJ_URL.format(season=ctx.season, week=ctx.week), params=params, fixture="sleeper_projections.json"
    )
    if not isinstance(rows, list):
        raise SourceError("unexpected projections payload (not a list)")
    return parse_projections(rows)


def parse_players(data: dict) -> list[StatusRecord]:
    out = []
    for pid, p in data.items():
        pos = normalize_pos(p.get("position"))
        team = normalize_team(p.get("team"))
        if pos not in ("QB", "RB", "WR", "TE") or not team:
            continue
        status = INJURY.get(p.get("injury_status"), "Q")
        name = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        out.append(StatusRecord(source="sleeper_status", name=name, pos=pos, team=team,
                                status=status, ids={"sleeper_id": str(pid)}))
    return out


def fetch_status(ctx: Context) -> list[StatusRecord]:
    data = ctx.http.get_json(PLAYERS_URL, fixture="sleeper_players.json")
    if not isinstance(data, dict):
        raise SourceError("unexpected players payload (not an object)")
    return parse_players(data)
