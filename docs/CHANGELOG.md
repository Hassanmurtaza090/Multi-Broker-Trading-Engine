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

### Fixed

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