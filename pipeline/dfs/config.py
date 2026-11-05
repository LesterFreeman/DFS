from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "config.toml"


@dataclass
class Config:
    raw: dict[str, Any]

    @classmethod
    def load(cls, path: Path | None = None) -> "Config":
        with open(path or DEFAULT_CONFIG, "rb") as f:
            return cls(tomllib.load(f))

    def section(self, name: str) -> dict[str, Any]:
        return self.raw.get(name, {})

    def enabled(self, source: str) -> bool:
        return bool(self.section("sources").get(source, True))

    def source_weight(self, source: str, pos: str | None = None) -> float:
        """Weight of a source in the consensus; a [source_weights.<POS>] table overrides it for one position."""
        weights = self.section("source_weights")
        override = weights.get(pos, {}) if pos else {}
        if isinstance(override, dict) and source in override:
            return float(override[source])
        value = weights.get(source, 1.0)
        return float(value) if not isinstance(value, dict) else 1.0

    @property
    def slate(self) -> dict[str, Any]:
        return self.section("slate")

    @property
    def sanity(self) -> dict[str, Any]:
        return self.section("sanity")

    @property
    def floor(self) -> dict[str, Any]:
        return self.section("floor")

    @property
    def pool_min(self) -> dict[str, float]:
        return self.section("pool").get("min_projection", {})
