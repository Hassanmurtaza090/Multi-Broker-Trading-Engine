"""API gateway factory (M10/M12) — composes the FastAPI application.

`create_app(runtime, auth, ...)` builds the app around an `EngineRuntime`
(the application composition root) and the `AuthService` (the M12 identity
layer). Authentication is mandatory — there is no unauthenticated mode.

WebSocket authorization (M12): a valid REST session does NOT imply stream
access. Clients exchange their access token for a single-use ticket
(`POST /auth/ws-ticket`); the WS endpoint consumes the ticket (replay-proof)
and then checks the principal's account scope against the runtime's bound
account before registering with the hub.

CORS: explicit origins only (bearer-header auth; credentials mode stays
off). Never "*" with credentials.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from api.auth import AuthService, protected_auth_router, public_auth_router
from api.errors import install_exception_handlers
from api.rest import router as rest_router
from api.security import Principal, get_current_principal
from api.ws import WebSocketHub, hello_message
from application.runtime import EngineRuntime
from events import DEFAULT_REGISTRY, EventSerializer

# Module-level dependency alias (same pattern as rest.py): resolvable by
# FastAPI at route definition time.
PrincipalDep = Annotated[Principal, Depends(get_current_principal)]

API_TITLE = "Multi-Broker Trading Engine API"
API_VERSION = "1.2.0"


def create_app(
    runtime: EngineRuntime,
    *,
    auth: AuthService,
    ws_account_id: str,
    allowed_origins: Sequence[str] = (),
    ws_queue_size: int = 1000,
    docs_enabled: bool = False,
    database: object | None = None,
) -> FastAPI:
    """Build the FastAPI app bound to `runtime` + `auth`.

    `ws_account_id` is the account the runtime's single broker serves; the
    WS stream is scoped to it.

    `docs_enabled` gates the OpenAPI/docs surface (M14): the API schema is
    DEV tooling, disabled by default so unauthenticated callers cannot
    enumerate the API surface in production; `main.py` enables it when
    APP_ENV=development.

    `database` (M15) is any object with an async `ping() -> bool` (the
    PostgreSQL repository); it feeds the readiness probe and metrics.
    """

    from infrastructure.metrics import MetricsRegistry, attach_bus_counters

    app = FastAPI(
        title=API_TITLE,
        version=API_VERSION,
        description=(
            "Broker-agnostic REST + WebSocket gateway over the trading engine. "
            "All financial values are JSON strings (exact decimals). WebSocket "
            "delivery is at-least-once: dedupe by `event_id` and resync via REST. "
            "Authentication is JWT bearer; authorize via the role model."
        ),
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.state.runtime = runtime
    app.state.auth = auth
    app.state.ws_account_id = ws_account_id
    app.state.database = database

    if allowed_origins:
        # Explicit origins only; bearer tokens travel in headers, so cookie
        # credentials mode is unnecessary and stays disabled.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(allowed_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        """M14 secure defaults for every response (setdefault: a layer that
        deliberately set a header earlier keeps its value)."""
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        # Authenticated trading data must never be cached by intermediaries.
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    serializer = EventSerializer(DEFAULT_REGISTRY)
    hub = WebSocketHub(runtime.bus, serializer, queue_size=ws_queue_size)
    # Observability (M15): bus-driven counters + gauges, authenticated-only.
    metrics = MetricsRegistry()
    metrics.gauge("ws_clients", hub.client_count)
    metrics.gauge("sessions_active", auth.tokens.session_count)
    metrics.gauge("broker_connected", lambda: 1.0 if runtime.broker_connected() else 0.0)
    attach_bus_counters(metrics, runtime.bus)
    app.state.metrics = metrics

    @app.get("/metrics", tags=["system"])
    async def metrics_snapshot(request: Request, principal: PrincipalDep) -> dict[str, float]:
        """Operational counters/gauges — authenticated operators only;
        never exposed publicly (the production proxy only forwards
        whitelisted paths)."""
        registry: MetricsRegistry = request.app.state.metrics
        return registry.snapshot()

    app.state.hub = hub

    app.include_router(public_auth_router)  # login/refresh only
    app.include_router(protected_auth_router)  # logout/me/ws-ticket
    app.include_router(rest_router)
    install_exception_handlers(app)

    @app.websocket("/ws")
    async def websocket_endpoint(
        websocket: WebSocket, topics: str | None = None, ticket: str | None = None
    ) -> None:
        await websocket.accept()
        # --- authorization first: no unauthenticated client ever registers ---
        if not ticket:
            await websocket.close(code=4401, reason="authentication required")
            return
        subject = auth.tokens.consume_ws_ticket(ticket)  # single-use
        user = auth.users.find(subject) if subject is not None else None
        if subject is None or user is None:
            await websocket.close(code=4401, reason="authentication required")
            return
        principal = Principal.of(subject, roles=user.roles, accounts=user.accounts)
        if not principal.can_access_account(ws_account_id):
            await websocket.close(code=4403, reason="no access to this account")
            return
        # --- existing M10 contract after authorization --------------------------
        try:
            parsed = WebSocketHub.parse_topics(topics)
        except ValueError as exc:
            await websocket.close(code=4400, reason=str(exc))
            return
        client_id = hub.register(websocket, parsed)
        await websocket.send_text(hello_message(client_id, parsed))
        sender = None
        try:
            import asyncio

            sender = asyncio.get_running_loop().create_task(hub.serve(client_id))
            while True:
                # Consume client traffic (pings/commands are ignored); a
                # disconnect bubbles out and cleans the client up.
                message = await websocket.receive_text()
                if message == "ping":
                    await websocket.send_text('{"control": "pong"}')
        except WebSocketDisconnect:
            pass
        finally:
            if sender is not None:
                sender.cancel()
            hub.unregister(client_id)

    @app.get("/ready", tags=["system"], include_in_schema=True)
    async def readiness(request: Request) -> dict[str, str]:
        """Infrastructure probe (public by design: no sensitive data).

        Reports broker connectivity AND (when persistence is configured)
        database availability — a backend is only "ready" when both the
        broker feed and the order store are usable (M15 startup ordering).
        """
        runtime_from_state: EngineRuntime = request.app.state.runtime
        database = request.app.state.database
        db_status = "not_configured"
        if database is not None:
            db_status = "ok" if await database.ping() else "unavailable"
        ready = runtime_from_state.broker_connected() and db_status != "unavailable"
        return {
            "status": "ready" if ready else "starting",
            "broker": runtime_from_state.broker_name,
            "database": db_status,
        }

    return app
