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

## ADR-018 — Authentication & Authorization (M12)

- **Status:** Accepted
- **Decision:** Mandatory JWT bearer authentication with rotating opaque refresh
  sessions, a three-role RBAC model with server-side account scoping, and
  single-use WebSocket tickets - replacing the M10 anonymous-principal hook
  with no unauthenticated mode
- **Context/Rationale:** The roadmap requires AuthN/AuthZ (JWT), a
  role/permission model, and secure sessions with least privilege enforced
  server-side (FR-013, NFR-003). The M10 hook (`get_current_principal`)
  admitted an anonymous principal by design; M12 makes it real without
  touching endpoint semantics. Browsers cannot set Authorization headers on
  WebSocket connects, so the WS needs its own credential exchange.
- **Consequences:**
  - **Tokens:** short-lived stateless access JWTs (HS256, pinned algorithm,
    `typ`/`iss`/`exp`/`iat` required; signing keys must be >=32 bytes -
    RFC 7518 - enforced fail-closed) + opaque 256-bit refresh tokens stored
    server-side ONLY as SHA-256 hashes. Refresh rotates on every use;
    presenting a superseded token revokes the whole session (theft
    response). Logout revokes the session; access JWTs are not denylisted
    (short-TTL tradeoff, documented). With no `JWT_SECRET_KEY` configured,
    the process generates an EPHEMERAL secret (never logged/persisted) -
    dev-only; production must configure one.
  - **Identity sources:** a JSON users file (`AUTH_USERS_FILE`, PBKDF2
    hashes via `scripts/hash_password.py`) and/or env-provisioned demo
    users (hashed at startup). Fail-closed provisioning: unknown roles,
    duplicate usernames, empty accounts, and non-admin wildcard scopes are
    rejected at load. No users configured -> nobody can log in.
  - **Passwords:** stdlib PBKDF2-HMAC-SHA256, 600k iterations, per-user
    salt, constant-time verification, and an equal-cost dummy verify for
    unknown users so login failures are indistinguishable (no user
    enumeration in status, body, or timing profile).
  - **RBAC:** `viewer` (read-only) < `trader` (viewer + `orders:write`) <
    `admin` (trader + `risk:admin`); permissions like `orders:read/write`,
    `positions:read`, `account:read`, `market:read`, `risk:read/admin`,
    `brokers:read`. Account scoping is a per-user frozenset (the `"*"`
    wildcard is admin-only). EVERY account-scoped endpoint enforces the
    scope server-side - including scope checks on loaded order resources
    (IDOR guard) and response filtering on order listings. Kill-switch
    control requires `risk:admin`. Frontend role-aware rendering is UX
    only and never a security boundary.
  - **WebSocket:** REST issues a single-use 30 s ticket
    (`POST /auth/ws-ticket`, authenticated); the WS endpoint consumes it
    (replay-proof), re-derives the principal from the user directory, and
    verifies account scope against the runtime's bound account before
    registering with the hub (close codes 4401/4403). A valid REST session
    therefore never implies unrestricted stream access. Tickets travel in
    the URL by necessity (browsers cannot set WS headers) - they are
    single-use and consumed-or-expired before any access log can record a
    usable value.
  - **CORS:** explicit origins only (`API_ORIGINS`), credentials mode off
    (bearer-header auth), never `*`.
  - **Audit:** login/refresh/logout/kill-switch events are structured-logged
    with identifiers only (FR-012/TS-009); credentials and tokens are never
    logged.
  - **Frontend:** tokens live in memory only (never localStorage/cookies -
    re-login on reload is the accepted tradeoff); the API client attaches
    the bearer and performs exactly one single-flight refresh + retry per
    401; session expiry flips the app to the login view and unmounts the
    terminal.
  - **Limitations (documented):** login rate limiting/lockout deferred to
    M14 (delivered); the session store is in-memory (persistence with the
    infrastructure milestone - documented posture in ADR-020); `/ready` and
    the OpenAPI docs stay public (probe/schema only, no data); single-account
    runtime scopes the WS stream per process.

---

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
| ADR-018 | 2026-09-30 | Mandatory JWT + rotating refresh sessions; RBAC + account scoping; single-use WS tickets | Accepted |
| ADR-019 | 2026-10-08 | Fail-closed login throttling; secure defaults (headers, docs gating); availability caps; hardened containers | Accepted |
| ADR-020 | 2026-10-09 | Async OrderRepository port + PostgreSQL orders; mtbe-prod TLS/nginx deployment; native metrics; bounded readiness | Accepted |
| ADR-021 | 2026-10-11 | Live-stack per-broker E2E suites with evidence artifacts; simulation-only market/fill drivers via the identifiers channel | Accepted |
---

## ADR-019 — Security Hardening Controls (M14)

- **Status:** Accepted
- **Decision:** Layered abuse/availability controls and secure-by-default
  configuration, added without changing the M12 authN/authZ model
- **Context/Rationale:** M14 requires hardened secrets handling, input
  validation, dependency scanning, and secure defaults. The M12/M13 reviews
  left three documented deferrals (login rate limiting, the dev-toolchain
  advisories, docs-surface exposure) plus audit findings in availability
  (unbounded WS-ticket registry, lingering sessions), transport headers,
  and container configuration.
- **Consequences:**
  - **Login throttling (fail-closed):** sliding-window failures per
    (username, client IP) — default 5 per 60 s, configurable
    (`AUTH_LOGIN_MAX_FAILURES` / `AUTH_LOGIN_WINDOW_SECONDS`). Locked keys
    return 429 + Retry-After BEFORE credential verification, so guessing
    cannot resume by getting the password right mid-lock; success resets
    the key. The failure table is memory-bounded (active keys only +
    opportunistic sweep past 10k keys) and thread-safe. In-memory and
    single-process, like the session store.
  - **Availability caps:** a subject may hold at most 10 unconsumed WS
    tickets (issuing beyond evicts that subject's oldest — a flood can
    only harm the flooder); expired tickets and sessions are swept lazily.
  - **Secure defaults:** every response carries `X-Content-Type-Options`,
    `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
    `Cache-Control: no-store` (authenticated trading data is never cached
    by intermediaries). The OpenAPI/docs surface is OFF by default
    (`API_DOCS_ENABLED`; auto-enabled only when APP_ENV=development) so
    unauthenticated callers cannot enumerate the API surface.
  - **Input boundaries:** `InstrumentIn.identifiers` entries are
    key/value length-bounded (32/128 chars) — identifier metadata can never
    become a memory-abuse vector into the OMS.
  - **Dependencies:** the frontend dev toolchain was upgraded
    (ESLint 9 flat config, Vite 8, Vitest 5, typescript-eslint 8) — npm
    advisories went 16 → 0 (incl. a critical in the old test-runner pool);
    the production bundle never contained any of them. Backend
    `pip-audit` (project venv): 0 known vulnerabilities.
  - **Containers:** both images are build-time-install, non-root runtime;
    `.dockerignore` excludes `.env` and users files from build contexts
    (secrets could previously be baked into image layers via `COPY . .`);
    compose requires `POSTGRES_PASSWORD`/`JWT_SECRET_KEY` to be set
    (fail-fast, no insecure fallbacks), binds ports to loopback by default,
    adds healthchecks, and the frontend serves via the unprivileged nginx
    image with a strict CSP.
  - **Automated guards:** a repository secrets-scan test (tracked-file
    pattern sweep — private keys, token shapes, secret-like filenames) and
    frontend static-security tests (no HTML injection sinks, no token
    persistence, no credential logging, no dynamic code execution).
  - **Accepted/deferred risks (documented):** distributed rate-limit
    evasion (many source IPs) and general endpoint throttling require
    shared infrastructure — deferred to the M15 reverse proxy/ops layer;
    the trading-level abuse controls (M6 risk gate, kill switch, daily
    order counts) remain the in-process defense. WS tickets still appear
    in access logs only in consumed-or-expired form (ADR-018 analysis
    unchanged). System-wide Python packages outside the project venv are
    out of scope (not shipped in any artifact).

---

## ADR-020 — Production Infrastructure (M15)

- **Status:** Accepted
- **Decision:** Reproducible container deployment with a TLS nginx edge,
  env-selected PostgreSQL persistence for orders, native (dependency-free)
  operational metrics, and an async persistence port
- **Context/Rationale:** M15 requires production-grade Docker/nginx/
  deployment/monitoring/logging. The documented debt said the in-memory
  `OrderRepository` gains a PostgreSQL implementation "with the
  infrastructure milestone" (ADR-010). The M4 port was synchronous while
  the OMS runs on the event loop — a DB-backed repository must never block
  it.
- **Consequences:**
  - **Async persistence port (breaking, application-internal):**
    `OrderRepository` methods are now `async` (ADR-020); the OMS awaits
    them. The in-memory implementation is unchanged in behavior; the API,
    event flow, and all 690 tests pass unmodified in semantics. This is an
    internal application-layer change — no REST/WS contract changed.
  - **PostgreSQL `orders` repository** (`backend/infrastructure/persistence.py`):
    SQLAlchemy 2 async + asyncpg; one row per order with queryable columns
    (id, idempotency key, account, status, timestamps) + a JSON payload
    holding the full serialized domain `Order` (exact-decimal strings,
    pydantic round-trip). Upserts via ON CONFLICT; the idempotency binding
    mirrors in-memory last-binding-wins semantics; `create_all` only
    (no destructive migrations). Selected via `ORDER_REPOSITORY` +
    `DATABASE_URL` (memory default for dev/tests; postgres in the
    production compose). Portfolio and auth-session state stay in-memory
    BY DESIGN (ADR-013: portfolio rebuilds from broker reconciliation;
    sessions are short-lived — access JWTs survive restarts via the stable
    signing secret; users re-login).
  - **Readiness gating:** `/ready` now reports `database: ok /
    unavailable / not_configured` and is `ready` only when both the broker
    feed and (when configured) the order store answer. The DB ping is
    BOUNDED (2 s — review finding: an unbounded ping hung the probe on a
    paused database).
  - **Deployment topology** (`docker-compose.prod.yml`, project
    `mtbe-prod`): unprivileged nginx TLS edge (443, TLSv1.2/1.3, HSTS,
    per-IP edge rate limiting, explicit 404 for /metrics and the docs
    surface — never forwarded) → hardened frontend image → backend
    (in-memory-repo-free, DB-backed, JSON logs, no published ports) →
    postgres (strong password required, no published ports). Startup
    ordering via healthchecks; restart policies + resource limits + log
    rotation everywhere; `stop_grace_period` 30 s for graceful shutdown
    (broker feed disconnect → DB engine dispose, verified exit 0).
    Dev and prod compose are separate files with an explicit prod project
    id (review finding: the shared default project name let dev/prod
    volumes collide).
  - **Observability:** dependency-free metrics registry (counters wired to
    the event bus + gauges: WS clients, sessions, broker connection,
    uptime) exposed at an AUTHENTICATED `/metrics` (in-cluster only;
    404 at the edge). `LOG_FORMAT=json` renders every application log
    line as a single JSON object for aggregation. Identifiers-only
    logging guarantees (M12/M14) unchanged; no secrets in logs verified.
  - **CI/CD** (`.github/workflows/foundation.yml`): backend format/lint/
    strict-mypy/tests; a PostgreSQL service job for the repository
    integration tests; frontend format/lint/typecheck/tests/build with
    the dist artifact; container image builds + prod compose validation;
    pip-audit + npm audit (production deps) gates.
  - **Backup/recovery:** `scripts/backup_db.sh` (`pg_dump --clean
    --if-exists` — idempotent restore, review finding) +
    `scripts/restore_db.sh`; round-trip verified live (truncate →
    restore → API reads restored orders). TLS staging certs via
    `scripts/generate_tls_certs.*` (production mounts real certs;
    certs/ and backups/ are gitignored).
  - **Verified live (deployment validation, 13/13):** TLS frontend with
    CSP, HTTP→HTTPS redirect, 401s, login, risk-gated order through the
    proxy, in-cluster metrics counting engine events, WS ticket through
    TLS, backend SIGTERM graceful stop + auto-restart with orders
    PERSISTED across the restart (PostgreSQL), idempotency binding
    surviving the restart, /ready degrading to `starting` while the
    database is paused and recovering, /metrics + /docs 404 at the edge.

---

## ADR-021 — End-to-End Validation Approach (M16)

- **Status:** Accepted
- **Decision:** Live-stack scenario suites (parameterized over both broker
  adapters) with structured evidence artifacts, plus simulation-only
  market-data/fill drivers in the composition boundary
- **Context/Rationale:** M16 requires full-system validation from UI to the
  simulated brokers with reconciliation checks and performance smoke.
  M13 already proved the engine path in-process; what was missing was the
  same proof against the DEPLOYED production stack (TLS edge, containers,
  PostgreSQL) — the platform as an operator experiences it. Executions on
  the live stack cannot be injected from outside the process, so the
  simulated brokers need paper-trading drivers.
- **Consequences:**
  - **Live-stack E2E** (`tests/e2e/`): pytest scenarios drive the deployed
    `docker-compose.prod.yml` stack over TLS exactly like an operator
    (REST + raw WSS); the SAME suite runs per broker adapter (IBKR then
    SAXO) — zero scenario changes between brokers; only the broker-neutral
    `SAXO_UIC` identifier differs. Every scenario appends a structured
    evidence record (case, environment, input/action, expected, actual,
    pass/fail) to `tests/e2e/artifacts/e2e-<broker>-results.{json,md}`.
  - **Simulation drivers (ADR-014/015 era only, composition boundary):**
    startup-configured market subscriptions (`MARKET_SUBSCRIPTIONS`,
    compensating for the documented no-subscribe-API gap), a simulated tick
    emitter (`SIM_TICK_SECONDS`), and a paper-trading auto-fill driver
    (`SIM_AUTO_FILL`) that drives executions through the REAL adapter
    callback path. Deterministic E2E directives ride the broker-neutral
    instrument identifiers channel (ADR-015): `SIM_ACTION=PARTIAL` fills
    40% then the remainder; `SIM_ACTION=REJECT` rejects broker-side through
    the M5 reconcile path (`force_status` is poll-based — TS-006). The
    domain `Order` carries no idempotency key, so the earlier key-based
    convention could not work; identifiers are the legitimate channel.
    Real transports never set these knobs; a genuine broker supplies the
    market data and executions.
  - **Demo users for boundary scenarios:** a read-only viewer and a
    cross-account outsider join the demo-user provisioning (env-driven).
  - **Terminal coverage:** the React row is validated by the in-process
    terminal flow test (login -> submit -> WS-driven blotter -> cancel ->
    loss banner -> fresh-ticket reconnect, `frontend/src/App.flow.test.tsx`)
    plus the M16 frontend identifiers-field work; real browser automation
    (Playwright) remains an environment limitation (no browser binaries in
    the headless validation environment) — documented, not hidden.
  - **Evidence-based reviews:** the E2E artifacts ARE the review record;
    failures found during validation were investigated and fixed (see
    TEST_STATUS), never skipped.
