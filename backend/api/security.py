"""API security hooks (M10 — placeholder for M12 Authentication & Authorization).

M10 exposes the HOOK, not the mechanism: every router depends on
`get_current_principal`, which currently admits an anonymous principal.
M12 replaces this dependency with real authentication (JWT/session) and
role-based authorization without touching the endpoints. No credentials or
secrets exist here.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Principal:
    """The authenticated caller (opaque to business logic)."""

    subject: str
    roles: frozenset[str] = field(default_factory=frozenset)


ANONYMOUS = Principal(subject="anonymous", roles=frozenset({"trader"}))


def get_current_principal() -> Principal:
    """Auth hook — returns the caller's principal.

    M10: admits the anonymous principal (development posture, documented in
    ADR-016). M12 swaps this implementation for real authentication.
    """
    return ANONYMOUS
