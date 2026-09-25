from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..config import Config
from ..http import Http
from ..models import Game


@dataclass
class Context:
    cfg: Config
    http: Http
    now: datetime
    season: int = 0
    week: int = 0
    slate_date: str | None = None  # YYYY-MM-DD (local) of the slate's first kickoff
    games: list[Game] = field(default_factory=list)  # nflverse schedule for the season
    slate_teams: set[str] = field(default_factory=set)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceMeta:
    name: str
    label: str
    kind: str
    access: str
