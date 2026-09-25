import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dfs.config import Config  # noqa: E402
from dfs.http import Http  # noqa: E402
from dfs.sources.base import Context  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def cfg():
    return Config.load()


@pytest.fixture
def ctx(cfg):
    return Context(cfg=cfg, http=Http(FIXTURES), now=NOW, season=2026, week=4)
