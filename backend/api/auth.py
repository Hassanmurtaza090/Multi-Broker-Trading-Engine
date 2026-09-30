"""Authentication service + routes (M12) — the ONLY way credentials enter.

Identity sources (ADR-018):
- A JSON users file (`AUTH_USERS_FILE`): records with PBKDF2 password hashes
  (see `scripts/hash_password.py`). Never commit user files; hashes only.
- Explicitly provisioned records (dev bootstrap / tests) — hashed passwords
  passed in; raw passwords never stored anywhere.

Session/token lifecycle is delegated to `TokenService`. Login failures are
indistinguishable (unknown user vs wrong password: same 401, same KDF cost)
to resist user enumeration. Audit events (identifiers only, never
credentials) are structured-logged for FR-012/TS-009.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from api.passwords import hash_password, verify_dummy, verify_password
from api.schemas import (
    LoginIn,
    RefreshIn,
    TokenPairOut,
    UserOut,
    WsTicketOut,
)
from api.security import (
    ALL_ACCOUNTS,
    VALID_ROLES,
    ApiUnauthorizedError,
    Principal,
    get_current_principal,
)
from api.tokens import TokenError, TokenService

logger = logging.getLogger("mtbe.api.auth")

# Annotated dependency (avoids B008); mirrors the rest-router pattern.
PrincipalDep = Annotated[Principal, Depends(get_current_principal)]

# --- user directory ----------------------------------------------------------------


@dataclass(frozen=True)
class UserRecord:
    """One provisioned user. `password_hash` is a PBKDF2 hash string."""

    username: str
    password_hash: str
    roles: frozenset[str]
    accounts: frozenset[str]


class UserDirectory:
    """In-memory identity store (persistence: infrastructure milestone)."""

    def __init__(self, records: list[UserRecord]) -> None:
        seen: set[str] = set()
        for record in records:
            if not record.username or record.username in seen:
                raise ValueError(f"invalid or duplicate username: {record.username!r}")
            seen.add(record.username)
            unknown_roles = record.roles - VALID_ROLES
            if unknown_roles:
                raise ValueError(f"user {record.username}: unknown roles {sorted(unknown_roles)}")
            if not record.accounts:
                raise ValueError(f"user {record.username}: no accounts configured")
            is_admin = "admin" in record.roles
            if not is_admin and ALL_ACCOUNTS in record.accounts:
                # Least privilege: the wildcard is reserved for admins.
                raise ValueError(f"user {record.username}: wildcard accounts require admin role")
        self._users: dict[str, UserRecord] = {r.username: r for r in records}

    @classmethod
    def from_records(cls, raw: list[dict[str, Any]]) -> UserDirectory:
        records: list[UserRecord] = []
        for entry in raw:
            username = entry.get("username")
            password_hash = entry.get("password_hash")
            roles = entry.get("roles", [])
            accounts = entry.get("accounts", [])
            if not isinstance(username, str) or not isinstance(password_hash, str):
                raise ValueError("user record needs string 'username' and 'password_hash'")
            if not isinstance(roles, list) or not all(isinstance(r, str) for r in roles):
                raise ValueError(f"user {username}: 'roles' must be a list of strings")
            if not isinstance(accounts, list) or not all(isinstance(a, str) for a in accounts):
                raise ValueError(f"user {username}: 'accounts' must be a list of strings")
            records.append(
                UserRecord(
                    username=username,
                    password_hash=password_hash,
                    roles=frozenset(roles),
                    accounts=frozenset(accounts),
                )
            )
        return cls(records)

    @classmethod
    def from_json_file(cls, path: str | Path) -> UserDirectory:
        """Load users from a JSON file (hashed passwords only)."""
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            raise ValueError(f"{path}: expected a JSON list of user records")
        return cls.from_records(raw)

    def find(self, username: str) -> UserRecord | None:
        return self._users.get(username)

    def __len__(self) -> int:
        return len(self._users)


def demo_record(
    username: str,
    password: str,
    *,
    roles: list[str],
    accounts: list[str],
) -> UserRecord:
    """Provision a user from a raw password (dev bootstrap / tests only)."""
    return UserRecord(
        username=username,
        password_hash=hash_password(password),
        roles=frozenset(roles),
        accounts=frozenset(accounts),
    )


# --- service ------------------------------------------------------------------------


@dataclass(frozen=True)
class IssuedCredentials:
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_in: int
    principal: Principal


class AuthService:
    """Login / refresh / logout orchestration over `TokenService`."""

    tokens: TokenService  # public: the app installs it for the auth dependency

    def __init__(self, tokens: TokenService, users: UserDirectory) -> None:
        self.tokens = tokens
        self.users = users

    # -- login ---------------------------------------------------------------

    def authenticate(self, username: str, password: str) -> UserRecord | None:
        """Verify credentials; None on any failure (constant-cost either way)."""
        user = self.users.find(username)
        if user is None:
            verify_dummy(password)  # equal KDF cost for unknown users
            logger.info(
                "auth_login_failed",
                extra={"operation": "auth.login", "reason": "unknown_user"},
            )
            return None
        if not verify_password(password, user.password_hash):
            logger.info(
                "auth_login_failed",
                extra={"operation": "auth.login", "reason": "bad_password"},
            )
            return None
        logger.info(
            "auth_login_success",
            extra={"operation": "auth.login", "subject": user.username},
        )
        return user

    def login(self, username: str, password: str) -> IssuedCredentials | None:
        user = self.authenticate(username, password)
        if user is None:
            return None
        return self._issue(user)

    def _issue(self, user: UserRecord) -> IssuedCredentials:
        refresh, sid, refresh_expires = self.tokens.create_session(
            subject=user.username, roles=user.roles, accounts=user.accounts
        )
        access, expires_in = self.tokens.issue_access(
            subject=user.username, roles=user.roles, accounts=user.accounts, sid=sid
        )
        return IssuedCredentials(
            access_token=access,
            expires_in=expires_in,
            refresh_token=refresh,
            refresh_expires_in=refresh_expires,
            principal=Principal.of(user.username, roles=user.roles, accounts=user.accounts),
        )

    # -- refresh / logout --------------------------------------------------------

    def refresh(self, refresh_token: str) -> IssuedCredentials:
        """Rotate a refresh token into a fresh credential pair.

        The claims come from the SERVER-side session (roles/scope cannot be
        altered by the client), never from the presented token.
        """
        try:
            claims, new_refresh, refresh_expires = self.tokens.rotate_refresh(refresh_token)
        except TokenError as exc:
            logger.info(
                "auth_refresh_failed",
                extra={"operation": "auth.refresh", "reason": "invalid_token"},
            )
            raise ApiUnauthorizedError() from exc
        access, expires_in = self.tokens.issue_access(
            subject=claims.subject,
            roles=claims.roles,
            accounts=claims.accounts,
            sid=claims.sid,
        )
        logger.info(
            "auth_refresh_success",
            extra={"operation": "auth.refresh", "subject": claims.subject},
        )
        return IssuedCredentials(
            access_token=access,
            expires_in=expires_in,
            refresh_token=new_refresh,
            refresh_expires_in=refresh_expires,
            principal=Principal.of(claims.subject, roles=claims.roles, accounts=claims.accounts),
        )

    def logout(self, refresh_token: str) -> None:
        """Revoke the session (best-effort: an unknown token is a no-op)."""
        try:
            self.tokens.revoke_session_by_refresh(refresh_token)
        except TokenError:
            pass  # logout with an invalid token must not leak validity


# --- request handlers -----------------------------------------------------------------


def principal_to_user_out(principal: Principal) -> UserOut:
    return UserOut(
        subject=principal.subject,
        roles=sorted(principal.roles),
        accounts=sorted(principal.accounts),
        permissions=sorted(principal.permissions),
    )


def credentials_to_out(issued: IssuedCredentials) -> TokenPairOut:
    return TokenPairOut(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        refresh_token=issued.refresh_token,
        refresh_expires_in=issued.refresh_expires_in,
        user=principal_to_user_out(issued.principal),
    )


# Public routes — no authentication dependency (login/refresh are how you GET one).
public_auth_router = APIRouter(prefix="/api/v1/auth")


@public_auth_router.post("/login", response_model=TokenPairOut, tags=["auth"])
async def login(body: LoginIn, request: Request) -> TokenPairOut:
    service: AuthService = request.app.state.auth
    issued = service.login(body.username, body.password)
    if issued is None:
        # One generic 401 for every failure mode (no user enumeration).
        raise ApiUnauthorizedError("invalid credentials")
    return credentials_to_out(issued)


@public_auth_router.post("/refresh", response_model=TokenPairOut, tags=["auth"])
async def refresh(body: RefreshIn, request: Request) -> TokenPairOut:
    service: AuthService = request.app.state.auth
    return credentials_to_out(service.refresh(body.refresh_token))


# Protected routes — require a valid access token.
protected_auth_router = APIRouter(
    prefix="/api/v1/auth",
    dependencies=[Depends(get_current_principal)],
)


@protected_auth_router.post("/logout", status_code=204, tags=["auth"])
async def logout(body: RefreshIn, request: Request) -> None:
    service: AuthService = request.app.state.auth
    service.logout(body.refresh_token)


@protected_auth_router.get("/me", response_model=UserOut, tags=["auth"])
async def me(principal: PrincipalDep) -> UserOut:
    return principal_to_user_out(principal)


@protected_auth_router.post("/ws-ticket", response_model=WsTicketOut, tags=["auth"])
async def ws_ticket(request: Request, principal: PrincipalDep) -> WsTicketOut:
    """Single-use, short-lived ticket for one WebSocket connection.

    Browsers cannot set Authorization headers on WS, so the terminal
    exchanges its access token for this ticket over REST; the ticket is
    consumed at connect time and is useless for replay. A REST session NEVER
    implies unrestricted stream access: the WS endpoint re-checks the
    principal's account scope against the runtime's bound account.
    """
    service: AuthService = request.app.state.auth
    ticket, expires_in = service.tokens.issue_ws_ticket(principal.subject)
    return WsTicketOut(ticket=ticket, expires_in=expires_in)


__all__ = [
    "AuthService",
    "IssuedCredentials",
    "UserDirectory",
    "UserRecord",
    "demo_record",
    "principal_to_user_out",
    "public_auth_router",
    "protected_auth_router",
]
