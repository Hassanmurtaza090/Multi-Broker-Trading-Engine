"""Integration: IBKR adapter wired into the full engine (M3/M4/M5/M7)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.unit.brokers.conftest import *  # noqa: F401,F403
