"""Login rate limiting (M14) — online password-guessing abuse protection.

The M12 deferral, now implemented: a sliding-window failure counter keyed by
(username, client IP).

- After `max_failures` failures within `window_seconds`, further login
  attempts for that key are refused with HTTP 429 (Retry-After), BEFORE any
  credential verification — a locked key stays locked even for the correct
  password (fail-closed: guessing cannot be resumed by alternating).
- A successful login clears the key's failures.
- The counter is in-memory with a lock (single-process deployment — same
  posture as the session store; distributed limiting arrives with external
  infrastructure).
- Clock is injectable for deterministic tests. No credentials are logged.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime, timedelta


def _system_clock() -> datetime:
    return datetime.now(UTC)


# Opportunistic housekeeping threshold: once the key table grows past this
# (e.g. credential-stuffing sprays of random usernames), expired keys are
# swept so memory stays bounded to the ACTIVE window.
_MAX_TRACKED_KEYS = 10_000


class LoginRateLimiter:
    """Sliding-window failure throttle for the login endpoint."""

    def __init__(
        self,
        *,
        max_failures: int = 5,
        window: timedelta = timedelta(seconds=60),
        clock: Callable[[], datetime] = _system_clock,
    ) -> None:
        if max_failures <= 0:
            raise ValueError("max_failures must be positive")
        self._max_failures = max_failures
        self._window = window
        self._clock = clock
        self._failures: dict[str, list[datetime]] = defaultdict(list)
        self._lock = threading.Lock()

    def _key(self, username: str, client_ip: str) -> str:
        return f"{username}|{client_ip}"

    def _prune(self, key: str, now: datetime) -> list[datetime]:
        cutoff = now - self._window
        return [t for t in self._failures.get(key, []) if t > cutoff]

    def _housekeep_if_large(self, now: datetime) -> None:
        """Bound the key table against random-username sprays: past the
        threshold, drop every key whose failures have all expired."""
        if len(self._failures) <= _MAX_TRACKED_KEYS:
            return
        cutoff = now - self._window
        for key in [k for k, ts in self._failures.items() if not any(t > cutoff for t in ts)]:
            self._failures.pop(key, None)

    def check(self, username: str, client_ip: str) -> float:
        """Seconds the key must wait before the next attempt; 0 = allowed."""
        key = self._key(username, client_ip)
        with self._lock:
            now = self._clock()
            recent = self._prune(key, now)
            if recent:
                self._failures[key] = recent
            else:
                # No recent failures: drop the key so the table only holds
                # ACTIVE keys (bounded memory).
                self._failures.pop(key, None)
            if len(recent) < self._max_failures:
                return 0.0
            retry_after = (recent[0] + self._window - now).total_seconds()
            return max(retry_after, 0.0)

    def record_failure(self, username: str, client_ip: str) -> None:
        key = self._key(username, client_ip)
        with self._lock:
            now = self._clock()
            failures = self._prune(key, now)
            failures.append(now)
            self._failures[key] = failures
            self._housekeep_if_large(now)

    def record_success(self, username: str, client_ip: str) -> None:
        key = self._key(username, client_ip)
        with self._lock:
            self._failures.pop(key, None)
