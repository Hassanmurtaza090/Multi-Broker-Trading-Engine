"""Security-suite fixtures: reuse the integration API app/stack fixtures
(the same real engine + auth service) for adversarial tests."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.integration.api.conftest import (  # noqa: F401
    adapter,
    app,
    bus,
    client,
    runtime,
    sim_client,
)
