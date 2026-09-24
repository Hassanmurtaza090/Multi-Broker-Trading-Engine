"""Application layer — use-case orchestration and the engine composition root.

Depends on the domain, the event system, and broker PORTS only (never on a
concrete broker adapter — adapters are injected at the composition boundary).
"""

from __future__ import annotations

from application.runtime import EngineRuntime

__all__ = ["EngineRuntime"]
