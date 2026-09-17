"""Event registry: maps event types to their concrete classes (by version).

The registry is the single source of truth for deserialization and drives
versioned lookups so a future v2 event class can coexist with v1.
"""

from __future__ import annotations

from collections.abc import Mapping

from events.base import DEFAULT_EVENT_VERSION, DomainEvent


class UnknownEventTypeError(ValueError):
    """Raised when serializing/deserializing an event type not in the registry."""

    def __init__(self, event_type: str) -> None:
        super().__init__(f"unknown event type: {event_type!r}")
        self.event_type = event_type


class UnsupportedEventVersionError(ValueError):
    """Raised when the event type is known but the version is not supported."""

    def __init__(self, event_type: str, version: int) -> None:
        super().__init__(f"unsupported version {version} for event type {event_type!r}")
        self.event_type = event_type
        self.version = version


class EventRegistry:
    """Registry of event type + version -> concrete event class."""

    def __init__(self) -> None:
        # (event_type, version) -> class
        self._map: dict[tuple[str, int], type[DomainEvent]] = {}

    def register(self, cls: type[DomainEvent]) -> type[DomainEvent]:
        key = (cls.__event_type__, cls.__event_version__)
        if not key[0]:
            raise ValueError(f"{cls.__name__} must define __event_type__")
        existing = self._map.get(key)
        if existing is not None and existing is not cls:
            raise ValueError(f"event type/version already registered: {key}")
        self._map[key] = cls
        return cls

    def resolve(self, event_type: str, version: int | None = None) -> type[DomainEvent]:
        """Resolve a class for the given type; `version=None` resolves latest."""
        if not event_type:
            raise UnknownEventTypeError(event_type)
        if version is None:
            version = self.latest_version(event_type)
        cls = self._map.get((event_type, version))
        if cls is None:
            if version not in self.versions(event_type):
                raise UnsupportedEventVersionError(event_type, version)
            raise UnknownEventTypeError(event_type)
        return cls

    def versions(self, event_type: str) -> tuple[int, ...]:
        return tuple(sorted(v for (t, v) in self._map if t == event_type)) or (
            DEFAULT_EVENT_VERSION,
        )

    def latest_version(self, event_type: str) -> int:
        versions = [v for (t, v) in self._map if t == event_type]
        if not versions:
            raise UnknownEventTypeError(event_type)
        return max(versions)

    def registered_types(self) -> Mapping[str, tuple[int, ...]]:
        result: dict[str, list[int]] = {}
        for t, v in self._map:
            result.setdefault(t, []).append(v)
        return {t: tuple(sorted(vs)) for t, vs in sorted(result.items())}


def build_default_registry() -> EventRegistry:
    """Construct the registry with all M2 events registered."""
    # Local import to avoid a hard circular dependency at module import time.
    from events import types as t

    registry = EventRegistry()
    for cls in (
        t.MarketQuoteUpdated,
        t.MarketTickUpdated,
        t.MarketBarUpdated,
        t.OrderSubmitted,
        t.OrderAccepted,
        t.OrderRejected,
        t.OrderCancelled,
        t.OrderModified,
        t.OrderPartiallyFilled,
        t.OrderFilled,
        t.OrderExpired,
        t.PositionOpened,
        t.PositionUpdated,
        t.PositionClosed,
        t.AccountUpdated,
        t.BalanceUpdated,
        t.BrokerConnected,
        t.BrokerDisconnected,
        t.RiskViolation,
    ):
        registry.register(cls)
    return registry


# Process-wide default registry (immutable in practice).
DEFAULT_REGISTRY: EventRegistry = build_default_registry()
