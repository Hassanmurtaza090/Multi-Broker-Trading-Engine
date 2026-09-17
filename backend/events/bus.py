"""Event publishing/dispatch.

Design decisions (documented in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`):

- **Per-bus total ordering (per event loop).** Every `publish()` acquires a
  process-bus lock before dispatching, so concurrent `publish()` calls are
  serialized and handler executions never interleave across events. This
  guarantees that for any two publishes `A` then `B` (issued in that order),
  all of A's handlers complete before any of B's handlers begin.
- **Reentrancy for handler-driven event chains.** A handler may itself call
  `bus.publish(...)` (e.g. `OrderFilled` -> `PositionUpdated`). The lock is
  tracked per asyncio task, so a nested publish from within the task that
  already holds the lock proceeds without deadlocking.
- **Sequential, in-order dispatch within a publish call.** Handlers for a single
  event execute one after another in registration order. `publish()` awaits
  completion of all handlers before returning.
- **Handler isolation.** A handler that raises does not prevent the remaining
  subscribers from running, and does not crash the bus. Failures are logged and
  collected; the caller receives a list of `HandlerError`s.
- **Uniform handler signature.** A handler receives the full `EventEnvelope`.
  Use `envelope.payload` for the typed event.
- **Ordering scope / limitations.** Ordering is guaranteed only *within a
  single `InProcessEventBus` instance on a single event loop*. There is no
  ordering guarantee across separate bus instances, across processes, or across
  a future distributed transport; that requires an external ordering mechanism
  (see docs).
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4

from events.base import DomainEvent
from events.envelope import EventEnvelope

logger = logging.getLogger("mtbe.events")

# A handler is an async (or sync) callable consuming an envelope.
AnyHandler = Callable[[EventEnvelope[Any]], Any | Coroutine[Any, Any, None]]


@dataclass(frozen=True, slots=True)
class HandlerError:
    """Captured failure of one handler for one event."""

    handler_name: str
    event_id: str
    event_type: str
    exception_type: str
    message: str  # safeguarded message (no secrets) — see _safe_message


@dataclass(frozen=True, slots=True)
class PublishResult:
    """Outcome of dispatching one event to all current subscribers."""

    envelope: EventEnvelope[Any]
    delivered_to: int
    errors: tuple[HandlerError, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class Subscription:
    """Handle to a registered handler; returned from subscribe()."""

    token: str
    event_type: str
    handler: AnyHandler


class EventBus(Protocol):
    """Abstract event bus contract (so transport can be swapped later)."""

    def subscribe(self, event_type: str, handler: AnyHandler) -> Subscription: ...

    def unsubscribe(self, subscription: Subscription) -> bool: ...

    async def publish(
        self,
        event: DomainEvent | EventEnvelope[Any],
        *,
        source: str = "",
        correlation_id: str | None = None,
        causation_id: str | None = None,
    ) -> PublishResult: ...

    def subscriber_count(self, event_type: str) -> int: ...


class InProcessEventBus:
    """In-process, sequential event bus (M2 implementation).

    Deterministic ordering: each `publish()` is fully awaited; handlers run in
    registration order, sequentially (not concurrently), preserving causality
    for trading logic.
    """

    def __init__(self) -> None:
        # event_type -> list[(token, handler)], registration order preserved.
        self._subscribers: dict[str, list[tuple[str, AnyHandler]]] = {}
        # Serializes publish() calls for deterministic per-bus ordering.
        self._lock = asyncio.Lock()
        # Task currently holding _lock, so nested publishes don't deadlock.
        self._lock_holder: asyncio.Task[Any] | None = None

    # -- subscription management ----------------------------------------------
    def subscribe(self, event_type: str, handler: AnyHandler) -> Subscription:
        if not callable(handler):
            raise TypeError("handler must be callable")
        token = str(uuid4())
        self._subscribers.setdefault(event_type, []).append((token, handler))
        sub = Subscription(token=token, event_type=event_type, handler=handler)
        logger.info(
            "event_subscribe",
            extra={"event_type": event_type, "token": token},
        )
        return sub

    def unsubscribe(self, subscription: Subscription) -> bool:
        handlers = self._subscribers.get(subscription.event_type)
        if not handlers:
            return False
        before = len(handlers)
        new_handlers = [(t, h) for (t, h) in handlers if t != subscription.token]
        self._subscribers[subscription.event_type] = new_handlers
        removed = len(new_handlers) != before
        if removed:
            logger.info(
                "event_unsubscribe",
                extra={
                    "event_type": subscription.event_type,
                    "token": subscription.token,
                },
            )
        return removed

    def subscriber_count(self, event_type: str) -> int:
        return len(self._subscribers.get(event_type, []))

    # -- publishing ------------------------------------------------------------
    async def publish(
        self,
        event: DomainEvent | EventEnvelope[Any],
        *,
        source: str = "",
        correlation_id: str | None = None,
        causation_id: str | None = None,
    ) -> PublishResult:
        envelope = (
            event
            if isinstance(event, EventEnvelope)
            else EventEnvelope.wrap(
                event, source=source, correlation_id=correlation_id, causation_id=causation_id
            )
        )

        # Acquire the bus lock to serialize this publish against others, unless
        # the current task already holds it (a handler publishing a follow-up
        # event on the same task). The lock is held for the full dispatch so a
        # handler's awaits cannot interleave with another publish.
        task = asyncio.current_task()
        acquired = False
        if self._lock_holder is not task:
            await self._lock.acquire()
            self._lock_holder = task
            acquired = True

        try:
            result = await self._dispatch(envelope)
        finally:
            if acquired:
                self._lock_holder = None
                self._lock.release()
        return result

    async def _dispatch(self, envelope: EventEnvelope[Any]) -> PublishResult:
        # Freeze the subscriber list at publish time so a handler that
        # (un)subscribes mid-dispatch does not affect the current delivery.
        handlers = list(self._subscribers.get(envelope.event_type, []))
        errors: list[HandlerError] = []
        for _, handler in handlers:
            try:
                result = handler(envelope)
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:  # noqa: BLE001 — intentionally isolated
                err = HandlerError(
                    handler_name=_handler_name(handler),
                    event_id=str(envelope.event_id),
                    event_type=envelope.event_type,
                    exception_type=type(exc).__name__,
                    message=_safe_message(exc),
                )
                errors.append(err)
                logger.warning(
                    "event_handler_error",
                    extra={
                        "event_id": str(envelope.event_id),
                        "event_type": envelope.event_type,
                        "handler": err.handler_name,
                        "exception_type": err.exception_type,
                    },
                    exc_info=True,
                )
        result = PublishResult(envelope=envelope, delivered_to=len(handlers), errors=tuple(errors))
        logger.debug(
            "event_published",
            extra={
                "event_id": str(envelope.event_id),
                "event_type": envelope.event_type,
                "source": envelope.source,
                "correlation_id": envelope.correlation_id,
                "delivered_to": len(handlers),
                "errors": len(errors),
            },
        )
        return result


# ---- helpers -----------------------------------------------------------------
def _handler_name(handler: AnyHandler) -> str:
    return getattr(handler, "__qualname__", repr(handler))[:128]


def _safe_message(exc: Exception) -> str:
    """Return a concise, non-sensitive exception representation.

    We intentionally include only type + a bounded message, avoiding argument
    echoes (which may contain account/order payloads). Never include secrets.
    """
    text = str(exc)
    return text[:200]
