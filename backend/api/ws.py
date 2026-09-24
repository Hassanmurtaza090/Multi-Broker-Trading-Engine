"""WebSocket gateway (M10) — streams engine events to clients over /ws.

Event-to-client synchronization model (ADR-016):
- Delivery is at-least-once: every message is a serialized M2 `EventEnvelope`
  (via the registry-driven `EventSerializer`) carrying `event_id`,
  `event_type`, `event_version`, `timestamp`, and payload — clients dedupe by
  `event_id` and can resync from the REST read models at any time.
- Ordering follows the M2 per-bus total ordering (ADR-007). Within a single
  topic the engine publish order is preserved. Across topics, nested
  reactions interleave by subscriber registration order: a component that
  reacts to an event by publishing another (e.g. the portfolio publishing
  `position.opened` while consuming `order.partially_filled`) is dispatched
  before later subscribers, so its reaction can be queued BEFORE the event
  that caused it. Clients must therefore reconcile by `event_id` + REST
  resync, never by cross-topic ordering alone.
- Topic filtering: clients subscribe with `?topics=orders,positions,market,
  account,brokers,risk` (default `all`); events fan out only to matching
  clients.
- Backpressure policy: each client has a bounded queue (one slot reserved for
  the close sentinel); a client that cannot keep up is CLOSED with code 1013
  ("try again later") rather than silently dropping events or growing
  unbounded memory. Slow clients resync via REST.
- Concurrency: the bus handler only does `put_nowait` (no awaits) so fan-out
  is atomic per delivery on the single event loop; registration is confined to
  the WS endpoint coroutine.

No broker-specific types ever appear here — only internal envelopes.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from events import EventBus, EventEnvelope, EventSerializer

logger = logging.getLogger("mtbe.api.ws")

_CLOSE_SENTINEL = object()

# Event types streamed to clients, by topic group.
_TOPIC_EVENTS: dict[str, tuple[str, ...]] = {
    "orders": (
        "order.submitted",
        "order.accepted",
        "order.rejected",
        "order.cancelled",
        "order.modified",
        "order.partially_filled",
        "order.filled",
        "order.expired",
    ),
    "positions": (
        "position.opened",
        "position.updated",
        "position.closed",
    ),
    "account": ("balance.updated", "account.updated"),
    "market": (
        "market.quote.updated",
        "market.tick.updated",
        "market.bar.updated",
    ),
    "brokers": ("broker.connected", "broker.disconnected"),
    "risk": ("risk.violation",),
}

_ALL_TOPICS = tuple(_TOPIC_EVENTS)


def _event_topic(event_type: str) -> str | None:
    for topic, types in _TOPIC_EVENTS.items():
        if event_type in types:
            return topic
    return None


@dataclass
class _Client:
    """One connected WS client: its queue, topics, and sender control."""

    client_id: str
    websocket: Any
    topics: frozenset[str]
    queue: asyncio.Queue[Any]
    closed: bool = field(default=False)


class WebSocketHub:
    """Fan-out of M2 envelopes to connected WebSocket clients."""

    def __init__(
        self, bus: EventBus, serializer: EventSerializer, *, queue_size: int = 1000
    ) -> None:
        self._serializer = serializer
        self._queue_size = queue_size
        self._clients: dict[str, _Client] = {}
        for topic, event_types in _TOPIC_EVENTS.items():
            for event_type in event_types:
                bus.subscribe(event_type, self._make_handler(event_type, topic))

    def _make_handler(self, event_type: str, topic: str) -> Any:
        async def handler(envelope: EventEnvelope[Any]) -> None:
            self._fan_out(envelope, topic)

        handler.__name__ = f"ws_hub_{event_type}"  # diagnostics
        return handler

    def _fan_out(self, envelope: EventEnvelope[Any], topic: str) -> None:
        # No awaits: atomic fan-out per delivery on the single event loop.
        for client in list(self._clients.values()):
            if client.closed:
                continue
            if "all" in client.topics or topic in client.topics:
                if client.queue.qsize() >= self._queue_size:
                    # Backpressure: close the slow client (it can resync via
                    # REST) — never silently drop events or grow memory. The
                    # sentinel always fits (one reserved slot).
                    client.closed = True
                    client.queue.put_nowait(_CLOSE_SENTINEL)
                    continue
                client.queue.put_nowait(envelope)

    # -- registration (called from the WS endpoint coroutine) --------------------
    def register(self, websocket: Any, topics: frozenset[str]) -> str:
        client_id = str(uuid4())
        self._clients[client_id] = _Client(
            client_id=client_id,
            websocket=websocket,
            topics=topics,
            # One slot beyond `queue_size` is reserved for the close sentinel,
            # guaranteeing the sentinel always fits when a client overflows.
            queue=asyncio.Queue(maxsize=self._queue_size + 1),
        )
        return client_id

    def unregister(self, client_id: str) -> None:
        self._clients.pop(client_id, None)

    def client_count(self) -> int:
        return len(self._clients)

    @staticmethod
    def parse_topics(raw: str | None) -> frozenset[str]:
        """Parse the `topics` query parameter into a validated topic set."""
        if not raw or raw.strip().lower() == "all":
            return frozenset({"all"})
        requested = {part.strip().lower() for part in raw.split(",") if part.strip()}
        unknown = requested - set(_ALL_TOPICS)
        if unknown:
            valid = ", ".join(sorted(_ALL_TOPICS))
            raise ValueError(f"unknown topics: {', '.join(sorted(unknown))}; valid: {valid}")
        return frozenset(requested)

    async def serve(self, client_id: str) -> None:
        """Sender loop for one client; runs until the client goes away."""
        client = self._clients[client_id]
        ws = client.websocket
        while True:
            item = await client.queue.get()
            if item is _CLOSE_SENTINEL or client.closed:
                try:
                    await ws.close(code=1013)
                except Exception:  # noqa: BLE001 — best-effort close
                    pass
                break
            try:
                data = self._serializer.dumps(item)
                await ws.send_text(json.dumps(data))
            except Exception:  # noqa: BLE001 — client went away; stop sending
                break


def hello_message(client_id: str, topics: frozenset[str]) -> str:
    """The initial control message sent to every new WS client."""
    return json.dumps(
        {
            "control": "hello",
            "client_id": client_id,
            "topics": sorted(topics),
            "delivery": "at-least-once",
            "dedupe_key": "event_id",
        }
    )
