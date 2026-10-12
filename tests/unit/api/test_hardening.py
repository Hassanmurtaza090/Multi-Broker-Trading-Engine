"""M14 unit tests — abuse/availability hardening primitives.

LoginRateLimiter (sliding-window, fail-closed), the WS-ticket per-subject
cap, and expired-session sweeping. Clocks are injectable for determinism."""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api.throttle import LoginRateLimiter
from api.tokens import (
    TokenService,
    WS_TICKET_MAX_PER_SUBJECT,
)


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)


SECRET = "unit-test-signing-secret-0123456789abcdef"


def make_service(clock: FakeClock, **overrides) -> TokenService:
    return TokenService(secret_key=SECRET, clock=clock, **overrides)


class TestLoginRateLimiter:
    def test_allows_up_to_limit_then_locks(self):
        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=3, window=timedelta(seconds=60), clock=clock)
        for i in range(3):
            assert limiter.check("alice", "1.2.3.4") == 0.0, i
            limiter.record_failure("alice", "1.2.3.4")
        # 4th attempt is locked out — even before any credential check.
        assert limiter.check("alice", "1.2.3.4") > 0.0

    def test_window_slides_old_failures_expire(self):
        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=3, window=timedelta(seconds=60), clock=clock)
        for _ in range(3):
            limiter.record_failure("alice", "1.2.3.4")
        assert limiter.check("alice", "1.2.3.4") > 0.0
        clock.advance(seconds=61)  # every failure is now outside the window
        assert limiter.check("alice", "1.2.3.4") == 0.0

    def test_retry_after_shrinks_with_time(self):
        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=2, window=timedelta(seconds=60), clock=clock)
        limiter.record_failure("alice", "1.2.3.4")
        limiter.record_failure("alice", "1.2.3.4")
        first = limiter.check("alice", "1.2.3.4")
        clock.advance(seconds=10)
        second = limiter.check("alice", "1.2.3.4")
        assert 0 < second < first <= 60

    def test_success_resets_the_key(self):
        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=3, window=timedelta(seconds=60), clock=clock)
        limiter.record_failure("alice", "1.2.3.4")
        limiter.record_failure("alice", "1.2.3.4")
        limiter.record_success("alice", "1.2.3.4")
        assert limiter.check("alice", "1.2.3.4") == 0.0

    def test_keys_are_isolated_per_username_and_ip(self):
        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=1, window=timedelta(seconds=60), clock=clock)
        limiter.record_failure("alice", "1.2.3.4")
        assert limiter.check("alice", "1.2.3.4") > 0.0
        # Same user, different source — not punished.
        assert limiter.check("alice", "5.6.7.8") == 0.0
        # Different user, same source — not punished (targeted guessing only).
        assert limiter.check("bob", "1.2.3.4") == 0.0

    def test_thread_safety_smoke(self):
        import threading

        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=500, window=timedelta(seconds=60), clock=clock)

        def hammer() -> None:
            for _ in range(200):
                limiter.check("u", "1.1.1.1")
                limiter.record_failure("u", "1.1.1.1")

        threads = [threading.Thread(target=hammer) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert limiter.check("u", "1.1.1.1") > 0.0  # locked: 800 failures ≥ 500

    def test_invalid_configuration_rejected(self):
        with pytest.raises(ValueError):
            LoginRateLimiter(max_failures=0)

    def test_stale_keys_do_not_accumulate(self):
        """M14 review finding: random-username sprays must not grow the key
        table without bound — keys with no in-window failures are dropped
        when touched, and a large table is swept opportunistically."""
        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=3, window=timedelta(seconds=60), clock=clock)
        for i in range(50):
            limiter.record_failure(f"user-{i}", "9.9.9.9")
        clock.advance(seconds=61)  # every failure expires
        for i in range(50):
            limiter.check(f"user-{i}", "9.9.9.9")
        assert len(limiter._failures) == 0  # noqa: SLF001 — white-box bound check

    def test_housekeeping_sweeps_when_table_is_large(self):
        import api.throttle as throttle_mod

        clock = FakeClock()
        limiter = LoginRateLimiter(max_failures=3, window=timedelta(seconds=60), clock=clock)
        original_cap = throttle_mod._MAX_TRACKED_KEYS
        throttle_mod._MAX_TRACKED_KEYS = 10  # tiny cap for the test
        try:
            for i in range(20):
                limiter.record_failure(f"spray-{i}", "9.9.9.9")
            clock.advance(seconds=61)
            limiter.record_failure("fresh-user", "9.9.9.9")  # triggers sweep
            # The expired spray keys were swept; only the fresh one remains.
            assert len(limiter._failures) == 1
        finally:
            throttle_mod._MAX_TRACKED_KEYS = original_cap


class TestWsTicketCap:
    def test_flooding_cannot_grow_the_registry_without_bound(self):
        service = make_service(FakeClock())
        tickets = [service.issue_ws_ticket("alice")[0] for _ in range(WS_TICKET_MAX_PER_SUBJECT + 5)]

        # The earliest tickets were evicted (single-use means a flood can only
        # harm the flooder itself — tickets no one consumed).
        for evicted in tickets[:5]:
            assert service.consume_ws_ticket(evicted) is None
        # The most recent tickets still work.
        subject = service.consume_ws_ticket(tickets[-1])
        assert subject == "alice"

    def test_cap_is_per_subject(self):
        service = make_service(FakeClock())
        alice_tickets = [service.issue_ws_ticket("alice")[0] for _ in range(WS_TICKET_MAX_PER_SUBJECT)]
        service.issue_ws_ticket("bob")  # other subject unaffected by alice's cap
        assert service.consume_ws_ticket(alice_tickets[0]) == "alice"

    def test_expired_tickets_are_evicted_on_issue(self):
        clock = FakeClock()
        service = make_service(clock)
        stale = service.issue_ws_ticket("alice")[0]
        clock.advance(seconds=31)
        fresh = service.issue_ws_ticket("alice")[0]
        assert service.consume_ws_ticket(stale) is None
        assert service.consume_ws_ticket(fresh) == "alice"


class TestSessionSweep:
    def test_sweep_removes_only_expired_sessions(self):
        clock = FakeClock()
        service = make_service(
            clock,
            access_ttl=timedelta(minutes=5),
            refresh_ttl=timedelta(minutes=10),
        )
        expired_refresh, _, _ = service.create_session(
            subject="old", roles=frozenset({"trader"}), accounts=frozenset({"ACC-001"})
        )
        clock.advance(minutes=11)
        live_refresh, _, _ = service.create_session(
            subject="new", roles=frozenset({"trader"}), accounts=frozenset({"ACC-001"})
        )

        swept = service.sweep_expired_sessions()
        assert swept == 1

        # The expired session is gone (its refresh token no longer works);
        # the live session is untouched.
        from api.tokens import TokenError

        with pytest.raises(TokenError):
            service.rotate_refresh(expired_refresh)
        claims, _new_refresh, _ = service.rotate_refresh(live_refresh)
        assert claims.subject == "new"

    def test_sweep_with_nothing_expired_is_a_noop(self):
        service = make_service(FakeClock())
        service.create_session(
            subject="a", roles=frozenset({"trader"}), accounts=frozenset({"ACC-001"})
        )
        assert service.sweep_expired_sessions() == 0
