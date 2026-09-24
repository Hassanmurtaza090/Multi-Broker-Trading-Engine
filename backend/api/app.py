"""API gateway factory (M10) — composes the FastAPI application.

`create_app(runtime)` builds the app around an `EngineRuntime` (the
application composition root). The API layer holds no business logic and no
broker knowledge: it delegates to the runtime, serializes via API DTOs, and
streams M2 envelopes over WebSocket. FastAPI's auto-generated OpenAPI docs
(`/docs`, `/redoc`, `/openapi.json`) are the API documentation.
"""

from __future__ import annotations

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect

from api.errors import install_exception_handlers
from api.rest import router as rest_router
from api.security import get_current_principal
from api.ws import WebSocketHub, hello_message
from application.runtime import EngineRuntime
from events import DEFAULT_REGISTRY, EventSerializer

API_TITLE = "Multi-Broker Trading Engine API"
API_VERSION = "1.0.0"


def create_app(runtime: EngineRuntime, *, ws_queue_size: int = 1000) -> FastAPI:
    """Build the FastAPI app bound to `runtime`."""
    app = FastAPI(
        title=API_TITLE,
        version=API_VERSION,
        description=(
            "Broker-agnostic REST + WebSocket gateway over the trading engine. "
            "All financial values are JSON strings (exact decimals). WebSocket "
            "delivery is at-least-once: dedupe by `event_id` and resync via REST."
        ),
    )
    app.state.runtime = runtime

    serializer = EventSerializer(DEFAULT_REGISTRY)
    hub = WebSocketHub(runtime.bus, serializer, queue_size=ws_queue_size)
    app.state.hub = hub

    app.include_router(rest_router)
    install_exception_handlers(app)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket, topics: str | None = None) -> None:
        await websocket.accept()
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
        runtime_from_state: EngineRuntime = request.app.state.runtime
        return {
            "status": "ready" if runtime_from_state.broker_connected() else "starting",
            "broker": runtime_from_state.broker_name,
        }

    # Auth hook is applied router-wide; keep a reference for M12 discoverability.
    app.state.auth_hook = get_current_principal
    return app
