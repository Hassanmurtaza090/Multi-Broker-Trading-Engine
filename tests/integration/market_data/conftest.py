"""Shared fixtures for market-data integration tests.

Reuses the simulated feed and instrument fixtures from the unit market-data
conftest.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Repo root is 5 levels up from tests/integration/market_data/conftest.py.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.unit.market_data.conftest import *  # noqa: F401,F403