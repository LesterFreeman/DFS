"""DraftKings salaries.

Unofficial public JSON (no login): the lobby lists draft groups; the draftables endpoint lists
players, salaries, positions, games and DK's injury tag. Not a supported API and against
DraftKings' terms for automated access; we make two requests per run.

Fallback: DraftKings' own "Export to CSV" (DKSalaries.csv) dropped into data/overrides/.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ..models import SlatePlayer, SourceError
from ..names import normalize_pos, normalize_team, team_from_text
from .base import Context, SourceMeta

META = SourceMeta("draftkings", "DraftKings salaries", "salaries", "Unofficial public endpoint")
CSV_META = SourceMeta("draftkings_csv", "DraftKings CSV (manual)", "salaries", "Official CSV export")

LOBBY_URL = "https://www.draftkings.com/lobby/getcontests"
DRAFTABLES_URL = "https://api.draftkings.com/draftgroups/v1/draftgroups/{id}/draftables"

DK_STATUS = {
    "": "ACTIVE", "NONE": "ACTIVE", "ACTIVE": "ACTIVE", "Q": "Q", "QUESTIONABLE": "Q",
    "D": "D", "DOUBTFUL": "D", "O": "O", "OUT": "O", "IR": "IR", "PUP": "O", "SUS": "O",
    "NA": "O", "COVID": "O",
}


def parse_dk_status(raw: str | None) -> str:
    return DK_STATUS.get((raw or "").strip().upper(), "Q")


def _group_start(g: dict, tz: ZoneInfo) -> datetime:
    m = re.search(r"/Date\((\d+)", str(g.get("StartDate") or ""))
    if m:
        return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
    est = str(g.get("StartDateEst") or "")[:19]
    return datetime.fromisoformat(est).replace(tzinfo=tz).astimezone(timezone.utc)


def pick_main_draft_group(lobby: dict, contest_type_id: int, now: datetime, tz: ZoneInfo) -> dict:
    groups = lobby.get("DraftGroups") or []
    classic = [
        g for g in groups
        if g.get("ContestTypeId") == contest_type_id and not (g.get("ContestStartTimeSuffix") or "").strip()
    ]
    featured = [g for g in classic if (g.get("DraftGroupTag") or "") == "Featured"] or classic
    upcoming = [g for g in featured if _group_start(g, tz) >= now - timedelta(hours=6)]
    sundays = [g for g in upcoming if _group_start(g, tz).astimezone(tz).weekday() == 6] or upcoming
    if not sundays:
        raise SourceError("no upcoming main-slate Classic draft group in the DraftKings lobby")
    return min(sundays, key=lambda g: (_group_start(g, tz), -(g.get("GameCount") or 0)))


def _iso(ts: str | None) -> str | None:
    if not ts:
        return None
    ts = ts.strip().rstrip("Z")
    ts = re.sub(r"(\.\d{6})\d+", r"\1", ts)
    return datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def parse_draftables(data: dict) -> list[SlatePlayer]:
    players: dict[str, SlatePlayer] = {}
    for d in data.get("draftables") or []:
        if d.get("isDisabled"):
            continue
        pid = str(d.get("playerId") or d.get("playerDkId") or d.get("draftableId"))
        pos = normalize_pos(d.get("position"))
        slot = str(d.get("rosterSlotId") or "")
        if pid in players:
            if slot and slot not in players[pid].roster_slots:
                players[pid].roster_slots.append(slot)
            continue
        team = normalize_team(d.get("teamAbbreviation"))
        if pos not in ("QB", "RB", "WR", "TE", "DST") or not team:
            continue
        comp = d.get("competition") or {}
        game = comp.get("name")
        opp, home = None, None
        if game and "@" in game:
            away_t, home_t = (normalize_team(x) for x in game.replace(" ", "").split("@", 1))
            home = team == home_t
            opp = away_t if home else home_t
        name = (d.get("displayName") or f"{d.get('firstName', '')} {d.get('lastName', '')}").strip()
        players[pid] = SlatePlayer(
            dk_id=pid,
            name=name if pos != "DST" else f"{name} DST".replace(" DST DST", " DST"),
            pos=pos,
            team=team,
            opp=opp,
            salary=int(d.get("salary") or 0),
            home=home,
            game=game.replace(" ", "") if game else None,
            kickoff=_iso(comp.get("startTime")),
            dk_status=parse_dk_status(d.get("status")),
            roster_slots=[slot] if slot else [],
        )
    return list(players.values())


def fetch(ctx: Context) -> tuple[list[SlatePlayer], dict]:
    slate_cfg = ctx.cfg.slate
    tz = ZoneInfo(slate_cfg.get("timezone", "America/New_York"))
    group_id = int(slate_cfg.get("draft_group_id") or 0)
    info: dict = {}
    if not group_id:
        lobby = ctx.http.get_json(LOBBY_URL, params={"sport": "NFL"}, fixture="dk_lobby.json")
        group = pick_main_draft_group(lobby, int(slate_cfg.get("contest_type_id", 21)), ctx.now, tz)
        group_id = int(group["DraftGroupId"])
        info = {"game_count": group.get("GameCount"), "start": _group_start(group, tz).isoformat()}
    data = ctx.http.get_json(DRAFTABLES_URL.format(id=group_id), fixture="dk_draftables.json")
    players = parse_draftables(data)
    if not players:
        raise SourceError(f"draft group {group_id} returned no draftable players")
    return players, {"draft_group_id": group_id, **info}


def parse_salary_csv(text: str, tz: ZoneInfo) -> list[SlatePlayer]:
    """DraftKings 'Export to CSV' format (DKSalaries.csv)."""
    players = []
    for row in csv.DictReader(io.StringIO(text)):
        pos = normalize_pos(row.get("Position"))
        team = normalize_team(row.get("TeamAbbrev"))
        if pos not in ("QB", "RB", "WR", "TE", "DST") or not team:
            continue
        info = (row.get("Game Info") or "").strip()  # "CIN@KC 09/27/2026 01:00PM ET"
        game, kickoff, opp, home = None, None, None, None
        m = re.match(r"(\w+)@(\w+)\s+(\d\d/\d\d/\d{4})\s+(\d\d:\d\d[AP]M)", info)
        if m:
            away_t, home_t = normalize_team(m.group(1)), normalize_team(m.group(2))
            game = f"{away_t}@{home_t}"
            home = team == home_t
            opp = away_t if home else home_t
            local = datetime.strptime(f"{m.group(3)} {m.group(4)}", "%m/%d/%Y %I:%M%p").replace(tzinfo=tz)
            kickoff = local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        name = row.get("Name", "").strip()
        if pos == "DST":
            name = f"{name} DST"
            team = team or team_from_text(name)
        players.append(SlatePlayer(
            dk_id=str(row.get("ID")), name=name, pos=pos, team=team, opp=opp,
            salary=int(row.get("Salary") or 0), home=home, game=game, kickoff=kickoff,
            roster_slots=[s for s in (row.get("Roster Position") or "").split("/") if s],
        ))
    return players
