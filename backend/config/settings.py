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
    # Enable the OpenAPI/docs endpoints (development tooling). Production
    # posture is OFF (M14): unauthenticated callers cannot enumerate the
    # API surface.
    api_docs_enabled: bool = False
    # Bind address for the dev/prod entrypoint. Inside a container use
    # 0.0.0.0 (the compose network is the isolation boundary); a bare-metal
    # dev run defaults to loopback.
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    # Log format for structured logs: "text" (dev) or "json" (production log
    # aggregation, M15). Level via LOG_LEVEL.
    log_format: str = "text"
    log_level: str = "INFO"

    # --- broker composition (M15) -------------------------------------------------
    # Which simulated adapter to bind (real transports deferred per
    # ADR-014/015) and the internal account the runtime serves.
    broker_adapter: str = "IBKR"
    broker_account: str = "ACC-001"
    # --- market data (M16) ----------------------------------------------------------
    # Startup-configured market subscriptions (the M10 API has no subscribe
    # endpoint — documented M11 limitation), format:
    #   SYMBOL|ASSET_CLASS|CURRENCY|EXCHANGE[|KEY=VALUE...]
    # e.g. "AAPL|EQUITY|USD|NASDAQ" or "AAPL|EQUITY|USD|NASDAQ|SAXO_UIC=211"
    # (the SAXO_UIC key=value pair rides the broker-neutral identifiers
    # field — ADR-015 — required by the Saxo adapter).
    market_subscriptions: str = ""
    # Simulated tick emitter interval (seconds; 0 = off). A SIMULATION-ONLY
    # knob (ADR-014/015): drives the simulated feed with a random-walk last
    # price so the live deployment exercises the full market-data path
    # (feed -> engine -> bus -> WS -> terminal). Production with real
    # transports never sets this.
    sim_tick_seconds: float = 0.0
    # Simulated auto-fill driver ("off" | "on"). SIMULATION-ONLY (paper
    # trading, ADR-014/015): after the simulated broker acks an order, a
    # delayed execution is driven through the REAL callback path (adapter
    # mapping -> OMS -> portfolio -> events -> WS). Conventions (only in
    # simulation mode): an idempotency key containing "PARTIAL" fills 40%
    # then the remainder; one containing "REJECT" gets a broker rejection.
    # Production with real transports never sets this.
    sim_auto_fill: bool = False
    sim_fill_delay_seconds: float = 1.5

    # --- persistence (M15) -------------------------------------------------------
    # "memory" (dev/tests) or "postgres" (production). The M4 OrderRepository
    # port chooses its implementation here; portfolio/auth state stays
    # in-memory BY DESIGN (ADR-013/ADR-020).
    order_repository: str = "memory"
    # SQLAlchemy async URL, e.g. postgresql+asyncpg://user:pass@host:5432/db
    database_url: str = ""

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
    # E2E isolation demo user: a trader scoped to a DIFFERENT account (the
    # cross-account scenarios). Same env-driven provisioning as above.
    auth_demo_outsider_username: str = "outsider"
    auth_demo_outsider_password: str = ""
    auth_demo_outsider_accounts: str = "ACC-OTHER"
    # Read-only demo user (E2E role-boundary scenarios): viewer role scoped
    # to the trading account.
    auth_demo_viewer_username: str = "viewer"
    auth_demo_viewer_password: str = ""
    auth_demo_viewer_accounts: str = "ACC-001"
    # Login rate limiting (M14): failures per username+IP within the window
    # before HTTP 429 with Retry-After (fail-closed: a locked key stays
    # locked even for the correct password until the window slides).
    auth_login_max_failures: int = 5
    auth_login_window_seconds: int = 60


def split_csv(value: str) -> list[str]:
    """Split a comma-separated env value into trimmed, non-empty parts."""
    return [part.strip() for part in value.split(",") if part.strip()]
