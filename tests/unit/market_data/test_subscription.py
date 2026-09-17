"""Unit tests for SubscriptionManager."""

from __future__ import annotations

import asyncio

from market_data import SubscriptionManager


class TestSubscriptionManager:
    def test_subscribe_opens_feed_on_first_reference(self, aapl, sim_feed):
        mgr = SubscriptionManager()
        first = asyncio.run(mgr.subscribe(aapl, sim_feed))
        assert first is True
        assert sim_feed.subscribed == [aapl.primary_identifier]
        assert mgr.is_subscribed(aapl) is True

    def test_subscribe_idempotent_on_repeat(self, aapl, sim_feed):
        mgr = SubscriptionManager()
        asyncio.run(mgr.subscribe(aapl, sim_feed))
        again = asyncio.run(mgr.subscribe(aapl, sim_feed))
        assert again is False
        # Feed subscription opened only once despite two references.
        assert sim_feed.subscribed == [aapl.primary_identifier]
        assert mgr.reference_count(aapl) == 2

    def test_unsubscribe_last_reference_cancels_feed(self, aapl, sim_feed):
        mgr = SubscriptionManager()
        asyncio.run(mgr.subscribe(aapl, sim_feed))
        removed = asyncio.run(mgr.unsubscribe(aapl, sim_feed))
        assert removed is True
        assert sim_feed.subscribed == []
        assert mgr.is_subscribed(aapl) is False

    def test_unsubscribe_keeps_feed_when_references_remain(self, aapl, sim_feed):
        mgr = SubscriptionManager()
        asyncio.run(mgr.subscribe(aapl, sim_feed))
        asyncio.run(mgr.subscribe(aapl, sim_feed))
        removed = asyncio.run(mgr.unsubscribe(aapl, sim_feed))
        assert removed is False  # one reference remains -> feed stays
        assert sim_feed.subscribed == [aapl.primary_identifier]
        assert mgr.reference_count(aapl) == 1

    def test_unsubscribe_unknown_instrument_false(self, aapl, tsla, sim_feed):
        mgr = SubscriptionManager()
        asyncio.run(mgr.subscribe(aapl, sim_feed))
        removed = asyncio.run(mgr.unsubscribe(tsla, sim_feed))
        assert removed is False

    def test_distinct_instruments_independent(self, aapl, tsla, sim_feed):
        mgr = SubscriptionManager()
        asyncio.run(mgr.subscribe(aapl, sim_feed))
        asyncio.run(mgr.subscribe(tsla, sim_feed))
        assert set(sim_feed.subscribed) == {aapl.primary_identifier, tsla.primary_identifier}
        assert mgr.active_keys() == (aapl.primary_identifier, tsla.primary_identifier)