# Roadmap

The project is delivered in milestones. Each milestone must satisfy its
acceptance criteria and pass required specialist reviews before the next
milestone begins. Milestones are sequential unless explicitly noted.

---

## M0 — Architecture & Foundation

- **Objective:** Establish repository structure, persistent documentation,
  agent workflow, testing conventions, and development rules. Establish
  minimal backend/frontend/Docker/test foundations.
- **Deliverables:**
  - Monorepo directory structure.
  - `AGENTS.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `ARCHITECTURE.md`,
    `REQUIREMENTS.md`, `DECISIONS.md`, `TEST_STATUS.md`, `CHANGELOG.md`,
    `DEVELOPMENT_WORKFLOW.md`, `README.md`.
  - Backend dependency/quality tooling (Pyproject, ruff, mypy, pytest).
  - Frontend tooling (React + TypeScript + Vite, ESLint, Prettier, Vitest).
  - Docker compose foundation (backend, frontend, PostgreSQL).
  - Initial test suite validating the foundation.
- **Dependencies:** None.
- **Acceptance Criteria:**
  - All documented files exist and are accurate.
  - Tooling commands run successfully.
  - Foundation tests pass (results recorded, not fabricated).
- **Testing Requirements:** Foundation validation tests executed and recorded.
- **Specialist Review:** Architect.

---

## M1 — Core Domain Model

- **Status:** ✅ Complete (verified 2026-09-13)
- **Objective:** Define the broker-agnostic core domain types (order, fill,
  position, account, instrument, execution report, broker error).
- **Deliverables:** Domain entities, value objects, invariants in
  `backend/domain`.
- **Dependencies:** M0.
- **Acceptance Criteria:** Domain model is testable, broker-agnostic, and
  documented; no infrastructure imports in domain.
- **Testing Requirements:** Unit tests for entities/invariants.
- **Specialist Review:** Quant (+ Backend).
- **Result:** Implemented `money`, `instrument`, `orders` (lifecycle state
  machine), `account`, `position` (VWAP), `fills`, `portfolio`, `market`,
  `errors`. 113 unit tests pass; ruff/mypy/format clean. Quant review: PASS
  WITH NOTES. Architecture boundary tests enforce no framework/broker imports.

## M2 — Event System

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Introduce a typed, ordered event bus (market data, order
  events, execution reports, risk events).
- **Deliverables:** Event definitions, bus, envelope/ordering.
- **Dependencies:** M1.
- **Acceptance Criteria:** Events are typed, replay/loggable, and decoupled
  from brokers.
- **Testing Requirements:** Unit + integration tests.
- **Specialist Review:** Backend (+ Architect).
- **Result:** Implemented `backend/events` (`DomainEvent`, `EventEnvelope`,
  `EventBus` protocol + `InProcessEventBus`, `EventRegistry`,
  `EventSerializer`, 16 event types). Per-bus total ordering with
  reentrancy-safe lock; timezone-aware timestamps; versioned events; at-least-
  once delivery with `event_id` idempotency contract. 156/156 tests pass
  (52 M2); ruff/mypy/format clean. Quant, Security, QA, Architect reviews:
  PASS. M0+M1 regression: PASS. See `docs/EVENTS.md`, ADR-006/007/008.

## M3 — Market Data

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Abstract market-data feed and subscription lifecycle.
- **Deliverables:** Market-data interfaces, tick/bar models, subscription
  manager.
- **Dependencies:** M2.
- **Acceptance Criteria:** Core subscribes via abstraction; no broker logic in
  core.
- **Testing Requirements:** Unit tests with simulated feeds.
- **Specialist Review:** Quant + Backend.
- **Result:** Implemented `MarketDataFeed` broker port
  (`backend/brokers/base/market_data.py`), domain `MarketTick`/`Bar`/
  `BarInterval`, and `MarketDataEngine` with `SubscriptionManager` (idempotent
  ref-counted) and `StalenessMonitor` (TS-007). Engine normalizes/validates
  raw payloads and publishes `MarketQuoteUpdated` / `MarketTickUpdated` /
  `MarketBarUpdated` on the M2 event bus. Broker-agnostic; simulated feed used
  in tests. 191/191 tests pass (35 M3); ruff/mypy/format clean. Quant,
  Security, QA, Architect reviews: PASS. M0+M1+M2 regression: PASS. See
  ADR-009, `docs/ARCHITECTURE.md`, `docs/EVENTS.md`.

## M4 — Order Management

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Order lifecycle state machine (new → submitted → filled /
  cancelled / rejected) with idempotency and duplicate-order protection.
- **Deliverables:** Order manager, order states, persistence interface.
- **Dependencies:** M2, M3 (partial).
- **Acceptance Criteria:** Correct lifecycle, idempotent submission, no
  unconfirmed execution assumptions.
- **Testing Requirements:** Unit + integration tests.
- **Specialist Review:** Quant + Backend + QA.
- **Result:** Implemented `backend/order_management` (`OrderManager`,
  `OrderRepository` port + `InMemoryOrderRepository`). Drives the M1 `Order`
  state machine, applies confirmed `ExecutionReport`s (filled-quantity
  tracking, overfill/non-completing-FILL rejection), enforces idempotency via
  `client_order_id` / `idempotency_key` and duplicate `report_id` protection,
  and publishes `order.*` events on the M2 bus. 217/217 tests pass (26 M4);
  ruff/mypy/format clean. Quant, Security, QA, Architect reviews: PASS.
  M0+M1+M2+M3 regression: PASS. See ADR-010, `docs/ARCHITECTURE.md`,
  `docs/EVENTS.md`.

## M5 — Execution Engine

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Route orders through the broker abstraction; handle partial
  fills, rejects, timeouts, reconnection.
- **Deliverables:** Execution service, routing logic, reconciliation hooks.
- **Dependencies:** M4.
- **Acceptance Criteria:** Execution via interfaces only; graceful handling of
  failure scenarios.
- **Testing Requirements:** Unit tests with simulated brokers; failure-scenario
  coverage.
- **Specialist Review:** Quant + Backend + QA.
- **Result:** Implemented `backend/execution` (`ExecutionEngine`) and an
  `ExecutionBroker` port in `backend/brokers/base/execution.py`. The engine
  drives the OMS and routes through the broker; applies reports to the OMS
  (which publishes `order.*` events); handles partial/multiple fills, rejects,
  cancels, timeouts (raises `BrokerError(TIMEOUT)`, state unchanged), bounded
  connection-loss retry, and `reconcile()` for reconnection (TS-006). No broker
  SDK logic. 232/232 tests pass (15 M5); ruff/mypy/format clean. Quant,
  Security, QA, Architect reviews: PASS. M0–M4 regression: PASS. See ADR-011,
  `docs/ARCHITECTURE.md`.

## M6 — Risk Engine

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Pre-trade risk validation, position/cash controls, kill switch.
- **Deliverables:** Risk checks, limits, kill-switch mechanism.
- **Dependencies:** M4, M5.
- **Acceptance Criteria:** Risk gates execution; no order bypasses risk;
  kill switch is effective.
- **Testing Requirements:** Unit + integration; risk-bypass must be impossible.
- **Specialist Review:** Quant + Backend + QA + Security.
- **Result:** Implemented `backend/risk` (`RiskEngine`, `RiskGatedExecutor`,
  `RiskPolicy`/`RiskLimits`, rules, kill switch) and read-model ports
  (`PortfolioView`, `AccountView`, `MarketDataView`, `DailyPnlProvider`).
  Deterministic, configurable, fail-closed pre-trade rules; risk-gated
  execution (no bypass); kill switch; EventBus integration (publishes
  `RiskViolation`, dedupes `OrderSubmitted` for counts). 269/269 tests pass
  (37 M6); ruff/mypy/format clean. Quant, Security, QA, Architect reviews:
  PASS. M0–M5 regression: PASS. See ADR-012, `docs/ARCHITECTURE.md`.

## M7 — Portfolio & P&L

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Position tracking, valuation, realized/unrealized P&L.
- **Deliverables:** Portfolio model, P&L calculations, reconciliation.
- **Dependencies:** M3, M4, M5.
- **Acceptance Criteria:** Positions reconcile with fills; P&L correct.
- **Testing Requirements:** Unit (financial correctness) + integration.
- **Specialist Review:** Quant + Backend + QA.
- **Result:** Implemented `backend/portfolio` (`PortfolioService` — authoritative
  fill-driven positions, realized P&L (cumulative + daily), unrealized P&L,
  exposure, equity; consumes `order.*` fills, quotes, and balance events;
  publishes `position.opened/updated/closed`; implements the M6 read-model
  ports so Risk consumes authoritative state; broker reconciliation via
  `apply_broker_snapshot`) plus pure average-cost `accounting` functions
  (open/increase/reduce/close/reverse, fee handling). 310/310 tests pass
  (39 M7); ruff/mypy/format clean. M7 integration testing found and fixed an
  M6 daily-loss sign defect (positive magnitude semantics + 2 regressions).
  Quant, Security, QA, Architect reviews: PASS. M0–M6 regression: PASS (271/271).
  See ADR-013, `docs/ARCHITECTURE.md`.

## M8 — IBKR Integration

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Broker adapter implementing the base interfaces for IBKR.
- **Deliverables:** `backend/brokers/ibkr` adapter; simulated/paper mode.
- **Dependencies:** M5, M6, M7.
- **Acceptance Criteria:** Adapter satisfies base contracts; paper-tested.
- **Testing Requirements:** Simulated broker tests; no live trading.
- **Specialist Review:** Backend + Quant + QA + Security.
- **Result:** Implemented `backend/brokers/ibkr`: `IbkrAdapter` implementing
  the M3 `MarketDataFeed` and M5 `ExecutionBroker` ports; pure IBKR↔internal
  `mapping` (contracts, orders, statuses, executions→fills, account values→
  balances, positions, error codes→`BrokerError`); `IbkrClient`/
  `IbkrCallbacks` transport protocols with `SimulatedIbkrClient` (paper mode).
  Connection lifecycle publishes `BrokerConnected`/`BrokerDisconnected`;
  reconnect re-subscribes exactly once and replays broker state for
  reconciliation; statuses/executions deduped; account data relabeled to the
  internal account and published as `balance.updated` for M7. 368/368 tests
  pass (58 M8); ruff/mypy/format clean. Backend, Quant, QA, Security reviews:
  PASS. M0–M7 regression: PASS (310/310). Live/paper validation against a real
  TWS/Gateway: DEFERRED (documented, ADR-014). See ADR-014,
  `docs/ARCHITECTURE.md`.

## M9 — Saxo Integration

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** Broker adapter implementing the base interfaces for Saxo Bank.
- **Deliverables:** `backend/brokers/saxo` adapter (OAuth, sim environment).
- **Dependencies:** M5, M6, M7.
- **Acceptance Criteria:** Adapter satisfies base contracts; sim-tested.
- **Testing Requirements:** Simulated tests; no live trading.
- **Specialist Review:** Backend + Quant + QA + Security.
- **Result:** Implemented `backend/brokers/saxo`: `SaxoAdapter` implementing
  the SAME M3/M5 ports as IBKR (abstraction reused unchanged — parity review
  recorded); pure Saxo↔internal `mapping` (UIC/AssetType instruments via
  `SAXO_UIC`, orders, statuses incl. Expired→EXPIRED, executions→fills,
  balance snapshots, positions, errors); `SaxoClient`/`SaxoCallbacks`
  transport protocols with an OAuth session lifecycle (proactive + reactive
  token refresh) and `SimulatedSaxoClient` (sim/paper mode). Connection
  lifecycle, reconnect re-subscription + state replay, status/execution
  dedup, `balance.updated` publication, and internal-account relabeling for
  M7. 432/432 tests pass (64 M9); ruff/mypy/format clean. Backend, Quant, QA,
  Security reviews + IBKR/Saxo parity review: PASS. M0–M8 regression: PASS
  (368/368). Sandbox validation: DEFERRED (documented, ADR-015). See ADR-015,
  `docs/ARCHITECTURE.md`.

## M10 — FastAPI Gateway

- **Status:** ✅ Complete (verified 2026-09-15)
- **Objective:** REST + WebSocket API exposing core capabilities (no core
  changes required).
- **Deliverables:** `backend/api` routes, WS channels, auth hooks.
- **Dependencies:** M3–M7.
- **Acceptance Criteria:** API cleanly delegates to application layer; core
  stays broker-agnostic.
- **Testing Requirements:** Integration + e2e API tests.
- **Specialist Review:** Backend + QA + Security.
- **Result:** Implemented `backend/api` (FastAPI): thin REST router
  delegating to the `EngineRuntime` composition root (`backend/application`)
  - order creation goes through the M6 risk gate (never bypassed; idempotent
  `idempotency_key` replay 200 vs 201), cancel/modify via M5, reads from
  M4/M7, kill-switch + risk dry-run via M6; API DTOs with exact-decimal JSON
  strings; stable-error HTTP mapping (generic 500, no internals);
  `WebSocketHub` streaming M2 envelopes over `/ws` (topics, `event_id`
  at-least-once sync, bounded backpressure closing slow clients 1013); auth
  hook (M12 placeholder, anonymous principal in M10); `main.py` composition
  boundary (simulated adapters only). 482/482 tests pass (50 M10); ruff/
  mypy/format clean. Backend, QA, Security, Architect reviews + race/event
  sync review: PASS. M0-M9 regression: PASS (432/432). Documented cross-topic
  event interleave semantics (ADR-016). See ADR-016, `docs/ARCHITECTURE.md`.



## M11 — React Trading Terminal

- **Status:** ✅ Complete (verified 2026-09-27)
- **Objective:** Web trading terminal UI (dashboard, orders, positions, P&L,
  charts).
- **Deliverables:** `frontend/src` features, stores, services, real-time
  wiring.
- **Dependencies:** M10.
- **Acceptance Criteria:** UI consumes API/WS; functional end-to-end.
- **Testing Requirements:** Component + e2e tests.
- **Specialist Review:** Frontend + QA.
- **Result:** Implemented `frontend/src`: typed REST client over the M10
  gateway (`services/api.ts`, stable-error mapping incl. risk 422 violations,
  504-timeout guidance) and a WS client implementing the ADR-016 sync contract
  (`services/ws.ts` — `event_id` dedupe, capped exponential reconnect,
  resync-on-(re)connect, 1013/4400 close handling, ping keepalive); a minimal
  typed store layer on `useSyncExternalStore` (no state framework, ADR-017)
  with idempotent event merges; `useTerminal` as the single wiring hook
  (initial REST load, event routing, debounced portfolio resync after fills,
  watchlist quote polling, 1 Hz staleness tick); terminal UI (Dashboard /
  Orders / Positions views, order ticket with server-side risk dry-run and
  idempotency-key lifecycle, order blotter with confirmed cancel/modify,
  positions table, account/balance/summary panel, watchlist + SVG sparkline
  chart, broker status, risk panel with confirmed kill-switch control and
  violation feed, connection banner, loading/error/empty/stale states
  everywhere). Exact-decimal strings end-to-end (no float money math); no
  broker knowledge in the frontend. Frontend 89/89 tests pass; `tsc`, ESLint,
  Prettier, `vite build` clean; backend regression 482/482. Live contract
  smoke against the real M10 gateway: PASS (10/10). Frontend/QA/Security
  reviews: PASS (findings fixed). Browser E2E belongs to M13/M16 per
  roadmap. See ADR-017, `docs/ARCHITECTURE.md`, `docs/TEST_STATUS.md`.

## M12 — Authentication & Authorization

- **Status:** ✅ Complete (verified 2026-09-30)
- **Objective:** AuthN/AuthZ (JWT), role/permission model, secure session.
- **Deliverables:** Auth service, token lifecycle, RBAC.
- **Dependencies:** M10.
- **Acceptance Criteria:** Least-privilege enforced; secrets not exposed.
- **Testing Requirements:** Security + integration tests.
- **Specialist Review:** Security + Backend + QA.
- **Result:** Implemented `backend/api` authN/AuthZ (ADR-018): PBKDF2
  password hashing (stdlib, 600k iterations, constant-time, equal-cost
  unknown-user path); `TokenService` (short-lived HS256 access JWTs with
  ≥32-byte key enforcement, opaque rotating refresh tokens stored as
  hashes with superseded-token theft detection, single-use 30s WS tickets);
  login/refresh/logout/me/ws-ticket endpoints with generic 401s (no user
  enumeration); router-wide bearer authentication (fail-closed — the M10
  anonymous principal is gone); RBAC viewer⊂trader⊂admin with per-user
  account scoping enforced server-side on every endpoint including loaded
  order resources (IDOR) and scope-filtered listings; kill-switch control
  requires `risk:admin` (audited); WS connections require a fresh ticket,
  re-derive the principal server-side, and check runtime-account scope
  (4401/4403); explicit-origin CORS (credentials off). Frontend: in-memory
  token store (never persisted), single-flight 401 refresh+retry, login
  view gating the terminal, RBAC-aware UX (clearly server-enforced).
  Backend 586/586 tests pass (104 new M12 tests incl. a dedicated security
  suite); frontend 109/109 pass; ruff/mypy/tsc/ESLint/build all clean.
  Live contract smoke against the real server: PASS (19/19 — fail-closed
  401s, IDOR/RBAC denials, WS ticket single-use, refresh rotation + theft
  response, logout revocation). Security review: PASS (see
  `docs/TEST_STATUS.md`). See ADR-018, `docs/ARCHITECTURE.md`.

## M13 — Integration Testing

- **Status:** Complete (verified 2026-10-01)
- **Objective:** Cross-component integration validation with simulated brokers.
- **Deliverables:** Integration test suite, fixtures, simulation harness.
- **Dependencies:** M8–M11.
- **Acceptance Criteria:** Integrated flows verified against simulated brokers.
- **Testing Requirements:** Integration + e2e suites.
- **Specialist Review:** QA + Quant + Backend.
- **Result:** Added `tests/integration/full_stack/` — a dual-broker harness
  composing EVERY boundary on one bus (FastAPI + M12 auth → M10 runtime →
  M6 risk gate → M4 OMS → M5 execution → M8 IBKR / M9 Saxo simulated
  adapters → M7 portfolio) driven ONLY through authenticated REST + ticketed
  WS, parameterized over BOTH brokers: 56 tests (golden trading flow with
  partial/complete fills, WS event ordering, market-data flow with
  staleness + valuation, fail-closed risk with stale quotes, duplicate
  events/orders, overfill isolation, broker rejection, cancel conflicts,
  cross-account isolation incl. WS scope, broker disconnect → reconnect →
  reconcile, WS client reconnect with fresh tickets, burst/parallel
  concurrency, error-envelope stability) + a terminal-boundary flow test
  (`App.flow.test.tsx`). Two integration defects found and fixed with
  regressions: (1) the REST `InstrumentIn` DTO could not express the
  broker-neutral identifiers (ADR-015), leaving a Saxo-backed runtime
  unreachable through the API — `identifiers` now pass through (backward
  compatible); (2) an invalid async broker report (overfill) escaped the
  execution engine boundary and wedged the adapter delivery pipeline —
  invalid reports are now isolated and logged (identifiers only) in both
  the async-delivery and reconcile paths. Backend 647/647 tests pass;
  frontend 110/110; ruff/mypy/tsc/ESLint/format/build all clean. No live
  trading; simulated clients only. External sandbox/paper validation
  remains deferred (no credentialed environment exists — documented since
  M8/M9). See `docs/TEST_STATUS.md`, `docs/ARCHITECTURE.md`.

## M14 — Security Hardening

- **Status:** ✅ Complete (verified 2026-10-08)
- **Objective:** Harden secrets handling, input validation, dependency
  scanning, secure defaults.
- **Deliverables:** Security controls, audit, threat review.
- **Dependencies:** M12.
- **Acceptance Criteria:** Security review passed; no secrets, no injection.
- **Testing Requirements:** Security test suite.
- **Specialist Review:** Security.
- **Result:** Audited the full surface (API, authN/authZ, WS, frontend,
  adapters, order/execution flows, risk, config/secrets, logging,
  Docker/deployment, dependencies) and remediated: fail-closed login
  rate limiting (429 + Retry-After per username+IP, memory-bounded,
  thread-safe), WS-ticket per-subject cap (flooding cannot grow the
  registry), lazy session/ticket sweeps, security-headers middleware
  (nosniff/DENY/no-referrer/no-store), OpenAPI docs OFF by default
  (dev-only via APP_ENV/API_DOCS_ENABLED), size-bounded instrument
  identifiers, hardened containers (non-root runtime images, .dockerignore
  secrets exclusion — .env could previously be baked into image layers,
  fail-fast compose secrets with no insecure defaults, loopback port binds,
  healthchecks, unprivileged nginx + strict CSP), a repository
  secrets-scan guard, and frontend static-security tests. Dependencies:
  frontend toolchain upgraded (ESLint 9/Vite 8/Vitest 5) — npm advisories
  16→0 incl. a critical in the old chain; pip-audit (project venv): 0.
  Backend 677/677, frontend 116/116; ruff/mypy/tsc/lint/format/build clean.
  Live hardened-surface smoke: PASS (6/6). Adversarial review: PASS (all
  findings fixed with regressions; accepted/deferred risks documented in
  ADR-019). No secrets, no injection; security controls verified
  server-side (frontend gating was never a control). See ADR-019,
  `docs/TEST_STATUS.md`.

## M15 — Production Infrastructure

- **Status:** ✅ Complete (verified 2026-10-09)
- **Objective:** Production-grade Docker, Nginx, deployment, monitoring,
  logging.
- **Deliverables:** Deployment configs, observability stack, CI/CD.
- **Dependencies:** M13, M14.
- **Acceptance Criteria:** Repeatable deploy; monitoring active.
- **Testing Requirements:** Deployment validation.
- **Specialist Review:** DevOps + Security + QA.
- **Result:** Implemented and LIVE-VALIDATED (docker-compose.prod.yml,
  project mtbe-prod): unprivileged nginx TLS edge (TLSv1.2/1.3, HSTS,
  per-IP rate limiting, explicit 404s for /metrics + docs, HTTP→HTTPS
  redirect) → hardened frontend → backend (JSON logs, no published ports,
  graceful SIGTERM, healthcheck-gated) → PostgreSQL (required strong
  password, internal-only). The documented ADR-010 debt is closed: the M4
  OrderRepository port is now ASYNC and has a PostgreSQL implementation
  (SQLAlchemy 2 async + asyncpg, JSON payload + queryable columns, upserts,
  last-binding-wins idempotency) selected via ORDER_REPOSITORY/DATABASE_URL
  — orders PERSIST across backend restarts, verified live. /ready gates on
  broker + database (bounded 2 s ping — fixed an unbounded-ping hang found
  in review). Native dependency-free metrics (bus counters + gauges) at an
  authenticated in-cluster /metrics; LOG_FORMAT=json application logs.
  CI/CD: full backend/frontend quality gates + a PostgreSQL-service CI job
  for the repository tests + container builds + prod compose validation +
  pip/npm audit gates. Backup/restore scripts with a verified truncate →
  restore → API round-trip. TLS staging cert generation (gitignored certs;
  production mounts real ones). Deployment validation 13/13 PASS
  (from-scratch deploy, TLS+auth+REST+WS through the proxy, fresh order
  through the gate, metrics counting, backend restart with order
  persistence + idempotency replay, DB-pause degradation/recovery,
  graceful shutdown exit 0, edge 404s). Review findings fixed: unbounded
  readiness ping, in-container loopback bind, shared dev/prod project
  volumes (explicit name: mtbe-prod), proxy conf mount path, eslint@10 npm
  ci breakage (pinned ^9), frontend nginx add_header inheritance, pg_dump
  --clean for idempotent restore, unprivileged-proxy key readability.
  Backend 690/690 (incl. 8 live-PostgreSQL repository tests), frontend
  116/116; ruff/mypy/tsc/ESLint/format/build clean. No live trading
  (simulated brokers per ADR-014/015). See ADR-020, the deployment
  RUNBOOK (infrastructure/deployment/RUNBOOK.md), `docs/TEST_STATUS.md`.

## M16 — End-to-End Validation

- **Status:** ✅ Complete (verified 2026-10-11)
- **Objective:** Full-system validation from UI to simulated brokers.
- **Deliverables:** E2E scenarios, reconciliation checks, performance smoke.
- **Dependencies:** M15.
- **Acceptance Criteria:** All critical flows verified end-to-end.
- **Testing Requirements:** E2E + performance smoke tests.
- **Specialist Review:** QA + Quant + Backend + DevOps.
- **Result:** Live-stack scenario suites in `tests/e2e/` (ADR-021) drive
  the DEPLOYED mtbe-prod stack over TLS exactly like an operator, run per
  broker (IBKR AND SAXO — the SAME scenarios, only the broker-neutral
  SAXO_UIC identifier differs): 34 evidence records per broker, ALL PASS —
  readiness gating (broker + database), broker status, live market data
  (startup subscription + sim ticks -> fresh quotes), risk dry-run,
  risk-gated submission -> broker ack -> FULL fill -> PARTIAL fill ->
  completing fill -> broker rejection (M5 reconcile path) ->
  cancellation -> position creation/updates/closure (flat), realized
  P&L == 0.00 verified by independent exact-decimal recomputation
  (buy@150.25 x20 -> sell@150.25 x20), duplicate-order idempotent replay,
  kill-switch block + release (no bypass), WS hello contract + order
  lifecycle streaming in engine order through the WSS edge, backend
  SIGTERM restart with orders PERSISTED (PostgreSQL) + idempotency
  binding surviving, database-restart readiness degradation +
  recovery, unauthenticated/tampered-token 401s, viewer-role 403,
  cross-account isolation (REST + IDOR cancel + WS close 4403),
  edge 404s for metrics/docs, performance smoke (submission p95 +
  5-parallel-submission consistency). Simulation drivers
  (`main.py`, ADR-021): startup market subscriptions, sim tick
  emitter, and the paper-trading auto-fill driving executions through
  the REAL adapter callback path with deterministic SIM_ACTION
  directives (PARTIAL/REJECT) riding the broker-neutral identifiers.
  Frontend: the order ticket gained the identifiers field (closing the
  UI gap for broker-neutral metadata — SAXO trading from the terminal),
  covered by tests. Backend regression 695/695 (incl. 5 new
  composition-helper tests + the full M13 in-process suites);
  frontend 116/116; all hygiene clean. E2E findings investigated and
  fixed (marker-channel defect, WS test reading only the 101 handshake,
  zero-quantity second chunk, missing viewer demo user). See
  `tests/e2e/README.md`, the artifacts, and `docs/TEST_STATUS.md`.

## M17 — Production Readiness

- **Status:** ✅ Complete (verified 2026-10-12) — **PRODUCTION READY** for the validated scope (see `docs/RELEASE.md`)
- **Objective:** Final review, documentation, release readiness.
- **Deliverables:** Signed-off release, runbooks, final status.
- **Dependencies:** M16.
- **Acceptance Criteria:** All milestones accepted; no open blockers.
- **Testing Requirements:** Full regression suite green.
- **Specialist Review:** Architect (final) + all affected.
- **Result:** Final production-readiness audit completed across every
  dimension (architecture, engine, adapters, API/WS, terminal, auth, DB,
  security, infrastructure, configuration, logging, backup/recovery,
  testing, release process, documentation). Final baseline: backend
  695/695, frontend 116/116, all hygiene clean, 0 dependency
  vulnerabilities. Clean-environment deployment re-validated from the
  documented RUNBOOK; ALL operational procedures exercised live (startup,
  graceful shutdown exit-0, restart with persisted orders, database
  restart recovery, JWT secret rotation — old tokens 401, fresh login
  200, JSON log inspection, /ready + authenticated /metrics health,
  backup, restore round-trip, rollback procedure). Requirements audit:
  every FR/NFR/TS requirement is implemented and validated or an
  explicitly recorded deferral — no release blockers. Secrets audit:
  tracked-file scan clean (one documentation-credential finding found
  and fixed); .env/certs/backups gitignored; the automated secrets
  guard ships in the suite. Independent multi-perspective review
  (Architect + Security + QA + DevOps, actively challenging the claim):
  PASS — findings classified, zero blockers. Release record signed off
  in `docs/RELEASE.md` with the mandatory pre-real-money checklist and
  post-release operational steps.

---

## Note

Broker integrations (M8/M9) must be paper/sim tested before any live
deployment. No live trading occurs during development milestones.