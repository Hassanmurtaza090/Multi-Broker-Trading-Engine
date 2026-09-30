"""Unit tests — TokenService (M12): access JWTs, rotating refresh sessions,
and single-use WS tickets. The clock is injectable for deterministic expiry."""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jwt as pyjwt
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api.tokens import ALGORITHM, TokenError, TokenService

SECRET = "unit-test-signing-secret-0123456789abcdef"  # ≥32 bytes (RFC 7518)
OTHER_SECRET = "a-completely-different-secret-0123456789"


class FakeClock:
    """Mutable UTC clock for deterministic issuance/expiry tests.

    NOTE: access-token expiry is validated by PyJWT against the REAL system
    clock, so expiry tests REWIND the clock before issuance (tokens are then
    already expired in real time). Session/ticket expiry is service-local
    and uses this clock directly.
    """

    def __init__(self) -> None:
        self.now = datetime.now(UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)

    def rewind(self, **kwargs) -> None:
        self.now -= timedelta(**kwargs)


def make_service(clock: FakeClock | None = None, **overrides) -> TokenService:
    return TokenService(secret_key=SECRET, clock=clock or FakeClock(), **overrides)


def login_trio(service: TokenService, subject: str = "alice"):
    roles = frozenset({"trader"})
    accounts = frozenset({"ACC-001"})
    refresh, sid, _ = service.create_session(subject=subject, roles=roles, accounts=accounts)
    access, _ = service.issue_access(
        subject=subject, roles=roles, accounts=accounts, sid=sid
    )
    return access, refresh, sid


class TestAccessTokens:
    def test_round_trip_claims(self):
        service = make_service()
        access, _, sid = login_trio(service)
        claims = service.validate_access(access)
        assert claims.subject == "alice"
        assert claims.roles == frozenset({"trader"})
        assert claims.accounts == frozenset({"ACC-001"})
        assert claims.sid == sid

    def test_expired_token_rejected(self):
        clock = FakeClock()
        service = make_service(clock, access_ttl=timedelta(minutes=1))
        clock.rewind(minutes=10)  # issued in the past → already expired NOW
        access, _, _ = login_trio(service)
        with pytest.raises(TokenError):
            service.validate_access(access)

    def test_tampered_token_rejected(self):
        service = make_service()
        access, _, _ = login_trio(service)
        with pytest.raises(TokenError):
            service.validate_access(access[:-2] + ("AA" if access[-2:] != "AA" else "BB"))

    def test_wrong_signature_rejected(self):
        service = make_service()
        access, _, _ = login_trio(service)
        forged = pyjwt.encode(
            {"sub": "mallory", "roles": ["admin"], "accounts": ["*"],
             "sid": "x", "exp": 9999999999, "iat": 1, "typ": "access"},
            OTHER_SECRET,
            algorithm=ALGORITHM,
        )
        with pytest.raises(TokenError):
            service.validate_access(forged)

    def test_garbage_and_wrong_type_rejected(self):
        service = make_service()
        for bad in ["", "not-a-token", "rt_opaque_refresh_value"]:
            with pytest.raises(TokenError):
                service.validate_access(bad)
        # A well-signed token WITHOUT typ=access (e.g. hand-crafted) fails.
        clock = FakeClock()
        forged = pyjwt.encode(
            {"iss": "mtbe", "sub": "mallory", "exp": 9999999999, "iat": 1},
            SECRET,
            algorithm=ALGORITHM,
        )
        with pytest.raises(TokenError):
            make_service(clock).validate_access(forged)

    def test_wrong_issuer_rejected(self):
        service = make_service()
        forged = pyjwt.encode(
            {"iss": "evil", "sub": "mallory", "exp": 9999999999,
             "iat": 1, "typ": "access", "sid": "s"},
            SECRET,
            algorithm=ALGORITHM,
        )
        with pytest.raises(TokenError):
            service.validate_access(forged)


class TestRefreshSessions:
    def test_rotation_issues_new_pair_and_kills_old(self):
        service = make_service()
        _, refresh, sid = login_trio(service)
        claims, new_refresh, _ = service.rotate_refresh(refresh)
        assert claims.sid == sid
        assert new_refresh != refresh
        # The OLD token is superseded: presenting it revokes the session.
        with pytest.raises(TokenError):
            service.rotate_refresh(refresh)
        # And the NEW token is now dead too (session revoked on theft).
        with pytest.raises(TokenError):
            service.rotate_refresh(new_refresh)

    def test_reuse_detection_revokes_entire_session(self):
        service = make_service()
        _, first, _ = login_trio(service)
        _, second, _ = service.rotate_refresh(first)
        # Replay `first` (already used) -> theft response: revoke everything.
        with pytest.raises(TokenError):
            service.rotate_refresh(first)
        with pytest.raises(TokenError):
            service.rotate_refresh(second)

    def test_logout_revokes_session(self):
        service = make_service()
        _, refresh, _ = login_trio(service)
        service.revoke_session_by_refresh(refresh)
        with pytest.raises(TokenError):
            service.rotate_refresh(refresh)

    def test_session_expiry(self):
        clock = FakeClock()
        service = make_service(clock, refresh_ttl=timedelta(hours=1))
        _, refresh, _ = login_trio(service)
        clock.advance(hours=2)
        with pytest.raises(TokenError):
            service.rotate_refresh(refresh)

    def test_unknown_refresh_token_rejected(self):
        service = make_service()
        with pytest.raises(TokenError):
            service.rotate_refresh("rt_unknown_token_value")

    def test_access_token_outlives_logout_until_expiry(self):
        # Documented model: access JWTs are short-lived and NOT denylisted;
        # revocation kills the session (no renewal), not the live access.
        clock = FakeClock()
        service = make_service(clock, access_ttl=timedelta(minutes=1))
        access, refresh, _ = login_trio(service)
        service.revoke_session_by_refresh(refresh)
        assert service.validate_access(access).subject == "alice"
        with pytest.raises(TokenError):
            service.rotate_refresh(refresh)


class TestWsTickets:
    def test_single_use(self):
        service = make_service()
        ticket, ttl = service.issue_ws_ticket("alice")
        assert ttl == 30
        assert service.consume_ws_ticket(ticket) == "alice"
        assert service.consume_ws_ticket(ticket) is None  # replay-proof

    def test_expiry(self):
        clock = FakeClock()
        service = make_service(clock)
        ticket, _ = service.issue_ws_ticket("alice")
        clock.advance(seconds=31)
        assert service.consume_ws_ticket(ticket) is None

    def test_unknown_ticket(self):
        service = make_service()
        assert service.consume_ws_ticket("wst_forged") is None
        assert service.consume_ws_ticket("") is None


class TestConfigValidation:
    def test_empty_secret_rejected(self):
        with pytest.raises(ValueError):
            TokenService(secret_key="")

    def test_short_secret_rejected(self):
        with pytest.raises(ValueError, match="32 bytes"):
            TokenService(secret_key="too-short-key")

    def test_nonpositive_access_ttl_rejected(self):
        with pytest.raises(ValueError):
            TokenService(secret_key=SECRET, access_ttl=timedelta(0))

    def test_refresh_shorter_than_access_rejected(self):
        with pytest.raises(ValueError):
            TokenService(
                secret_key=SECRET,
                access_ttl=timedelta(hours=2),
                refresh_ttl=timedelta(hours=1),
            )
