# Architecture

The **Multi-Broker Trading Engine** is a broker-agnostic, modular trading
platform. The core trading engine is independent of the UI framework, the API
framework, and any specific broker.

---

## High-Level Architecture

```text
React (frontend)
      ↓
FastAPI / API Layer (backend/api)
      ↓
Application Layer (backend/application)
      ↓
Trading Domain / Core (backend/domain)
      ↓
Broker Abstraction (backend/brokers/base)
      ↓
Broker Adapters
      ├── IBKR (backend/brokers/ibkr)
      └── Saxo (backend/brokers/saxo)
```

Arrows point **downward**. A module may depend only on modules below it; it must
never depend on modules above it.

---

## Layered Boundaries

### Frontend (React + TypeScript)

Presentation only. Consumes the API layer over REST and WebSocket. Holds no
business logic. Broker-specific knowledge must never reach the frontend.

### API Layer (`backend/api`)

FastAPI routes and WebSocket channels. Translates HTTP/WS into application-layer
calls. No domain logic, no broker logic. Concerned with transport, validation of
untrusted input, authentication, and serialization.

### Application Layer (`backend/application`)

Use-case orchestration. Coordinates domain services to fulfill commands/queries
(e.g., "submit order" validates risk then executes). Depends on domain and the
broker abstraction. No HTTP/framework concerns.

### Domain / Core (`backend/domain`)

The trading core: entities, value objects, invariants, and pure domain services
(order lifecycle, position math, P&L). **Must not import** React, FastAPI, any
broker, or infrastructure. This is the broker-agnostic heart.

### Infrastructure (`backend/infrastructure`)

Persistence (PostgreSQL), messaging (Redis pub/sub), configuration, logging,
clock. Implements ports defined by domain/application. Never imports upward.

### Broker Abstraction (`backend/brokers/base`)

Protocols/abstract base classes defining the contracts the core talks to:

- Broker connection lifecycle
- Market data subscription
- Order submission / cancel / modify
- Position / account queries
- Execution reports
- Broker errors

### Broker Adapters (`backend/brokers/ibkr`, `backend/brokers/saxo`)

The **only** place broker-specific logic lives. Each adapter implements the base
contracts and maps its broker's protocol to/from domain types.

---

## Other Subsystems

| Module | Responsibility |
| --- | --- |
| `backend/market_data` | Feed abstraction (broker port), subscription management, tick/bar/quote normalization, staleness detection |
| `backend/order_management` | Order lifecycle, state management, idempotency, event publication (OMS) |
| `backend/execution` | Order routing, lifecycle transitions, reconciliation hooks |
| `backend/risk` | Pre-trade checks, limits, kill switch |
| `backend/portfolio` | Positions, valuation, P&L |
| `backend/events` | Event definitions + bus (ordered, typed, replayable) |
| `backend/config` | Centralized settings loading (from environment) |

---

## Event Architecture

The engine is event-driven. Domain state changes emit typed events on a
central bus. Consumers (application services, persistence, risk, audit) subscribe
without the publisher knowing about them. Events are ordered, typed, and
suitable for audit logging and replay. Initial transport is in-process; Redis
pub/sub and persistence are added when milestones require them.

### Layered Design (M2)

```text
Domain Event (typed, broker-agnostic)          backend/events/base.py, types.py
      ↓
Event Contract (EventEnvelope)                 backend/events/envelope.py
      ↓
EventBus Interface (Protocol)                  backend/events/bus.py
      ↓
InProcessEventBus (M2 transport)               backend/events/bus.py
```

The `EventBus` is a `typing.Protocol`, so the transport can later be replaced
with an external implementation (e.g. NATS) without rewriting the domain or
application layers. `InProcessEventBus` is the M2 in-process implementation.

### Components

- **Event** — immutable, strongly-typed record of something that already
  happened (`DomainEvent`). Declares a stable `__event_type__` and
  `__event_version__`.
- **Event Envelope** — wraps an event with routing/tracing metadata
  (`event_id`, `event_type`, `event_version`, `timestamp`, `source`,
  `correlation_id`, `causation_id`, `payload`).
- **Event Bus** — `publish` / `subscribe` / `unsubscribe`. Routes an event to
  all subscribed handlers.
- **Subscription** — handle to a registered handler, returned by `subscribe()`.
- **Handler** — async (or sync) callable receiving the full envelope.
- **Registry** — maps `(event_type, version)` to concrete classes, the single
  source of truth for deserialization.
- **Serializer** — converts envelope ↔ JSON-safe dict for WebSocket/external
  transport.

### Ordering & Concurrency (M2 guarantees)

- **Per-bus total order (per event loop).** A reentrancy-aware `asyncio.Lock`
  serializes all `publish()` calls; handlers for one event complete before the
  next event's handlers begin. No interleaving across concurrent publishes.
- **Sequential dispatch within an event.** Handlers run one after another in
  registration order; `publish()` awaits all handlers before returning.
- **Reentrancy.** A handler may publish a follow-up event on the same task
  without deadlocking (e.g. `OrderFilled` → `PositionUpdated`).
- **Limitations.** Ordering is guaranteed only within a single bus instance on a
  single event loop. Cross-instance/process/distributed ordering requires an
  external transport with ordering support (future).

### Handler Isolation & Error Handling

- A handler exception is captured into `PublishResult.errors`, logged, and does
  not stop other subscribers or crash the bus.
- Publishing with no subscribers succeeds (`delivered_to == 0`).
- Invalid events / serialization failures raise typed errors to the caller.
- Failures are observable via `PublishResult` and structured logs.
- Never log secrets (API keys, credentials, tokens, passwords).

### Serialization, Versioning & Idempotency

- Envelope ↔ JSON-safe dict; typed payload round-trips losslessly via the
  registry.
- Events are versioned from day one (`__event_version__`, default 1); the
  registry supports coexisting v1/v2 of the same event type.
- Delivery is at-least-once; consumers identify duplicates via `event_id`.
  Distributed idempotency is deferred.

See `docs/EVENTS.md` for the full event catalog and `docs/DECISIONS.md` for the
M2 ADRs.

## Market Data Architecture (M3)

The market-data engine is broker-agnostic. Broker adapters (IBKR, Saxo) will
implement the `MarketDataFeed` port in `backend/brokers/base` (their dedicated
milestones); the engine depends only on that port, the domain, and the event
system.

```text
MarketDataFeed (broker port)                 backend/brokers/base/market_data.py
      ↓  RawQuote / RawTick / RawBar
MarketDataEngine                              backend/market_data/engine.py
      ├─ SubscriptionManager                  backend/market_data/subscription.py
      ├─ StalenessMonitor (TS-007)            backend/market_data/staleness.py
      └─ publishes typed events on EventBus
      ↓  MarketQuoteUpdated / MarketTickUpdated / MarketBarUpdated
Consumers (portfolio, risk, UI)               subscribe via EventBus
```

- **Normalization:** raw feed payloads are validated into domain value objects
  (`MarketQuote`, `MarketTick`, `Bar`). Invalid payloads (bid>ask, negative
  volume, mixed currency, naive timestamp) are rejected and dropped without
  crashing the engine.
- **Subscription management:** `SubscriptionManager` keeps subscriptions
  idempotent via reference counting — multiple requests for one instrument open
  a single feed subscription; the feed is detached on the last reference.
- **Staleness (TS-007):** `StalenessMonitor` flags instruments with no fresh
  data within a configured window; never-observed data is conservatively stale.
  The reference clock is injectable for deterministic testing.

## Order Management Architecture (M4)

The OMS is the broker-independent authority on order lifecycle. It depends on
the M1 domain (`Order` state machine), the M2 event bus, and an `OrderRepository`
port (persistence detail).

```text
OrderManager (OMS)                          backend/order_management/manager.py
   ├─ create / submit / cancel / modify / apply reports
   ├─ OrderRepository (port)                backend/order_management/repository.py
   │      └─ InMemoryOrderRepository (M4)   (PostgreSQL impl: infrastructure milestone)
   └─ publishes on EventBus                 order.submitted/accepted/... (M2 events)
```

- **Lifecycle:** `OrderManager` drives the M1 state machine:
  `NEW → PENDING_SUBMIT → SUBMITTED → PARTIALLY_FILLED → FILLED`, with
  `REJECTED` / `CANCELLED` / `EXPIRED` terminal paths. Broker confirmations
  arrive as `ExecutionReport`s and are applied only when confirmed (no
  unconfirmed execution assumption).
- **Idempotency / duplicates (TS-003/004):** creation is idempotent via
  `client_order_id` and `idempotency_key`; duplicate `report_id`s are ignored.
- **Fills:** cumulative `filled_quantity` is tracked (M1-deferred); overfill and
  non-completing FILL reports are rejected.
- **Boundaries:** the OMS contains no broker-specific logic and does not route to
  a broker (that is M5, the Execution Engine).

## Execution Architecture (M5)

The Execution Engine is the broker-independent coordinator between the OMS
(lifecycle authority) and the `ExecutionBroker` port (implemented by IBKR/Saxo
in M8/M9). It does not contain broker SDK logic.

```text
OMS (lifecycle + order.* events)      backend/order_management
       ↑  submit/cancel/modify, apply reports
ExecutionEngine                       backend/execution/engine.py
       ↓  ExecutionBroker (port)      backend/brokers/base/execution.py
Broker adapters (IBKR/Saxo)           backend/brokers/{ibkr,saxo} (M8/M9)
```

- **Division of responsibility:** OMS owns order state and publishes `order.*`
  events; the Execution Engine routes through the broker, handles timeouts,
  retries (on transient connection loss, bounded), and reconciliation. The
  engine publishes no events itself (avoiding duplication with the OMS).
- **Timeout safety:** a submit/cancel/modify timeout raises `BrokerError(TIMEOUT)`
  leaving order state unchanged (never assumes an outcome without confirmation);
  `reconcile()` re-syncs outstanding orders after a broker reconnect (TS-006).
- **Retry safety:** submission retries only on `CONNECTION_LOST` and is bounded
  by `submit_max_attempts`; safe only because `client_order_id` is the
  idempotency key that adapters propagate.

## Risk Architecture (M6)

The Risk Engine is the mandatory pre-trade gate between intent and execution. It
is broker-independent and evaluates only internal domain models.

```text
OrderIntent (OrderRequest)
    ↓
RiskEngine (backend/risk)                 reads: PortfolioView, AccountView,
    ├─ RiskPolicy (limits)                          MarketDataView, DailyPnlProvider
    ├─ rules (kill switch, order size, position,
    │         notional, funds, order count, loss, session)
    ├─ REJECT → RiskViolation event
    └─ APPROVE
          ↓
RiskGatedExecutor → Execution Engine       (no order bypasses risk)
```

### State ownership

- **risk owns:** kill switch, daily order counts (from `OrderSubmitted` events),
  the policy, and the decision.
- **risk reads (never writes):** positions/exposure (M7 `PortfolioView`),
  balances (account layer `AccountView`), quotes/staleness (M3 `MarketDataView`),
  and realized P&L (M7 `DailyPnlProvider`). It never re-implements portfolio.

### Fail-safe behavior (fail-closed)

A rule **rejects** when a required safety condition cannot be evaluated, unless
the rule is not configured (its limit is `None`). Documented per-rule: missing
balance, missing/stale quote, and P&L unavailable all reject with
`data_unavailable=True`. The kill switch rejects all orders while active. The
engine never silently approves an order it could not fully check.

### Concurrency

`_evaluate_sync` has no awaits, so each evaluation is atomic on the cooperative
event loop; order counts and the kill switch cannot interleave mid-evaluation.
Concurrent `evaluate` calls are serialized by the absence of awaits and the M2
bus lock. Duplicate `OrderSubmitted` events are deduped by `event_id`.

## Portfolio & P&L Architecture (M7)

The Portfolio module owns the authoritative internal portfolio state. It is
fill-driven (never order-state-driven) and broker-independent.

```text
Execution/OMS (order.* fills)  ──┐
Market Data (quotes)            ──┼─→ EventBus → PortfolioService
Broker/account (balances)       ──┘                    │
                                                       ├─ positions (authoritative)
                                                       ├─ realized P&L (cumulative + daily)
                                                       ├─ unrealized P&L / exposure / equity
                                                       └─ publishes position.opened/updated/closed
                                                              ↓
                                              serves M6 Risk read-model ports
```

- **Accounting (ADR-013):** average-cost method. Open/increase use the M1 VWAP
  `Position.apply_fill`; reduce/close/reverse realize `(exit − avg) × closed`
  (long) / `(avg − exit) × closed` (short); reducing keeps the average; a
  reversal realizes on the closing portion and opens the opposite side at the
  fill price. Fees (`commission`/`fees`) reduce realized P&L immediately.
- **Valuation policy:** the last quote's `last` (else mid) is a valid current
  price only while fresher than `price_max_age`; stale/missing prices make
  unrealized P&L `None` (never silently zero) and fall back to the average entry
  price for exposure/equity. Equity requires a known balance (cash unknown →
  equity `None`). Multi-currency aggregates return `None` (no invented FX).
- **Event processing:** duplicate fills are deduped by `fill_id`; fill order
  follows the M2 per-bus total ordering (ADR-007) and matters for average-cost
  accounting. Handlers commit state synchronously before publishing.
- **Risk integration:** `PortfolioService` implements the M6 ports
  (`PortfolioView`, `AccountView`, `MarketDataView`, `DailyPnlProvider`) so
  Risk consumes authoritative state without duplication.
- **Reconciliation boundary:** `apply_broker_snapshot(account, positions,
  balance)` aligns internal state with broker-reported domain models (used by
  M8/M9 adapters after reconnect; TS-002/TS-006).
- **Persistence:** in-memory for M7; PostgreSQL arrives with the infrastructure
  milestone. State is rebuildable from events and/or a broker snapshot.

## Broker Adapter Architecture (M8 — IBKR)

All IBKR-specific code lives in `backend/brokers/ibkr`. The core depends only on
the `brokers.base` ports; IBKR knowledge enters and ends at the adapter.

```text
        core (M3/M4/M5/M7)          brokers/base ports        backend/brokers/ibkr
        ─────────────────           ────────────────          ─────────────────────
M3 MarketDataEngine  ←────  MarketDataFeed    ←──  IbkrAdapter ←→ IbkrClient (port)
M5 ExecutionEngine   ←────  ExecutionBroker   ←──              ↕    SimulatedIbkrClient
M7 PortfolioService  ←────  balance.updated events ←──          (paper/test mode)
```

- **Transport port:** `IbkrClient` (request surface, EClient-shaped) +
  `IbkrCallbacks` (response surface, EWrapper-shaped). `SimulatedIbkrClient`
  implements the port in memory — the roadmap's simulated/paper mode. A real
  ibapi/ib_insync-backed client is the only deferred piece (ADR-014).
- **Mapping (pure, `mapping.py`):** instruments ↔ contracts (EQUITY↔STK,
  FOREX pairs ↔ CASH with base/quote split, CON_ID preserved, SMART fallback),
  orders → IBKR orders (orderRef carries the client_order_id), statuses →
  report types (fill statuses intentionally unmapped — executions carry the
  fills), executions → fills (BOT/SLD, unix → UTC), account values →
  `Balance`, positions → `Position`, IBKR error codes → `BrokerError`.
- **Lifecycle:** connect/disconnect publish `BrokerConnected` /
  `BrokerDisconnected`; unexpected disconnects keep the desired-subscription
  registry; `reconnect()` re-subscribes exactly once and replays open orders /
  executions / account / positions for reconciliation (TS-006).
- **Account identity:** the adapter relabels broker-side account data to the
  internal account id it is constructed with.
- **Duplicate safety:** IBKR repeats statuses and can redeliver executions;
  the adapter dedupes statuses per order (last-status tracking) and executions
  by `execution_id` — matching the at-least-once semantics of M2/M7.
- **Async bridging:** IBKR callbacks are synchronous; reports/feed/bus
  deliveries go through pending queues drained on the event loop
  (`auto_drain=False` gives deterministic test draining).

## Broker Adapter Architecture (M9 — Saxo)

The Saxo adapter (`backend/brokers/saxo`) reuses the SAME abstraction as IBKR
without extension — all Saxo differences live inside the adapter:

```text
        core (M3/M4/M5/M7)          brokers/base ports        backend/brokers/saxo
        ─────────────────           ────────────────          ─────────────────────
M3 MarketDataEngine  ←────  MarketDataFeed    ←──  SaxoAdapter ←→ SaxoClient (port)
M5 ExecutionEngine   ←────  ExecutionBroker   ←──              ↕    SimulatedSaxoClient
M7 PortfolioService  ←────  balance.updated events ←──          (sim/paper mode)
```

- **Transport port:** `SaxoClient` (REST + streaming request surface) +
  `SaxoCallbacks` (callback surface) with an OAuth session model:
  `authorize()` / `refresh_session()` / `logout()`. Token expiry is handled
  proactively (broker expiry notification → refresh) and reactively
  (auth-rejected request → refresh once → retry; safe because the request was
  not processed). Refresh failure drops the session (`UNAUTHORIZED`).
  `SimulatedSaxoClient` implements the port in memory (sim/paper mode; real
  transport + credential acquisition deferred, ADR-015).
- **Mapping (pure):** instruments ↔ UIC/AssetType (`SAXO_UIC` travels in the
  broker-neutral `identifiers` dict; the adapter never guesses), orders →
  Saxo orders (ExternalReference = client_order_id), statuses → report types
  (Working/WaitingConfirmation → ACCEPTED; Saxo additionally reports Expired
  → EXPIRED), executions → fills, full balance snapshots → `Balance`,
  positions → `Position` (venue preserved), error codes → `BrokerError`
  (401/403 → UNAUTHORIZED, 429 → RATE_LIMITED, 503 → CONNECTION_LOST).
- **Streaming:** quotes resolve through the subscription registry by UIC —
  quotes for untracked UICs are dropped; reconnect re-subscribes exactly once
  and replays broker state (open orders, executions, balances, positions).

### Broker capability differences (IBKR vs Saxo)

Both adapters implement the identical core ports; differences are legitimate
and documented (full parity table in `docs/TEST_STATUS.md`): authentication
(none vs OAuth refresh), instrument identifiers (`CON_ID` vs `SAXO_UIC` — both
in the broker-neutral `identifiers` field), order-type/TIF vocabularies,
status vocabularies (Saxo adds `Expired` → `EXPIRED`), account data shape
(incremental values vs full snapshots), and quote resolution (contract mapping
vs UIC registry). The core is unaware of which broker is attached.

## Persistence Architecture

Domain/models define repository interfaces (ports). `backend/infrastructure`
provides PostgreSQL implementations via SQLAlchemy (asyncio). The domain never
imports the ORM. Persistence is a dependency detail, not a domain concern.

## Configuration

Environment-driven via `.env` (see `.env.example`). Loaded centrally by
`backend/config`; other modules receive an immutable settings object. Secrets are
never hardcoded or committed.

## Logging

Structured logging with levels driven by `LOG_LEVEL`. Sensitive data (passwords,
tokens, API keys) must never be logged. PII and order/account identifiers are
redacted where required.

## Error Handling

Domain and broker errors are explicit, typed exceptions. The API layer maps them
to appropriate HTTP/WS responses. Broker errors surface through the broker
abstraction; adapters translate broker-specific errors into base error types.

## Security Boundaries

- Authentication/authorization enforced at the API layer (M12+).
- Least-privilege at every boundary.
- Secrets via environment only.
- Untrusted input validated at the API boundary.
- Risk engine is a mandatory gate between application and execution.

## Testing Architecture

```text
tests/
├── unit/          # isolated domain/business logic
├── integration/   # components together (with test DB / simulated broker)
├── e2e/           # full stack flows
├── security/      # auth, secrets, injection
├── performance/   # smoke/load
└── fixtures/      # shared test data
```

The core (domain) is tested without brokers or DB by design. Broker adapters are
tested against simulated endpoints. See `TEST_STATUS.md` for recording rules.

## Principles

- Clear separation of concerns; high cohesion; low coupling.
- Explicit interfaces; dependency inversion at boundaries.
- Prefer stateless services where appropriate.
- Avoid premature microservices — this is a modular monolith.
- No circular dependencies, god classes, or god services.

---

**Do not over-engineer.** At M0 only boundaries and tooling exist; no runtime
behavior is implemented.