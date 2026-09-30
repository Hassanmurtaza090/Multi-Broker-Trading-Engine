"""Unit tests — password hashing (M12)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api.passwords import hash_password, verify_dummy, verify_password


class TestPasswordHashing:
    def test_round_trip(self):
        encoded = hash_password("s3cret-Pass")
        assert encoded.startswith("pbkdf2_sha256$")
        assert verify_password("s3cret-Pass", encoded) is True

    def test_wrong_password_rejected(self):
        encoded = hash_password("s3cret-Pass")
        assert verify_password("s3cret-pass", encoded) is False
        assert verify_password("", encoded) is False

    def test_fresh_salt_per_hash(self):
        # Same password, two hashes: different salts, both verify.
        a = hash_password("same-password")
        b = hash_password("same-password")
        assert a != b
        assert verify_password("same-password", a)
        assert verify_password("same-password", b)

    def test_malformed_stored_hash_rejected(self):
        for bad in [
            "",
            "plain",
            "md5$1$abc$def",
            "pbkdf2_sha256$abc$def",  # too few fields
            "pbkdf2_sha256$not-a-number$c2FsdA==$aGFzaA==",
            "pbkdf2_sha256$0$c2FsdA==$aGFzaA==",
            "pbkdf2_sha256$-1$c2FsdA==$aGFzaA==",
            "pbkdf2_sha256$100$!!!notb64!!!$aGFzaA==",
            "pbkdf2_sha256$100$$aGFzaA==",  # empty salt
            "pbkdf2_sha256$100$c2FsdA==$",  # empty digest
        ]:
            assert verify_password("whatever", bad) is False, bad

    def test_hash_length_is_fixed(self):
        # 16-byte salt + 32-byte digest -> stable encoded length.
        a = hash_password("x")
        b = hash_password("y")
        assert len(a.split("$")) == 4
        assert len(a) == len(b)

    def test_verify_dummy_never_raises(self):
        verify_dummy("any-password")  # constant-cost path for unknown users
        verify_dummy("")
