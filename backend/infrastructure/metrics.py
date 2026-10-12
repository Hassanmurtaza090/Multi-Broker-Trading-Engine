"""Operational metrics (M15) — a minimal, dependency-free registry.

NFR-004 requires "structured logs, metrics". This registry provides
counters (monotonic) and gauges (callable-sourced) for the operational
surface the roadmap documents: order lifecycle activity, risk rejections,
connection state, and service availability. It is exposed at `/metrics`
(AUTHENTICATED — never public) and is deliberately NOT a Prometheus
endpoint: no new dependency, no unnecessary infrastructure service.

Everything is process-local by design (single-process engine, ADR-007).
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any


class MetricsRegistry:
    """Thread-safe counters + gauges for operational monitoring."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, int] = {}
        self._gauges: dict[str, Callable[[], float]] = {}
        self._started_at = datetime.now(UTC)

    def counter(self, name: str) -> None:
        """Increment a counter (creating it at zero on first touch)."""
        with self._lock:
            self._counters[name] = self._counters.get(name, 0) + 1

    def gauge(self, name: str, source: Callable[[], float]) -> None:
        with self._lock:
            self._gauges[name] = source

    def snapshot(self) -> dict[str, float]:
        """A consistent point-in-time view of all metrics."""
        with self._lock:
            counters = dict(self._counters)
            gauges = {name: source() for name, source in self._gauges.items()}
        gauges["uptime_seconds"] = (datetime.now(UTC) - self._started_at).total_seconds()
        return {**gauges, **{f"{k}_total": v for k, v in counters.items()}}


# Event-name → counter-name mapping for the bus-driven counters.
EVENT_COUNTERS: dict[str, str] = {
    "order.submitted": "orders_submitted",
    "order.accepted": "orders_accepted",
    "order.rejected": "orders_rejected",
    "order.cancelled": "orders_cancelled",
    "order.partially_filled": "orders_partially_filled",
    "order.filled": "orders_filled",
    "order.expired": "orders_expired",
    "position.opened": "positions_opened",
    "position.closed": "positions_closed",
    "risk.violation": "risk_violations",
    "balance.updated": "balance_updates",
    "market.quote.updated": "market_quotes",
    "broker.connected": "broker_reconnects",
    "broker.disconnected": "broker_disconnects",
}


def attach_bus_counters(registry: MetricsRegistry, bus: object) -> None:
    """Subscribe one counter handler per mapped event (identifiers never
    enter the metrics — counters only, so no account/user data leaks)."""

    from events import EventEnvelope

    for event_type, counter_name in EVENT_COUNTERS.items():
        # Default-arg binds the loop variable NOW (no late-binding bug).
        async def handler(envelope: EventEnvelope[Any], _counter: str = counter_name) -> None:
            registry.counter(_counter)

        handler.__name__ = f"metrics_{counter_name}"  # diagnostics
        bus.subscribe(event_type, handler)  # type: ignore[attr-defined]
