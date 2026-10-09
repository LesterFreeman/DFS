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
# The same CSV that the lineup page's "Export to CSV" link serves; tried when the JSON API refuses us.
SALARY_CSV_URL = "https://www.draftkings.com/lineup/getavailableplayerscsv"
# api.draftkings.com answers 403 to bare requests from some cloud IPs; send what the site sends.
DK_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.draftkings.com",
    "Referer": "https://www.draftkings.com/",
}

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


SUN_MON = re.compile(r"sun\W*mon", re.I)


def _suffix(g: dict) -> str:
    return (g.get("ContestStartTimeSuffix") or "").strip()


def pick_draft_group(lobby: dict, contest_type_id: int, now: datetime, tz: ZoneInfo,
                     slate: str = "sun-mon") -> tuple[dict, str]:
    """Choose the Classic draft group for the upcoming Sunday.

    slate="main":    the unsuffixed Main slate (Sunday afternoon games only).
    slate="sun-mon": the Sunday-Monday slate. Chosen by a "(Sun-Mon)"-style suffix if DraftKings
                     lists one, otherwise the Sunday-starting Classic group with the most games.
                     Falls back to Main (with a note) if nothing larger is offered.
    Returns (group, note).
    """
    classic = [g for g in lobby.get("DraftGroups") or [] if g.get("ContestTypeId") == contest_type_id]
    upcoming = [g for g in classic if _group_start(g, tz) >= now - timedelta(hours=6)]
    sundays = [g for g in upcoming if _group_start(g, tz).astimezone(tz).weekday() == 6]
    if sundays:  # only the nearest Sunday
        day = min(_group_start(g, tz).astimezone(tz).date() for g in sundays)
        sundays = [g for g in sundays if _group_start(g, tz).astimezone(tz).date() == day]
    mains = [g for g in sundays if not _suffix(g)]
    main = (min(mains, key=lambda g: (-((g.get("DraftGroupTag") or "") == "Featured"), -(g.get("GameCount") or 0)))
            if mains else None)

    if slate == "main":
        if main:
            return main, "Main slate"
        if upcoming:  # e.g. week with no Sunday slate listed yet
            g = min(upcoming, key=lambda g: (_group_start(g, tz), -(g.get("GameCount") or 0)))
            return g, f"no Main slate listed; using {_suffix(g) or 'first upcoming slate'}"
        raise SourceError("no upcoming Classic draft group in the DraftKings lobby")

    labelled = [g for g in sundays if SUN_MON.search(_suffix(g))]
    if labelled:
        g = max(labelled, key=lambda g: g.get("GameCount") or 0)
        return g, f"Sunday-Monday slate {_suffix(g)}"
    # Sunday-starting slates that end on Sunday afternoon or are single-window are smaller than
    # the full Sunday-Monday slate, so the largest Sunday-starting group is the best match.
    if sundays:
        g = max(sundays, key=lambda g: (g.get("GameCount") or 0, not _suffix(g)))
        if main is not None and (g.get("GameCount") or 0) <= (main.get("GameCount") or 0):
            listed = ", ".join(sorted({_suffix(x) or "Main" for x in sundays}))
            return main, f"no Sunday-Monday slate listed (Sunday slates: {listed}); using Main"
        return g, f"largest Sunday slate {_suffix(g) or 'Main'} ({g.get('GameCount')} games)"
    raise SourceError("no upcoming Sunday Classic draft group in the DraftKings lobby")


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


def fetch(ctx: Context, group_id: int = 0) -> tuple[list[SlatePlayer], dict]:
    """Salaries for a draft group: group_id, else the configured one, else the lobby's pick."""
    slate_cfg = ctx.cfg.slate
    tz = ZoneInfo(slate_cfg.get("timezone", "America/New_York"))
    group_id = group_id or int(slate_cfg.get("draft_group_id") or 0)
    info: dict = {}
    if not group_id:
        lobby = ctx.http.get_json(LOBBY_URL, params={"sport": "NFL"}, fixture="dk_lobby.json")
        group, note = pick_draft_group(lobby, int(slate_cfg.get("contest_type_id", 21)), ctx.now, tz,
                                       slate=str(slate_cfg.get("draftkings_slate", "sun-mon")).lower())
        group_id = int(group["DraftGroupId"])
        info = {"game_count": group.get("GameCount"), "start": _group_start(group, tz).isoformat(),
                "slate_label": _suffix(group) or "Main", "slate_note": note}
    errors = []
    try:
        data = ctx.http.get_json(DRAFTABLES_URL.format(id=group_id), headers=DK_HEADERS, fixture="dk_draftables.json")
        players = parse_draftables(data)
        if players:
            return players, {"draft_group_id": group_id, **info}
        errors.append("draftables API: no players")
    except Exception as exc:  # noqa: BLE001 - try the fallbacks below
        errors.append(f"draftables API: {_short(exc)}")

    try:
        text = ctx.http.get_text(
            SALARY_CSV_URL,
            params={"contestTypeId": slate_cfg.get("contest_type_id", 21), "draftGroupId": group_id},
            headers={**DK_HEADERS, "Accept": "text/csv,*/*"},
            fixture="dk_salaries_endpoint.csv",
        )
        players = parse_salary_csv(text, tz)
        if players:
            return players, {"draft_group_id": group_id, "via": "csv_endpoint", **info}
        errors.append(f"CSV endpoint: no players (response began {text[:60].strip()!r})")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"CSV endpoint: {_short(exc)}")
    raise SourceError("all DraftKings routes refused (upload DKSalaries.csv to the repo root as a manual fallback): "
                      + "; ".join(errors))


def _short(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:160]


def parse_salary_csv(text: str, tz: ZoneInfo) -> list[SlatePlayer]:
    """DraftKings 'Export to CSV' format (DKSalaries.csv)."""
    players = []
    # DraftKings' export starts with a UTF-8 byte-order mark, which would otherwise glue itself
    # onto the first header ("\ufeffPosition").
    for raw in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        row = {(k or "").strip(): (v or "").strip() for k, v in raw.items()}
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
            dk_status=parse_dk_status(row.get("Status")),
            roster_slots=[s for s in (row.get("Roster Position") or "").split("/") if s],
        ))
    return players


def main_slate_only(players: list[SlatePlayer], tz: ZoneInfo, primetime_hour: int = 19) -> tuple[list[SlatePlayer], list[str]]:
    """Keep the Sunday-afternoon games; drop Thursday/Sunday-night/Monday games from a wider export.

    Returns (kept players, dropped game labels). If the file has no Sunday afternoon games it is
    returned unchanged (someone deliberately uploaded a different slate).
    """
    def local(p: SlatePlayer) -> datetime | None:
        return datetime.fromisoformat(p.kickoff.replace("Z", "+00:00")).astimezone(tz) if p.kickoff else None

    sundays = sorted({lt.date() for p in players if (lt := local(p)) and lt.weekday() == 6 and lt.hour < primetime_hour})
    if not sundays:
        return players, []
    day = sundays[0]
    kept, dropped = [], set()
    for p in players:
        lt = local(p)
        if lt and lt.date() == day and lt.hour < primetime_hour:
            kept.append(p)
        else:
            dropped.add(p.game or "?")
    return kept, sorted(dropped)
