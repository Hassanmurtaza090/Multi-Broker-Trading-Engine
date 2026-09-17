"""Subscription manager: tracks active feed subscriptions per instrument.

Keeps the market-data engine idempotent: subscribing to an instrument that is
already subscribed is a no-op against the underlying feed, and unsubscribing
only detaches when there are no remaining references. Keyed by the instrument's
`primary_identifier` (exchange:symbol).
"""

from __future__ import annotations

import logging

from brokers.base import FeedSubscription, MarketDataFeed
from domain.instrument import Instrument

logger = logging.getLogger("mtbe.market_data")


class SubscriptionManager:
    """Owns the set of active feed subscriptions keyed by instrument key."""

    def __init__(self) -> None:
        # instrument key -> (FeedSubscription | None, active feed reference count)
        self._subs: dict[str, tuple[FeedSubscription | None, int]] = {}

    @staticmethod
    def _key(instrument: Instrument) -> str:
        return instrument.primary_identifier

    def is_subscribed(self, instrument: Instrument) -> bool:
        return self._key(instrument) in self._subs

    def active_keys(self) -> tuple[str, ...]:
        """Keys of instruments with at least one subscription reference."""
        return tuple(k for k, (_, refs) in self._subs.items() if refs > 0)

    def reference_count(self, instrument: Instrument) -> int:
        entry = self._subs.get(self._key(instrument))
        return entry[1] if entry else 0

    async def subscribe(self, instrument: Instrument, feed: MarketDataFeed) -> bool:
        """Register a subscription for `instrument`.

        Returns `True` when a new feed subscription was opened (first
        reference), `False` when it was already subscribed (idempotent no-op).
        """
        key = self._key(instrument)
        entry = self._subs.get(key)
        if entry is not None:
            sub, refs = entry
            self._subs[key] = (sub, refs + 1)
            return False
        sub = await feed.subscribe(instrument)
        self._subs[key] = (sub, 1)
        logger.info(
            "market_subscribe",
            extra={"instrument": key, "event_type": "market.subscribe"},
        )
        return True

    async def unsubscribe(self, instrument: Instrument, feed: MarketDataFeed) -> bool:
        """Remove one subscription reference for `instrument`.

        Returns `True` when the last reference was removed (feed subscription
        cancelled), `False` when there was no active subscription or references
        remain.
        """
        key = self._key(instrument)
        entry = self._subs.get(key)
        if entry is None:
            return False
        sub, refs = entry
        if refs > 1:
            self._subs[key] = (sub, refs - 1)
            return False
        if sub is not None:
            await feed.unsubscribe(sub)
        del self._subs[key]
        logger.info(
            "market_unsubscribe",
            extra={"instrument": key, "event_type": "market.unsubscribe"},
        )
        return True

    async def cancel_all(self, feed: MarketDataFeed) -> None:
        """Cancel every active feed subscription and clear bookkeeping.

        Used during graceful shutdown so the underlying feed detaches all
        subscriptions before `feed.stop()`.
        """
        subs = [sub for sub, _ in self._subs.values() if sub is not None]
        for sub in subs:
            await feed.unsubscribe(sub)
        self._subs.clear()

    def __len__(self) -> int:
        return len(self._subs)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"SubscriptionManager({len(self._subs)} active)"
