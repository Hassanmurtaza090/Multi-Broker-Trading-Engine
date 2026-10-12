"""Token & session service (M12) — the single authentication mechanism.

Model (ADR-018):
- **Access token**: stateless JWT (HS256), short-lived. Claims carry the
  principal identity (subject, roles, account scope) plus `sid` linking to
  the server-side session. Revocation is by short expiry only — a logged-out
  access token lives at most `access_ttl`.
- **Refresh token**: opaque 256-bit random value. ONLY its SHA-256 hash is
  stored server-side. Rotated on every refresh; the session remembers the
  superseded hash, so presenting an already-rotated token is treated as
  theft and revokes the whole session.
- **WS ticket**: opaque single-use ticket with a short TTL, exchanged over
  authenticated REST and consumed at WebSocket connect — keeps long-lived
  tokens out of URLs and makes each ticket useless after replay.

Clock is injectable for deterministic expiry tests. All state is in-memory;
persistence arrives with the infrastructure milestone (as everywhere else).
Secrets are never logged.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt as pyjwt
import jwt.exceptions

logger = logging.getLogger("mtbe.api.auth")

DEFAULT_ACCESS_TTL_MINUTES = 60
DEFAULT_REFRESH_TTL_MINUTES = 7 * 24 * 60  # 10080
WS_TICKET_TTL_SECONDS = 30
# Availability hardening (M14): a subject may hold at most this many
# unconsumed tickets — issuing beyond the cap evicts the oldest, so a
# flooding client cannot grow the registry without bound.
WS_TICKET_MAX_PER_SUBJECT = 10
ALGORITHM = "HS256"


def _system_clock() -> datetime:
    return datetime.now(UTC)


class TokenError(Exception):
    """Any invalid/expired/misused credential. The API maps it to 401."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Session:
    """Server-side state for one login session.

    `refresh_hash` is the CURRENT refresh token's hash; `superseded_hash`
    is the immediately-previous generation — kept solely for reuse
    (theft) detection. Both are hashes; raw tokens are never stored.
    """

    sid: str
    subject: str
    roles: frozenset[str]
    accounts: frozenset[str]
    refresh_hash: bytes
    superseded_hash: bytes | None
    expires_at: datetime


@dataclass(frozen=True)
class AccessClaims:
    subject: str
    roles: frozenset[str]
    accounts: frozenset[str]
    sid: str


class _RefreshReuseError(Exception):
    """Internal: a superseded refresh token was presented — revoke session."""

    def __init__(self, session: Session) -> None:
        super().__init__("refresh token reuse detected")
        self.session = session


class TokenService:
    """Issues and validates the three credential types."""

    def __init__(
        self,
        *,
        secret_key: str,
        issuer: str = "mtbe",
        access_ttl: timedelta = timedelta(minutes=DEFAULT_ACCESS_TTL_MINUTES),
        refresh_ttl: timedelta = timedelta(minutes=DEFAULT_REFRESH_TTL_MINUTES),
        clock: Callable[[], datetime] = _system_clock,
    ) -> None:
        # RFC 7518 §3.2: HMAC-SHA256 keys must be ≥ 32 bytes. Fail closed on
        # weak configuration instead of warning and proceeding.
        if not secret_key or len(secret_key.encode("utf-8")) < 32:
            raise ValueError("secret_key must be at least 32 bytes (RFC 7518)")
        if access_ttl <= timedelta(0):
            raise ValueError("access_ttl must be positive")
        if refresh_ttl < access_ttl:
            raise ValueError("refresh_ttl must be >= access_ttl")
        self._secret = secret_key.encode("utf-8")
        self._issuer = issuer
        self._access_ttl = access_ttl
        self._refresh_ttl = refresh_ttl
        self._clock = clock
        self._sessions: dict[str, Session] = {}
        self._ws_tickets: dict[str, tuple[str, datetime]] = {}  # ticket -> (subject, exp)

    # --- access tokens -------------------------------------------------------

    def issue_access(
        self, *, subject: str, roles: frozenset[str], accounts: frozenset[str], sid: str
    ) -> tuple[str, int]:
        now = self._clock()
        exp = now + self._access_ttl
        payload = {
            "iss": self._issuer,
            "sub": subject,
            "roles": sorted(roles),
            "accounts": sorted(accounts),
            "sid": sid,
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
            "jti": secrets.token_hex(8),
            "typ": "access",
        }
        token = pyjwt.encode(payload, self._secret, algorithm=ALGORITHM)
        return token, int(self._access_ttl.total_seconds())

    def validate_access(self, token: str) -> AccessClaims:
        """Validate a bearer token. Raises TokenError on any flaw."""
        try:
            claims: dict[str, Any] = pyjwt.decode(
                token,
                self._secret,
                algorithms=[ALGORITHM],  # pinned: algorithm confusion is impossible
                issuer=self._issuer,
                options={"require": ["exp", "iat", "sub", "typ"]},
            )
        except jwt.exceptions.PyJWTError as exc:
            raise TokenError("invalid or expired token") from exc
        if claims.get("typ") != "access":
            raise TokenError("wrong token type")
        subject = claims.get("sub")
        sid = claims.get("sid")
        if not isinstance(subject, str) or not subject or not isinstance(sid, str):
            raise TokenError("invalid token claims")
        roles = _as_str_set(claims.get("roles"))
        accounts = _as_str_set(claims.get("accounts"))
        return AccessClaims(subject=subject, roles=roles, accounts=accounts, sid=sid)

    # --- sessions & refresh tokens ---------------------------------------------

    def create_session(
        self, *, subject: str, roles: frozenset[str], accounts: frozenset[str]
    ) -> tuple[str, str, int]:
        """Start a login session: (refresh_token, sid, refresh_expires_in)."""
        sid = secrets.token_urlsafe(16)
        refresh = "rt_" + secrets.token_urlsafe(32)
        expires_at = self._clock() + self._refresh_ttl
        self._sessions[sid] = Session(
            sid=sid,
            subject=subject,
            roles=roles,
            accounts=accounts,
            refresh_hash=_sha256(refresh),
            superseded_hash=None,
            expires_at=expires_at,
        )
        return refresh, sid, int(self._refresh_ttl.total_seconds())

    def rotate_refresh(self, refresh_token: str) -> tuple[AccessClaims, str, int]:
        """Exchange a valid refresh token for new credentials.

        Returns (claims, new_refresh_token, refresh_expires_in). Presenting a
        token that was already used for a rotation revokes the entire session
        — the documented theft response.
        """
        try:
            session = self._session_by_refresh(refresh_token)
        except _RefreshReuseError as theft:
            self._drop_session(theft.session, reason="reuse")
            raise TokenError("invalid refresh token") from None
        new_refresh = "rt_" + secrets.token_urlsafe(32)
        self._sessions[session.sid] = Session(
            sid=session.sid,
            subject=session.subject,
            roles=session.roles,
            accounts=session.accounts,
            refresh_hash=_sha256(new_refresh),
            superseded_hash=session.refresh_hash,
            expires_at=session.expires_at,
        )
        access, _ = self.issue_access(
            subject=session.subject,
            roles=session.roles,
            accounts=session.accounts,
            sid=session.sid,
        )
        claims = AccessClaims(
            subject=session.subject,
            roles=session.roles,
            accounts=session.accounts,
            sid=session.sid,
        )
        return claims, new_refresh, int(self._refresh_ttl.total_seconds())

    def revoke_session_by_refresh(self, refresh_token: str) -> None:
        """Logout: destroy the session bound to this refresh token."""
        try:
            session = self._session_by_refresh(refresh_token)
        except _RefreshReuseError as theft:
            self._drop_session(theft.session, reason="reuse")
            return
        self._drop_session(session, reason="logout")

    def _session_by_refresh(self, refresh_token: str) -> Session:
        """Find the session for a refresh token; detect superseded reuse."""
        token_hash = _sha256(refresh_token)
        for session in self._sessions.values():
            if hmac.compare_digest(session.refresh_hash, token_hash):
                if self._clock() >= session.expires_at:
                    self._drop_session(session, reason="expired")
                    raise TokenError("session expired")
                return session
            if session.superseded_hash is not None and hmac.compare_digest(
                session.superseded_hash, token_hash
            ):
                raise _RefreshReuseError(session)
        raise TokenError("invalid refresh token")

    def _drop_session(self, session: Session, *, reason: str) -> None:
        self._sessions.pop(session.sid, None)
        logger.info(
            "auth_session_revoked",
            extra={
                "subject": session.subject,
                "operation": "auth.revoke",
                "reason": reason,
            },
        )

    # --- WS tickets -------------------------------------------------------------

    def issue_ws_ticket(self, subject: str) -> tuple[str, int]:
        ticket = "wst_" + secrets.token_urlsafe(24)
        expires = self._clock() + timedelta(seconds=WS_TICKET_TTL_SECONDS)
        self._evict_expired_ws_tickets()
        # Per-subject cap (M14): bounded memory; the oldest unconsumed ticket
        # is evicted when a client floods the endpoint. Tickets are
        # single-use and 30 s old at most — eviction only invalidates a
        # ticket the client was unlikely to still use.
        subject_tickets = [t for t, (s, _) in self._ws_tickets.items() if s == subject]
        while len(subject_tickets) >= WS_TICKET_MAX_PER_SUBJECT:
            oldest = min(subject_tickets, key=lambda t: self._ws_tickets[t][1])
            self._ws_tickets.pop(oldest, None)
            subject_tickets.remove(oldest)
        self._ws_tickets[ticket] = (subject, expires)
        return ticket, WS_TICKET_TTL_SECONDS

    def consume_ws_ticket(self, ticket: str) -> str | None:
        """Consume a ticket: single-use — a replayed ticket never validates."""
        entry = self._ws_tickets.pop(ticket, None)
        if entry is None:
            return None
        subject, expires = entry
        if self._clock() >= expires:
            return None
        return subject

    def _evict_expired_ws_tickets(self) -> None:
        now = self._clock()
        for ticket in [t for t, (_, exp) in self._ws_tickets.items() if exp <= now]:
            self._ws_tickets.pop(ticket, None)

    def session_count(self) -> int:
        """Gauge source for operational metrics (M15)."""
        return len(self._sessions)

    # --- housekeeping --------------------------------------------------------------

    def sweep_expired_sessions(self) -> int:
        """Remove sessions past their refresh expiry (M14 availability:
        without this, abandoned sessions linger until their token is next
        presented). Returns the number swept."""
        now = self._clock()
        expired = [s.sid for s in self._sessions.values() if s.expires_at <= now]
        for sid in expired:
            session = self._sessions.pop(sid, None)
            if session is not None:
                logger.info(
                    "auth_session_revoked",
                    extra={
                        "subject": session.subject,
                        "operation": "auth.sweep",
                        "reason": "expired",
                    },
                )
        return len(expired)


def _sha256(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


def _as_str_set(value: Any) -> frozenset[str]:
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return frozenset(value)
    return frozenset()
