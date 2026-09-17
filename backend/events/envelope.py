"""Event envelope: metadata wrapping a typed domain event.

The envelope separates transport/routing metadata from business payload so the
bus, serialization, and tracing all operate on a uniform shape regardless of
the concrete event type.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TypeVar
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from events.base import DomainEvent

EventT = TypeVar("EventT", bound=DomainEvent)


class EventEnvelope[EventT: DomainEvent](BaseModel):
    """A domain event wrapped with routing/tracing metadata.

    - `event_id` uniquely identifies this event occurrence (idempotency key for
      consumers).
    - `correlation_id` links related events across an operation.
    - `causation_id` identifies the event/action that directly caused this one.
    - `source` names the subsystem that produced the event (for diagnosis).
    - `timestamp` is timezone-aware UTC.
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    event_id: UUID = Field(default_factory=uuid4)
    event_type: str
    event_version: int
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    source: str = Field(default="", max_length=128)
    correlation_id: str | None = Field(default=None, max_length=256)
    causation_id: str | None = Field(default=None, max_length=256)
    payload: EventT

    @model_validator(mode="after")
    def _validate_timestamp_tz_aware(self) -> EventEnvelope[EventT]:
        if self.timestamp.tzinfo is None:
            raise ValueError("event timestamp must be timezone-aware (UTC)")
        return self

    @classmethod
    def wrap(
        cls,
        event: EventT,
        *,
        source: str = "",
        correlation_id: str | None = None,
        causation_id: str | None = None,
        event_id: UUID | None = None,
        timestamp: datetime | None = None,
    ) -> EventEnvelope[EventT]:
        """Build an envelope around a domain event, filling identity/version.

        `event_id` and `timestamp` default to a fresh UUID and now(UTC) unless
        provided (useful for replay/deserialization).
        """
        return cls(
            event_id=event_id or uuid4(),
            event_type=event.event_type,
            event_version=event.event_version,
            timestamp=timestamp or datetime.now(UTC),
            source=source,
            correlation_id=correlation_id,
            causation_id=causation_id,
            payload=event,
        )
