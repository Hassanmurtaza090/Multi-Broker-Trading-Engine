"""Unit tests for StalenessMonitor (TS-007)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from market_data import StalenessMonitor


def make_clock(start: datetime):
    state = {"now": start}

    def clock() -> datetime:
        return state["now"]

    def advance(delta: timedelta) -> None:
        state["now"] = state["now"] + delta

    return clock, advance


class TestStalenessMonitor:
    def test_invalid_max_age_rejected(self):
        with pytest.raises(ValueError):
            StalenessMonitor(max_age=timedelta(0))

    def test_never_observed_is_stale(self, aapl):
        monitor = StalenessMonitor(max_age=timedelta(seconds=10))
        assert monitor.is_stale(aapl) is True
        assert monitor.last_seen(aapl) is None

    def test_fresh_data_not_stale(self, aapl):
        start = datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)
        clock, advance = make_clock(start)
        monitor = StalenessMonitor(max_age=timedelta(seconds=10), clock=clock)
        monitor.record(aapl, start)
        advance(timedelta(seconds=5))
        assert monitor.is_stale(aapl) is False
        assert monitor.age(aapl) == timedelta(seconds=5)

    def test_older_than_max_age_is_stale(self, aapl):
        start = datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)
        clock, advance = make_clock(start)
        monitor = StalenessMonitor(max_age=timedelta(seconds=10), clock=clock)
        monitor.record(aapl, start)
        advance(timedelta(seconds=11))
        assert monitor.is_stale(aapl) is True

    def test_fresh_data_clears_stale(self, aapl):
        start = datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)
        clock, advance = make_clock(start)
        monitor = StalenessMonitor(max_age=timedelta(seconds=10), clock=clock)
        monitor.record(aapl, start)
        advance(timedelta(seconds=11))
        assert monitor.is_stale(aapl) is True
        advance(timedelta(seconds=-5))  # back in time
        monitor.record(aapl, clock())
        assert monitor.is_stale(aapl) is False

    def test_naive_timestamp_rejected(self, aapl):
        monitor = StalenessMonitor(max_age=timedelta(seconds=10))
        with pytest.raises(ValueError):
            monitor.record(aapl, datetime(2025, 1, 2, 12, 0, 0))  # naive

    def test_reset_clears_state(self, aapl):
        start = datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)
        clock, _ = make_clock(start)
        monitor = StalenessMonitor(max_age=timedelta(seconds=10), clock=clock)
        monitor.record(aapl, start)
        monitor.reset()
        assert monitor.is_stale(aapl) is True
        assert monitor.last_seen(aapl) is None

    def test_instruments_tracked_independently(self, aapl, tsla):
        start = datetime(2025, 1, 2, 12, 0, 0, tzinfo=UTC)
        clock, advance = make_clock(start)
        monitor = StalenessMonitor(max_age=timedelta(seconds=10), clock=clock)
        monitor.record(aapl, start)
        advance(timedelta(seconds=20))
        monitor.record(tsla, clock())
        assert monitor.is_stale(aapl) is True
        assert monitor.is_stale(tsla) is False