from dfs.repair_history import rebuild


def run(at, group, players, games=2):
    slate = {"draft_group_id": group, "generated_at": at,
             "games": [{"game": "A@B", "kickoff": "2026-10-11T17:00:00Z"},
                       {"game": "C@D", "kickoff": "2026-10-12T00:20:00Z"}][2 - games:]}
    return slate, players


def p(pid, proj, game=None, kickoff=None, **kw):
    return {"id": pid, "proj": proj, "game": game, "kickoff": kickoff, "opp": None, "home": None, **kw}


def test_rebuild_keeps_each_players_last_pre_kickoff_row():
    early = ("A@B", "2026-10-11T17:00:00Z")
    night = ("C@D", "2026-10-12T00:20:00Z")
    history = [
        run("2026-10-11T12:00:00Z", 1, [p("a", 10, *early), p("c", 8, *night)]),
        run("2026-10-11T16:00:00Z", 1, [p("a", 11, *early), p("c", 9, *night)]),
        # after the early kickoff DraftKings drops A@B details; the projection moved after lock
        run("2026-10-11T20:00:00Z", 1, [p("a", 3), p("c", 12, *night)], games=1),
        # the Primetime slate overwrote the week: ignored
        run("2026-10-11T23:00:00Z", 2, [p("c", 99, *night)], games=1),
    ]
    slate, rows = rebuild(history, 1)
    by = {r["id"]: r for r in rows}
    assert by["a"]["proj"] == 11 and by["a"]["game"] == "A@B"
    assert by["c"]["proj"] == 12
    assert len(slate["games"]) == 2 and slate["first_kickoff"] == "2026-10-11T17:00:00Z"
    assert slate["generated_at"] == "2026-10-11T20:00:00Z"
