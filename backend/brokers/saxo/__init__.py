"""Saxo Bank adapter (M9).

Implements the broker ports (`MarketDataFeed`, `ExecutionBroker`) for Saxo
via the `SaxoClient` transport port (OAuth session lifecycle included). All
Saxo-specific logic — UIC/AssetType instruments, order formats, activity
statuses, executions, balance/position DTOs, error codes — lives inside this
package and never leaks into the core.

The `SimulatedSaxoClient` provides the sim/paper mode required by the M9
roadmap; no live trading occurs in development milestones. Token/credential
acquisition belongs to a real transport implementation reading the project's
configuration mechanism (`.env`, never committed) — deferred (ADR-015).
"""

from __future__ import annotations

from brokers.saxo import contracts as saxo_contracts
from brokers.saxo import mapping as saxo_mapping
from brokers.saxo.adapter import SaxoAdapter
from brokers.saxo.client import (
    SaxoAuthError,
    SaxoCallbacks,
    SaxoClient,
    SaxoClientError,
    SimulatedSaxoClient,
)

__all__ = [
    "SaxoAdapter",
    "SaxoClient",
    "SaxoCallbacks",
    "SaxoClientError",
    "SaxoAuthError",
    "SimulatedSaxoClient",
    "saxo_contracts",
    "saxo_mapping",
]
