"""Interactive Brokers adapter (M8).

Implements the broker ports (`MarketDataFeed`, `ExecutionBroker`) for IBKR via
the `IbkrClient` transport port. All IBKR-specific logic — contracts, order
mapping, statuses, executions, account values, positions, error codes — lives
inside this package and never leaks into the core.

The `SimulatedIbkrClient` provides the paper/test mode required by the M8
roadmap; no live trading occurs in development milestones.
"""

from __future__ import annotations

from brokers.ibkr import contracts as ibkr_contracts
from brokers.ibkr import mapping as ibkr_mapping
from brokers.ibkr.adapter import IbkrAdapter
from brokers.ibkr.client import (
    IbkrCallbacks,
    IbkrClient,
    IbkrClientError,
    SimulatedIbkrClient,
)

__all__ = [
    "IbkrAdapter",
    "IbkrClient",
    "IbkrCallbacks",
    "IbkrClientError",
    "SimulatedIbkrClient",
    "ibkr_contracts",
    "ibkr_mapping",
]
