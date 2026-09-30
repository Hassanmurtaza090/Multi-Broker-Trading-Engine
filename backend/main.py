"""Backend entrypoint — the composition boundary (M10/M12).

Builds the engine runtime with broker adapters injected as ports and serves
the API gateway. For development this wires the SIMULATED broker adapters
(paper/sim mode; no live trading per the roadmap); production wiring selects
real transports via configuration when they arrive (ADR-014/ADR-015).

M12: authentication is MANDATORY. The identity sources are the JSON users
file (`AUTH_USERS_FILE`, hashed passwords only) and explicitly provisioned
demo users from the environment (dev convenience; hashed at startup). With
no configured users the server runs with ZERO users — nobody can log in —
rather than falling back to an insecure anonymous mode.

Run:  python main.py  (serves http://127.0.0.1:8000 — docs at /docs)
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from datetime import timedelta
from pathlib import Path

from api.auth import AuthService, UserDirectory, demo_record
from api.tokens import TokenService
from application.runtime import EngineRuntime
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from brokers.saxo import SaxoAdapter, SimulatedSaxoClient
from config.settings import Settings, split_csv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mtbe.main")

_HOST = "127.0.0.1"
_PORT = 8000
_DEFAULT_ACCOUNT = "ACC-001"


def build_simulated_runtime(
    broker: str = "IBKR", account_id: str = _DEFAULT_ACCOUNT
) -> tuple[EngineRuntime, IbkrAdapter | SaxoAdapter]:
    """Compose the engine with the simulated (paper) broker adapters.

    The composition boundary is the ONLY place concrete adapters are imported;
    the runtime and API depend solely on ports. A single adapter instance
    implements both the market-data feed and the execution broker, and it
    publishes on the runtime's bus (injected here).
    """
    from events import InProcessEventBus

    bus = InProcessEventBus()
    if broker.upper() == "IBKR":
        adapter: IbkrAdapter | SaxoAdapter = IbkrAdapter(
            SimulatedIbkrClient(), bus=bus, account_id=account_id, auto_drain=True
        )
    else:
        adapter = SaxoAdapter(
            SimulatedSaxoClient(), bus=bus, account_id=account_id, auto_drain=True
        )
    runtime = EngineRuntime(feed=adapter, broker=adapter, broker_name=broker.upper(), bus=bus)
    return runtime, adapter


def build_auth_service(settings: Settings) -> AuthService:
    """Build the identity layer. Never stores or logs raw passwords."""
    if settings.jwt_secret_key:
        secret = settings.jwt_secret_key
        source = "environment"
    else:
        # Ephemeral, process-local secret: no secret is ever committed or
        # logged, and every session dies with the process. Intended for the
        # local simulated stack; production sets JWT_SECRET_KEY.
        secret = secrets.token_urlsafe(48)
        source = "ephemeral"
        logger.warning(
            "auth_jwt_secret_ephemeral",
            extra={
                "operation": "auth.bootstrap",
                "note": "JWT_SECRET_KEY not set; generated ephemeral secret "
                "(sessions do not survive restarts)",
            },
        )
    tokens = TokenService(
        secret_key=secret,
        access_ttl=timedelta(minutes=settings.jwt_access_token_expire_minutes),
        refresh_ttl=timedelta(minutes=settings.jwt_refresh_token_expire_minutes),
    )

    raw_users: list[dict[str, object]] = []
    if settings.auth_users_file:
        path = Path(settings.auth_users_file)
        raw_users = list(json.loads(path.read_text(encoding="utf-8")))
        logger.info(
            "auth_users_file_loaded",
            extra={"operation": "auth.bootstrap", "source": source, "path": str(path)},
        )
    if settings.auth_demo_trader_password:
        raw_users.append(
            vars(
                demo_record(
                    settings.auth_demo_trader_username,
                    settings.auth_demo_trader_password,
                    roles=["trader"],
                    accounts=split_csv(settings.auth_demo_trader_accounts),
                )
            )
        )
    if settings.auth_demo_admin_password:
        raw_users.append(
            vars(
                demo_record(
                    settings.auth_demo_admin_username,
                    settings.auth_demo_admin_password,
                    roles=["admin"],
                    accounts=split_csv(settings.auth_demo_admin_accounts),
                )
            )
        )
    directory = UserDirectory.from_records(raw_users)
    if len(directory) == 0:
        logger.warning(
            "auth_no_users_configured",
            extra={
                "operation": "auth.bootstrap",
                "note": "no users configured — nobody can log in (set "
                "AUTH_USERS_FILE or AUTH_DEMO_*_PASSWORD)",
            },
        )
    return AuthService(tokens, directory)


def main() -> None:
    """Serve the API gateway with the simulated broker stack."""
    import uvicorn

    from api.app import create_app

    settings = Settings()
    runtime, _adapter = build_simulated_runtime()
    auth = build_auth_service(settings)
    app = create_app(
        runtime,
        auth=auth,
        ws_account_id=_DEFAULT_ACCOUNT,
        allowed_origins=split_csv(settings.api_origins),
    )

    async def _serve() -> None:
        config = uvicorn.Config(app, host=_HOST, port=_PORT, log_level="info")
        server = uvicorn.Server(config)
        try:
            await server.serve()
        finally:
            await runtime.stop()

    logger.info("starting API gateway on %s:%s (simulated broker stack)", _HOST, _PORT)
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
