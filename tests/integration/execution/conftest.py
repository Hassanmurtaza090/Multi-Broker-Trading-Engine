"""Shared fixtures for execution integration tests (reuse unit execution conftest)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.unit.execution.conftest import *  # noqa: F401,F403