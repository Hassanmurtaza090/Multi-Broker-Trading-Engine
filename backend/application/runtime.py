"""Engine runtime — the application-layer composition root (M10).

Wires the complete trading engine on ONE M2 event bus:

    EngineRuntime
      ├─ EventBus (InProcessEventBus)
      ├─ OrderManager (M4)  ── ExecutionEngine (M5) ── ExecutionBroker (port)
      ├─ MarketDataEngine (M3) ── MarketDataFeed (port)
      ├─ PortfolioService (M7)  (implements the M6 read-model ports)
      ├─ RiskEngine (M6)         (consumes portfolio via those ports)
      └─ RiskGatedExecutor       (mandatory risk gate: no order bypasses risk)

The runtime depends ONLY on ports and the domain/application layers — it never
imports a concrete broker adapter. Adapters are injected at the composition
boundary (`backend/main.py`, tests) as `MarketDataFeed`/`ExecutionBroker`
implementations (a single adapter object typically implements both).

Lifecycle: `start()` starts the market-data engine (which connects the feed —
for combined adapters this also readies execution); `stop()` tears down in
reverse order. The Execution Engine binds ONE broker (M5 design); multi-broker
routing is future work (documented in ADR-016).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from brokers.base import ExecutionBroker, MarketDataFeed
from domain.orders import Order
from events import InProcessEventBus
from execution import ExecutionEngine
from market_data import MarketDataEngine
from order_management import InMemoryOrderRepository, OrderManager, OrderRepository
from portfolio import PortfolioService
from risk import RiskEngine, RiskGatedExecutor, RiskLimits

logger = logging.getLogger("mtbe.application")

Clock = Callable[[], datetime]


def _system_clock() -> datetime:
    return datetime.now(UTC)


class EngineRuntime:
    """Owns and wires all engine components on a single event bus."""

    def __init__(
        self,
        *,
        feed: MarketDataFeed,
        broker: ExecutionBroker,
        broker_name: str = "BROKER",
        bus: InProcessEventBus | None = None,
        price_max_age: timedelta | None = None,
        clock: Clock = _system_clock,
        order_repository: OrderRepository | None = None,
    ) -> None:
        # The bus may be injected by the composition boundary so that broker
        # adapters (constructed before the runtime) publish on the SAME bus.
        self.bus = bus if bus is not None else InProcessEventBus()
        # Persistence is a port: the composition boundary may inject the
        # PostgreSQL repository (M15); the in-memory default supports
        # development and tests.
        self.oms = OrderManager(
            order_repository if order_repository is not None else InMemoryOrderRepository(),
            self.bus,
        )
        self.executor = ExecutionEngine(broker, self.oms)
        if price_max_age is None:
            self.portfolio = PortfolioService(bus=self.bus, clock=clock)
        else:
            self.portfolio = PortfolioService(
                bus=self.bus, clock=clock, price_max_age=price_max_age
            )
        self.market = MarketDataEngine(feed, self.bus)
        # Risk consumes authoritative portfolio state through the M6 ports.
        self.risk = RiskEngine(
            self.portfolio,
            self.portfolio,
            self.portfolio,
            daily_pnl=self.portfolio,
            clock=clock,
            bus=self.bus,
        )
        self.gate = RiskGatedExecutor(self.risk, self.oms, self.executor)
        self.broker_name = broker_name
        self._feed = feed
        self._broker = broker

    # -- lifecycle ------------------------------------------------------------------
    async def start(self) -> None:
        """Start the engine (connects the feed; readies execution + events)."""
        await self.market.start()
        logger.info("engine_started", extra={"broker": self.broker_name})

    async def stop(self) -> None:
        """Tear the engine down in reverse order (idempotent)."""
        await self.market.stop()
        logger.info("engine_stopped", extra={"broker": self.broker_name})

    # -- read helpers (API convenience; no new business logic) -----------------------
    def broker_connected(self) -> bool:
        """Whether the injected broker adapter reports connectivity."""
        return bool(getattr(self._broker, "is_connected", False)) or bool(
            getattr(self._feed, "is_connected", False)
        )

    async def find_order_by_idempotency_key(self, key: str) -> Order | None:
        """Idempotent-replay lookup (TS-004) for the API layer."""
        return await self.oms.get_by_idempotency_key(key)

    def set_risk_limits(self, account_id: str, limits: RiskLimits) -> None:
        self.risk.set_policy(account_id, limits)
