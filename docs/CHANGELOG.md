# Changelog

Chronological development history. Only **actual** changes are recorded.
Categories: Added, Changed, Fixed, Removed, Security, Testing, Architecture,
Infrastructure.

---

## [Unreleased]

### Added

- Repository monorepo directory structure.
- Root `AGENTS.md` (permanent agent rules, architecture boundaries, completion
  rule, collaboration protocol, testing/security/git rules).
- `.gitignore` and `.env.example` (placeholders only).
- Project memory documentation under `docs/` (PROJECT_STATUS, ROADMAP,
  ARCHITECTURE, REQUIREMENTS, DECISIONS, TEST_STATUS, CHANGELOG,
  DEVELOPMENT_WORKFLOW) and root `README.md`.
- Backend foundation scaffold (package layout, dependency/config files,
  main entrypoint placeholder).
- Frontend foundation scaffold (React + TypeScript + Vite configuration).
- Docker foundation (compose file and Dockerfiles — scaffolded).
- Initial test infrastructure (test directory structure, pytest/vitest
  configuration, foundation validation tests).
- CI workflow scaffolding under `.github/workflows` (placeholder).
- **M1 Core Domain Model** (`backend/domain`): `Currency`, `Money`, `Quantity`,
  `Price`, `Instrument`, `AssetClass`, `Exchange`, `InstrumentType`, `Account`,
  `Balance`, `CashBalance`, `Order`, `OrderRequest`, `OrderSide`, `OrderType`,
  `TimeInForce`, `OrderStatus` (lifecycle state machine), `Position` (VWAP),
  `Fill`, `ExecutionReport`, `ExecutionReportType`, `Portfolio`, `MarketQuote`,
  `QuoteType`, and a typed `DomainError` hierarchy with stable error codes.
- **M2 Event System** (`backend/events`): `DomainEvent` base (`__event_type__`,
  `__event_version__`), `EventEnvelope` (`event_id`, `event_type`,
  `event_version`, timezone-aware `timestamp`, `source`, `correlation_id`,
  `causation_id`, typed `payload`), `EventBus` protocol +
  `InProcessEventBus` (reentrancy-safe per-bus ordering, sequential handler
  dispatch, handler isolation, structured observability), `EventRegistry`
  (version-keyed type resolution), `EventSerializer` (envelope ↔ JSON-safe
  dict), and 16 concrete event types (market data, order lifecycle, position
  lifecycle, account, broker connectivity, risk).
- **M3 Market Data Engine** (`backend/market_data`, `backend/domain/market.py`,
  `backend/brokers/base/market_data.py`): `MarketDataFeed` broker port with
  `RawQuote`/`RawTick`/`RawBar` payloads; domain `MarketTick`, `Bar`,
  `BarInterval`; `MarketDataEngine` (normalization + validation + event
  publishing), `SubscriptionManager` (idempotent ref-counted subscriptions),
  `StalenessMonitor` (TS-007 stale-data detection with injectable clock); new
  `MarketTickUpdated` / `MarketBarUpdated` events on the M2 event bus.
- **M4 Order Management System** (`backend/order_management`,
  `backend/domain/orders.py`, `backend/domain/errors.py`): `OrderManager`
  (create/submit/cancel/modify/apply execution reports, event publication),
  `OrderRepository` port + `InMemoryOrderRepository`, idempotency/duplicate
  protection; domain `Order.filled_quantity`/`remaining_quantity`/
  `apply_fill_quantity`/`mark_pending_submit`, `OrderStateError` (409); new
  `OrderModified` event on the M2 event bus.
- **M5 Execution Engine** (`backend/execution/engine.py`,
  `backend/brokers/base/execution.py`): `ExecutionEngine` (submit/cancel/
  modify/reconcile, timeout handling, bounded connection-loss retry) and an
  `ExecutionBroker` port (+ `ExecutionReportHandler`) for IBKR/Saxo to
  implement in M8/M9. The engine routes through the broker, applies reports to
  the OMS (which publishes `order.*` events), and never assumes an execution
  outcome without confirmation.
- **M6 Risk Engine** (`backend/risk`): `RiskEngine` (deterministic pre-trade
  evaluation, kill switch, daily order counts), `RiskPolicy`/`RiskLimits`
  (configurable rules), rules (kill switch, order size, position, notional
  exposure, available funds, daily order count, daily loss, trading session),
  `RiskGatedExecutor` (mandatory pre-execution checkpoint — no bypass), and
  read-model ports (`PortfolioView`, `AccountView`, `MarketDataView`,
  `DailyPnlProvider`) for clean state ownership. Fail-closed by default;
  publishes `RiskViolation` events on the M2 bus.
- **M7 Portfolio & P&L** (`backend/portfolio`): `PortfolioService`
  (authoritative fill-driven positions, realized P&L cumulative + daily,
  unrealized P&L, exposure, equity; consumes `order.*` fills, market quotes,
  and balance events; publishes `position.opened/updated/closed`; implements
  the M6 `PortfolioView`/`AccountView`/`MarketDataView`/`DailyPnlProvider`
  ports; broker reconciliation via `apply_broker_snapshot`) and pure
  `accounting` functions (average-cost open/increase/reduce/close/reverse,
  fee handling, unrealized/market-value/exposure math).
- **M8 IBKR Adapter** (`backend/brokers/ibkr`): `IbkrAdapter` implementing the
  M3 `MarketDataFeed` and M5 `ExecutionBroker` ports; pure IBKR↔internal
  `mapping` (instruments/contracts, orders, statuses, executions→fills,
  account values→balances, positions, error codes→`BrokerError`);
  `IbkrClient`/`IbkrCallbacks` transport protocols with
  `SimulatedIbkrClient` (paper/test mode, no live trading); connection
  lifecycle with `BrokerConnected`/`BrokerDisconnected` events, unexpected-
  disconnect recovery, deduplicated re-subscription and state replay
  (`request_open_orders`/`request_executions`) for reconciliation; status and
  execution dedup; `balance.updated` publication and internal-account
  relabeling for M7.
- **M9 Saxo Adapter** (`backend/brokers/saxo`): `SaxoAdapter` implementing the
  SAME M3/M5 ports as IBKR (abstraction reused unchanged); pure Saxo↔internal
  `mapping` (UIC/AssetType instruments via `SAXO_UIC` identifiers, orders
  with ExternalReference, statuses incl. Expired→EXPIRED, executions→fills,
  full balance snapshots→balances, positions with venues, error codes→
  `BrokerError`); `SaxoClient`/`SaxoCallbacks` transport protocols with an
  OAuth session lifecycle (`authorize`/`refresh_session`/`logout`; proactive
  and reactive token refresh) and `SimulatedSaxoClient` (sim/paper mode);
  streaming-subscription registry resolution (untracked UICs dropped);
  connection lifecycle, reconnect re-subscription + state replay, status/
  execution dedup, `balance.updated` publication, and internal-account
  relabeling for M7.
  - **M10 API Gateway** (`backend/api`, `backend/application`): FastAPI REST +
    WebSocket gateway. `EngineRuntime` composition root (ports only, one bus);
    thin REST router (orders through the M6 risk gate with idempotent
    `idempotency_key` replay, cancel/modify via M5, portfolio/balance/summary/
    positions/quote reads, risk dry-run + kill-switch, broker status, health);
    API DTOs with exact-decimal JSON strings; stable-error HTTP mapping (no
    internals leakage); `WebSocketHub` streaming registry-serialized M2
    envelopes over `/ws` with topic filtering, `event_id` dedupe, and bounded
    backpressure (slow clients closed 1013); auth hook (M12 placeholder);
    `main.py` composition boundary (simulated adapters, no live trading).
  - **M11 React Trading Terminal** (`frontend/src`): typed REST client over the
    M10 gateway with stable-error mapping (risk 422 violations, 504 timeout
    guidance, 503/404/409/network; URL-encoded path params); `TerminalSocket`
    WS client implementing the ADR-016 client contract (bounded `event_id`
    dedupe, capped exponential reconnect, resync after every (re)connect,
    1013/4400 close distinction, ping keepalive, malformed-frame isolation);
    minimal typed stores on `useSyncExternalStore` (no state framework) with
    idempotent event merges; `useTerminal` wiring hook (WS-independent initial
    REST load, event routing, account-switch resync with stale-result
    discard, watchlist quote polling, 1 Hz staleness tick); terminal UI —
    Dashboard/Orders/Positions views, order ticket (server-side risk dry-run,
    kill-switch warning, in-flight guard, idempotency-key lifecycle), order
    blotter (confirmed cancel/modify, state-machine-driven actionability),
    positions table, account/balance/summary panel, watchlist + SVG sparkline,
    broker status, risk panel (confirmed kill-switch control + violation
    feed), connection banner, loading/error/empty/stale states everywhere;
    dark terminal theme; Vite dev proxy to the M10 gateway.
  - **M12 Authentication & Authorization** (`backend/api`, `frontend/src`,
    `config/settings.py`, `scripts/hash_password.py`): mandatory JWT bearer
    authentication (fail-closed — the M10 anonymous principal is removed);
    stdlib PBKDF2 password hashing (600k iterations, constant-time,
    equal-cost unknown-user path); `TokenService` with short-lived HS256
    access JWTs (≥32-byte key enforcement, pinned algorithm, typ/iss/exp
    required), opaque rotating refresh tokens stored as SHA-256 hashes with
    superseded-token theft detection (reuse revokes the session), and
    single-use 30s WebSocket tickets; login/refresh/logout/me/ws-ticket
    endpoints with generic 401s (no user enumeration); RBAC
    viewer⊂trader⊂admin with per-user account scoping enforced server-side
    on every endpoint — including loaded order resources (IDOR guard),
    scope-filtered listings, and an audited `risk:admin`-only kill switch;
    WS connections consume a fresh ticket, re-derive the principal, and
    check runtime-account scope (4401/4403); explicit-origin CORS with
    credentials off; identifier-only audit logging; env-driven identity
    sources (users file with PBKDF2 hashes / demo users hashed at startup)
    with fail-closed provisioning; ephemeral dev signing secret when
    unconfigured (never logged). Frontend: in-memory token store (never
    persisted), single-flight 401 refresh + single retry in the API client,
    fresh-ticket-per-connect WS, login view gating the terminal, RBAC-aware
    UX, logout control.
  - **M13 Integration Testing** (`tests/integration/full_stack/`,
    `frontend/src/App.flow.test.tsx`): a dual-broker full-stack harness
    composing every boundary on one bus (FastAPI + auth, runtime, risk
    gate, OMS, execution, IBKR/Saxo simulated adapters, market data,
    portfolio) driven only through authenticated REST + ticketed WS,
    parameterized over BOTH brokers — 56 tests covering the golden trading
    flow (partial/completing fills, WS ordering, P&L), failure flows
    (rejections, risk fail-closed on stale quotes, duplicates, overfill,
    cancel conflicts), market-data staleness/valuation, recovery (broker
    disconnect/reconnect/reconcile, WS fresh-ticket reconnect), account
    isolation, and concurrency; plus a terminal-boundary flow test driving
    the real app with mocked transport.
  - **M14 Security Hardening** (`api/throttle.py`, `api/tokens.py`,
    `api/app.py`, `api/schemas.py`, `config/settings.py`, containers,
    frontend toolchain): fail-closed login rate limiting (429 + Retry-After,
    per username+IP, memory-bounded, thread-safe); per-subject WS-ticket
    cap + lazy session/ticket sweeps; security-headers middleware
    (nosniff/DENY/no-referrer/no-store); OpenAPI docs OFF by default
    (dev-only opt-in); size-bounded instrument identifiers; hardened
    container images (non-root runtime, .dockerignore secrets exclusion,
    unprivileged nginx + strict CSP, fail-fast compose secrets, loopback
    binds, healthchecks); repository secrets-scan guard; frontend static
    security guards; dev toolchain upgraded to ESLint 9 / Vite 8 /
    Vitest 5 (npm advisories 16 -> 0).
  - **M15 Production Infrastructure** (`docker-compose.prod.yml`,
    `infrastructure/`): PostgreSQL order persistence closing the ADR-010
    debt — the M4 `OrderRepository` port is now async (ADR-020) with a
    SQLAlchemy-2-async/asyncpg implementation (JSON payload + queryable
    columns, upserts, in-memory-identical idempotency binding, bounded
    readiness ping), env-selected via ORDER_REPOSITORY/DATABASE_URL;
    production compose stack `mtbe-prod` (unprivileged nginx TLS edge with
    TLSv1.2/1.3 + HSTS + per-IP rate limiting + explicit 404s for the
    metrics/docs surfaces; backend/frontend/postgres publish nothing;
    resource limits, restart policies, log rotation, healthcheck-gated
    startup, graceful shutdown); database-aware `/ready`; native
    dependency-free `/metrics` (bus counters + gauges, authenticated,
    in-cluster only); LOG_FORMAT=json application logs; env-driven bind
    host/port + broker adapter/account; TLS staging cert generation;
    idempotent backup/restore scripts; production deployment RUNBOOK;
    CI/CD with a PostgreSQL-service job for the repository tests,
    container builds, and prod compose validation.
  - **M16 End-to-End Validation** (`tests/e2e/`, `main.py` drivers,
    frontend ticket): live-stack scenario suites (ADR-021) driving the
    DEPLOYED mtbe-prod stack over TLS — the SAME 34-record evidence
    suite passing on BOTH broker adapters (IBKR + SAXO; only the
    broker-neutral SAXO_UIC identifier differs), covering the complete
    trading lifecycle, accounting invariants with independent
    exact-decimal recomputation, duplicate-order replay, kill-switch
    gating, WS streaming + reconnect semantics, backend-restart
    PostgreSQL persistence + idempotency survival, database-restart
    degradation/recovery, every security boundary through the edge, and
    performance smoke; simulation-only composition drivers (startup
    market subscriptions, tick emitter, paper-trading auto-fill with
    SIM_ACTION=PARTIAL|REJECT directives via the identifiers channel);
    viewer + outsider demo users; frontend order-ticket identifiers
    input; composition-helper unit tests.
  - **M17 Production Readiness** (`docs/RELEASE.md`, RUNBOOK rollback
    section, final audits): production-readiness audit across every
    dimension; final baseline re-run (695 + 116, hygiene clean, 0
    vulnerabilities); clean-environment deployment + all 12 operational
    procedures validated live (incl. JWT secret rotation and the
    backup/restore/rollback procedures); tracked-file secrets audit
    (one README documentation-credential finding fixed); requirements
    audit completed (every FR/NFR/TS implemented+validated or an
    explicit ADR-backed deferral); independent multi-perspective final
    review PASS — signed off as **PRODUCTION READY** for the validated
    scope with zero release blockers and a mandatory pre-real-money
    checklist.

### Fixed

- CI `backend` job aborted during pytest collection with "import file
  mismatch" (found by the feature-branch PR pipeline): two test files
  shared the basename `test_lifecycle.py` (`tests/unit/order_management/`
  and `tests/e2e/`), and pytest imports test modules by basename, so the
  combined `python -m pytest ../tests` run died before executing a
  single test — every PR pipeline and push to main failed this way.
  The unit file was renamed to `test_oms_lifecycle.py` (nothing imported
  it by basename; the e2e file must keep its name because
  `tests/e2e/test_realtime_failures.py` imports helpers from it), a
  unique-basename guard was added to the foundation suite
  (negative-verified), and the CI job now runs the README-documented
  `--ignore=../tests/e2e` scope since the live-stack E2E suite cannot
  run in the in-memory CI job (TESTING.md Step 13). Re-verified: 688
  passed + 8 skipped (PostgreSQL), 0 failed (2026-10-27).
- E2E README documented example credentials matching live validation
  values (found by the M17 secrets audit): substituted with
  placeholders; re-scan clean (2026-10-12).
- ADR-018 section record missing from `docs/DECISIONS.md` (found by the
  M17 final consistency check): the Authentication & Authorization
  decision section had been lost in a later file rewrite (its log row and
  all cross-references survived); restored verbatim from the M12 session
  and re-verified — 21 ADR sections present and ordered (2026-10-12).
- Sim-driver marker channel (found by M16 live E2E): the deterministic
  PARTIAL/REJECT conventions initially read `order.idempotency_key`, a
  field the domain Order does not carry — directives now ride the
  broker-neutral instrument identifiers and the REJECT delivery uses the
  M5 reconcile path (2026-10-11).
- WS E2E isolation assertion (found by M16 review): asserting only on
  the 101 handshake missed the accept-then-close design (M12) — the
  scenario now reads the close frame and asserts 4403 (2026-10-11).
- Unbounded DB readiness ping (found by M15 deployment validation): a
  paused database HUNG the /ready probe; now bounded to 2 s with fast
  degradation to `starting`/`unavailable` (2026-10-09).
- Backend loopback bind inside containers (found by M15 deployment
  validation): the proxy received 502s; the bind is now env-driven and
  the image defaults to 0.0.0.0 (compose network = isolation boundary;
  no ports published) (2026-10-09).
- Dev/prod compose volume collision (found by M15 review): the shared
  default project name let development and production postgres volumes
  collide (observed live); the production stack now pins
  `name: mtbe-prod` (2026-10-09).
- Frontend nginx CSP dropped on /index.html (found by M15 deployment
  validation): nginx add_header does not inherit into blocks that define
  their own; the full security header set is repeated in the block
  (verified live) (2026-10-09).
- eslint@latest resolved to v10, breaking strict `npm ci` in the frontend
  image build (found by M15 container validation); pinned to ^9 with 0
  npm advisories retained (2026-10-09).
- Login-throttle memory bounding (found by the M14 adversarial review):
  the failure table now drops keys with no in-window failures and sweeps
  when large, so random-username sprays cannot grow it without bound
  (2026-10-08).
- Instrument identifier size bounds (found by the M14 adversarial review):
  `InstrumentIn.identifiers` bounded the entry count but not key/value
  length — megabyte-scale identifier strings could reach the OMS; now
  422-rejected (32/128-char bounds) with regressions (2026-10-08).
- REST `InstrumentIn` could not express the broker-neutral instrument
  `identifiers` (found by M13 full-stack testing): a Saxo-backed runtime
  was unreachable through the documented API flow — the adapter requires
  `SAXO_UIC` and never guesses (ADR-015). `identifiers` now passes through
  to the domain `Instrument` (backward compatible); schema + full-stack
  regressions added (2026-10-01).
- Execution-engine report isolation (found by M13 full-stack testing): an
  invalid asynchronously-delivered broker report (overfill) raised
  `OrderStateError` through the adapter delivery loop, aborting the drain
  and wedging every subsequent queued report; the same exposure existed in
  the reconcile sweep. Invalid reports are now dropped at the engine
  boundary with identifier-only logging; engine + full-stack regressions
  added (2026-10-01).
- M6 daily-loss sign semantics (found by M7 integration testing):
  `max_daily_loss` is now documented and validated as a **positive** loss
  magnitude (floor = −(max_daily_loss)); a negative configuration previously
  rejected even zero-P&L orders. Added regressions for zero-P&L approval,
  negative-limit rejection, and the unavailable-provider path, and wired the
  `DailyPnlProvider` in the M6 risk test fixture (2026-09-15).

### Architecture

- Documented layered architecture and non-negotiable boundaries
  (React → FastAPI → Application → Domain → Broker base → Adapters).
- Documented event architecture (envelope, registry, bus, serializer,
  ordering/concurrency, versioning, idempotency) in `docs/ARCHITECTURE.md`.
- Added event catalog `docs/EVENTS.md` with per-event semantics.
- Added M2 ADRs (ADR-006 event bus, ADR-007 ordering & execution model,
  ADR-008 serialization & versioning) in `docs/DECISIONS.md`.
- Documented market-data architecture (broker port, engine, normalization,
  subscription management, staleness) in `docs/ARCHITECTURE.md`.
- Added ADR-009 (broker-agnostic market-data port + engine) in
  `docs/DECISIONS.md`.
- Documented order-management architecture (lifecycle, idempotency, repository
  port) in `docs/ARCHITECTURE.md`.
- Added ADR-010 (broker-independent OMS on M1 state machine + M2 event bus) in
  `docs/DECISIONS.md`.
- Made `tests` importable from the repo root in `tests/conftest.py` so unit
  tests can import helpers from `tests.unit.*.conftest` in standalone runs.
- Documented execution architecture (OMS/Execution/Broker split, timeout and
  retry safety, reconciliation) in `docs/ARCHITECTURE.md`.
- Added ADR-011 (broker-independent execution engine on `ExecutionBroker` port)
  in `docs/DECISIONS.md`.
- Documented risk architecture (state ownership, fail-closed behavior,
  concurrency, kill switch) in `docs/ARCHITECTURE.md`.
- Added ADR-012 (fail-closed pre-trade risk gate + mandatory execution
  checkpoint) in `docs/DECISIONS.md`.
- Documented portfolio & P&L architecture (average-cost accounting,
  valuation policy, event processing, risk integration, reconciliation,
  persistence boundary) in `docs/ARCHITECTURE.md`.
- Added ADR-013 (average-cost portfolio service implementing the M6 risk
  read-model ports) in `docs/DECISIONS.md`.
- Documented broker-adapter architecture (transport port, mapping layer,
  lifecycle, dedup, reconciliation, async bridging) in `docs/ARCHITECTURE.md`.
- Added ADR-014 (IBKR adapter behind `IbkrClient` port; simulated paper mode)
  in `docs/DECISIONS.md`.
- Documented Saxo adapter architecture + IBKR/Saxo capability-difference
  parity in `docs/ARCHITECTURE.md` and `docs/TEST_STATUS.md`.
- Added ADR-015 (Saxo adapter reusing the abstraction; OAuth session
  encapsulated in the adapter) in `docs/DECISIONS.md`.
- Documented API gateway architecture (composition root, delegation, exact
  decimals, error mapping, WS sync model) in `docs/ARCHITECTURE.md`.
- Added ADR-016 (thin REST+WS gateway; exact-decimal JSON; at-least-once WS
  synchronization) in `docs/DECISIONS.md`.
- Documented trading-terminal architecture (sync contract, reconnect policy,
  store layer, money handling, order safety, market data) in
  `docs/ARCHITECTURE.md`.
- Added ADR-017 (presentation-only terminal; useSyncExternalStore stores;
  ADR-016 sync client; exact-decimal UI) in `docs/DECISIONS.md`.
- Documented authentication & authorization architecture (token/session
  model, RBAC + account scoping, WS tickets, failure semantics) in
  `docs/ARCHITECTURE.md`.
- Added ADR-018 (mandatory JWT + rotating refresh sessions; RBAC + account
  scoping; single-use WS tickets) in `docs/DECISIONS.md`.

### Infrastructure

- Placeholder `.github/workflows`, `infrastructure/docker`, `infrastructure/nginx`,
  `infrastructure/deployment` structure created.

### Testing

- Established test recording rules (see `docs/TEST_STATUS.md`).
- **Verified** the M0 foundation: backend tests 29/29 pass, frontend 1/1 pass;
  backend `ruff` and `mypy` clean; frontend `tsc`, ESLint, and `vite build`
  clean (2026-09-10).
- **M1 domain tests added and verified** (2026-09-13): 113/113 backend tests
  pass; `ruff check`, `ruff format --check`, and `mypy` (strict) all clean.
- **M2 event tests added and verified** (2026-09-15): 156/156 backend tests
  pass (29 M0 + 75 M1 + 52 M2); `ruff check`, `ruff format --check`, and `mypy`
  (strict, 30 files) all clean. Quant, Security, QA, and Architect reviews:
  PASS. Full M0+M1 regression: PASS (104/104).
- **M3 market-data tests added and verified** (2026-09-15): 191/191 backend
  tests pass (29 M0 + 75 M1 + 52 M2 + 35 M3); `ruff check`, `ruff format
  --check`, and `mypy` (strict, 34 files) all clean. Quant, Security, QA, and
  Architect reviews: PASS. Full M0+M1+M2 regression: PASS (156/156).
- **M4 OMS tests added and verified** (2026-09-15): 217/217 backend tests pass
  (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4); `ruff check`, `ruff format --check`,
  and `mypy` (strict, 37 files) all clean. Quant, Security, QA, and Architect
  reviews: PASS. Full M0+M1+M2+M3 regression: PASS (191/191).
- **M5 execution tests added and verified** (2026-09-15): 232/232 backend tests
  pass (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 + 15 M5); `ruff check`, `ruff
  format --check`, and `mypy` (strict, 39 files) all clean. Quant, Security, QA,
  and Architect reviews: PASS. Full M0+M1+M2+M3+M4 regression: PASS (217/217).
- **M6 risk tests added and verified** (2026-09-15): 269/269 backend tests pass
  (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 + 15 M5 + 37 M6); `ruff check`, `ruff
  format --check`, and `mypy` (strict, 45 files) all clean. Quant, Security, QA,
  and Architect reviews: PASS. Full M0–M5 regression: PASS (232/232).
- **M7 portfolio tests added and verified** (2026-09-15): 310/310 backend tests
  pass (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 + 15 M5 + 39 M6 + 39 M7);
  `ruff check`, `ruff format --check`, and `mypy` (strict, 47 files) all clean.
  Quant, Security, QA, and Architect reviews: PASS. Full M0–M6 regression
  (including the M6 daily-loss fix and its 2 new regressions): PASS (271/271).
- **M8 IBKR adapter tests added and verified** (2026-09-15): 368/368 backend
  tests pass (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 + 15 M5 + 39 M6 + 39 M7 +
  58 M8); `ruff check`, `ruff format --check`, and `mypy` (strict, 51 files) all
  clean. Backend, Quant, QA, and Security reviews: PASS. Full M0–M7 regression:
  PASS (310/310). Live/paper validation against a real TWS/IBKR Gateway:
  DEFERRED (no credentials/gateway in this environment; simulated client only;
  documented in `docs/TEST_STATUS.md`, ADR-014).
- **M9 Saxo adapter tests added and verified** (2026-09-15): 432/432 backend
  tests pass (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 + 15 M5 + 39 M6 + 39 M7 +
  58 M8 + 64 M9); `ruff check`, `ruff format --check`, and `mypy` (strict, 55
  files) all clean. Backend, Quant, QA, and Security reviews + broker parity
  review: PASS. Full M0–M8 regression: PASS (368/368). Sandbox/live validation:
  DEFERRED (no sim-environment credentials; simulated client only; documented
  in `docs/TEST_STATUS.md`, ADR-015).
- **M10 API gateway tests added and verified** (2026-09-15): 482/482 backend
  tests pass (29 M0 + 75 M1 + 52 M2 + 35 M3 + 26 M4 + 15 M5 + 39 M6 + 39 M7 +
  58 M8 + 64 M9 + 50 M10); `ruff check`, `ruff format --check`, and `mypy`
  (strict, 62 files) all clean. Backend, QA, Security, and Architect reviews +
  a dedicated race/event-sync review: PASS. Full M0-M9 regression: PASS
  (432/432).
- **M11 frontend tests added and verified** (2026-09-27): 89/89 frontend tests
  pass (unit 44: decimal utils 10, stores 15, API client 9, WS client 10;
  hook-integration 8; component 37: order ticket 9, order blotter 8, panels
  17, App 3); `tsc -b`, ESLint, Prettier check, and `vite build` all clean.
  Frontend/QA and Security/Architecture reviews: PASS (all findings fixed
  and re-verified — see `docs/TEST_STATUS.md`). Backend M0–M10 regression:
  PASS (482/482). Live contract smoke against the running M10 gateway (REST +
  WS, incl. idempotent replay, risk 422, event_id envelopes): PASS (10/10).
  Browser E2E deferred to M13/M16 per roadmap.
- **M12 authN/AuthZ tests added and verified** (2026-09-30): backend 586/586
  tests pass (104 new: passwords 11, tokens 31, auth endpoints 25,
  authorization/IDOR 7, WS auth 7, security suite 23 — bypass shapes,
  token confusion, foreign-secret forgery, leakage scans via caplog,
  enumeration resistance, CORS posture, identity-source hardening);
  `ruff check`, `ruff format --check`, and `mypy` (strict, 66 files) all
  clean. Frontend 109/109 tests pass (20 new auth tests: session
  lifecycle incl. in-memory-only storage, single-flight refresh,
  401-retry interceptor, RBAC helpers, login view, auth-gated App, WS
  ticket flow, viewer/admin UX gating); `tsc -b`, ESLint, Prettier check,
  `vite build` all clean. Live contract smoke against the running
  M12-enabled gateway (REST + WS): PASS (19/19 — fail-closed 401s,
  IDOR/RBAC denials, single-use WS tickets, refresh rotation + theft
  response, logout revocation). Security review: PASS (findings fixed:
  dev-bootstrap record shapes, JWT-confusion reachability, ≥32-byte key
  enforcement promoted from warning to fail-closed, conditional-hook
  violation — see `docs/TEST_STATUS.md`).
- **M13 integration tests added and verified** (2026-10-01): backend 647/647
  tests pass (56 dual-broker full-stack tests + 3 identifiers schema
  regressions + 2 execution-isolation regressions; the SAME broker-
  independent workflow proven on IBKR and Saxo); `ruff check`, `ruff
  format --check`, `mypy` (strict, 66 files) all clean. Frontend 110/110
  tests pass (terminal-boundary flow test); `tsc -b`, ESLint, Prettier
  check, `vite build` all clean. Two integration defects found and fixed
  with regressions (identifiers pass-through; report isolation). External
  sandbox/paper validation NOT EXECUTED (no credentialed environment —
  documented deferral since M8/M9); simulated-client coverage only, no live
  trading. Integration/architecture review: PASS.
- **M14 security tests added and verified** (2026-10-08): backend 677/677
  tests pass (30 new hardening/security tests incl. the repo secrets
  guard); frontend 116/116 (6 new static security guards) on the upgraded
  ESLint 9 / Vite 8 / Vitest 5 stack; ruff/mypy/tsc/lint/format/build all
  clean. Dependency scans: `npm audit` 16 -> 0 (toolchain upgrade; all
  were dev-only), `pip-audit` (project venv) 0. Live hardened-surface
  smoke: PASS (6/6). Adversarial review: PASS — findings fixed with
  regressions (throttle memory bounding, identifier size bounds),
  accepted/deferred risks documented in ADR-019.
- **M15 infrastructure tests added and verified** (2026-10-09): backend
  690/690 tests pass (8 live-PostgreSQL repository tests incl. an OMS
  lifecycle + restart simulation, /ready database-state gating, /metrics
  event-driven counters); the DB tests skip cleanly without a provisioned
  database; ruff/mypy/format clean. Frontend 116/116; tsc/ESLint/
  Prettier/build clean; npm audit 0. LIVE deployment validation:
  13/13 PASS (TLS + CSP, auth/REST/WS through the proxy, orders persisted
  across a backend restart with idempotency replay, DB-pause readiness
  degradation/recovery, graceful shutdown, edge 404s) plus a verified
  backup/restore round-trip and fail-fast configuration checks.
  Infrastructure review: PASS — 8 findings fixed (bounded ping, container
  bind, project separation, proxy conf scope, eslint pinning, CSP
  inheritance, pg_dump --clean, unprivileged-proxy key readability).
- **M16 E2E validated and verified** (2026-10-11): LIVE-stack scenario
  suites — 34/34 evidence records PASS on IBKR AND 34/34 on SAXO
  (deployed production stack, full artifacts under
  `tests/e2e/artifacts/`); backend regression 695/695 (5 new
  composition-helper tests); frontend 116/116; all hygiene clean. All
  validation findings investigated and fixed (marker channel, WS close
  assertion, zero-qty chunk, viewer provisioning); limitations
  documented in ADR-021.
- **M17 final verification** (2026-10-12): backend 695/695 + frontend
  116/116 (full regression); clean-environment deployment + 12
  operational procedures validated live; secrets scan clean (one
  documentation finding fixed); requirements audit complete (no
  blockers); multi-perspective final review PASS — PRODUCTION READY,
  release record in `docs/RELEASE.md`.
