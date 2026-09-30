"""Password hashing (M12) — stdlib PBKDF2-HMAC-SHA256, salted.

Format: ``pbkdf2_sha256$<iterations>$<salt_b64>``+$<hash_b64>``

- No external dependency (OWASP-listed parameters: 600k iterations SHA-256,
  16-byte salt, 32-byte derived key).
- Verification is constant-time (`hmac.compare_digest`).
- Raw passwords are never stored, logged, or returned.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

_ALGORITHM = "pbkdf2_sha256"
_DEFAULT_ITERATIONS = 600_000
_SALT_BYTES = 16
_DK_BYTES = 32


def hash_password(password: str, *, iterations: int = _DEFAULT_ITERATIONS) -> str:
    """Hash a password with a fresh random salt."""
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=_DK_BYTES
    )
    return "$".join(
        [
            _ALGORITHM,
            str(iterations),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(password: str, encoded: str) -> bool:
    """Verify a password against a stored hash (constant-time).

    Returns False for malformed stored hashes instead of raising — user
    records are configuration data, and a bad record must never crash the
    login path.
    """
    parts = encoded.split("$")
    if len(parts) != 4 or parts[0] != _ALGORITHM:
        return False
    try:
        iterations = int(parts[1])
        if iterations <= 0:
            return False
        salt = base64.b64decode(parts[2], validate=True)
        expected = base64.b64decode(parts[3], validate=True)
    except (ValueError, TypeError):
        return False
    if not salt or not expected:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=len(expected)
    )
    return hmac.compare_digest(candidate, expected)


# A fixed dummy hash so failed lookups (unknown user) burn the same KDF cost
# as failed verifications — reduces the user-enumeration timing signal.
_DUMMY_HASH = hash_password("not-a-real-password")


def verify_dummy(password: str) -> None:
    """Constant-cost dummy verification for unknown users."""
    verify_password(password, _DUMMY_HASH)
