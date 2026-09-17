"""Execution Engine (M5).

Broker-independent coordinator that routes orders through the `ExecutionBroker`
port, applies reports to the OMS, handles timeouts, and provides reconciliation.
"""

from __future__ import annotations

from execution.engine import ExecutionEngine

__all__ = ["ExecutionEngine"]
