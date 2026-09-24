"""Backend entrypoint — the composition boundary (M10).

Builds the engine runtime with broker adapters injected as ports and serves
the API gateway. For development this wires the SIMULATED broker adapters
(paper/sim mode; no live trading per the roadmap); production wiring selects
real transports via configuration when they arrive (ADR-014/ADR-015).

Run:  python main.py  (serves http://127.0.0.1:8000 — docs at /docs)
"""

from __future__ import annotations

import asyncio
import logging

from application.runtime import EngineRuntime
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from brokers.saxo import SaxoAdapter, SimulatedSaxoClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mtbe.main")

_HOST = "127.0.0.1"
_PORT = 8000


def build_simulated_runtime(
    broker: str = "IBKR", account_id: str = "ACC-001"
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


def main() -> None:
    """Serve the API gateway with the simulated broker stack."""
    import uvicorn

    from api.app import create_app

    runtime, _adapter = build_simulated_runtime()

    async def _serve() -> None:
        await runtime.start()
        app = create_app(runtime)
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
