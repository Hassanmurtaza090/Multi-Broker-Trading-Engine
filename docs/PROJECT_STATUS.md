# Project Status

> **Live project-state document.** Keep this file current after every milestone
> or significant change. Never claim work is complete without verification.

---

## Overview

| Field | Value |
| --- | --- |
| Project | Multi-Broker Trading Engine |
| Status | Active Development |
| Current Milestone | M9 — Saxo Adapter |
| Current Phase | Saxo adapter implemented + verified (simulated client; sim environment) |
| Implementation Status | Completed (M1–M9) |
| Testing Status | M0–M9 tests pass (432/432) |
| Broker Integrations | IBKR + Saxo adapters complete (simulated clients; real transports deferred) |
| Frontend | Scaffolded only (M0) |
| Production Deployment | Not Started |
| Last Updated | 2026-09-15 |

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

> No API or frontend logic has been implemented yet (M10+). The real
> ibapi-backed IBKR and OpenAPI-backed Saxo transports are deferred
> (ADR-014/ADR-015); M8/M9 are verified against simulated clients only.

---

## In-Progress Work

- None — M1–M9 implementation and verification complete (awaiting entry to M10).

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
| M10 | FastAPI Gateway | Pending |
| M11 | React Trading Terminal | Pending |
| M12 | Authentication & Authorization | Pending |
| M13 | Integration Testing | Pending |
| M14 | Security Hardening | Pending |
| M15 | Production Infrastructure | Pending |
| M16 | End-to-End Validation | Pending |
| M17 | Production Readiness | Pending |

---

## Blockers

- None.

## Known Technical Debt

- None at this stage (M1–M8 have no known defects; the OMS/portfolio/adapter
  in-memory state is an intentional, documented deferral — see below).
- `frontend` npm dependencies report 4 advisories from the deprecated ESLint 8
  toolchain (build-time only); to be addressed when tooling is upgraded.
- The OMS uses an in-memory `OrderRepository`; a PostgreSQL implementation
  arrives with the infrastructure milestone (ADR-010).
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
`brokers.ibkr`/`brokers.saxo` import exists outside them). Architecture
boundaries hold: domain, events, market_data, order_management, execution,
risk, and portfolio do not import FastAPI, React, SQLAlchemy, or any broker.
See `docs/ARCHITECTURE.md`, `docs/EVENTS.md`, and `docs/DECISIONS.md`.

---

## Last Verified Test Status

See `docs/TEST_STATUS.md` for the authoritative record.

- Latest result (M9, 2026-09-15): backend 432/432 tests pass; `ruff check`,
  `mypy` (strict, 55 files), and `ruff format` all clean. Backend, Quant, QA,
  and Security reviews + IBKR/Saxo parity review: PASS. M0–M8 regression: PASS
  (368/368). Sandbox/live validation: DEFERRED (documented, ADR-015).