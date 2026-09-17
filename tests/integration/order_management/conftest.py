"""Shared fixtures for OMS integration tests (reuse unit OMS conftest)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.unit.order_management.conftest import *  # noqa: F401,F403