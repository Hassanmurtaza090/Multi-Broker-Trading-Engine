"""Centralized settings loading (M12) — environment-driven via pydantic-settings.

`backend/config` is the documented place for settings loading
(ARCHITECTURE.md). Values come from the environment and the local `.env`
(never committed). Secrets are placeholders in `.env.example` only; nothing
here logs any secret value.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- application ---------------------------------------------------------
    app_env: str = "development"

    # --- API / CORS ------------------------------------------------------------
    # Comma-separated explicit origins (never "*" — see app.py CORS notes).
    api_origins: str = ""

    # --- auth (M12) --------------------------------------------------------------
    # Empty `jwt_secret_key` is legal ONLY for local development: the process
    # then generates an EPHEMERAL random secret at startup (never logged,
    # never persisted) — all sessions die with the process. Production MUST
    # set a real secret via the environment.
    jwt_secret_key: str = ""
    jwt_access_token_expire_minutes: int = 60
    jwt_refresh_token_expire_minutes: int = 10080
    # JSON users file (records with PBKDF2 password hashes; see
    # scripts/hash_password.py). Gitignored; never commit user files.
    auth_users_file: str = ""
    # Explicitly provisioned demo users (dev convenience): passwords come
    # from the environment (the developer's gitignored .env), are hashed at
    # startup, and are never stored or logged raw.
    auth_demo_trader_username: str = "trader"
    auth_demo_trader_password: str = ""
    auth_demo_trader_accounts: str = "ACC-001"
    auth_demo_admin_username: str = "admin"
    auth_demo_admin_password: str = ""
    auth_demo_admin_accounts: str = "*"


def split_csv(value: str) -> list[str]:
    """Split a comma-separated env value into trimmed, non-empty parts."""
    return [part.strip() for part in value.split(",") if part.strip()]
