"""Market Data engine (M3).

Consumes a `MarketDataFeed` (broker port), normalizes and validates raw payloads
into domain value objects, tracks staleness, and publishes typed events on the
M2 event bus. Broker-agnostic: depends only on `brokers.base` and `events`.
"""

from __future__ import annotations

from market_data.engine import MarketDataEngine
from market_data.staleness import StalenessMonitor
from market_data.subscription import SubscriptionManager

__all__ = [
    "MarketDataEngine",
    "StalenessMonitor",
    "SubscriptionManager",
]
