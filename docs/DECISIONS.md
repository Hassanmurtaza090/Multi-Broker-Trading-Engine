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

## ADR-012 — Risk Engine (M6)

- **Status:** Accepted
- **Decision:** Broker-independent, fail-closed pre-trade risk gate with a
  mandatory execution checkpoint
- **Context/Rationale:** Pre-trade risk must gate execution and be impossible to
  bypass (TS-005, TS-008, TS-009, FR-009), operating on internal domain models
  without duplicating portfolio ownership.
- **Consequences:** Implement `backend/risk` (`RiskEngine`, `RiskGatedExecutor`,
  `RiskPolicy`/`RiskLimits`, configurable rules, kill switch). Risk owns the kill
  switch and daily order counts; it reads positions/exposure/balance/quote/P&L
  via ports (`PortfolioView`, `AccountView`, `MarketDataView`, `DailyPnlProvider`),
  so M7 implements the portfolio view. Fail-closed: a rule rejects when required
  data is unavailable unless not configured. The `RiskGatedExecutor` enforces
  "no order bypasses risk" at the orchestration layer.

## ADR-013 — Portfolio Accounting & P&L (M7)

- **Status:** Accepted
- **Decision:** Fill-driven, average-cost portfolio service on the M2 event bus,
  implementing the M6 read-model ports
- **Context/Rationale:** The engine needs authoritative internal positions and
  P&L (FR-006, FR-008, TS-002) without duplicating portfolio ownership in Risk
  or OMS, and without broker coupling.
- **Consequences:** Implement `backend/portfolio` (`PortfolioService`, pure
  `accounting` functions). Average-cost method: open/increase via the M1 VWAP
  `apply_fill`; reduce/close/reverse realize `(exit−avg)×closed` (long) /
  `(avg−exit)×closed` (short); reducing retains the average, reversal opens the
  opposite side at the fill price; optional fill fees reduce realized P&L
  immediately. Unrealized P&L uses a market price only while fresher than
  `price_max_age` (else `None`, never silently zero); exposure/equity fall back
  to the average entry price (documented); equity requires a known balance;
  multi-currency aggregates return `None` (no invented FX). Duplicate fills are
  deduped by `fill_id`; fill order follows ADR-007. The service publishes
  `position.opened/updated/closed` and implements `PortfolioView`,
  `AccountView`, `MarketDataView`, and `DailyPnlProvider` for M6. Broker
  reconciliation enters via `apply_broker_snapshot` (domain models only).
  Persistence is in-memory for M7 (PostgreSQL deferred; state rebuildable from
  events/snapshots). Clarified during M7: M6's `max_daily_loss` is a POSITIVE
  loss magnitude (floor = −(max_daily_loss)); negative configuration fails
  closed.

## ADR-014 — IBKR Adapter (M8)

- **Status:** Accepted
- **Decision:** IBKR adapter behind an `IbkrClient` transport port, with an
  in-memory simulated client as the paper/test mode
- **Context/Rationale:** The M8 roadmap requires the adapter to satisfy the base
  contracts and be paper-tested with no live trading. The real ibapi /
  ib_insync dependency, TWS/Gateway session handling, and credentials are
  environment concerns that must not enter the core, and no live connection is
  permitted during development milestones.
- **Consequences:** `backend/brokers/ibkr` contains `IbkrAdapter` (implements
  the M3 `MarketDataFeed` and M5 `ExecutionBroker` ports), a pure `mapping`
  layer (contracts/orders/statuses/executions/account/positions/errors — the
  only IBKR knowledge in the codebase), IBKR-shaped DTOs, and the
  `IbkrClient`/`IbkrCallbacks` transport protocols with
  `SimulatedIbkrClient` (paper mode). Submit returns a transport-level
  ACCEPTED ack (the async Submitted callback is deduped); cancel/modify await
  broker confirmation via bounded futures (never assume an outcome); statuses
  dedupe per order and executions by `execution_id`; `reconnect()` re-subscribes
  exactly once and replays broker state for reconciliation; broker account data
  is relabeled to the internal account id. Deferred (documented): the real
  ibapi-backed client, controlled live/paper validation in a credentialed
  environment, and adapter dedup-state persistence across restarts.
  `fetch_order_status` returns `None` for a fill status without cached
  execution data (execution-level reconciliation relies on the
  `request_executions` replay).

## ADR-015 — Saxo Adapter (M9)

- **Status:** Accepted
- **Decision:** Saxo adapter reusing the M8 broker abstraction unchanged, with
  the OAuth session lifecycle encapsulated in the adapter
- **Context/Rationale:** The M9 roadmap requires the adapter to satisfy the
  same base contracts and be sim-tested with no live trading. Saxo differs
  genuinely from IBKR (OAuth tokens, UIC identifiers, status vocabulary, full
  balance snapshots); forcing those into the common interface would mislead —
  instead the existing ports proved sufficient with all differences inside the
  adapter.
- **Consequences:** `backend/brokers/saxo` contains `SaxoAdapter` (same
  `MarketDataFeed` + `ExecutionBroker` ports as IBKR), a pure `mapping` layer
  (UIC/AssetType instruments via the broker-neutral `identifiers` field —
  `SAXO_UIC`; orders with ExternalReference = client_order_id; statuses with
  Saxo's additional `Expired` → `EXPIRED`; full balance snapshots; positions
  with venues), and `SaxoClient`/`SaxoCallbacks` transport protocols with an
  OAuth session model (`authorize`/`refresh_session`/`logout`) and
  `SimulatedSaxoClient` (sim/paper mode). Token expiry is handled proactively
  (expiry notification → refresh) and reactively (auth-rejected request →
  refresh once → retry — safe because the request was not processed); refresh
  failure drops the session (`UNAUTHORIZED`). The adapter requires the
  `SAXO_UIC` identifier and never guesses instrument identifiers; broker
  account data is relabeled to the internal account id. Deferred (documented):
  the real OpenAPI transport + OAuth credential acquisition (reads `.env`,
  never committed), controlled sim-environment validation, an instrument
  search/lookup service, and adapter dedup-state persistence across restarts.
  `fetch_order_status` returns `None` for a fill status without cached
  execution data (execution-level reconciliation relies on the
  `request_executions` replay), identical to ADR-014.

---

## ADR-016 — API Gateway (M10)

- **Status:** Accepted
- **Decision:** Thin REST + WebSocket delegation surface over an
  application-layer composition root, with exact-decimal JSON and an
  at-least-once WS sync model
- **Context/Rationale:** The M10 roadmap requires REST + WS exposing core
  capabilities with the API cleanly delegating to the application layer, auth
  hooks only (M12 implements enforcement), and no core changes.
- **Consequences:** Implement ackend/api (FastAPI): a REST router
  delegating to the runtime (order creation goes through the M6 risk gate and
  can never bypass it; cancel/modify via the M5 engine; reads from M4/M7 read
  models; kill-switch via M6), API DTOs with every Decimal serialized as a
  fixed-point JSON string (never floats or scientific notation), stable-error
  HTTP mapping (400/404/409/422/502/503/504; generic 500 without internals),
  and a WebSocket hub fanning out registry-serialized M2 envelopes with
  vent_id (at-least-once; clients dedupe and REST-resync), topic filtering,
  and bounded queues that close slow clients (1013) via a reserved sentinel
  slot. Ordering semantics: within a topic engine publish order is preserved;
  across topics nested reactions interleave by subscriber registration order
  (e.g. position.opened may arrive before the order.partially_filled that
  caused it) - tested as designed behavior. EngineRuntime (application)
  composes all components on one bus behind injected ports; concrete adapters
  are imported ONLY by ackend/main.py. Added
  OrderManager.get_by_idempotency_key (read-only lookup) for idempotent API
  replay (201 create vs 200 replay). Auth is a router-wide M12 hook admitting
  an anonymous principal in M10. Limitations: no pagination, no
  authentication enforcement (M12), no rate limiting (M14), in-memory engine
  state (persistence milestone).

---

## ADR-017 — React Trading Terminal (M11)

- **Status:** Accepted
- **Decision:** Presentation-only terminal on the M10 gateway with a minimal
  typed store layer over React 18's `useSyncExternalStore` (no state-management
  framework), a dedicated WS sync client implementing the ADR-016
  at-least-once contract, and exact-decimal strings end-to-end
- **Context/Rationale:** M11 requires dashboard/orders/positions/P&L/charts
  over REST + WS (FR-011) while keeping the frontend free of business, risk,
  and broker logic (ADR-001/ADR-005). The M10 WS is at-least-once with
  documented cross-topic interleave, so the client MUST dedupe by `event_id`
  and reconcile from REST — merge correctness is a correctness property, not
  a UI nicety. Adding Redux/Zustand would duplicate mechanisms the tiny store
  primitive already provides; adding a chart library for one sparkline would
  be an unnecessary dependency.
- **Consequences:** `frontend/src/services` is transport-only: `api.ts`
  (typed REST + stable-error mapping: risk 422 with violations, 504 timeout
  with "outcome unknown" guidance, 503/404/409/network; untrusted path
  segments URL-encoded) and `ws.ts` (`TerminalSocket`: bounded-LRU event_id
  dedupe, capped exponential reconnect that retries forever, full REST resync
  after every successful (re)connect, 1013 → reconnect+resync vs 4400 →
  fatal, ping keepalive, malformed-frame isolation). `frontend/src/stores`
  merges events idempotently (upsert by `client_order_id`; position identity
  key shared between WS payloads and REST rows; `position.closed` removes;
  REST reads stay authoritative via a debounced post-fill resync for
  REST-only fields). `useTerminal` is the single wiring hook (initial REST
  load independent of WS; account-switch resync discards stale results).
  Financial values remain exact-decimal strings — floats are used only for
  chart pixel coordinates. Order entry carries a client-generated
  `idempotency_key` that is KEPT across uncertain outcomes (network/5xx/504
  — a retry replays the same key server-side) and rotated after definitive
  ones (2xx/400/422/409), mirroring TS-004. The watchlist polls
  `GET /market/quote` because M10 exposes no subscribe endpoint; streamed
  `market.quote.updated` events render live when the engine has
  subscriptions. Limitations documented: single-account runtime (ADR-016),
  session-scoped frontend state (REST resync rebuilds on load), browser E2E
  deferred to M13/M16 per roadmap. No new runtime dependencies.

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
| ADR-012 | 2026-09-15 | Fail-closed pre-trade risk gate + mandatory execution checkpoint | Accepted |
| ADR-013 | 2026-09-15 | Average-cost portfolio service implementing M6 risk ports | Accepted |
| ADR-014 | 2026-09-15 | IBKR adapter behind IbkrClient port; simulated paper mode | Accepted |
| ADR-015 | 2026-09-15 | Saxo adapter reusing the abstraction; OAuth session in adapter | Accepted |
| ADR-016 | 2026-09-15 | Thin REST+WS gateway; exact-decimal JSON; at-least-once WS sync | Accepted |
| ADR-017 | 2026-09-27 | Presentation-only terminal; useSyncExternalStore stores; ADR-016 sync client; exact-decimal UI | Accepted |