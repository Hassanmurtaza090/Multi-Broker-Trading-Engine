"""Unit tests for EventRegistry."""

from __future__ import annotations

import pytest

from events import EventRegistry, UnknownEventTypeError, UnsupportedEventVersionError
from events.base import DomainEvent


class DummyEventV1(DomainEvent):
    __event_type__ = "test.dummy"
    __event_version__ = 1
    value: int = 1


class DummyEventV2(DomainEvent):
    __event_type__ = "test.dummy"
    __event_version__ = 2
    value: int = 2
    extra: str = "new"


class TestEventRegistry:
    def test_register_and_resolve(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)
        cls = reg.resolve("test.dummy")
        assert cls is DummyEventV1

    def test_resolve_latest_version(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)
        reg.register(DummyEventV2)
        cls = reg.resolve("test.dummy")  # version=None -> latest
        assert cls is DummyEventV2

    def test_resolve_specific_version(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)
        reg.register(DummyEventV2)
        assert reg.resolve("test.dummy", version=1) is DummyEventV1
        assert reg.resolve("test.dummy", version=2) is DummyEventV2

    def test_versions(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)
        reg.register(DummyEventV2)
        assert reg.versions("test.dummy") == (1, 2)

    def test_unknown_type_raises(self):
        reg = EventRegistry()
        with pytest.raises(UnknownEventTypeError):
            reg.resolve("nonexistent")

    def test_unsupported_version_raises(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)
        with pytest.raises(UnsupportedEventVersionError):
            reg.resolve("test.dummy", version=99)

    def test_latest_version_unknown_raises(self):
        reg = EventRegistry()
        with pytest.raises(UnknownEventTypeError):
            reg.latest_version("nonexistent")

    def test_duplicate_registration_same_class_ok(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)
        reg.register(DummyEventV1)  # idempotent
        assert reg.resolve("test.dummy") is DummyEventV1

    def test_duplicate_registration_different_class_raises(self):
        reg = EventRegistry()
        reg.register(DummyEventV1)

        class AnotherV1(DomainEvent):
            __event_type__ = "test.dummy"
            __event_version__ = 1

        with pytest.raises(ValueError):
            reg.register(AnotherV1)

    def test_default_registry_contains_m2_events(self):
        from events import DEFAULT_REGISTRY
        types = DEFAULT_REGISTRY.registered_types()
        assert "order.filled" in types
        assert "order.rejected" in types
        assert types["order.filled"] == (1,)