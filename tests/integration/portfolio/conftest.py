"""Shared fixtures for portfolio integration tests (reuse unit portfolio conftest)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.unit.portfolio.conftest import *  # noqa: F401,F403
from tests.unit.execution.conftest import SimulatedExecutionBroker  # noqa: F401