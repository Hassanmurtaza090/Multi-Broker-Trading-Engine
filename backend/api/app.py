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

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from api.auth import AuthService, protected_auth_router, public_auth_router
from api.errors import install_exception_handlers
from api.rest import router as rest_router
from api.security import Principal
from api.ws import WebSocketHub, hello_message
from application.runtime import EngineRuntime
from events import DEFAULT_REGISTRY, EventSerializer

API_TITLE = "Multi-Broker Trading Engine API"
API_VERSION = "1.1.0"


def create_app(
    runtime: EngineRuntime,
    *,
    auth: AuthService,
    ws_account_id: str,
    allowed_origins: Sequence[str] = (),
    ws_queue_size: int = 1000,
) -> FastAPI:
    """Build the FastAPI app bound to `runtime` + `auth`.

    `ws_account_id` is the account the runtime's single broker serves; the
    WS stream is scoped to it.
    """
    app = FastAPI(
        title=API_TITLE,
        version=API_VERSION,
        description=(
            "Broker-agnostic REST + WebSocket gateway over the trading engine. "
            "All financial values are JSON strings (exact decimals). WebSocket "
            "delivery is at-least-once: dedupe by `event_id` and resync via REST. "
            "Authentication is JWT bearer; authorize via the role model."
        ),
    )
    app.state.runtime = runtime
    app.state.auth = auth
    app.state.ws_account_id = ws_account_id

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

    serializer = EventSerializer(DEFAULT_REGISTRY)
    hub = WebSocketHub(runtime.bus, serializer, queue_size=ws_queue_size)
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
        """Infrastructure probe (public by design: no sensitive data)."""
        runtime_from_state: EngineRuntime = request.app.state.runtime
        return {
            "status": "ready" if runtime_from_state.broker_connected() else "starting",
            "broker": runtime_from_state.broker_name,
        }

    return app
