"""Generate an offline sample slate in each source's native format.

    python tests/fixtures/make_fixtures.py

Deterministic (seeded). Player names are real so name matching is exercised on genuinely tricky
cases (D.J./DJ, Jr./Sr./III, Hollywood Brown, hyphens), but teams, salaries, matchups and
projections are illustrative sample data, not a real slate.
"""
from __future__ import annotations

import csv
import io
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEASON, WEEK = 2026, 4
SLATE_DAY = "2026-09-27"
rng = random.Random(4242)

# Slate games: (away, home, kickoff UTC). 17:00Z = 1:00pm ET, 20:05Z = 4:05pm ET.
GAMES = [("CIN", "KC", "17:00"), ("DET", "GB", "17:00"), ("CHI", "MIN", "17:00"),
         ("ARI", "SEA", "20:05"), ("WAS", "LAR", "20:25")]
VEGAS = {"CIN@KC": (-3.5, 49.5), "DET@GB": (1.5, 47.0), "CHI@MIN": (-2.5, 42.5),
         "ARI@SEA": (-2.0, 44.0), "WAS@LAR": (-1.5, 48.5)}  # (spread for home, total)
OTHER_GAMES = [  # this week, not on the main slate
    ("NYG", "DAL", "2026-09-24", "20:15"), ("BUF", "NE", "2026-09-27", "20:20"),
    ("HOU", "JAX", "2026-09-28", "20:15"), ("BAL", "CLE", "2026-09-27", "13:00"),
    ("IND", "TEN", "2026-09-27", "13:00"), ("MIA", "NYJ", "2026-09-27", "13:00"),
    ("NO", "CAR", "2026-09-27", "13:00"), ("LAC", "SF", "2026-09-27", "16:05"),
    ("PHI", "LV", "2026-09-27", "16:25"),
]  # byes: ATL, DEN, PIT, TB

S = dict
# (team, pos, DK name, salary, base weekly stat line, variants)
# variants: sleeper=(first,last), espn=name, fp=name, cbs=name, dk_status, sleeper_status, skip=[sources]
PLAYERS = [
    ("KC", "QB", "Patrick Mahomes", 7400, S(pass_yd=262, pass_td=1.9, pass_int=0.6, rush_yd=22, rush_td=0.15, fum_lost=0.1), {}),
    ("KC", "RB", "Isiah Pacheco", 6000, S(rush_yd=64, rush_td=0.5, rec=2.2, rec_yd=16, rec_td=0.08, fum_lost=0.08), {"cbs": "Isaiah Pacheco"}),
    ("KC", "RB", "Kareem Hunt", 4600, S(rush_yd=31, rush_td=0.3, rec=1.4, rec_yd=10, rec_td=0.05), {}),
    ("KC", "WR", "Rashee Rice", 7000, S(rec=6.6, rec_yd=76, rec_td=0.5, rush_yd=4), {}),
    ("KC", "WR", "Xavier Worthy", 5300, S(rec=4.0, rec_yd=50, rec_td=0.35, rush_yd=6), {}),
    ("KC", "WR", "Marquise Brown", 4200, S(rec=3.2, rec_yd=38, rec_td=0.25), {"cbs": "Hollywood Brown"}),
    ("KC", "TE", "Travis Kelce", 5800, S(rec=5.6, rec_yd=58, rec_td=0.42), {}),
    ("KC", "TE", "Noah Gray", 2800, S(rec=1.5, rec_yd=14, rec_td=0.12), {"skip": ["sleeper", "espn", "fantasypros", "cbs"]}),
    ("CIN", "QB", "Joe Burrow", 7200, S(pass_yd=275, pass_td=2.0, pass_int=0.6, rush_yd=10, rush_td=0.08, fum_lost=0.1), {}),
    ("CIN", "RB", "Chase Brown", 6500, S(rush_yd=68, rush_td=0.55, rec=3.4, rec_yd=24, rec_td=0.12, fum_lost=0.06), {}),
    ("CIN", "RB", "Samaje Perine", 4000, S(rush_yd=18, rush_td=0.12, rec=1.8, rec_yd=14, rec_td=0.06), {"dk_status": "Q", "sleeper_status": "Questionable"}),
    ("CIN", "WR", "Ja'Marr Chase", 8600, S(rec=7.2, rec_yd=92, rec_td=0.7, rush_yd=3), {"espn": "Ja'Marr Chase", "fp": "JaMarr Chase"}),
    ("CIN", "WR", "Tee Higgins", 6300, S(rec=5.0, rec_yd=64, rec_td=0.5), {"dk_status": "Q", "sleeper_status": "Questionable"}),
    ("CIN", "WR", "Andrei Iosivas", 3400, S(rec=2.2, rec_yd=28, rec_td=0.18), {"skip": ["espn"]}),
    ("CIN", "TE", "Mike Gesicki", 3600, S(rec=3.3, rec_yd=33, rec_td=0.24), {}),
    ("DET", "QB", "Jared Goff", 6400, S(pass_yd=258, pass_td=1.8, pass_int=0.7, rush_yd=4, fum_lost=0.12), {}),
    ("DET", "RB", "Jahmyr Gibbs", 8200, S(rush_yd=78, rush_td=0.7, rec=3.6, rec_yd=30, rec_td=0.2, fum_lost=0.05), {}),
    ("DET", "RB", "David Montgomery", 5800, S(rush_yd=56, rush_td=0.6, rec=1.8, rec_yd=13, rec_td=0.05), {}),
    ("DET", "WR", "Amon-Ra St. Brown", 8300, S(rec=7.4, rec_yd=86, rec_td=0.62, rush_yd=2), {"fp": "Amon-Ra St Brown"}),
    ("DET", "WR", "Jameson Williams", 5600, S(rec=3.8, rec_yd=60, rec_td=0.38, rush_yd=5), {}),
    ("DET", "TE", "Sam LaPorta", 5000, S(rec=4.6, rec_yd=48, rec_td=0.4), {}),
    ("GB", "QB", "Jordan Love", 6200, S(pass_yd=248, pass_td=1.8, pass_int=0.8, rush_yd=12, rush_td=0.1, fum_lost=0.1), {}),
    ("GB", "RB", "Josh Jacobs", 7000, S(rush_yd=74, rush_td=0.7, rec=2.4, rec_yd=18, rec_td=0.08, fum_lost=0.08), {}),
    ("GB", "WR", "Jayden Reed", 5400, S(rec=4.3, rec_yd=56, rec_td=0.36, rush_yd=8), {}),
    ("GB", "WR", "Romeo Doubs", 4700, S(rec=3.6, rec_yd=46, rec_td=0.32), {}),
    ("GB", "WR", "Christian Watson", 4500, S(rec=2.8, rec_yd=44, rec_td=0.3), {"dk_status": "O", "sleeper_status": "Out"}),
    ("GB", "TE", "Tucker Kraft", 4400, S(rec=3.8, rec_yd=42, rec_td=0.32), {}),
    ("CHI", "QB", "Caleb Williams", 6000, S(pass_yd=236, pass_td=1.5, pass_int=0.7, rush_yd=24, rush_td=0.15, fum_lost=0.15), {}),
    ("CHI", "RB", "D'Andre Swift", 5700, S(rush_yd=58, rush_td=0.4, rec=3.0, rec_yd=22, rec_td=0.1, fum_lost=0.07), {"espn": "D'Andre Swift", "fp": "DAndre Swift"}),
    ("CHI", "WR", "DJ Moore", 5900, S(rec=5.4, rec_yd=64, rec_td=0.38, rush_yd=6), {"sleeper": ("D.J.", "Moore"), "fp": "D.J. Moore"}),
    ("CHI", "WR", "Rome Odunze", 5200, S(rec=4.4, rec_yd=56, rec_td=0.36), {}),
    ("CHI", "TE", "Cole Kmet", 3500, S(rec=3.0, rec_yd=30, rec_td=0.24), {}),
    ("MIN", "QB", "J.J. McCarthy", 5600, S(pass_yd=232, pass_td=1.5, pass_int=0.8, rush_yd=16, rush_td=0.12, fum_lost=0.12), {"fp": "JJ McCarthy"}),
    ("MIN", "RB", "Aaron Jones Sr.", 5900, S(rush_yd=62, rush_td=0.45, rec=2.8, rec_yd=22, rec_td=0.1, fum_lost=0.06), {"fp": "Aaron Jones", "sleeper": ("Aaron", "Jones")}),
    ("MIN", "WR", "Justin Jefferson", 8800, S(rec=7.0, rec_yd=98, rec_td=0.62), {}),
    ("MIN", "WR", "Jordan Addison", 5500, S(rec=4.2, rec_yd=58, rec_td=0.4), {}),
    ("MIN", "TE", "T.J. Hockenson", 4800, S(rec=4.8, rec_yd=48, rec_td=0.3), {"espn": "T.J. Hockenson", "fp": "TJ Hockenson"}),
    ("SEA", "QB", "Sam Darnold", 5700, S(pass_yd=246, pass_td=1.6, pass_int=0.8, rush_yd=8, rush_td=0.06, fum_lost=0.12), {}),
    ("SEA", "RB", "Kenneth Walker III", 6400, S(rush_yd=70, rush_td=0.6, rec=2.6, rec_yd=18, rec_td=0.08, fum_lost=0.06), {"espn": "Kenneth Walker III", "fp": "Kenneth Walker", "cbs": "Kenneth Walker"}),
    ("SEA", "WR", "Jaxon Smith-Njigba", 7400, S(rec=7.0, rec_yd=84, rec_td=0.48), {"cbs": "Jaxon Smith Njigba"}),
    ("SEA", "WR", "Cooper Kupp", 4800, S(rec=4.0, rec_yd=46, rec_td=0.3), {}),
    ("SEA", "TE", "AJ Barner", 3200, S(rec=2.8, rec_yd=26, rec_td=0.22), {"sleeper": ("A.J.", "Barner"), "espn": "AJ Barner"}),
    ("ARI", "QB", "Kyler Murray", 6300, S(pass_yd=226, pass_td=1.5, pass_int=0.6, rush_yd=34, rush_td=0.22, fum_lost=0.12), {}),
    ("ARI", "RB", "James Conner", 6200, S(rush_yd=66, rush_td=0.55, rec=2.6, rec_yd=20, rec_td=0.08, fum_lost=0.06), {}),
    ("ARI", "WR", "Marvin Harrison Jr.", 6100, S(rec=5.0, rec_yd=68, rec_td=0.48), {"fp": "Marvin Harrison", "espn": "Marvin Harrison Jr."}),
    ("ARI", "WR", "Michael Wilson", 3900, S(rec=3.0, rec_yd=36, rec_td=0.22), {}),
    ("ARI", "TE", "Trey McBride", 6200, S(rec=6.6, rec_yd=70, rec_td=0.36), {}),
    ("WAS", "QB", "Jayden Daniels", 7000, S(pass_yd=238, pass_td=1.6, pass_int=0.5, rush_yd=44, rush_td=0.3, fum_lost=0.12), {}),
    ("WAS", "RB", "Brian Robinson Jr.", 5200, S(rush_yd=58, rush_td=0.5, rec=1.8, rec_yd=13, rec_td=0.05, fum_lost=0.05), {"cbs": "Brian Robinson"}),
    ("WAS", "WR", "Terry McLaurin", 6500, S(rec=5.2, rec_yd=72, rec_td=0.52), {}),
    ("WAS", "WR", "Deebo Samuel Sr.", 5000, S(rec=4.0, rec_yd=44, rec_td=0.28, rush_yd=14, rush_td=0.06), {"espn": "Deebo Samuel", "fp": "Deebo Samuel"}),
    ("WAS", "TE", "Zach Ertz", 3700, S(rec=3.8, rec_yd=36, rec_td=0.3), {}),
    ("LAR", "QB", "Matthew Stafford", 5900, S(pass_yd=262, pass_td=1.8, pass_int=0.7, rush_yd=2, fum_lost=0.1), {}),
    ("LAR", "RB", "Kyren Williams", 7200, S(rush_yd=76, rush_td=0.7, rec=2.4, rec_yd=18, rec_td=0.08, fum_lost=0.08), {}),
    ("LAR", "WR", "Puka Nacua", 8500, S(rec=7.8, rec_yd=94, rec_td=0.5, rush_yd=5), {}),
    ("LAR", "WR", "Davante Adams", 6700, S(rec=5.6, rec_yd=66, rec_td=0.55), {"xwalk_team": "NYJ"}),
    ("LAR", "TE", "Tyler Higbee", 3300, S(rec=2.8, rec_yd=28, rec_td=0.2), {}),
]
DST_SALARY = {"KC": 3200, "CIN": 2700, "DET": 3300, "GB": 3100, "CHI": 2900, "MIN": 3500,
              "SEA": 3000, "ARI": 2600, "WAS": 3000, "LAR": 2800}
TEAM_FULL = {"KC": "Kansas City Chiefs", "CIN": "Cincinnati Bengals", "DET": "Detroit Lions",
             "GB": "Green Bay Packers", "CHI": "Chicago Bears", "MIN": "Minnesota Vikings",
             "SEA": "Seattle Seahawks", "ARI": "Arizona Cardinals", "WAS": "Washington Commanders",
             "LAR": "Los Angeles Rams"}
ESPN_TEAM = {"KC": 12, "CIN": 4, "DET": 8, "GB": 9, "CHI": 3, "MIN": 16, "SEA": 26, "ARI": 22,
             "WAS": 28, "LAR": 14}
ESPN_STAT = {"pass_yd": "3", "pass_td": "4", "pass_int": "20", "rush_yd": "24", "rush_td": "25",
             "rec": "53", "rec_yd": "42", "rec_td": "43", "fum_lost": "72"}


def opp_of(team):
    for a, h, _ in GAMES:
        if team == a:
            return h
        if team == h:
            return a


def implied(team):
    for a, h, _ in GAMES:
        if team in (a, h):
            spread, total = VEGAS[f"{a}@{h}"]
            spread = -spread  # stored as home line; nflverse convention is + = home favored
            home_pts = total / 2 + spread / 2
            return home_pts if team == h else total - home_pts


def dst_line(team):
    opp_total = implied(opp_of(team))
    return S(sack=2.5, def_int=0.8, fum_rec=0.6, def_td=0.14, safety=0.03, blk_kick=0.05, pts_allow=opp_total)


def jitter(stats, pct):
    return {k: round(v * rng.uniform(1 - pct, 1 + pct), 2) for k, v in stats.items()}


def ids_for(i):
    return {"sleeper_id": str(4000 + i), "espn_id": str(3100000 + i), "fantasypros_id": str(20000 + i),
            "gsis_id": f"00-00{30000 + i}", "cbs_id": str(2800000 + i)}


def kickoff(team):
    for a, h, t in GAMES:
        if team in (a, h):
            return f"{SLATE_DAY}T{t}:00.0000000Z"


def main():
    dk_rows, sleeper_proj, sleeper_players, espn_players = [], [], {}, []
    fp = {p: [] for p in ("qb", "rb", "wr", "te", "dst")}
    cbs = {p: [] for p in ("QB", "RB", "WR", "TE")}
    xwalk, weekly = [], {2025: [], 2026: []}
    draftable_id = 100000

    for i, (team, pos, dk_name, salary, base, var) in enumerate(PLAYERS):
        ids = ids_for(i)
        skip = set(var.get("skip", []))
        opp = opp_of(team)
        away, home = next((a, h) for a, h, _ in GAMES if team in (a, h))
        first, last = var.get("sleeper") or tuple(dk_name.split(" ", 1))
        dk_status = var.get("dk_status", "None")
        slots = {"QB": [66], "RB": [67, 70], "WR": [68, 70], "TE": [69, 70]}[pos]
        for slot in slots:  # DK lists FLEX-eligible players once per roster slot
            draftable_id += 1
            dk_rows.append({
                "draftableId": draftable_id, "firstName": first, "lastName": last, "displayName": dk_name,
                "playerId": 900000 + i, "playerDkId": 90000 + i, "position": pos, "rosterSlotId": slot,
                "salary": salary, "status": dk_status, "isDisabled": False, "teamAbbreviation": team,
                "competition": {"competitionId": 5000 + GAMES.index(next(g for g in GAMES if team in g[:2])),
                                "name": f"{away} @ {home}", "startTime": kickoff(team)},
            })
        if "sleeper" not in skip:
            st = jitter(base, 0.08)
            raw = {"pass_yd": st.get("pass_yd"), "pass_td": st.get("pass_td"), "pass_int": st.get("pass_int"),
                   "rush_yd": st.get("rush_yd"), "rush_td": st.get("rush_td"), "rec": st.get("rec"),
                   "rec_yd": st.get("rec_yd"), "rec_td": st.get("rec_td"), "fum_lost": st.get("fum_lost")}
            sleeper_proj.append({"player_id": ids["sleeper_id"], "week": WEEK, "season": str(SEASON),
                                 "team": team, "opponent": opp, "company": "rotowire",
                                 "stats": {k: v for k, v in raw.items() if v is not None},
                                 "player": {"first_name": first, "last_name": last, "position": pos, "team": team}})
        sleeper_players[ids["sleeper_id"]] = {
            "player_id": ids["sleeper_id"], "first_name": first, "last_name": last,
            "full_name": f"{first} {last}", "position": pos, "team": team, "status": "Active",
            "injury_status": var.get("sleeper_status"), "espn_id": int(ids["espn_id"]),
        }
        if "espn" not in skip:
            st = jitter(base, 0.10)
            espn_players.append({"id": int(ids["espn_id"]), "player": {
                "id": int(ids["espn_id"]), "fullName": var.get("espn", dk_name),
                "defaultPositionId": {"QB": 1, "RB": 2, "WR": 3, "TE": 4}[pos], "proTeamId": ESPN_TEAM[team],
                "injuryStatus": "ACTIVE",
                "stats": [
                    {"seasonId": SEASON, "scoringPeriodId": WEEK, "statSourceId": 0, "statSplitTypeId": 1,
                     "appliedTotal": 0, "stats": {}},
                    {"seasonId": SEASON, "scoringPeriodId": WEEK, "statSourceId": 1, "statSplitTypeId": 1,
                     "appliedTotal": 0, "stats": {ESPN_STAT[k]: v for k, v in st.items()}},
                ]}})
        if "fantasypros" not in skip:
            fp[pos.lower()].append((var.get("fp", dk_name), team, ids["fantasypros_id"], jitter(base, 0.07)))
        if "cbs" not in skip:
            cbs[pos].append((var.get("cbs", dk_name), team, jitter(base, 0.09)))
        xwalk.append({"name": dk_name, "merge_name": dk_name.lower(), "position": pos,
                      "team": var.get("xwalk_team", team), **ids})
        # history: 17 games in 2025, 3 in 2026; volatility differs by position
        vol = {"QB": 0.35, "RB": 0.55, "WR": 0.6, "TE": 0.65}[pos] * rng.uniform(0.7, 1.3)
        for season, weeks in ((2025, range(1, 18)), (2026, range(1, WEEK))):
            for w in weeks:
                f = max(0.0, rng.gauss(1.0, vol))
                g = {k: v * f for k, v in base.items()}
                weekly[season].append({
                    "player_id": ids["gsis_id"], "player_display_name": dk_name, "position": pos,
                    "season": season, "week": w, "season_type": "REG",
                    "passing_yards": round(g.get("pass_yd", 0)), "passing_tds": round(g.get("pass_td", 0)),
                    "passing_interceptions": round(g.get("pass_int", 0)), "rushing_yards": round(g.get("rush_yd", 0)),
                    "rushing_tds": round(g.get("rush_td", 0)), "receptions": round(g.get("rec", 0)),
                    "receiving_yards": round(g.get("rec_yd", 0)), "receiving_tds": round(g.get("rec_td", 0)),
                    "rushing_fumbles_lost": 0, "receiving_fumbles_lost": 0, "sack_fumbles_lost": 0,
                })

    for team, salary in DST_SALARY.items():
        away, home = next((a, h) for a, h, _ in GAMES if team in (a, h))
        nick = TEAM_FULL[team].rsplit(" ", 1)[-1]
        draftable_id += 1
        dk_rows.append({
            "draftableId": draftable_id, "firstName": nick, "lastName": "", "displayName": f"{nick} ",
            "playerId": 800000 + len(dk_rows), "position": "DST", "rosterSlotId": 71, "salary": salary,
            "status": "None", "isDisabled": False, "teamAbbreviation": team,
            "competition": {"name": f"{away} @ {home}", "startTime": kickoff(team)},
        })
        line = jitter(dst_line(team), 0.12)
        sleeper_proj.append({"player_id": team, "week": WEEK, "team": team, "stats": {
            "sack": line["sack"], "int": line["def_int"], "fum_rec": line["fum_rec"], "def_td": line["def_td"],
            "safe": line["safety"], "blk_kick": line["blk_kick"], "pts_allow": line["pts_allow"]},
            "player": {"first_name": TEAM_FULL[team].rsplit(" ", 1)[0], "last_name": nick, "position": "DEF", "team": team}})
        fp["dst"].append((TEAM_FULL[team], None, None, jitter(dst_line(team), 0.12)))

    # Filler roster entries so the Sleeper players file looks like a full league.
    for j in range(120):
        pid = str(9000 + j)
        sleeper_players[pid] = {"player_id": pid, "first_name": "Depth", "last_name": f"Player{j}",
                                "full_name": f"Depth Player{j}", "position": ["RB", "WR", "TE"][j % 3],
                                "team": ["NYG", "DAL", "BUF", "NE", "BAL", "CLE"][j % 6], "injury_status": None}
    sleeper_players["KC"] = {"player_id": "KC", "position": "DEF", "team": "KC", "first_name": "Kansas City", "last_name": "Chiefs"}

    lobby = {"Contests": [], "DraftGroups": [
        {"DraftGroupId": 131000, "ContestTypeId": 21, "StartDateEst": "2026-09-27T13:00:00.0000000",
         "ContestStartTimeSuffix": None, "DraftGroupTag": "Featured", "GameCount": 5},
        {"DraftGroupId": 131001, "ContestTypeId": 21, "StartDateEst": "2026-09-27T13:00:00.0000000",
         "ContestStartTimeSuffix": " (Early)", "DraftGroupTag": "", "GameCount": 3},
        {"DraftGroupId": 131002, "ContestTypeId": 21, "StartDateEst": "2026-09-24T20:15:00.0000000",
         "ContestStartTimeSuffix": " (Thu-Mon)", "DraftGroupTag": "", "GameCount": 16},
        {"DraftGroupId": 131004, "ContestTypeId": 21, "StartDateEst": "2026-09-27T13:00:00.0000000",
         "ContestStartTimeSuffix": " (Sun-Mon)", "DraftGroupTag": "", "GameCount": 7},
        {"DraftGroupId": 131003, "ContestTypeId": 96, "StartDateEst": "2026-09-27T20:20:00.0000000",
         "ContestStartTimeSuffix": " (BUF vs NE)", "DraftGroupTag": "", "GameCount": 1},
    ]}
    w = lambda name, obj: (HERE / name).write_text(json.dumps(obj, indent=1))  # noqa: E731
    w("dk_lobby.json", lobby)
    w("dk_draftables.json", {"draftables": dk_rows, "competitions": []})
    w("sleeper_state.json", {"week": WEEK, "season": str(SEASON), "season_type": "regular", "display_week": WEEK})
    w("sleeper_projections.json", sleeper_proj)
    w("sleeper_players.json", sleeper_players)
    w("espn_projections.json", {"players": espn_players})

    for pos, rows in fp.items():
        (HERE / f"fp_{pos}.html").write_text(fp_html(pos, rows))
    for pos, rows in cbs.items():
        (HERE / f"cbs_{pos}.html").write_text(cbs_html(pos, rows))

    (HERE / "nflverse_ids.csv").write_text(to_csv(xwalk))
    games_rows = []
    for a, h, t in GAMES:
        spread, total = VEGAS[f"{a}@{h}"]
        games_rows.append({"game_id": f"{SEASON}_{WEEK:02d}_{a}_{h}", "season": SEASON, "game_type": "REG",
                           "week": WEEK, "gameday": SLATE_DAY, "gametime": t, "away_team": a if a != "LAR" else "LA",
                           "home_team": h if h != "LAR" else "LA", "spread_line": -spread, "total_line": total})
    for a, h, day, t in OTHER_GAMES:
        games_rows.append({"game_id": f"{SEASON}_{WEEK:02d}_{a}_{h}", "season": SEASON, "game_type": "REG",
                           "week": WEEK, "gameday": day, "gametime": t, "away_team": a, "home_team": h,
                           "spread_line": 2.5, "total_line": 44.5})
    games_rows.append({"game_id": "2026_05_KC_DET", "season": SEASON, "game_type": "REG", "week": 5,
                       "gameday": "2026-10-04", "gametime": "13:00", "away_team": "KC", "home_team": "DET",
                       "spread_line": "NA", "total_line": "NA"})
    (HERE / "nflverse_games.csv").write_text(to_csv(games_rows))
    for season, rows in weekly.items():
        (HERE / f"nflverse_stats_{season}.csv").write_text(to_csv(rows))

    csv_rows = []
    for d in dk_rows:
        if d["rosterSlotId"] == 70:
            continue
        a, h = d["competition"]["name"].split(" @ ")
        ko = datetime.fromisoformat(d["competition"]["startTime"][:19]).replace(tzinfo=timezone.utc) - timedelta(hours=4)
        csv_rows.append({"Position": d["position"], "Name + ID": f"{d['displayName'].strip()} ({d['playerId']})",
                         "Name": d["displayName"].strip(), "ID": d["playerId"],
                         "Roster Position": {"QB": "QB", "RB": "RB/FLEX", "WR": "WR/FLEX", "TE": "TE/FLEX", "DST": "DST"}[d["position"]],
                         "Salary": d["salary"], "Game Info": f"{a}@{h} {ko:%m/%d/%Y %I:%M%p} ET",
                         "TeamAbbrev": d["teamAbbreviation"], "AvgPointsPerGame": 0})
    (HERE / "DKSalaries.csv").write_text(to_csv(csv_rows))
    print(f"wrote fixtures: {len(PLAYERS)} players + {len(DST_SALARY)} DST")


def to_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def fp_html(pos, rows):
    groups = {
        "qb": [("PASSING", ["ATT", "CMP", "YDS", "TDS", "INTS"]), ("RUSHING", ["ATT", "YDS", "TDS"]), ("MISC", ["FL", "FPTS"])],
        "rb": [("RUSHING", ["ATT", "YDS", "TDS"]), ("RECEIVING", ["REC", "YDS", "TDS"]), ("MISC", ["FL", "FPTS"])],
        "wr": [("RECEIVING", ["REC", "YDS", "TDS"]), ("RUSHING", ["ATT", "YDS", "TDS"]), ("MISC", ["FL", "FPTS"])],
        "te": [("RECEIVING", ["REC", "YDS", "TDS"]), ("MISC", ["FL", "FPTS"])],
    }
    stat_key = {("PASSING", "YDS"): "pass_yd", ("PASSING", "TDS"): "pass_td", ("PASSING", "INTS"): "pass_int",
                ("RUSHING", "YDS"): "rush_yd", ("RUSHING", "TDS"): "rush_td", ("RECEIVING", "REC"): "rec",
                ("RECEIVING", "YDS"): "rec_yd", ("RECEIVING", "TDS"): "rec_td", ("MISC", "FL"): "fum_lost"}
    if pos == "dst":
        head = "<thead><tr><th>Player</th>" + "".join(f"<th>{c}</th>" for c in
                                                      ["SACK", "INT", "FR", "FF", "TD", "SAFETY", "PA", "YDS AGN", "FPTS"]) + "</tr></thead>"
        body = "".join(
            f'<tr><td class="player-label"><a href="/nfl/teams/x.php" class="player-name">{name}</a></td>'
            f"<td>{s['sack']:.1f}</td><td>{s['def_int']:.1f}</td><td>{s['fum_rec']:.1f}</td><td>0.6</td>"
            f"<td>{s['def_td']:.2f}</td><td>{s['safety']:.2f}</td><td>{s['pts_allow']:.1f}</td><td>320.0</td><td>7.0</td></tr>"
            for name, _, _, s in rows)
        return f'<html><body><table id="data" class="table">{head}<tbody>{body}</tbody></table></body></html>'
    g = groups[pos]
    top = "<tr><th></th>" + "".join(f'<th colspan="{len(cols)}">{grp}</th>' for grp, cols in g) + "</tr>"
    sub = "<tr><th>Player</th>" + "".join(f"<th>{c}</th>" for _, cols in g for c in cols) + "</tr>"
    body = ""
    for name, team, fpid, s in rows:
        cells = "".join(f"<td>{s.get(stat_key.get((grp, c)), 0) or 0:.1f}</td>" for grp, cols in g for c in cols)
        body += (f'<tr class="mpb-player-{fpid}"><td class="player-label"><a href="/nfl/players/x.php" class="player-name">{name}</a> '
                 f'{team} <a href="#" class="fp-player-link fp-id-{fpid}" fp-player-name="{name}"></a></td>{cells}</tr>')
    return f'<html><body><table id="data" class="table"><thead>{top}{sub}</thead><tbody>{body}</tbody></table></body></html>'


def cbs_html(pos, rows):
    groups = {
        "QB": [("Passing", ["Att", "Cmp", "Yds", "TD", "Int"]), ("Rushing", ["Att", "Yds", "TD"]), ("Misc", ["FL", "FPTS"])],
        "RB": [("Rushing", ["Att", "Yds", "TD"]), ("Receiving", ["Rec", "Yds", "TD"]), ("Misc", ["FL", "FPTS"])],
        "WR": [("Receiving", ["Rec", "Yds", "TD"]), ("Rushing", ["Att", "Yds", "TD"]), ("Misc", ["FL", "FPTS"])],
        "TE": [("Receiving", ["Rec", "Yds", "TD"]), ("Misc", ["FL", "FPTS"])],
    }[pos]
    stat_key = {("Passing", "Yds"): "pass_yd", ("Passing", "TD"): "pass_td", ("Passing", "Int"): "pass_int",
                ("Rushing", "Yds"): "rush_yd", ("Rushing", "TD"): "rush_td", ("Receiving", "Rec"): "rec",
                ("Receiving", "Yds"): "rec_yd", ("Receiving", "TD"): "rec_td", ("Misc", "FL"): "fum_lost"}
    top = '<tr class="TableBase-headGroupTr"><th></th>' + "".join(
        f'<th colspan="{len(c)}">{grp}</th>' for grp, c in groups) + "</tr>"
    sub = '<tr class="TableBase-headTr"><th>Player</th>' + "".join(
        f'<th><div class="Tablebase-tooltip"><span class="Tablebase-tooltipLabel">{c}</span>'
        f'<div class="Tablebase-tooltipInner">{grp} {c} long description</div></div></th>'
        for grp, cols in groups for c in cols) + "</tr>"
    body = ""
    for name, team, s in rows:
        cells = "".join(f'<td class="TableBase-bodyTd">{s.get(stat_key.get((grp, c)), 0) or 0:.1f}</td>'
                        for grp, cols in groups for c in cols)
        body += (f'<tr class="TableBase-bodyTr"><td class="TableBase-bodyTd"><span class="CellPlayerName--long">'
                 f'<span><a href="/nfl/players/x/">{name}</a><span class="CellPlayerName-position">{pos}</span>'
                 f'<span class="CellPlayerName-team">{team}</span></span></span></td>{cells}</tr>')
    return (f'<html><body><table class="TableBase-table"><thead>{top}{sub}</thead><tbody>{body}</tbody>'
            f"</table></body></html>")


if __name__ == "__main__":
    main()
