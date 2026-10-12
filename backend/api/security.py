"""Identity & authorization model (M12) — the server-side security boundary.

- `Principal` is the authenticated caller: subject, roles, account scope, and
  the permissions derived from those roles.
- The RBAC matrix maps roles → permissions (`viewer` ⊂ `trader` ⊂ `admin`).
- Account scoping (`accounts`, with the admin-only `"*"` wildcard) is checked
  server-side on EVERY account-scoped resource, including order resources
  loaded by id (IDOR protection). The frontend's role-aware rendering is UX
  only — it is never a security boundary.
- `get_current_principal` is the router-wide authentication dependency; it
  validates the bearer access token via the app's `TokenService` and never
  admits an unauthenticated caller.

Credentials, tokens, and secrets are never logged here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from fastapi import Request

from api.tokens import TokenError

ALL_ACCOUNTS = "*"


class ApiUnauthorizedError(Exception):
    """401 — no session / invalid or expired token. Generic message only."""

    def __init__(self, message: str = "authentication required") -> None:
        super().__init__(message)
        self.message = message


class ApiForbiddenError(Exception):
    """403 — authenticated, but lacks the permission or the account scope."""

    def __init__(self, message: str = "insufficient permissions") -> None:
        super().__init__(message)
        self.message = message


class ApiRateLimitedError(Exception):
    """429 — abuse protection (e.g. login throttling). Generic message only."""

    def __init__(self, retry_after_seconds: float, message: str = "too many attempts") -> None:
        super().__init__(message)
        self.message = message
        self.retry_after_seconds = retry_after_seconds


# --- permissions -----------------------------------------------------------------

type Permission = Literal[
    "orders:read",
    "orders:write",
    "positions:read",
    "account:read",
    "market:read",
    "risk:read",
    "risk:admin",
    "brokers:read",
]

READ_PERMISSIONS: frozenset[Permission] = frozenset(
    {
        "orders:read",
        "positions:read",
        "account:read",
        "market:read",
        "risk:read",
        "brokers:read",
    }
)

ROLE_PERMISSIONS: dict[str, frozenset[Permission]] = {
    "viewer": READ_PERMISSIONS,
    "trader": READ_PERMISSIONS | {"orders:write"},
    "admin": READ_PERMISSIONS | {"orders:write", "risk:admin"},
}

VALID_ROLES = frozenset(ROLE_PERMISSIONS)


def permissions_for_roles(roles: frozenset[str]) -> frozenset[Permission]:
    """Union the permission sets of known roles; unknown roles grant nothing."""
    granted: set[Permission] = set()
    for role in roles:
        granted |= ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(granted)


# --- principal -------------------------------------------------------------------


@dataclass(frozen=True)
class Principal:
    """The authenticated caller (opaque to business logic)."""

    subject: str
    roles: frozenset[str] = field(default_factory=frozenset)
    accounts: frozenset[str] = field(default_factory=frozenset)
    permissions: frozenset[Permission] = field(default_factory=frozenset)

    @classmethod
    def of(
        cls,
        subject: str,
        *,
        roles: frozenset[str],
        accounts: frozenset[str],
    ) -> Principal:
        return cls(
            subject=subject,
            roles=frozenset(roles),
            accounts=frozenset(accounts),
            permissions=permissions_for_roles(frozenset(roles)),
        )

    def has_permission(self, permission: Permission) -> bool:
        return permission in self.permissions

    def can_access_account(self, account_id: str) -> bool:
        return ALL_ACCOUNTS in self.accounts or account_id in self.accounts

    def account_ids_visible(self) -> frozenset[str] | None:
        """Accounts the principal may see in listings; None = unrestricted."""
        if ALL_ACCOUNTS in self.accounts:
            return None
        return self.accounts


# --- enforcement helpers ------------------------------------------------------------


def require_permission(principal: Principal, permission: Permission) -> None:
    """Raise 403 unless the principal holds the permission."""
    if not principal.has_permission(permission):
        raise ApiForbiddenError(f"missing permission: {permission}")


def require_account_access(principal: Principal, account_id: str) -> None:
    """Raise 403 unless the account is in the principal's scope (IDOR guard)."""
    if not principal.can_access_account(account_id):
        raise ApiForbiddenError(f"no access to account {account_id}")


def require_resource_account(principal: Principal, resource_account_id: str) -> None:
    """Alias of `require_account_access` for loaded resources (orders etc.)."""
    require_account_access(principal, resource_account_id)


# --- authentication dependency ----------------------------------------------------------


def get_current_principal(request: Request) -> Principal:
    """Router-wide auth hook: validate the bearer access token.

    Reads the `Authorization: Bearer <token>` header and validates it via the
    app's `TokenService` (installed by `create_app` — there is no
    unauthenticated mode). Failure is always a generic 401: no distinction
    between missing, malformed, expired, or invalid tokens is exposed.
    """
    service = getattr(request.app.state, "auth", None)
    if service is None:  # pragma: no cover - create_app always installs auth
        raise ApiUnauthorizedError("authentication unavailable")
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiUnauthorizedError()
    try:
        claims = service.tokens.validate_access(token.strip())
    except TokenError as exc:
        raise ApiUnauthorizedError() from exc
    return Principal.of(
        claims.subject,
        roles=claims.roles,
        accounts=claims.accounts,
    )
