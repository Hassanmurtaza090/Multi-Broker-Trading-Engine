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
## API Gateway Architecture (M10)

The gateway (`backend/api`) is a pure delegation/serialization surface over
the application layer. It contains no business logic and no broker knowledge.

```text
HTTP/WS clients
      |
FastAPI app (create_app)                 backend/api/app.py
  |- REST router  (thin delegation)      backend/api/rest.py
  |    orders -> RiskGatedExecutor (M6 gate, never bypassed)
  |    cancel/modify -> Execution Engine (M5)
  |    reads -> OMS (M4) / Portfolio (M7) read models
  |    risk/kill-switch -> Risk Engine (M6)
  |- WebSocket hub (fan-out)             backend/api/ws.py
  |    consumes M2 bus -> EventSerializer -> /ws topics
  |- error mapping (DomainError -> HTTP) backend/api/errors.py
  |- schemas (DTOs, Decimal->string)     backend/api/schemas.py
  |- auth hook (M12 placeholder)         backend/api/security.py
      |
EngineRuntime (composition root)         backend/application/runtime.py
  wires bus + OMS + execution + risk + portfolio + market data + gate
      |
brokers.base ports  ->  adapters injected at backend/main.py ONLY
```

- **Composition:** `EngineRuntime` accepts injected `MarketDataFeed` /
  `ExecutionBroker` ports and owns one M2 bus; concrete adapters are imported
  only by `backend/main.py` (grep-verified). The runtime binds ONE broker (M5
  design); multi-broker routing is future work.
- **Serialization boundary:** API DTOs are distinct from domain models; every
  Decimal is a fixed-point JSON string (exact, never floats or "0E-8").
- **Idempotency (TS-004):** `POST /orders` replays the same `idempotency_key`
  as HTTP 200 with the original order.
- **Error model:** stable internal codes -> 400/404/409/422/502/503/504;
  unhandled errors -> generic 500, internals logged server-side only.
- **WebSocket sync model:** at-least-once delivery of serialized M2 envelopes
  (`event_id`, `event_type`, `timestamp`, payload); topic filtering
  (`orders,positions,market,account,brokers,risk` or `all`); bounded queues
  close slow clients (1013) instead of dropping events. Within a topic the
  engine publish order is preserved; across topics, nested reactions interleave
  by subscriber registration order (ADR-016) — clients reconcile by
  `event_id` and REST resync.
- **API documentation:** FastAPI auto-generated OpenAPI (`/docs`, `/redoc`,
  `/openapi.json`).
- **Auth:** the M12 hook is router-wide; M10 admits an anonymous principal
  (documented development posture).
## Trading Terminal Architecture (M11)

The terminal (`frontend/src`) is presentation-only: it consumes the M10
gateway exclusively (REST `/api/v1` + WS `/ws`) and holds no business, risk,
or broker logic. All trading validation stays server-side (M1 domain + M6
gate); the client validates only input shapes for usable forms.

```text
Terminal UI (pages / features / components)     frontend/src/{pages,features,components}
      ↓ reads via useSyncExternalStore
Feature stores (idempotent event merges)        frontend/src/stores
      ↑ REST resync + WS events
useTerminal (single wiring hook)                frontend/src/hooks/useTerminal.ts
      ├─ ApiClient (REST /api/v1)               frontend/src/services/api.ts
      └─ TerminalSocket (WS /ws, ADR-016)       frontend/src/services/ws.ts
```

- **Sync contract (ADR-016 client side):** WS delivery is at-least-once — the
  socket dedupes by `event_id` (bounded LRU), stores merge events
  idempotently (order upsert by `client_order_id`; positions by an identity
  key shared between WS payloads and REST rows; `position.closed` removes),
  and a full REST resync runs after EVERY successful (re)connect plus once at
  startup (independent of WS, so a WS-only outage never blocks reads).
  Cross-topic interleave is handled by merging, never by ordering
  assumptions. A fill burst additionally triggers one debounced REST resync
  for the REST-only fields (market price, server staleness, summary).
- **Reconnect policy:** capped exponential backoff, retrying forever (a
  trading terminal must keep trying); server close 1013 (slow consumer)
  reconnects + resyncs; close 4400 (invalid topics — a client bug) is fatal
  and surfaced. Ping keepalive detects half-open connections.
- **State management (ADR-017):** small typed external stores on React 18
  `useSyncExternalStore` — no state framework, stable `getSnapshot`
  identities, trivially testable pure reducers. Account switching clears
  account-scoped stores and discards in-flight results from the old account.
- **Money:** every financial value stays the backend's exact-decimal string;
  comparison/format helpers are string-based (BigInt where needed). Floats
  appear only in chart pixel math. Unpriced values render as "—", never as
  an invented zero (mirrors ADR-013).
- **Order safety (TS-003/004):** the ticket disables submission while a
  request is in flight, previews the server-side M6 decision via
  `POST /risk/evaluate` (dry-run), and manages the idempotency key across
  outcomes: kept across uncertain outcomes (network/5xx/504) so a retry
  replays the same order server-side; rotated after definitive ones.
  Cancel/modify follow the backend state machine (terminal orders are not
  actionable) and require confirmation; server errors (409, 504, 503) are
  surfaced verbatim-mapped, never swallowed.
- **Market data:** the watchlist polls `GET /market/quote` (M10 exposes no
  subscribe endpoint — documented limitation) and renders
  `market.quote.updated` events live when the engine has subscriptions;
  staleness combines the server flag with a 10 s client-side age window
  (mirroring the backend `price_max_age`, TS-007) re-evaluated on a 1 Hz
  tick. The chart is a dependency-free SVG sparkline over a capped per-
  instrument price history.

## Authentication & Authorization Architecture (M12)

Authentication lives in the API layer (`backend/api`), exactly where
ARCHITECTURE has always placed it: transport, validation of untrusted input,
authentication, serialization. There is NO unauthenticated mode — the M10
anonymous principal is gone and `get_current_principal` is a real bearer-token
dependency wired router-wide (fail-closed by construction).

```text
login/refresh (public)                    backend/api/auth.py
      |
      v
PBKDF2 verify  ──>  TokenService          backend/api/tokens.py + passwords.py
  (sessions: hashed rotating refresh + short-lived access JWTs + WS tickets)
      |
      v
get_current_principal (router-wide)       backend/api/security.py
  every request -> Bearer JWT -> Principal(subject, roles, accounts, permissions)
      |
      v
per-endpoint enforcement                  backend/api/rest.py
  require_permission(...)   +   require_account_access(...)  (IDOR guard)
  order listings scope-filtered; kill-switch needs risk:admin
      |
      v
WebSocket: single-use ticket              backend/api/app.py
  POST /auth/ws-ticket (authed) -> consume at connect (replay-proof)
  -> account-scope check vs the runtime's bound account -> 4401/4403 otherwise
```

- **Identity:** `viewer` ⊂ `trader` ⊂ `admin` roles → permissions
  (`orders:read/write`, `positions:read`, `account:read`, `market:read`,
  `risk:read/admin`, `brokers:read`); per-user account scope (`"*"` is
  admin-only). Unknown roles are rejected at provisioning AND grant nothing.
- **Server-side only:** the frontend mirrors roles for UX (hides controls,
  restricts the account selector) but every rule is re-enforced per request;
  the security/authorization test suites prove enforcement holds for a fully
  authenticated caller.
- **Token lifecycle:** access JWT (short TTL, no denylist) + opaque rotating
  refresh (server holds hashes only; reuse of a superseded token revokes the
  session); logout revokes the session; refresh derives identity from the
  SERVER-side session, never from the presented token.
- **Failure semantics:** one generic 401 for every authentication failure
  (no user enumeration in status, body, or timing — equal-cost PBKDF2 for
  unknown users); 403 states the missing permission/scope. Audit events
  (login/logout/kill-switch/denials) are structured-logged with identifiers
  only.

See ADR-018 for the full decision record.

## Cross-Boundary Integration Guarantees (M13)

The full-stack suite (`tests/integration/full_stack/`) pins these guarantees
on BOTH broker stacks, driving the system only through authenticated REST +
ticketed WS:

- **Instrument identity**: lookups (quotes, positions, valuation, risk) key
  on the domain `Instrument.primary_identifier` (exchange:symbol). This
  deliberately absorbs legitimate per-adapter enrichment — IBKR adds
  `CON_ID`, Saxo adds `SAXO_UIC` + `instrument_type`, REST DTOs may set
  neither — so a broker-built and a REST-built AAPL resolve to the same
  market data and position. The broker-neutral `identifiers` field travels
  end-to-end: `InstrumentIn.identifiers` → domain `Instrument` → adapter
  contract/UIC resolution (ADR-015). Adapters that REQUIRE an identifier
  (Saxo) fail with a typed broker error when it is absent — they never
  guess.
- **Report isolation at the trust boundary**: broker reports are untrusted
  input. An invalid report (overfill, conflicting transition, duplicate)
  is rejected by the OMS and DROPPED at the `ExecutionEngine` boundary —
  logged with identifiers only, never allowed to escape into the adapter's
  delivery loop (where it would wedge every subsequent queued report). The
  same isolation applies in the reconcile sweep: recovery always continues
  with the remaining outstanding orders.
- **Fail-closed risk through the whole stack**: a rule that needs market
  data rejects with `data_unavailable` when the quote is missing OR stale
  (TS-007) — verified end-to-end by submitting through the REST API against
  a configured notional limit.
- **Recovery**: a working order survives a broker disconnect/reconnect
  (state replay is deduplicated); broker-side changes are picked up by M5
  reconciliation; WS clients reconnect with a fresh single-use ticket and
  resync via REST (ADR-016/018).

## Security Hardening Controls (M14)

Layered on the M12 authN/AuthZ model without changing it (ADR-019):

- **Abuse/availability:** fail-closed login throttling (sliding window per
  username+IP; 429 + Retry-After BEFORE credential verification — a locked
  key stays locked even for the correct password); a per-subject cap on
  unconsumed WS tickets (flooding evicts the flooder's oldest tickets
  only); lazy sweeps of expired tickets/sessions. All counters are
  in-memory, memory-bounded, and thread-safe; shared-infrastructure
  throttling arrives with the M15 reverse proxy.
- **Secure defaults:** every response carries nosniff / X-Frame-Options
  DENY / no-referrer / Cache-Control no-store; the OpenAPI docs surface is
  OFF by default (dev-only opt-in via APP_ENV/API_DOCS_ENABLED) so
  unauthenticated callers cannot enumerate the API surface.
- **Input boundaries:** instrument identifier metadata is count- AND
  size-bounded at the DTO (16 entries, 32-char keys, 128-char values) —
  oversized input is 422-rejected before reaching the OMS.
- **Containers:** non-root runtime images; build contexts exclude .env and
  users files (secrets can never be baked into image layers); compose
  requires POSTGRES_PASSWORD/JWT_SECRET_KEY (fail-fast, no insecure
  defaults), binds to loopback by default, and the frontend serves via
  unprivileged nginx with a strict CSP.
- **Automated guards:** repository secrets-scan test + frontend
  static-security tests (no injection sinks, no token persistence, no
  credential logging, no dynamic code execution) run in every CI/test pass.
