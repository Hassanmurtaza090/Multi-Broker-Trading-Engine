#!/usr/bin/env python
"""Generate a PBKDF2 password hash for the M12 users file.

Usage:
    python scripts/hash_password.py            # prompts for the password
    python scripts/hash_password.py <password> # argv (careful: shell history)

Paste the printed record into your AUTH_USERS_FILE (never committed):

    [
      {
        "username": "alice",
        "password_hash": "pbkdf2_sha256$...",
        "roles": ["trader"],
        "accounts": ["ACC-001"]
      }
    ]
"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from api.passwords import hash_password  # noqa: E402


def main() -> None:
    if len(sys.argv) > 1:
        password = sys.argv[1]
    else:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm : ")
        if password != confirm:
            print("passwords do not match", file=sys.stderr)
            raise SystemExit(1)
    if not password:
        print("password must not be empty", file=sys.stderr)
        raise SystemExit(1)
    print(hash_password(password))


if __name__ == "__main__":
    main()
