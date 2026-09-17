"""Event base type and event-type identity.

A domain event is an immutable, strongly-typed, broker-agnostic record of
something that *has already happened*. Every event carries a stable string
`event_type` and a `version` so consumers can route and evolve independently of
Python class names.
"""

from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict

# Current schema version applied to all events defined in this milestone.
# Each event type declares its own version via `__event_version__` so future
# versions can diverge per-type.
DEFAULT_EVENT_VERSION = 1


class DomainEvent(BaseModel):
    """Base class for all domain events.

    Subclasses MUST set `__event_type__` (a stable, unique string). They MAY
    set `__event_version__` to override the default version to support schema
    evolution.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    __event_type__: ClassVar[str] = ""
    __event_version__: ClassVar[int] = DEFAULT_EVENT_VERSION

    @property
    def event_type(self) -> str:
        """Stable, registry-unique event type string."""
        return self.__event_type__

    @property
    def event_version(self) -> int:
        """Schema version of this event type."""
        return self.__event_version__
