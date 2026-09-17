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