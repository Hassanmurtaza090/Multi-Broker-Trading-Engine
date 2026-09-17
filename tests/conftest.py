"""Pytest configuration for the Multi-Broker Trading Engine backend tests.

Ensures the `backend` package sources are importable and sets asyncio mode.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add the repo root to sys.path so test helper modules under `tests/` are
# importable (e.g. `from tests.unit.<area>.conftest import ...`) regardless of
# whether the run starts from the backend/ directory or the repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Add the backend directory to sys.path so backend packages are importable
# when running pytest from the backend/ directory (or the repo root).
BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))