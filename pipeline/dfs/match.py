"""Match records from any source to DraftKings slate players.

Order of attempts, first hit wins:
  1. DST: by team.
  2. Site ID -> crosswalk row -> slate player (when the source ships an ID we can map).
  3. Normalized name + position + team.
  4. Normalized name + position, if unique on the slate (handles trades and stale team codes).
  4b. Normalized name + team, any position, if unique (sites disagree on RB/TE/WR listings).
  5. Fuzzy name (rapidfuzz token_sort_ratio >= 88) among slate players with the same team + position.
"""
from __future__ import annotations

from collections import defaultdict

from rapidfuzz import fuzz, process

from .models import SlatePlayer
from .names import normalize_name

FUZZY_CUTOFF = 88


class SlateIndex:
    def __init__(self, players: list[SlatePlayer], crosswalk: list[dict] | None = None):
        self.players = {p.dk_id: p for p in players}
        self.by_npt: dict[tuple, list[str]] = defaultdict(list)
        self.by_np: dict[tuple, list[str]] = defaultdict(list)
        self.by_tp: dict[tuple, list[str]] = defaultdict(list)
        self.by_nt: dict[tuple, list[str]] = defaultdict(list)
        self.by_n: dict[str, list[str]] = defaultdict(list)
        self.dst_by_team: dict[str, str] = {}
        self.norm: dict[str, str] = {}
        for p in players:
            if p.pos == "DST":
                self.dst_by_team[p.team] = p.dk_id
                continue
            n = normalize_name(p.name)
            self.norm[p.dk_id] = n
            self.by_npt[(n, p.pos, p.team)].append(p.dk_id)
            self.by_np[(n, p.pos)].append(p.dk_id)
            self.by_tp[(p.team, p.pos)].append(p.dk_id)
            self.by_nt[(n, p.team)].append(p.dk_id)
            self.by_n[n].append(p.dk_id)
        # Site ID -> dk_id, built by name-matching crosswalk rows to the slate.
        self.id_map: dict[tuple[str, str], str] = {}
        self.gsis_by_dk: dict[str, str] = {}
        for row in crosswalk or []:
            dk_id, _ = self._match_name(row["name"], row["pos"], row["team"], fuzzy=False)
            if not dk_id:
                continue
            for id_type, value in row["ids"].items():
                self.id_map[(id_type, value)] = dk_id
            if "gsis_id" in row["ids"]:
                self.gsis_by_dk.setdefault(dk_id, row["ids"]["gsis_id"])

    def _match_name(self, name: str, pos: str, team: str | None, fuzzy: bool = True) -> tuple[str | None, str]:
        n = normalize_name(name)
        if team:
            hits = self.by_npt.get((n, pos, team), [])
            if len(hits) == 1:
                return hits[0], "name"
        hits = self.by_np.get((n, pos), [])
        if len(hits) == 1:
            return hits[0], "name_pos"
        if team and pos != "QB":
            hits = self.by_nt.get((n, team), [])
            if len(hits) == 1 and self.players[hits[0]].pos in ("RB", "WR", "TE"):
                return hits[0], "name_team"
        if fuzzy and team:
            pool = {dk: self.norm[dk] for dk in self.by_tp.get((team, pos), [])}
            if pool:
                best = process.extractOne(n, pool, scorer=fuzz.token_sort_ratio, score_cutoff=FUZZY_CUTOFF)
                if best:
                    return best[2], "fuzzy"
        return None, "unmatched"

    def match(self, name: str, pos: str, team: str | None, ids: dict[str, str] | None = None) -> tuple[str | None, str]:
        if pos == "DST":
            dk = self.dst_by_team.get(team or "")
            return (dk, "team") if dk else (None, "unmatched")
        for id_type, value in (ids or {}).items():
            dk = self.id_map.get((id_type, value))
            if dk and self.players[dk].pos == pos:
                return dk, "id"
        if not pos:  # the site didn't say: name + team, then name alone if unique on the slate
            n = normalize_name(name)
            for hits, how in ((self.by_nt.get((n, team or ""), []), "name_team"), (self.by_n.get(n, []), "name_only")):
                if len(hits) == 1:
                    return hits[0], how
            return None, "unmatched"
        return self._match_name(name, pos, team)
