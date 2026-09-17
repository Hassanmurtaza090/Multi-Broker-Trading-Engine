# Architecture Decision Records

All architectural decisions are recorded here as **ADRs**. Decisions are
changed only by adding a new ADR (or superseding with a new ADR), never by
silently editing an existing decision.

---

## ADR-001 — Frontend

- **Status:** Accepted
- **Decision:** React + TypeScript
- **Context/Rationale:** The product is a browser-based professional trading
  terminal requiring real-time dashboards, charts, panels, remote access, and
  future extensibility. TypeScript provides safety for a complex, evolving UI.
- **Consequences:** Frontend tooling follows React/TS conventions (Vite, ESLint,
  Prettier, Vitest). No business logic in the frontend.

## ADR-002 — Backend

- **Status:** Accepted
- **Decision:** Python + FastAPI
- **Context/Rationale:** Python provides a strong ecosystem for quantitative
  development, broker APIs, data processing, automation, and rapid backend
  development. FastAPI offers async-first REST + WebSocket support.
- **Consequences:** Backend tooling follows Python conventions (uv/pyproject,
  ruff, mypy, pytest). Core remains framework-independent.

## ADR-003 — Database

- **Status:** Accepted
- **Decision:** PostgreSQL
- **Context/Rationale:** Relational integrity (orders, positions, audit), mature
  async support, strong ecosystem, and production reliability.
- **Consequences:** Persistence is PostgreSQL via SQLAlchemy (asyncio); the
  domain uses repository interfaces and never imports the ORM.

## ADR-004 — Initial Brokers

- **Status:** Accepted
- **Decision:** Interactive Brokers and Saxo Bank
- **Context/Rationale:** IBKR provides broad market access and a mature API;
  Saxo provides multi-asset coverage and an OAuth-based REST/streaming API.
- **Consequences:** Two broker adapters implement a shared base abstraction.

## ADR-005 — Architecture

- **Status:** Accepted
- **Decision:** Broker-agnostic core with broker-specific adapters
- **Context/Rationale:** The trading core must remain independent of any broker
  so new brokers can be added without modifying core logic.
- **Consequences:** Core communicates via `backend/brokers/base` interfaces;
  broker-specific code lives only in adapters. Enforced as non-negotiable in
  `AGENTS.md`.

## ADR-006 — Event System (M2)

- **Status:** Accepted
- **Decision:** In-process, typed, async event bus as the communication backbone
- **Context/Rationale:** Components (market data, order management, risk,
  portfolio) must communicate decoupled from each other, from brokers, and from
  infrastructure. An internal event bus provides typed, traceable, replayable
  notifications without coupling publishers to consumers.
- **Consequences:** Implement `backend/events` with an `EventBus` protocol and an
  `InProcessEventBus`. No distributed broker (NATS/Kafka/RabbitMQ/Redis Streams)
  is introduced at M2. The protocol allows the transport to be replaced later
  without rewriting domain/application layers. Broker-specific and
  framework-specific code must not import into `backend/events`.

## ADR-007 — Ordering & Execution Model (M2)

- **Status:** Accepted
- **Decision:** Per-bus total ordering with sequential handler dispatch;
  reentrancy-safe lock
- **Context/Rationale:** Trading systems require predictable, deterministic
  state transitions. Concurrent publishes must not interleave handlers
  (`A→B` must not become `B→A`), and handlers that publish follow-up events
  must not deadlock.
- **Consequences:** `InProcessEventBus` serializes all `publish()` calls with an
  `asyncio.Lock` tracked per task (reentrant for nested publishes). Handlers run
  sequentially in registration order within a publish. Ordering is guaranteed
  only within one bus instance on one event loop. Global/distributed ordering is
  deferred to a future external transport.

## ADR-008 — Event Serialization & Versioning (M2)

- **Status:** Accepted
- **Decision:** Versioned typed events with a registry-driven JSON serializer
- **Context/Rationale:** Events must survive schema evolution and be suitable for
  WebSocket/external transport without breaking existing consumers.
- **Consequences:** Every event declares a stable `__event_type__` and
  `__event_version__`. `EventRegistry` keys `(event_type, version)` so v1/v2 can
  coexist. `EventSerializer` converts envelope ↔ JSON-safe dict losslessly.
  Delivery is at-least-once; consumers deduplicate via `event_id`. A distributed
  idempotency store and retry/dead-letter mechanics are deferred.

## ADR-009 — Market Data Engine (M3)

- **Status:** Accepted
- **Decision:** Broker-agnostic market-data port + engine publishing on the M2
  event bus
- **Context/Rationale:** The core must subscribe to and normalize market data
  without coupling to any broker (FR-002, TS-007). Broker feeds arrive at their
  own milestones (M8/M9); M3 must establish the abstraction and behavior now.
- **Consequences:** Define a `MarketDataFeed` protocol (with `RawQuote`,
  `RawTick`, `RawBar`) in `backend/brokers/base` that IBKR/Saxo adapters will
  implement. `MarketDataEngine` in `backend/market_data` consumes the port,
  validates/normalizes into domain value objects, tracks staleness
  (`StalenessMonitor`, TS-007), manages subscriptions idempotently
  (`SubscriptionManager`), and publishes `MarketQuoteUpdated` /
  `MarketTickUpdated` / `MarketBarUpdated` on the M2 event bus. No broker logic
  lives in the core. Simulation feeds (tests) implement the same port.
- **Extension point:** Real broker adapters (M8/M9) implement `MarketDataFeed`
  and plug into the engine without core changes.

## ADR-010 — Order Management System (M4)

- **Status:** Accepted
- **Decision:** Broker-independent OMS driving the M1 `Order` state machine and
  publishing on the M2 event bus
- **Context/Rationale:** The engine needs a central, broker-agnostic authority
  for order lifecycle, idempotency, and execution-report application (TS-001,
  TS-003, TS-004) before routing (M5) and broker adapters (M8/M9) exist.
- **Consequences:** Implement `backend/order_management` with an `OrderManager`
  and an `OrderRepository` port (+ `InMemoryOrderRepository` for M4). The OMS
  validates via the M1 domain, applies confirmed `ExecutionReport`s (fills
  tracked via new `Order.filled_quantity`), enforces idempotency/duplicate
  protection, and publishes `order.*` events on the M2 bus. It does not route to
  a broker (M5) and contains no broker logic. A PostgreSQL repository arrives
  with the infrastructure milestone.

## ADR-011 — Execution Engine (M5)

- **Status:** Accepted
- **Decision:** Broker-independent execution engine routing through an
  `ExecutionBroker` port, with the OMS owning lifecycle state
- **Context/Rationale:** Orders must be routed to a broker through an
  abstraction, handling partial fills, rejects, timeouts, and reconnection
  (FR-003/004/005, TS-006) without coupling to any broker.
- **Consequences:** Implement `backend/execution` (`ExecutionEngine`) and an
  `ExecutionBroker` port in `backend/brokers/base/execution.py` (IBKR/Saxo
  implement it in M8/M9). The engine drives the OMS and applies broker reports
  to it (the OMS publishes `order.*` events; the engine publishes none).
  Timeouts raise `BrokerError(TIMEOUT)` without assuming an outcome; submission
  retries only on transient connection loss, bounded and safe because
  `client_order_id` is the idempotency key; `reconcile()` re-syncs outstanding
  orders after reconnect. No broker SDK logic in the engine.

---

## Decision Log

| ADR | Date | Decision | Status |
| --- | --- | --- | --- |
| ADR-001 | 2026-09-10 | React + TypeScript frontend | Accepted |
| ADR-002 | 2026-09-10 | Python + FastAPI backend | Accepted |
| ADR-003 | 2026-09-10 | PostgreSQL database | Accepted |
| ADR-004 | 2026-09-10 | IBKR + Saxo initial brokers | Accepted |
| ADR-005 | 2026-09-10 | Broker-agnostic core, broker adapters | Accepted |
| ADR-006 | 2026-09-15 | In-process typed async event bus | Accepted |
| ADR-007 | 2026-09-15 | Per-bus total ordering, sequential dispatch, reentrancy-safe | Accepted |
| ADR-008 | 2026-09-15 | Versioned typed events, registry-driven JSON serializer | Accepted |
| ADR-009 | 2026-09-15 | Broker-agnostic market-data port + engine on M2 event bus | Accepted |
| ADR-010 | 2026-09-15 | Broker-independent OMS on M1 state machine + M2 event bus | Accepted |
| ADR-011 | 2026-09-15 | Broker-independent execution engine on ExecutionBroker port | Accepted |