"""Stale-data detection (TS-007).

A quote/tick is considered **stale** when no market data has arrived for an
instrument within a configured maximum age. This lets consumers (risk, order
management) avoid acting on outdated prices. The reference clock is injectable
for deterministic tests; the default is the current UTC time.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from domain.instrument import Instrument

logger = logging.getLogger("mtbe.market_data")

Clock = Callable[[], datetime]


def _system_clock() -> datetime:
    return datetime.now(UTC)


class StalenessMonitor:
    """Tracks last-observed data time per instrument and flags staleness."""

    def __init__(
        self,
        max_age: timedelta,
        *,
        clock: Clock = _system_clock,
    ) -> None:
        if max_age <= timedelta(0):
            raise ValueError("max_age must be a positive duration")
        self._max_age = max_age
        self._clock = clock
        # instrument key -> last observed timestamp
        self._last_seen: dict[str, datetime] = {}
        # instrument key -> currently stale
        self._stale: set[str] = set()

    @staticmethod
    def _key(instrument: Instrument) -> str:
        return instrument.primary_identifier

    def record(self, instrument: Instrument, timestamp: datetime) -> None:
        """Record that fresh data for `instrument` arrived at `timestamp`."""
        if timestamp.tzinfo is None:
            raise ValueError("recorded timestamp must be timezone-aware")
        key = self._key(instrument)
        self._last_seen[key] = timestamp
        if key in self._stale:
            self._stale.discard(key)
            logger.info(
                "market_stale_clear",
                extra={"instrument": key, "event_type": "market.stale.clear"},
            )

    def last_seen(self, instrument: Instrument) -> datetime | None:
        entry = self._last_seen.get(self._key(instrument))
        return entry

    def age(self, instrument: Instrument) -> timedelta | None:
        last = self.last_seen(instrument)
        if last is None:
            return None
        return self._clock() - last

    def is_stale(self, instrument: Instrument) -> bool:
        """True if no data has been observed within `max_age`."""
        last = self.last_seen(instrument)
        if last is None:
            # Never observed -> conservatively stale.
            return True
        if self._clock() - last > self._max_age:
            key = self._key(instrument)
            if key not in self._stale:
                self._stale.add(key)
                logger.warning(
                    "market_stale",
                    extra={"instrument": key, "event_type": "market.stale"},
                )
            return True
        return False

    def reset(self) -> None:
        """Clear all tracked state (e.g. on reconnect/reset)."""
        self._last_seen.clear()
        self._stale.clear()
