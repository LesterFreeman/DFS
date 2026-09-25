from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class SourceError(Exception):
    """A source returned nothing usable. Raised inside adapters; caught by the runner."""


@dataclass
class SlatePlayer:
    dk_id: str
    name: str
    pos: str
    team: str
    opp: str | None
    salary: int
    home: bool | None
    game: str | None
    kickoff: str | None  # ISO-8601 UTC
    dk_status: str = "ACTIVE"
    roster_slots: list[str] = field(default_factory=list)


@dataclass
class ProjRecord:
    source: str
    name: str
    pos: str
    team: str | None
    points: float  # DraftKings points
    stats: dict[str, float] | None = None
    ids: dict[str, str] = field(default_factory=dict)
    native: bool = False  # True if points are the source's own scoring rather than recomputed


@dataclass
class StatusRecord:
    source: str
    name: str
    pos: str
    team: str | None
    status: str  # ACTIVE | Q | D | O | IR
    ids: dict[str, str] = field(default_factory=dict)


@dataclass
class Game:
    season: int
    week: int
    game_type: str
    gameday: str
    gametime: str | None
    away: str
    home: str
    spread_line: float | None  # positive = home favored (nflverse convention)
    total_line: float | None

    def implied(self) -> dict[str, float] | None:
        if self.spread_line is None or self.total_line is None:
            return None
        home = self.total_line / 2 + self.spread_line / 2
        return {self.home: round(home, 2), self.away: round(self.total_line - home, 2)}


@dataclass
class SourceStatus:
    name: str
    label: str
    kind: str  # salaries | projections | status | reference
    access: str
    status: str = "ok"  # ok | stale | failed | disabled
    fetched_at: str | None = None
    rows: int = 0
    coverage: float | None = None
    error: str | None = None
    stale_hours: float | None = None
    notes: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}
