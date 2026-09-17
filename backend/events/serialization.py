"""Serializer: DomainEvent/EventEnvelope <-> JSON-compatible dict.

The on-the-wire shape keeps metadata at the top level and the typed payload
under `payload`, with `event_type`/`event_version` for routing and schema
evolution. Round-trip is lossless for all registered (typed) events.
"""

from __future__ import annotations

from typing import Any

from events.base import DomainEvent
from events.registry import EventRegistry

EnvelopeData = dict[str, Any]


class EventSerializer:
    """Serialize and deserialize event envelopes.

    Requires a registry so that the `event_type` in an envelope can be mapped
    back to its concrete class (payload) on deserialization.
    """

    def __init__(self, registry: EventRegistry) -> None:
        self._registry = registry

    # --- Serialization -------------------------------------------------------
    def dumps(self, envelope: Any) -> dict[str, Any]:
        """Serialize an envelope (or a bare DomainEvent) to a JSON-safe dict."""
        from events.envelope import EventEnvelope

        if isinstance(envelope, DomainEvent):
            envelope = EventEnvelope.wrap(envelope)
        if not isinstance(envelope, EventEnvelope):  # pragma: no cover - guard
            raise TypeError(f"cannot serialize object of type {type(envelope)!r}")
        return envelope.model_dump(mode="json")

    # --- Deserialization -----------------------------------------------------
    def loads(self, data: str | dict[str, Any]) -> Any:
        """Deserialize a JSON string/dict back to a typed EventEnvelope."""
        import json

        from events.envelope import EventEnvelope

        if isinstance(data, str):
            data = json.loads(data)
        if not isinstance(data, dict):
            raise TypeError("serialized event must be a JSON object")

        event_type = data.get("event_type")
        if not isinstance(event_type, str) or not event_type:
            raise ValueError("serialized event missing 'event_type'")
        event_version = data.get("event_version")

        cls = self._registry.resolve(event_type, version=event_version)

        # Validate payload into the concrete event type, keep envelope metadata.
        payload_data = data.get("payload")
        if payload_data is None:
            raise ValueError("serialized event missing 'payload'")

        payload = cls.model_validate(payload_data)

        envelope_meta = {k: v for k, v in data.items() if k != "payload"}
        # Rebuild envelope with the typed payload.
        return EventEnvelope[cls](payload=payload, **envelope_meta)  # type: ignore[valid-type]
