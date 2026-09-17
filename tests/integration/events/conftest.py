"""Shared fixtures for event integration tests."""

from __future__ import annotations

import sys
from pathlib import Path

# Add repo root to path so tests module is importable
# This file is at: tests/integration/events/conftest.py
# Repo root is 4 levels up
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tests.unit.events.conftest import *  # noqa: F403,F401