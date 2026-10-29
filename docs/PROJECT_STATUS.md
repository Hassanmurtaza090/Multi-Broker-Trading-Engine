# Project Status

> **Live project-state document.** Keep this file current after every milestone
> or significant change. Never claim work is complete without verification.

---

## Overview

| Field | Value |
| --- | --- |
| Project | Multi-Broker Trading Engine |
| Status | Released (M17 signed off); post-release Figma adaptation in progress |
| Current Milestone | FE-M8 — Risk Management (post-release) |
| Current Phase | FE adaptation — FE-M1 (design system), FE-M2 (Dashboard), FE-M3 (Portfolio), FE-M4 (Positions/Orders management), FE-M5 (Order history/Executions), FE-M6 (Watchlists/Market data), FE-M7 (Strategy management), FE-M8 (Risk management) complete |
| Implementation Status | Backend M0–M17 complete; FE-M1…FE-M8 complete (verified) |
| Testing Status | Backend 696/696 (CI duplicate-basename collection fix + suite-hygiene guard, 2026-10-27 — see TEST_STATUS); Frontend 339/339; Playwright live visual check green (14 steps incl. positions/orders/activity/markets/strategies/risk screens, sim stack); 0 dependency vulnerabilities |
| Broker Integrations | IBKR + Saxo adapters complete (simulated clients; real transports deferred) |
| API Gateway | Complete (REST + WebSocket; authentication ENFORCED since M12) |
| Frontend | Complete + re-themed: M11 terminal, M12 login/RBAC, FE-M1 design system, FE-M2 Dashboard, FE-M3 Portfolio, FE-M4 Positions/Orders management, FE-M5 Order history/Executions, FE-M6 Watchlists/Market data, FE-M7 Strategy management (capability state), FE-M8 Risk Management |
| Deployment | Production-like stack validated (M15): nginx TLS edge + backend + frontend + PostgreSQL (ADR-020) |
| Production Deployment | Production-like stack built + live-validated (M15; controlled production rollout is M16/M17 scope) |
| Last Updated | 2026-10-29 |

---

## Completed Work

- Repository directory structure created (monorepo layout).
- Root `AGENTS.md` (permanent agent rules) authored.
- `.gitignore` and `.env.example` (placeholders only) authored.
- Project memory documentation authored (this file, ROADMAP, ARCHITECTURE,
  REQUIREMENTS, DECISIONS, TEST_STATUS, CHANGELOG, DEVELOPMENT_WORKFLOW).
- Backend foundation scaffolded (package layout, dependency management,
  lint/format/type-check/test configuration).
- Frontend foundation scaffolded (React + TypeScript + Vite, lint/format/test
  configuration).
- Docker foundation scaffolded (compose + backend/frontend/postgres structure).
- Initial test infrastructure created (tests validate the project foundation
  only — no application behavior yet).
- Backend foundation verified (pytest, ruff, mypy all pass).
- Frontend foundation verified (vitest, tsc, ESLint, vite build all pass).
- **M1 — Core Domain Model implemented** in `backend/domain`:
  - `money.py` — `Currency`, `Money`, `Quantity`, `Price` (Decimal-based,
    immutable value objects).
  - `instrument.py` — `Instrument`, `AssetClass`, `Exchange`, `InstrumentType`.
  - `orders.py` — `OrderSide`, `OrderType`, `TimeInForce`, `OrderStatus`
    (lifecycle state machine), `Order`, `OrderRequest`.
  - `account.py` — `Account`, `Balance`, `CashBalance`.
  - `position.py` — `Position` (signed quantity, VWAP via `apply_fill`).
  - `fills.py` — `Fill`, `ExecutionReport`, `ExecutionReportType`.
  - `portfolio.py` — `Portfolio` aggregation.
  - `market.py` — `MarketQuote`, `QuoteType`.
  - `errors.py` — typed `DomainError` hierarchy + stable error codes.
- **M2 — Event System implemented** in `backend/events`:
  - `base.py` — `DomainEvent` base (stable `__event_type__`, `__event_version__`).
  - `envelope.py` — `EventEnvelope` (`event_id`, `event_type`, `event_version`,
    timezone-aware `timestamp`, `source`, `correlation_id`, `causation_id`,
    typed `payload`).
  - `bus.py` — `EventBus` protocol + `InProcessEventBus` (reentrancy-safe
    per-bus total ordering, sequential handler dispatch, handler isolation,
    structured observability).
  - `registry.py` — `EventRegistry` (version-keyed `(event_type, version)` → class).
  - `serialization.py` — `EventSerializer` (envelope ↔ JSON-safe dict).
  - `types.py` — concrete event types (market data, order lifecycle,
    position lifecycle, account, broker connectivity, risk).
  - `docs/EVENTS.md` — full event catalog with per-event semantics.
- **M3 — Market Data Engine implemented**:
  - `domain/market.py` — added `MarketTick`, `Bar`, `BarInterval` (OHLCV bar
    invariants, non-negative volume, single-currency checks).
  - `brokers/base/market_data.py` — `MarketDataFeed` port with `RawQuote`,
    `RawTick`, `RawBar` payloads (implemented by IBKR/Saxo in M8/M9).
  - `market_data/engine.py` — `MarketDataEngine`: normalizes/validates raw
    feed payloads into domain value objects and publishes
    `MarketQuoteUpdated` / `MarketTickUpdated` / `MarketBarUpdated` on the M2
    event bus.
  - `market_data/subscription.py` — `SubscriptionManager`: idempotent,
    ref-counted feed subscriptions.
  - `market_data/staleness.py` — `StalenessMonitor`: stale-data detection
    (TS-007) with injectable clock.
  - `events/` — added `MarketTickUpdated` and `MarketBarUpdated` event types.
- **M4 — Order Management System implemented**:
  - `domain/orders.py` — added `Order.filled_quantity` (M1-deferred),
    `remaining_quantity`, `apply_fill_quantity`, `mark_pending_submit`.
  - `domain/errors.py` — added `OrderStateError` (code `CONFLICT`).
  - `order_management/manager.py` — `OrderManager`: create/submit/cancel/
    modify/apply execution reports with event publication, idempotency
    (`client_order_id` / `idempotency_key`) and duplicate-`report_id`
    protection.
  - `order_management/repository.py` — `OrderRepository` port +
    `InMemoryOrderRepository`.
  - `events/` — added `OrderModified` event type.
- **M5 — Execution Engine implemented**:
  - `brokers/base/execution.py` — `ExecutionBroker` port +
    `ExecutionReportHandler` (implemented by IBKR/Saxo in M8/M9).
  - `execution/engine.py` — `ExecutionEngine`: submit/cancel/modify through the
    broker, apply reports to the OMS (which publishes `order.*` events), handle
    timeouts (state unchanged), bounded connection-loss retry, and
    `reconcile()` for reconnection (TS-006).
- **M6 — Risk Engine implemented**:
  - `risk/engine.py` — `RiskEngine`: deterministic pre-trade evaluation,
    kill switch (global + per-account), daily order counts (dedup by
    `event_id`), publishes `RiskViolation` on rejection.
  - `risk/rules.py` — configurable rules (kill switch, order size, position,
    notional exposure, available funds, daily order count, daily loss, trading
    session); fail-closed when required data is unavailable.
  - `risk/policy.py` — `RiskPolicy` / `RiskLimits` / `TradingWindow`.
  - `risk/gate.py` — `RiskGatedExecutor`: mandatory pre-execution checkpoint
    (no order bypasses risk).
  - `risk/views.py` — read-model ports (`PortfolioView`, `AccountView`,
    `MarketDataView`, `DailyPnlProvider`) for state ownership (M7 supplies the
    portfolio view).
- **M7 — Portfolio & P&L implemented**:
  - `portfolio/accounting.py` — pure average-cost functions (open/increase/
    reduce/close/reverse with realized P&L, immediate fee recognition,
    unrealized/market-value/exposure math).
  - `portfolio/service.py` — `PortfolioService`: authoritative fill-driven
    positions and P&L (cumulative + daily), valuation with a staleness policy
    (`price_max_age`), balance/equity/exposure, duplicate-fill dedup,
    `position.opened/updated/closed` publishing, the M6 read-model ports, and
    `apply_broker_snapshot` reconciliation for M8/M9 adapters.
- **M8 — IBKR adapter implemented**:
  - `brokers/ibkr/contracts.py` — IBKR-shaped DTOs (contract, order, execution,
    account value, position, quote, bar, order status) + error/status codes.
  - `brokers/ibkr/mapping.py` — pure IBKR↔internal translation (instruments ↔
    contracts incl. FOREX pairs, orders → IBKR orders, statuses → report types,
    executions → fills, account values → balances, positions, errors).
  - `brokers/ibkr/client.py` — `IbkrClient`/`IbkrCallbacks` transport protocols
    (EClient/EWrapper shapes) + `SimulatedIbkrClient` (paper/test mode).
  - `brokers/ibkr/adapter.py` — `IbkrAdapter`: implements the M3
    `MarketDataFeed` and M5 `ExecutionBroker` ports; connection lifecycle with
    `BrokerConnected`/`BrokerDisconnected`; reconnect with deduplicated
    re-subscription and state replay; status/execution dedup; `balance.updated`
    publication and internal-account relabeling; `position_snapshot()` for the
    M7 reconciliation boundary.
- **M9 — Saxo adapter implemented**:
  - `brokers/saxo/contracts.py` — Saxo-shaped DTOs (session, instrument, order,
    order status, execution, quote, bar, balance, position) + status/error
    codes.
  - `brokers/saxo/mapping.py` — pure Saxo↔internal translation (UIC/AssetType
    instruments via `SAXO_UIC` identifiers, orders → Saxo orders, statuses →
    report types incl. Expired→EXPIRED, executions → fills, balance snapshots
    → balances, positions with venues, errors).
  - `brokers/saxo/client.py` — `SaxoClient`/`SaxoCallbacks` transport
    protocols with an OAuth session lifecycle
    (`authorize`/`refresh_session`/`logout`) + `SimulatedSaxoClient`
    (sim/paper mode).
  - `brokers/saxo/adapter.py` — `SaxoAdapter`: implements the SAME M3/M5 ports
    as IBKR (abstraction reused unchanged); proactive + reactive token refresh;
    streaming-registry quote resolution; connection lifecycle, reconnect
    re-subscription + state replay; status/execution dedup;
    `balance.updated` publication and internal-account relabeling;
    `position_snapshot()` for the M7 reconciliation boundary.

- **M10 - API gateway implemented**:
  - `application/runtime.py` - `EngineRuntime`: composition root wiring bus,
    OMS, execution, market data, portfolio, risk, and the risk-gated executor
    on one M2 bus behind injected ports.
  - `api/schemas.py` - API DTOs + exact-decimal (fixed-point string)
    serialization.
  - `api/errors.py` - DomainError to HTTP mapping (stable codes; generic 500
    without internals).
  - `api/rest.py` - thin REST router (orders via the M6 gate, cancel/modify
    via M5, reads via M4/M7, risk + kill-switch via M6, market quotes,
    broker status, health).
  - `api/ws.py` - `WebSocketHub`: at-least-once M2-envelope streaming with
    topic filtering, `event_id` dedupe, bounded backpressure (1013 close).
  - `api/app.py` - `create_app` factory (OpenAPI docs at /docs).
  - `api/security.py` - auth hook (M12 placeholder, anonymous principal).
  - `main.py` - composition boundary (simulated adapters; no live trading).

- **M11 — React trading terminal implemented** in `frontend/src`:
  - `services/api.ts` — typed REST client over `/api/v1` (all M10 endpoints)
    with stable-error mapping: risk 422 (violations attached), 404/409/400,
    504 timeout ("outcome unknown — safe idempotent retry"), 503 connection
    lost, network errors; exact-decimal strings passed through verbatim;
    untrusted path segments URL-encoded.
  - `services/ws.ts` — `TerminalSocket` implementing the ADR-016 client
    contract: bounded-LRU `event_id` dedupe, capped exponential reconnect
    (retry forever for a terminal), full REST resync after every successful
    (re)connect, distinct 1013 (reconnect+resync) vs 4400 (fatal) close
    handling, ping keepalive, malformed-frame isolation.
  - `stores/` — minimal typed external stores on React 18
    `useSyncExternalStore` (no state-management framework — ADR-017):
    connection, brokers, orders, positions, account, market, risk, ui.
    Idempotent event merges keyed by `client_order_id` / position identity;
    WS payloads reconcile with REST rows (same identity key); REST reads
    stay authoritative (debounced resync after fills).
  - `hooks/useTerminal.ts` — the single wiring hook: initial REST load
    independent of WS, WS event routing, account-switch resync with
    stale-result discard, watchlist quote polling (M10 has no subscribe
    endpoint), 1 Hz staleness tick (TS-007 display).
  - Terminal UI (`layouts/`, `pages/`, `features/`, `components/`):
    Dashboard / Orders / Positions views; order ticket (server-side risk
    dry-run, kill-switch warning, in-flight submit guard, idempotency-key
    lifecycle: kept across uncertain outcomes — 504/5xx/network — rotated
    after definitive ones); order blotter (state-machine-driven
    cancel/modify with confirmation, 409/504 error surfacing); positions
    table (signed qty, "—" for unpriced values — never invented zeros,
    stale badges); account panel (balances, equity/exposure, P&L summary;
    404 balance = explicit "not reported" state); watchlist + SVG
    sparkline chart; broker status (multi-broker capable list); risk panel
    (confirmed kill-switch control + bounded violation feed); connection
    banner; loading/error/empty states everywhere.
  - `config.ts` (VITE_* env with safe defaults), `vite.config.ts` dev proxy
    to the M10 gateway, dark terminal theme (`styles.css`).

- **M12 — Authentication & Authorization implemented** in `backend/api` +
  `frontend/src` (ADR-018):
  - `api/passwords.py` — stdlib PBKDF2-HMAC-SHA256 (600k iterations, 16-byte
    salt, constant-time verify, equal-cost dummy verify for unknown users).
  - `api/tokens.py` — `TokenService`: HS256 access JWTs (pinned algorithm,
    `typ`/`iss`/`exp` required, ≥32-byte key enforcement — RFC 7518);
    opaque rotating refresh tokens stored as SHA-256 hashes with
    superseded-hash theft detection (reuse revokes the session); single-use
    30s WS tickets; injectable clock.
  - `api/security.py` — `Principal` (subject/roles/accounts/permissions),
    the router-wide `get_current_principal` bearer dependency (fail-closed,
    generic 401s), the RBAC matrix (viewer⊂trader⊂admin), and
    `require_permission` / `require_account_access` enforcement helpers.
  - `api/auth.py` — `AuthService` (login/refresh/logout; identity derived
    from the SERVER session on refresh), `UserDirectory` (fail-closed
    provisioning: unknown roles, duplicates, empty accounts, non-admin
    wildcards rejected; PBKDF2-hash users file via `AUTH_USERS_FILE`),
    login/refresh (public) + logout/me/ws-ticket (protected) routes;
    identifier-only audit logging.
  - `api/rest.py` — per-endpoint authorization: permission checks on every
    route, account-scope checks incl. loaded order resources (IDOR guard)
    and cross-account idempotent replay, scope-filtered order listings,
    `risk:admin`-gated (audited) kill-switch.
  - `api/app.py` — mandatory `auth` wiring; WS ticket consumption +
    account-scope check BEFORE hub registration (4401/4403); explicit-
    origin CORS (credentials off); `/ready` stays a public infra probe.
  - `config/settings.py` (pydantic-settings), `main.py` (ephemeral dev
    secret when unconfigured — never logged; env-provisioned demo users,
    hashed at startup), `scripts/hash_password.py`.
  - Frontend: `services/auth.ts` (in-memory tokens — never persisted;
    single-flight refresh), ApiClient bearer + one 401-refresh-retry,
    TerminalSocket fresh-ticket-per-connect, `stores/authStore`,
    `features/auth/LoginView` (generic errors), login-gated `App`,
    RBAC-aware UX (viewer read-only ticket, admin-only kill-switch note,
    scoped account dropdown), logout control.

- **M13 — Integration testing implemented** in
  `tests/integration/full_stack/` (+ frontend flow test):
  - A dual-broker full-stack harness (`conftest.py`): every boundary on one
    bus — FastAPI + auth, EngineRuntime, risk gate, OMS, execution, M8 IBKR /
    M9 Saxo simulated adapters, market data, portfolio — driven ONLY through
    authenticated REST + ticket-gated WS, with deterministic portal-loop
    drains and broker-specific capability handling (Saxo UIC identifiers +
    streaming-registry subscription; IBKR direct contract mapping).
  - 56 dual-broker tests: golden trading flow (partial + completing fills,
    WS event ordering with the documented cross-topic interleave, positions/
    P&L/summary consistency, idempotent replay), failure flows (broker
    rejection, invalid input, risk-limit + fail-closed stale-quote
    rejection, duplicate executions/orders, overfill isolation, cancel
    conflicts), market-data flows (fresh/stale/missing quotes, valuation
    degradation and recovery), recovery flows (broker disconnect →
    reconnect → reconcile, broker-side cancel via reconciliation, WS client
    reconnect with fresh tickets, stable error envelopes), account
    isolation (REST + WS scope), and concurrency (parallel submissions,
    burst fills, conflicting reports).
  - Terminal-boundary flow test (`frontend/src/App.flow.test.tsx`): login →
    submit → WS-driven blotter updates → confirmed cancel → connection-loss
    banner → fresh-ticket reconnect.
  - **Defects found and fixed (with regressions):**
    (1) `InstrumentIn.identifiers` — the REST DTO could not express the
    broker-neutral identifiers (ADR-015), making a Saxo-backed runtime
    unreachable through the API; now passed through (backward compatible)
    with schema + full-stack regressions. (2) Execution-engine report
    isolation — an invalid async broker report (overfill) raised through
    the adapter delivery loop and wedged all subsequent queued reports;
    invalid reports are now dropped with identifier-only logging in both
    the async-delivery and reconcile paths (engine + full-stack
    regressions).

- **M14 — Security hardening implemented** (ADR-019):
  - `api/throttle.py` — fail-closed login rate limiting (sliding window per
    username+IP, default 5/60 s, 429 + Retry-After; success resets;
    memory-bounded keys; thread-safe) wired into the login route; settings
    `AUTH_LOGIN_MAX_FAILURES`/`AUTH_LOGIN_WINDOW_SECONDS`.
  - `api/tokens.py` — per-subject WS-ticket cap (10; flooding evicts the
    flooder's oldest tickets), expired-ticket eviction, and
    `sweep_expired_sessions()` run lazily on login.
  - `api/app.py` — security-headers middleware (nosniff / X-Frame-Options
    DENY / no-referrer / Cache-Control no-store) and docs-surface gating
    (`docs_enabled`, default OFF; main.py enables only in development).
  - `api/schemas.py` — identifier key/value size bounds (32/128 chars).
  - Frontend — dev toolchain upgraded (ESLint 9 flat config, Vite 8,
    Vitest 5, typescript-eslint 8): npm advisories 16 → 0 incl. a
    critical in the old test-runner chain; static security-guard tests
    (no injection sinks, no token persistence, no credential logging, no
    dynamic code execution, no hardcoded secrets).
  - Containers — hardened runtime images (non-root backend user,
    unprivileged nginx with strict CSP), `.dockerignore` secrets
    exclusion in both build contexts (previously `COPY . .` could bake
    `.env` into image layers), fail-fast compose secrets
    (POSTGRES_PASSWORD / JWT_SECRET_KEY required — no insecure defaults),
    loopback port binds, healthchecks, restart policies.
  - Automated guards — repository secrets-scan test (tracked-file sweep
    for private keys / token shapes / secret-like filenames) + the
    frontend statics suite; dependency scanning recorded (pip-audit venv:
    0; npm: 0).

- **M15 — Production infrastructure implemented** (ADR-020):
  - `order_management` — the M4 `OrderRepository` port is now ASYNC
    (ADR-020; the OMS awaits it) — a DB-backed repository can never block
    the event loop. Behavior-preserving; the full suite passes.
  - `infrastructure/persistence.py` — `PostgresOrderRepository`
    (SQLAlchemy 2 async + asyncpg): one row per order (queryable
    client_order_id / idempotency_key / account_id / status columns +
    a JSON payload holding the full domain `Order`, exact-decimal
    round-trip), upserts via ON CONFLICT, in-memory-identical idempotency
    binding, create-only schema init, bounded (2 s) `ping()`, NullPool
    support for multi-loop tests. Selected via `ORDER_REPOSITORY` +
    `DATABASE_URL`.
  - `infrastructure/metrics.py` — dependency-free counters (wired to the
    event bus) + gauges (WS clients, sessions, broker connection,
    uptime) at an authenticated in-cluster `/metrics`; `/ready` now
    reports and gates on database state.
  - `main.py`/`config` — persistence-first startup ordering with
    fail-fast configuration errors, JSON log format, env-driven bind
    host/port and broker adapter/account, graceful teardown in reverse.
  - `docker-compose.prod.yml` (project `mtbe-prod`) +
    `infrastructure/nginx/nginx.conf` — unprivileged TLS edge with
    modern-only TLS, HSTS, per-IP edge rate limiting, explicit 404s for
    the metrics/docs surfaces; backend/frontend/postgres publish NOTHING;
    resource limits + restart policies + log rotation; healthcheck-gated
    startup ordering. `scripts/` — TLS staging certs, idempotent
    backup/restore (`pg_dump --clean --if-exists`).
  - CI/CD (`.github/workflows/foundation.yml`) — backend format/lint/
    strict-mypy/tests + a PostgreSQL-service job for the repository
    tests; frontend format/lint/typecheck/tests/build + artifact;
    container builds + prod compose validation; pip/npm audit gates.
  - Deployment RUNBOOK at `infrastructure/deployment/RUNBOOK.md`.

- **M16 — End-to-end validation implemented** (ADR-021):
  - `tests/e2e/` — live-stack scenario suites driving the DEPLOYED
    mtbe-prod stack over TLS (REST + raw WSS), parameterized per broker:
    the SAME scenarios ran against IBKR and SAXO (34 evidence records
    each, all PASS; artifacts under `tests/e2e/artifacts/`). Covers the
    complete lifecycle (auth -> market data -> risk dry-run -> submission
    -> ack -> full/partial/rejected/cancelled executions -> position
    lifecycle -> P&L), duplicate-order idempotent replay, kill-switch
    gating, WS streaming + hello + lifecycle order, backend-restart
    persistence + idempotency survival, database-restart degradation +
    recovery, all security boundaries (401/tampered/viewer-403/IDOR/
    WS-4403/edge-404s), and performance smoke (submit p95 + concurrent
    consistency).
  - `main.py` composition (simulation-only, ADR-021): startup-configured
    market subscriptions (`MARKET_SUBSCRIPTIONS`), sim tick emitter
    (`SIM_TICK_SECONDS`), paper-trading auto-fill driver
    (`SIM_AUTO_FILL`) pushing executions through the REAL adapter
    callback path, with deterministic `SIM_ACTION=PARTIAL|REJECT`
    directives on the broker-neutral identifiers channel; viewer +
    outsider demo users for boundary scenarios.
  - Frontend: order-ticket identifiers input (broker-neutral metadata —
    closes the SAXO-from-the-terminal gap) with validation and tests.
  - `tests/unit/test_main_helpers.py` — composition config parsing
    regressions.

- **M17 — Production readiness audit + sign-off** (`docs/RELEASE.md`):
  - Final clean-environment deployment from the documented RUNBOOK +
    live validation of every operational procedure (startup, graceful
    SIGTERM shutdown exit-0, restart with PostgreSQL-persisted orders,
    database restart recovery, JWT secret rotation, JSON log
    inspection, health monitoring, backup + restore round-trip,
    rollback procedure documented).
  - Final secrets audit: tracked-file scan for every validation
    credential used across M14-M16 — one documentation finding (the
    E2E README example matched live validation values) found and
    fixed; re-scan clean; .env/certs/backups gitignored.
  - Requirements audit: every FR/NFR/TS marked implemented+validated
    or an explicit deferral; zero release blockers.
  - Independent multi-perspective final review (Architect, Security,
    QA, DevOps — actively challenging the claim) recorded in
    TEST_STATUS; all findings classified; zero blockers, zero
    high-risk in-scope items.


- **FE-M1 — Figma design system & trading terminal (post-release, 2026-10-23,
  commit c23d785)** in `frontend/src`:
  - Visual source: the retrieved Figma Make project
    "Multi-Broker-Trading-Engine-UI" (design tokens transcribed exactly).
  - Full re-theme of `styles.css` onto the prototype's tokens (palette,
    self-hosted DM Sans + Space Grotesk — CSP-safe, no runtime CDN,
    breakpoints 1050px/700px); every pre-existing class keeps working.
  - Figma shell: fixed sidebar (WORKSPACE/PLATFORM sections, real
    destinations enabled, unimplemented ones visibly disabled, real
    working-order badge, user chip) + sticky blurred header (⌘K search
    with client-side watchlist filter, broker chip, market-status pill,
    kill-switch/broker/stream badges, account selector, logout).
  - Trading Terminal screen: stat cards (real equity/P&L/buying power;
    LIVE badge wired to the actual WS state), chart workspace (real quote
    history line; timeframes/indicators honestly disabled — no subscribe
    API; real FRESH/STALE readout), Markets card (asset-class tabs, search
    filter, coin icons, per-row sparklines), quick-order ticket restyle
    (segmented side/type, exact BigInt "Est. total" from the live quote),
    positions/orders tabs card, functional strip (risk + brokers).
  - New primitives: Icon (prototype SVG set), SegmentedControl, Panel
    subtitle/flush, Sparkline compact mode; useOpenOrderCount primitive
    store subscription (re-render optimization); exact display arithmetic
    (addDecimal/multiplyDecimal) in utils/decimal.
  - Honesty rules kept: no fee/24H-change/candlestick/meter fabrication
    ("—" when unreported); orders only through the existing risk-gated
    simulated workflow.
- **FE-M1 fix — Python Decimal scientific-notation wire values (368b9ce)**:
  found live by the Playwright check (`Cannot convert 0E-8 to a BigInt`):
  `str(Decimal("0.00000000"))` → `"0E-8"` crashed the M11 order mapper on
  every order lifecycle event; fixed via `expandScientificDecimal()` in
  utils/decimal (display + parse paths; lowercase user input still
  rejected) + the crash site in stores/mappers; regression tests added.
- **FE-M1 tooling — Playwright visual verification (686d599)**:
  `npm run visual:check` (scripts/visual-check.mjs) drives the REAL app
  against the REAL backend (login → add AAPL → live chart → paper order →
  sim auto-fill) and captures desktop/mobile screenshots; uses the
  installed Chrome (channel "chrome", no browser download); replaces the
  abandoned AutoClaw path (regional auth block); demo credential comes
  from `TRADER_PASSWORD` env — never hardcoded.
- **FE-M2 — Dashboard & application navigation (post-release, 2026-10-26)**:
  - New "overview" view (store-driven; no router library — ADR-017 kept):
    sidebar "Overview" (the Figma nav destination) is now ENABLED and
    lands on the Dashboard; Trade/Orders/Positions unchanged; default
    view stays "dashboard" (the M13 flow contract requires the blotter on
    the landing screen).
  - Dashboard (`pages/OverviewPage`): inferred layout (the Figma
    prototype has NO dashboard frame — documented): greeting title with
    the REAL session identity (the design's "Good morning, Alex"
    pattern, honestly adapted), reused M1 StatCards, new read-only
    snapshot cards (PositionsSummaryCard, OrdersSummaryCard — working
    count + recent activity via the existing order store, no separate
    executions endpoint exists; WatchlistSnapshot — shared quoteState
    badge logic extracted with the Markets card), reused M11 panels
    (Account, Brokers, Risk). Navigation shortcuts only — NO order
    execution on the Dashboard (M2 rule); `gotoOrderTicket` shared by
    Trade + Dashboard.
  - Frontend tests 147 → 158 (11 new dashboard/navigation tests; 2
    assertions legitimately updated: sidebar disabled-count 5→4 as
    Overview became real — no assertion weakened).
- **FE-M3 — Portfolio & Account Overview (post-release, 2026-10-27)** in
  `frontend/src/features/portfolio` + `pages/PortfolioPage`:
  - New "accounts" view wired to the sidebar's Figma "Accounts"
    destination (now ENABLED — disabled destinations are down to
    Activity/Strategies/Settings). Store-driven navigation kept
    (ADR-017); default landing view unchanged.
  - DESIGN NOTE: the Figma prototype contains NO portfolio/accounts
    frame — the layout is inferred from the established FE-M1 design
    system and documented in `pages/PortfolioPage.tsx`.
  - `AccountsCard` — the user's server-scoped accounts with the ACTIVE
    account and switching via the EXISTING `uiStore.accountId`
    mechanism (switching re-syncs all account-scoped data — the
    supported refresh path; no decorative refresh button). Wildcard
    admins keep the free-entry selector. Broker identity + connection
    states from the real brokers store. Documents the single-account
    runtime (ADR-016) — never claims cross-account aggregation.
  - `PortfolioMetricsCard` — currency-aware metrics preserving the
    distinct backend fields (cash total / available / buying power per
    ccy; equity; exposure = used margin; unrealized / realized P&L and
    market value per ccy) with per-metric tooltips. CURRENCY RULE:
    values NEVER summed across currencies (no FX endpoint, ADR-013);
    NULL equity (multi-ccy accounts) shows "not reported" with the
    reason — never zero-filled.
  - `AllocationCard` + pure `computeAllocation` (unit-tested): per-
    currency gross exposure by instrument derived EXACTLY from
    position marks (BigInt string math; floats only for bar widths —
    ADR-017); short positions keep signed values; unpriced positions
    are EXCLUDED and counted; stale marks flagged; shares computed
    only within a currency group.
  - Reused: BrokerStatusPanel, shared primitives, design tokens; no new
    dependencies; NO order execution anywhere on the page (M3 rule).
  - Frontend tests 158 → 176 (18 new: 7 pure allocation unit tests +
    11 component/page tests); App nav tests extended. Live Playwright
    check extended (step 9) and verified against the sim stack
    (07/08-portfolio-desktop/mobile screenshots; zero page errors).
- **FE-M4 — Positions & Open Orders Management (post-release, 2026-10-28)**:
  - DESIGN NOTE: the Figma prototype has no dedicated positions/orders
    screens; the bottom-card mock's column set (Asset | Broker | Size |
    Avg. price | Market value | P&L — the Broker tag included) and the
    Positions/Open orders/Order history tabs are the design signals
    honored; everything else is inferred from the FE-M1 design system.
  - `PositionsTable` (upgraded, `compact` mode for the terminal tabs
    card): sortable columns (numeric decimal comparison — never
    lexicographic), direction segmented filter (All/Long/Short) + symbol
    text filter, LONG/SHORT/FLAT chips derived from the signed quantity,
    Broker column (runtime broker identity, single-broker note,
    ADR-016), per-currency unrealized totals (exact within-currency
    sums only), no-match empty state, row-click → chart the instrument
    on Trade (prefers the watched identity). Unpriced "—" and stale
    badges unchanged (ADR-013 policy).
  - `OrderBlotter` (upgraded, `compact` mode): the select filter became
    the design-consistent segmented All/Working/Done radiogroup (same
    accessible name; working vs terminal classification unchanged);
    sortable columns (newest-first default); new full-mode columns:
    order identifier (truncated, full id on hover), remaining quantity,
    submission time (full ISO on hover). Cancel/Modify flows preserved
    UNCHANGED (confirmed dialogs, in-flight guard, 409/504 surfacing);
    UX-only gating now hides the actions for users without
    orders:write (server enforces regardless — M12). No close-position
    action exists (no endpoint) and none is faked.
  - `PositionsPage` restructured for the wide table (full-width table +
    account/broker detail below) with page-title shortcuts.
  - Frontend tests 176 → 188 (12 new: 4 blotter M4 tests incl. viewer
    gating + numeric-sort regression; 8 positions-table tests); the
    blotter filter tests moved to the segmented interaction. Live
    Playwright check extended (step 10) and verified against the sim
    stack (09/10-positions/orders-desktop screenshots; zero page
    errors).
- **FE-M5 — Order History & Executions (post-release, 2026-10-28)**:
  - DESIGN NOTE: the Figma prototype lists "Activity" in the sidebar
    (Overview, Trade, Orders, Positions, Accounts, Activity) and names
    the third bottom-card tab "Order history", but ships no frames for
    either screen. The layout therefore follows the FE-M1 design system
    (page title → summary strip → panel with toolbar/table) and the
    existing table/badge/dialog primitives; no invented visual element
    was added.
  - `ActivityPage` (new view `activity`, sidebar Activity now ENABLED —
    it was a disabled placeholder through FE-M4): segmented sections
    "Order history" / "Executions" plus a summary strip counting the
    backend's own statuses (filled/partial/cancelled/rejected/expired/
    working) and the live fill count.
  - `OrderHistoryTable` (read-only): the authoritative `GET /orders`
    read model, defaulting to "All finished" (FILLED/CANCELLED/
    REJECTED/EXPIRED) so a working order is never shown as history.
    Filters: status (finished / each backend status / everything), side,
    account (only when >1 account is present), UTC-day from/to range,
    and symbol-or-order-id search; sortable Submitted/Symbol/Qty/
    Filled/Status with NUMERIC decimal comparison. Columns preserve
    broker + account identity, order id, type, qty/filled/remaining,
    limit/stop, status badge. Real Refresh (re-reads `listOrders`) and
    an error state that names the failure; no-match and empty states
    are distinct.
  - `OrderDetailDialog`: opens with the held snapshot then refreshes
    from `GET /orders/{client_order_id}` (existing M13 endpoint, newly
    exposed as `ApiClient.getOrder`); a failed refresh shows the cached
    snapshot WITH an alert (never silently presented as fresh). Shows
    lifecycle timestamps, broker order id, rejection reason, and the
    fills captured for that order.
  - `ExecutionsTable` + `executionsStore` (NEW): the backend exposes NO
    execution-history endpoint (verified: no fills in `OrderOut`, no
    `/executions` route), so fills are captured from the WS
    `order.partially_filled` / `order.filled` payloads (which carry a
    full `Fill`), keyed by `fill_id` (at-least-once dedupe), bounded at
    500, newest-first. The panel labels itself a SESSION CAPTURE at the
    point of display and states that reloading loses it — nothing is
    derived from an order's status, and unreported commission/fees
    render "—", never 0.
  - Shared helpers: `utils/time.ts` (full/compact timestamps, UTC day)
    and pure `features/history/orderHistoryFilters.ts` (filter/sort/
    summarize/count/distinct-accounts) — no React, fully unit-tested.
  - Frontend tests 188 → 223 (35 new: 17 pure filter/sort/summary
    tests, 5 executions-store tests incl. dedupe + bounded eviction, 17
    component/integration tests across both tables + the detail dialog
    + an App-level WS→store→Activity flow). App nav tests updated for
    the now-2 disabled destinations. Lint/typecheck/format/build green.
    Live Playwright check extended (step 11) and verified against the
    sim stack: 6 historical FILLED rows, 1 live fill captured,
    11/12/13 screenshots, and URL-level HTTP-failure evidence.
- **FE-M6 — Watchlists & Market Data (post-release, 2026-10-28)**:
  - DESIGN NOTE (CORRECTED 2026-10-28): the Figma Make prototype DOES have a
    market-data destination. Its sidebar (`src/App.tsx:40-49`) is
    WORKSPACE: Overview / Trade / Orders / Positions / Accounts / Activity /
    Portfolio / **Market Data**, and `src/App.tsx:211` renders the Market Data
    screen (watchlist selector + quote ladder). An earlier version of this
    record claimed the prototype had "no Markets/watchlist destination" —
    that was wrong and has been retracted. The prototype additionally has a
    "Markets" card inside the Trade screen (Watchlist/Crypto/Stocks/Forex
    tabs, columns Instrument | Last price | 24H | Chart), which supplies the
    instrument-icon/tab/quote-badge vocabulary FE-M6 reuses.
    The remaining gap against the design is therefore NAVIGATION NAMING, not
    existence or coverage: the implementation registers the view as `markets`
    and labels the sidebar entry "Markets" while the prototype says "Market
    Data". Renaming touches the `TerminalView` union, `TerminalLayout`,
    `App.tsx`, tests and prior docs, so it is recorded as a tracked follow-up
    rather than bundled into this milestone. The mock's "24H" column is
    deliberately NOT reproduced: the provider reports no previous close, day
    open, or change (see below), and a fabricated number is prohibited.
  - DATA REALITY (verified before implementing): the backend exposes NO
    watchlist capability — no watchlist route in `backend/api/rest.py`,
    no runtime subscribe endpoint, and quotes stream only for the
    instruments configured by `MARKET_SUBSCRIPTIONS` at startup. `QuoteOut`
    carries symbol/exchange/currency/bid/ask/last/mid/timestamp/stale
    only. Watchlists are therefore an explicitly labelled
    THIS-DEVICE-ONLY client feature.
  - `stores/watchlistsStore.ts` (NEW): named lists with create / rename /
    delete / select, instrument add/remove de-duplicated by FULL identity
    (symbol + asset class + currency + venue — the same symbol on two
    venues is two instruments), caps (20 lists, 100 instruments per list)
    and case-insensitive duplicate-name rejection. Persistence is
    `localStorage` (`mbt.watchlists.v1`) with a versioned payload, strict
    validation of untrusted stored JSON (malformed entries/duplicates
    dropped, unknown active id falls back to the first list, unusable
    payload → default state), and HONEST storage health
    (ok / unavailable / error) surfaced in the UI — a failed save is
    reported, never assumed. Pure reducers keep list semantics unit-
    testable without React. `resetAllStores` clears the persisted copy.
  - `marketStore.replaceWatchlist` (NEW): the store stays the single quote
    pipeline — the active list is MIRRORED into `marketStore.watchlist`
    after every mutation, so the existing 5 s REST poll in `useTerminal`,
    the chart history and the dashboard card are unchanged, there is no
    second connection and no additional polling. Quotes/history for
    instruments that leave the list are retained (polling stops, the
    staleness rule then labels the frozen quote stale rather than live).
  - `MarketsPage` + `features/markets/WatchlistRail.tsx` +
    `WatchlistTable.tsx`: new `markets` view (sidebar entry ENABLED; the
    two remaining Figma destinations, Strategies and Settings, stay
    visibly disabled). Table shows Last/Bid/Ask via `MoneyText` ("—" for
    missing values, never 0), the SHARED `quoteStateBadge` mapping
    (Live / Polled / Stale / No data / Error — the Markets screen can
    never disagree with the dashboard card about freshness), quote
    origin time, per-row Trade/Remove actions, sortable numeric columns
    (exact decimal comparison, unknown values last), search + asset-class
    filters with a working clear, and a quote-count summary line.
  - `features/markets/sessionChange.ts` (NEW): "Session Δ" is the change
    between the first and latest quote THIS terminal observed in the
    session (sample count + from/to timestamps in the tooltip), shown
    only with ≥2 observations and labelled NOT a daily/24H change. The
    page's "Quote semantics & limitations" panel states the same thing in
    the UI: source/poll cadence, badge meanings, what the API does not
    report (daily change, previous close, session status, depth/volume,
    descriptions), that "—" is never zero, and that watchlists are
    browser-local with no cross-device sync.
  - Dashboard `WatchlistPanel` re-wired to `watchlistActions` (add/remove
    now mutate the ACTIVE named list, with a default-list fallback when
    every list was deleted) so the card and the Markets screen can never
    hold divergent instrument sets. `utils/instrument.ts` gained an
    OPTIONAL `name` (taken only from a WS `description`, never synthesized
    from the symbol) plus `normalizeDescriptor`; the instrument-icon tone
    map moved to the shared `utils/instrumentTone.ts`.
  - Frontend tests 223 → 265 (42 new: 23 watchlists-store tests — reducer
    semantics, caps, duplicate identity vs duplicate symbol, storage
    error reporting, serialization round-trip, corrupt/duplicate payload
    rejection, hydration on module load, no-credential persistence; 18
    Markets-page tests — list CRUD + confirmation, duplicate feedback,
    venue-distinct rows, filters/clear, shared freshness badges, "—" for
    missing values, session-Δ gating/tooltip/tone, numeric sorting,
    Trade navigation, limitations panel; 1 App-level WS→Markets-row
    flow). App nav tests updated for the new enabled destination (the
    disabled count stays 2: Strategies, Settings).
    Lint/typecheck/format/build green. Live Playwright check extended
    (step 12) and verified against the sim stack: 1 watchlist, 1 AAPL row
    with state LIVE, a populated session-Δ cell, and
    15/16-markets-desktop/mobile screenshots; no page errors, the only
    HTTP 4xx being the pre-existing documented balance 404.

- **FE-M7 — Strategy Management (post-release, 2026-10-29)**:
  - CAPABILITY REALITY (verified before implementing, not assumed): the
    backend has NO strategy capability. A repository-wide search for
    "strateg" across `backend/` (sources, tests, config, OpenAPI) returns
    zero matches: no strategy domain package, no route in
    `backend/api/rest.py`, no schema in `backend/api/schemas.py`, no event in
    `backend/events/types.py`, and no strategy reference on `OrderRequest` /
    `Order` / `Fill`. Strategy listing, configuration, lifecycle
    (start/stop/pause/resume), per-strategy P&L, deployment and backtesting
    therefore cannot be built without fabricating records or faking a
    successful save/lifecycle transition — all prohibited.
  - DESIGN NOTE: the prototype DOES have a Strategies screen — sidebar
    PLATFORM entry (`App.tsx:99`) and a body at `App.tsx:206` (metrics
    "Active strategies / Strategy P&L / Execution health", tabs
    "Active strategies / Backtest / Library", a
    Strategy name | Symbol | Status | Last run table, "Pause"/"Resume",
    "+ Create new strategy" and "Run backtest" with a hardcoded result).
    M7 ships that LAYOUT with honest content: the metric slots show "—" with
    the blocking reason, the table keeps the design's columns but its single
    body row is an explicit absent-capability note, and every designed
    control renders disabled with its reason in the tooltip. No demo figure
    or demo strategy name is reproduced anywhere (asserted by test).
  - `features/strategies/capabilities.ts` (NEW): typed, pure registry of the
    7 designed capabilities (listing, configuration, lifecycle, attribution,
    deployment, backtest, library) — each with the design reference, the
    reason it is unavailable, and the EXACT backend work required
    (e.g. `GET /api/v1/strategies?account_id=`,
    `PUT /api/v1/strategies/{id}/config` with typed parameter descriptors and
    optimistic concurrency, `POST /strategies/{id}:start|:stop|:pause|:resume`
    returning the authoritative state, `POST /api/v1/backtests` + a bars
    producer, `GET /api/v1/strategy-types`, optional `strategy_id` on orders
    for attribution). Also records the four structural gaps (no strategy
    domain, no runtime, no bar producer, no attribution key) and the four
    foundations a future service must reuse (risk gate as the only submit
    path, OMS idempotency, the event bus, portfolio accounting).
    `summarizeCapabilities()` / `capabilitiesByArea()` keep the counts and
    grouping unit-testable, and flipping a capability to "available" later is
    a registry change that must ship the real data source in the same commit.
  - `features/strategies/StrategyCapabilityCard.tsx` (NEW): capability card
    (title, "Unavailable" badge, design reference, reason, required work) and
    the records table. Uses a plain badge rather than `StatusBadge` on
    purpose: `StatusBadge` carries `role="status"` (a polite live region) and
    seven static availability badges must not announce themselves as changing
    state.
  - `pages/StrategiesPage.tsx` (NEW): page composition — capability badge,
    the design's three metric slots as unavailable, the "Strategy management"
    panel with a `SegmentedControl` over the prototype's three areas (a real,
    working control that swaps the capability cards), disabled design
    actions, the records table, a "What this platform does today" panel with
    working navigation to Trade/Orders/Activity/Positions, the structural-gap
    and reusable-foundation panels, and a milestone-scope panel. The page
    performs NO fetch, opens no socket, and triggers no lifecycle action on
    mount or on any interaction.
  - `layouts/TerminalLayout.tsx`: `VIEWS` gained a `section` field so real
    destinations render in the design's WORKSPACE/PLATFORM groups;
    "Strategies" moved from `COMING_SOON` to a real view (icon `layers`)
    under PLATFORM, leaving Settings as the single disabled destination.
    `uiStore.TerminalView` gained `"strategies"` and `App.tsx` routes it.
  - DESIGN CORRECTION (this release): the FE-M6 record above wrongly claimed
    the prototype had "no Markets/watchlist destination". It has one — the
    sidebar's 8th WORKSPACE entry "Market Data" (`App.tsx:40-49`) with a real
    body (`App.tsx:211`). The record and the `MarketsPage` /
    `TerminalLayout` comments were corrected; the remaining gap is the
    navigation LABEL ("Markets" vs "Market Data"), recorded as a tracked
    follow-up because it touches the `TerminalView` union, tests and prior
    docs.
  - `docs/FE_SCOPE_RISK_PORTFOLIO_REPORTS.md` (NEW): the pre-implementation
    scope spec for the next three backed destinations (Risk Management,
    Portfolio promotion, Reports) — per-screen API mapping against the real
    DTOs, the explicitly unbacked elements (daily drawdown, margin level,
    VaR, max drawdown, leverage, asset-class allocation, cross-currency
    totals, PDF), CSV-only reporting with an injection guard, and the six
    minimal backend asks (B1 limits, B2 account registry, B3 equity series,
    B4 report generation, B5 executions read model, B6 violation history).
  - Frontend tests 265 → 287 (22 new: 5 registry-integrity tests — unique ids,
    7 capabilities all unavailable, non-trivial reason + requirement per
    entry, tab grouping with no empty area, gaps/foundations recorded and the
    risk gate named as mandatory; 13 page tests — shell + capability badge,
    "—" metrics with no digit in the metrics region, no prototype demo
    literal or demo strategy name rendered, table headers with exactly one
    absent-state body row, disabled controls with `aria-disabled` + reason
    that neither navigate nor fetch when clicked, zero fetches on mount,
    rendered per-capability backend contracts; 3 tab tests — real area
    switching, library blocker, backtest blocker naming the missing bar
    producer; 6 navigation/scope tests). App nav tests updated, not weakened:
    the disabled count went 2 → 1 (Settings only), the sidebar test now
    asserts Strategies is enabled and renders its screen, and a new
    DOM-order test asserts Strategies renders inside the PLATFORM group
    (design sidebar order) rather than WORKSPACE.
    Lint/typecheck/format/build green. Live Playwright check extended
    (step 13) and verified against the sim stack: badge
    "CAPABILITY NOT PRESENT", metric values "—, —, —", 5 capability cards,
    2 disabled actions, 1 absent-state table row, backtest tab swapping to 1
    card with "Run backtest" disabled, screenshots
    17/18/19-strategies-*, and NO `strateg`-matching xhr/fetch request during
    the entire run; zero page errors; the only 4xx remain the pre-existing
    documented balance 404 (plus the favicon console entry).


- **FE-M8 - Risk Management (post-release, 2026-10-29)**:
  - VERIFIED BACKEND SURFACE (inspected before implementing, not assumed):
    the only risk routes are `GET`/`POST /api/v1/accounts/{id}/risk/kill-switch`
    (`risk:read` / `risk:admin`), `POST /api/v1/accounts/{id}/risk/evaluate`
    (`orders:write`, a dry run that creates no order), the account
    `summary`/`positions`/`balance` read models, and the WS `risk.violation`
    event. There is NO limits endpoint - a search for "limit" across
    `backend/api` returns only login rate limiting and `limit_price`.
  - ENFORCEMENT vs DISPLAY: the 8 pre-trade rules (`backend/risk/rules.py`)
    and the kill switch are enforced server-side by
    `RiskGatedExecutor.submit -> RiskEngine.evaluate` on every
    `POST /orders`. `RiskLimits` (`backend/risk/policy.py`) is configuration
    with no read endpoint, so the page reports the rule set with
    "Not exposed" for all 7 configurable thresholds (the kill switch is the
    only rule whose state is readable) and renders NO edit control: no
    default limit is invented and no frontend-only rule is stored.
  - `features/risk/riskMetrics.ts` (NEW, pure, unit-tested): the rule
    catalogue transcribed from the backend, the "not reported" metric list
    with the reason for each, and the only derived figures - per-currency
    long/short/net/gross exposure, concentration per currency (reusing the
    M3 `computeAllocation`), position market value, and exposure-to-equity as
    a float percentage (floats for percentages only - ADR-017). All money
    math is exact `utils/decimal` string arithmetic; nothing is summed across
    currencies (ADR-013); unpriced positions are excluded AND counted, never
    valued at 0.
  - `features/risk/useRiskData.ts` (NEW): a `usePositionsList()` selector so
    the module reads the existing `positionsStore` instead of fetching.
  - Components (NEW): `RiskOverviewCards` (equity, gross exposure plus a
    derived share of equity, per-currency unrealized P&L, open-position
    counts), `RiskMetricsCard` (per-currency concentration plus 5 explicit
    "Not reported" rows: daily drawdown, margin level, VaR, max drawdown,
    leverage), `RiskLimitsCard` (8 enforced rules, "Not exposed" thresholds,
    live kill switch), `RiskViolationsCard` (session-only `risk.violation`
    feed with a real rule filter and NO acknowledge action - no endpoint
    exists), `PositionRiskCard` (direction, quantity, average/last mark,
    derived market value, server unrealized P&L, stale/unpriced badges, and
    no stop column because nothing links a position to a protective order),
    `RiskTestPanel` (pre-trade dry run via `POST /risk/evaluate`, gated by
    `userCanTrade()`, duplicate-submit safe, and it never references the
    order-submission client method - asserted by a static test), and
    `KillSwitchControl` (extracted from `RiskPanel`; identical DOM and
    behaviour, so the four existing RiskPanel tests still pass untouched).
  - `pages/RiskPage.tsx` (NEW): page header with account and
    broker/connection context, a provenance note (no per-response `as_of`
    exists, so freshness is bounded by the stream state rather than
    asserted), the regions above, and a user-visible "Not supported by this
    backend" table with the exact required work per gap: a limits read
    endpoint, utilisation measurements, persisted + acknowledgeable
    violations, margin data with an explicit account currency, an equity
    series for drawdown/VaR, a position-to-protective-order linkage with
    contract specs, a limits update endpoint with audit, and `as_of`
    timestamps.
  - `layouts/TerminalLayout.tsx`: "Risk Management" added under PLATFORM
    after Strategies (icon `shield`, added to `Icon.tsx`);
    `uiStore.TerminalView` gained `"risk"` and `App.tsx` routes it. Settings
    remains the single disabled destination.
  - NO new fetch, socket, store or API client: the workspace is a projection
    of `accountStore` / `positionsStore` / `riskStore` / `brokersStore`, all
    populated by `useTerminal`.
  - DESIGN NOTE (inferred; recorded in the page header): the prototype has a
    Risk screen (`src/App.tsx:207` of the Figma Make file) with a header,
    four metric tiles, "Risk metrics", "Risk limits", risk alerts and a
    pre-trade check. The REGIONS are preserved; tile/column CONTENT is
    substituted wherever the prototype shows a figure this platform cannot
    source, and every substitution is labelled in the UI. Figma access was
    read-only and text-only, so fidelity is structural, not pixel-level.
  - Frontend tests 287 -> 339 (52 new: 23 pure metric/rule tests in
    `features/risk/riskMetrics.test.ts`, 29 component/page tests in
    `features/risk/risk.test.tsx`). App nav assertions extended, not
    weakened: the disabled count stays ["Settings"], Risk Management is
    asserted enabled, ordered after Strategies inside PLATFORM, and it
    renders its heading and "Risk limits" region. Lint/typecheck/format/build
    green. Live Playwright check extended (step 14) against the sim stack:
    context badge "IBKR (CONNECTED)", metric values "-" / per-currency P&L /
    open-position count, 8 limit rows with exactly 7 "Not exposed" and 5
    "Not reported", 1 position row, 0 alert rows, dry-run disabled on an
    empty form, screenshots 20/21-risk-desktop/mobile; zero page errors; the
    only 4xx remain the pre-existing documented balance 404.

> M10 itself contains no frontend logic; the M11 terminal above consumes it
> over REST + WS only.
> ibapi-backed IBKR and OpenAPI-backed Saxo transports are deferred
> (ADR-014/ADR-015); M8/M9 are verified against simulated clients only.

---

## In-Progress Work

- None - backend M0-M17 and the FE-M1..FE-M8 post-release frontend milestones are complete and verified. Remaining follow-ups are the documented pre-real-money checklist (real broker transports, sandbox validation, CA certs) and the frontend candidates below.

## Next Frontend Milestone Candidates (post-release)

- **FE-M9 (recommended next)**: Portfolio promotion + Reports — account-scoped equity/P&L
  allocation already exists (no new endpoints), and Reports can ship as real
  client-side CSV with an injection guard (spec §4/§5). Bundles the mechanical
  `PortfolioPage` → `AccountsPage` rename.
- **TRACKED RENAME (small, not a milestone)**: `markets` → `marketData` /
  label "Market Data" so the navigation matches the prototype; touches
  `TerminalView`, `TerminalLayout`, `App.tsx`, tests and prior docs.
- **STRATEGY BACKEND (blocks any real strategy UI)**: FE-M7 documents the
  exact contracts required — strategy resource + typed parameter schemas,
  a strategy runtime with `:start|:stop|:pause|:resume` returning
  authoritative state, a bars producer/historical store + backtest service,
  and an optional `strategy_id` on orders for attribution. Until the runtime
  exists there is nothing for the UI to drive, and the screen must keep
  reporting the capability as absent.
- **SETTINGS**: still no settings API; only local preferences (theme, default
  view) can be honest. Requires a server-side preferences resource before the
  destination can be enabled.

- **BACKEND GAP (watchlists)**: FE-M6's watchlists are browser-local because no
  watchlist REST resource exists. A `GET/PUT /api/v1/watchlists` (per user or
  per account, validated server-side) would let `stores/watchlistsStore.ts`
  swap its `localStorage` adapter for the API without changing any component
  contract; the UI's "this device only" copy is derived from the store's
  storage health, so it would flip automatically.
- **BACKEND GAP (market-data subscription)**: FE-M6 polls the same instruments
  the engine subscribed at startup. A runtime subscribe/unsubscribe endpoint
  (and a quote field for previous close if the venues supply one) would let the
  Markets screen quote arbitrary watchlist instruments and replace "Session Δ"
  with a real daily change.
- **BACKEND GAP (needed by FE-M5 to become true history)**: an execution/
  fill read model. The domain already has `Fill` (fill_id, order id, price,
  quantity, commission, fees, executed_at) and the engine publishes one per
  `order.partially_filled`/`order.filled` event, but nothing is persisted or
  queryable. A `GET /api/v1/executions?account_id=…` (+ optional order filter)
  returning those records would let `ExecutionsTable` switch from the current
  session capture to a REST read model without any component contract change.
  Until then the UI states the limitation rather than simulating history.
- The same gap implies no durable "average fill price" per order; once
  executions are persisted, an order-level VWAP can replace the current
  "filled notional at limit" approximation shown in the detail dialog.
- A public open-orders endpoint would let Open Orders use a dedicated
  `status=open` server-side query instead of the client-side working/terminal
  classification of the orders feed.
- Real broker transport + sandbox validation (pre-real-money checklist)
  remains the gating item before any live cancellation is exercised
  against a broker; the M4 cancel flow is currently validated against
  the paper/sim stack only.
- A market-data subscribe API would unlock timeframe selection, real
  candlesticks, and a portfolio-value history chart (currently omitted —
  fabricating them is prohibited).
- An FX-conversion design (ADR-013) would unlock cross-currency equity
  and consolidated multi-account totals (the Portfolio page is structured
  for it — per-currency groups are already isolated).

---

## Planned Work

| Milestone | Name | Status |
| --- | --- | --- |
| M1 | Core Domain Model | ✅ Complete (verified) |
| M2 | Event System | ✅ Complete (verified) |
| M3 | Market Data | ✅ Complete (verified) |
| M4 | Order Management | ✅ Complete (verified) |
| M5 | Execution Engine | ✅ Complete (verified) |
| M6 | Risk Engine | ✅ Complete (verified) |
| M7 | Portfolio & P&L | ✅ Complete (verified) |
| M8 | IBKR Integration | ✅ Complete (verified) |
| M9 | Saxo Integration | ✅ Complete (verified) |
| M10 | FastAPI Gateway | ✅ Complete (verified) |
| M11 | React Trading Terminal | ✅ Complete (verified) |
| M12 | Authentication & Authorization | ✅ Complete (verified) |
| M13 | Integration Testing | ✅ Complete (verified) |
| M14 | Security Hardening | ✅ Complete (verified) |
| M15 | Production Infrastructure | ✅ Complete (verified) |
| M16 | End-to-End Validation | ✅ Complete (verified) |
| M17 | Production Readiness | ✅ Complete (signed off — PRODUCTION READY) |

---

## Blockers

- None.

## Known Technical Debt

- None at this stage (M1–M8 have no known defects; the OMS/portfolio/adapter
  in-memory state is an intentional, documented deferral — see below).
- `frontend` npm dependencies report 4 advisories from the deprecated ESLint 8
  toolchain (build-time only); to be addressed when tooling is upgraded.
- ~~The OMS uses an in-memory `OrderRepository`~~ CLOSED (M15): a
  PostgreSQL implementation now exists and is production-default
  (ADR-010/020); the in-memory repository remains the dev/test default.
- The Portfolio service is in-memory (state rebuildable from events and/or a
  broker snapshot); PostgreSQL persistence arrives with the infrastructure
  milestone (ADR-013).
- Event bus ordering is guaranteed only within a single `InProcessEventBus`
  instance on a single event loop. Cross-process/distributed ordering and a
  retry/dead-letter mechanism are intentionally deferred (ADR-007).
- The M8/M9 adapters (IBKR, Saxo) are verified against their simulated
  clients (paper/sim mode). The real ibapi/ib_insync and OpenAPI transports,
  session/credential handling, and controlled live/sim validation are deferred
  to credentialed environments (ADR-014/ADR-015); adapter dedup state is
  in-memory across restarts.
- Multi-currency portfolio aggregates (exposure/equity/daily P&L) return `None`
  pending an FX-conversion design (ADR-013); single-currency accounts are fully
  functional.
- The M10 runtime binds ONE broker account (M5 design; ADR-016); the terminal's
  account selector re-syncs account-scoped data on change and is forward-
  compatible with multi-account deployments, but only one account exists on the
  gateway today.
- M10 exposes no market-data subscribe endpoint; the terminal therefore POLLS
  `GET /market/quote` for watchlisted instruments and additionally renders
  `market.quote.updated` events when the engine has subscriptions. A subscribe
  API is future gateway work (noted for M13 integration scope).
- Frontend state is in-memory (no persistence between reloads — acceptable for
  a terminal; REST resync rebuilds everything on load). The watchlist is
  session-scoped (one demo default available).
- Browser-based E2E (Playwright/Cypress) is deliberately deferred to M13/M16
  per the roadmap; M11 verification is component/hook tests plus a live
  contract smoke against the real gateway (see TEST_STATUS).
- M12 authn state (sessions, refresh-token hashes, WS tickets, user
  directory) is in-memory — persistence arrives with the infrastructure
  milestone, consistent with OMS/portfolio state.
- Access JWTs are intentionally NOT denylisted on logout (short TTL; the
  session/refresh token is revoked) — documented stateless tradeoff
  (ADR-018).
- Login rate limiting / account lockout is deferred to M14 security
  hardening; PBKDF2 (600k iterations) slows online guessing meanwhile.
- The frontend keeps tokens in memory only — a page reload requires
  re-login (accepted XSS-safe tradeoff, ADR-018; cookie persistence is a
  possible M14 item).
- `/ready` (infra probe) and the OpenAPI docs (`/docs`) remain public —
  they expose no account data (ADR-018).
- WS tickets travel in the connection URL (browsers cannot set WS headers);
  they are single-use, 30-second, and consumed-or-expired before any access
  log can hold a usable value (ADR-018).
- M14 abuse controls are per-process and in-memory: login throttling is
  per username+IP (distributed sources evade it) and authenticated
  endpoints are not HTTP-level rate limited — shared-infrastructure
  throttling and a fronting reverse proxy arrive with M15 (ADR-019); the
  in-process trading-abuse defenses remain the M6 risk gate, kill switch,
  and daily order counts.
- The OpenAPI/docs surface is enabled automatically when APP_ENV is
  development (dev tooling); production posture keeps it OFF
  (API_DOCS_ENABLED, compose sets APP_ENV=production).
- Full-stack integration coverage runs against the SIMULATED broker clients
  (paper/sim mode). A controlled IBKR-paper or Saxo-sandbox validation
  remains deferred until a credentialed environment exists (documented
  since M8/M9, ADR-014/015); no credentials are committed.
- The full-stack market-data tests drive the M3 subscription the API cannot
  yet express (the documented no-subscribe-endpoint limitation, M11).

---

## Current Architecture State

M1 domain model is implemented in `backend/domain` (broker-agnostic, no
infrastructure/framework imports — enforced by tests). The M2 event system in
`backend/events` is broker- and framework-agnostic: domain logic depends on the
`EventBus` protocol, and the `InProcessEventBus` transport is swappable without
rewriting domain/application layers. The M3 market-data engine in
`backend/market_data` depends only on the `MarketDataFeed` port
(`backend/brokers/base`), the domain, and the event system. The M4 OMS in
`backend/order_management` depends only on the domain (`Order` state machine),
the event bus, and its `OrderRepository` port. The M5 Execution Engine in
`backend/execution` depends only on the `ExecutionBroker` port, the domain, and
the OMS. The M6 Risk Engine in `backend/risk` depends only on the domain, the
event bus, and read-model ports. The M7 Portfolio service in `backend/portfolio`
depends only on the domain and the event bus, and implements the M6 read-model
ports so Risk consumes authoritative state. The M8 IBKR adapter
(`backend/brokers/ibkr`) and M9 Saxo adapter (`backend/brokers/saxo`) implement
the SAME broker ports against their respective transport ports, proving the
abstraction reusable with no core changes (broker parity review recorded); all
broker-specific code is confined to those packages (grep-verified: no
`brokers.ibkr`/`brokers.saxo` import exists outside them). The M10 gateway
(`backend/api`) is a pure delegation/serialization surface over the
`EngineRuntime` composition root (`backend/application`), which depends only on
ports; adapters are imported solely by `backend/main.py` (grep-verified).
The M11 terminal (`frontend/src`) is presentation-only: it consumes the gateway
exclusively over REST `/api/v1` + WS `/ws`, holds no business/risk/broker logic,
keeps every financial value as an exact-decimal string (floats only for chart
pixels), and synchronizes via the ADR-016 at-least-once contract (event_id
dedupe + REST resync; ADR-017). M12 puts authentication in the API layer where
it belongs: a router-wide fail-closed bearer dependency, server-side RBAC +
account scoping on every endpoint (including order resources and listings),
and ticket-gated WebSockets; the core engine was not touched (ADR-018).
Architecture
boundaries hold: domain, events, market_data, order_management, execution,
risk, and portfolio do not import FastAPI, React, SQLAlchemy, or any broker.
See `docs/ARCHITECTURE.md`, `docs/EVENTS.md`, and `docs/DECISIONS.md`.

---

## Last Verified Test Status

See `docs/TEST_STATUS.md` for the authoritative record.

- Final result (M17, 2026-10-12): backend 695/695 and frontend
  116/116 pass (full regression, live-PostgreSQL persistence included);
  hygiene clean; 0 npm + 0 pip vulnerabilities. Clean-environment
  deployment re-validated from the RUNBOOK; every operational procedure
  exercised live. Secrets scan clean. Requirements audit complete.
  Multi-perspective final review: PASS — **PRODUCTION READY** for the
  validated scope with zero release blockers; the pre-real-money
  checklist is recorded in `docs/RELEASE.md`.
- Post-release FE-M1 (2026-10-23/24): frontend **147/147** pass (full
  regression incl. new M1 component tests, the `0E-8` wire-format
  regression suite, and the M13 flow contract intact);
  lint/typecheck/format/build green; Playwright live visual check green
  against the sim stack (login → live chart → paper order auto-fill →
  screenshots; zero page errors).
- Post-release FE-M2 (2026-10-26): frontend **158/158** pass (11 new
  dashboard/navigation tests); lint/typecheck/format/build green;
  Playwright live visual check green including the new Overview
  navigation (sidebar → Dashboard → greeting → desktop/mobile
  screenshots). Backend untouched (695/695 stand).
- Post-release FE-M3 (2026-10-27): frontend **176/176** pass (18 new:
  7 pure allocation unit tests + 11 component/page tests);
  lint/typecheck/format/build green; Playwright live visual check green
  including the new Portfolio navigation (sidebar → Accounts →
  desktop/mobile screenshots; zero page errors). Backend untouched
  (695/695 stand).