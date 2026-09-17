# Event Catalog — M2 Event System

This document is the authoritative reference for the internal event types
defined in Milestone M2. Each event lists its purpose, producer, consumers,
payload, required/optional fields, version, invariants, and expected state
transition. Read this alongside `docs/ARCHITECTURE.md` (event architecture) and
`docs/DECISIONS.md` (ADRs).

Source of truth: `backend/events/types.py`, `backend/events/base.py`,
`backend/events/envelope.py`.

---

## Envelope

Every event is transported inside an `EventEnvelope` (`backend/events/envelope.py`):

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event_id` | UUID | yes (default fresh) | Unique occurrence id; the idempotency key for consumers. |
| `event_type` | str | yes | Stable, registry-unique type string. |
| `event_version` | int | yes | Schema version of the event type. |
| `timestamp` | datetime (UTC, tz-aware) | yes | When the event occurred. Naive timestamps are rejected. |
| `source` | str | no | Subsystem that produced the event (diagnosis only). |
| `correlation_id` | str \| None | no | Links related events across a business operation. |
| `causation_id` | str \| None | no | Event/action that directly caused this one (if applicable). |
| `payload` | typed DomainEvent | yes | Strongly typed business data. |

Invariants:

- `event_id` is globally unique per occurrence (fresh UUID unless replaying).
- `timestamp` must be timezone-aware (UTC); naive datetimes are rejected.
- `event_type` and `event_version` on the envelope always match the payload's
  declared identity.

---

## Event Types

### Market Data

#### `MarketQuoteUpdated` (`market.quote.updated`)

- **Purpose:** A normalized market quote for an instrument was received.
- **Producer:** Market Data engine (M3).
- **Consumers:** Portfolio valuation, risk, UI/WebSocket relay.
- **Payload:** `quote: MarketQuote` (required).
- **Required:** `quote`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `quote` is a valid `MarketQuote` (bid/ask validated).
- **State transition:** Market data snapshot refreshed; no domain state transition.

#### `MarketTickUpdated` (`market.tick.updated`)

- **Purpose:** A raw price tick was received/normalized for an instrument.
- **Producer:** Market Data engine (M3).
- **Consumers:** Portfolio valuation, risk, UI/WebSocket relay.
- **Payload:** `tick: MarketTick` (required).
- **Required:** `tick`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `tick` is a valid `MarketTick` (non-negative volume).
- **State transition:** Market data snapshot refreshed; no domain state transition.

#### `MarketBarUpdated` (`market.bar.updated`)

- **Purpose:** An OHLCV bar was received/normalized for an instrument.
- **Producer:** Market Data engine (M3).
- **Consumers:** Charting/UI, strategy indicators (later), risk.
- **Payload:** `bar: Bar` (required).
- **Required:** `bar`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `bar` is a valid OHLCV `Bar` (high ≥ max(open,close), low ≤
  min(open,close), single currency, non-negative volume).
- **State transition:** Market data snapshot refreshed; no domain state transition.

### Order Lifecycle

#### `OrderSubmitted` (`order.submitted`)

- **Purpose:** An order was submitted to the broker (transport accepted, ack
  pending).
- **Producer:** Order Management (M4) / Execution (M5).
- **Consumers:** Audit, risk monitoring, persistence, UI.
- **Payload:** `order: Order` (required); `request: OrderRequest | None`
  (optional; carries `idempotency_key` when known).
- **Required:** `order`. **Optional:** `request`.
- **Version:** 1.
- **Invariants:** Order status is `SUBMITTED` (or a pre-ack working state).
- **State transition:** NEW → SUBMITTED.

#### `OrderAccepted` (`order.accepted`)

- **Purpose:** The broker acknowledged and accepted the order (working).
- **Producer:** Broker adapter / Execution.
- **Consumers:** Audit, persistence, UI.
- **Payload:** `order: Order` (required).
- **Required:** `order`. **Optional:** none.
- **Version:** 1.
- **Invariants:** Order status is `ACCEPTED`/working.
- **State transition:** SUBMITTED → ACCEPTED.

#### `OrderRejected` (`order.rejected`)

- **Purpose:** The broker (or risk engine) rejected the order.
- **Producer:** Broker adapter / Risk engine.
- **Consumers:** Audit, risk, UI.
- **Payload:** `order: Order` (required); `reason: str` (optional, ≤512 chars).
- **Required:** `order`. **Optional:** `reason`.
- **Version:** 1.
- **Invariants:** Order status is `REJECTED`.
- **State transition:** NEW/SUBMITTED → REJECTED (failure path).

#### `OrderCancelled` (`order.cancelled`)

- **Purpose:** The order was cancelled.
- **Producer:** Execution / Order Management.
- **Consumers:** Audit, persistence, UI.
- **Payload:** `order: Order` (required).
- **Required:** `order`. **Optional:** none.
- **Version:** 1.
- **Invariants:** Order status is `CANCELLED`.
- **State transition:** SUBMITTED/ACCEPTED → CANCELLED.

#### `OrderModified` (`order.modified`)

- **Purpose:** A working order's price terms were modified locally.
- **Producer:** Order Management (M4).
- **Consumers:** Audit, persistence, UI.
- **Payload:** `order: Order` (required).
- **Required:** `order`. **Optional:** none.
- **Version:** 1.
- **Invariants:** Order is non-terminal and not pending submit/cancel; payload
  reflects the new prices.
- **State transition:** Working state → working state (price fields updated).
  Broker confirmation of the replace is handled by M5.

#### `OrderPartiallyFilled` (`order.partially_filled`)

- **Purpose:** A partial execution occurred against the order.
- **Producer:** Broker adapter / Execution.
- **Consumers:** Portfolio, risk, persistence, UI.
- **Payload:** `order: Order` (required); `fill: Fill` (required).
- **Required:** `order`, `fill`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `fill.quantity` is less than the remaining open quantity;
  order status remains working.
- **State transition:** ACCEPTED → PARTIALLY_FILLED (working).

#### `OrderFilled` (`order.filled`)

- **Purpose:** The order was fully filled.
- **Producer:** Broker adapter / Execution.
- **Consumers:** Portfolio, risk, persistence, UI.
- **Payload:** `order: Order` (required); `fill: Fill` (required).
- **Required:** `order`, `fill`. **Optional:** none.
- **Version:** 1.
- **Invariants:** Order status is `FILLED`; cumulative filled == order quantity.
- **State transition:** ACCEPTED/PARTIALLY_FILLED → FILLED.

#### `OrderExpired` (`order.expired`)

- **Purpose:** The order expired before being filled.
- **Producer:** Execution / Order Management.
- **Consumers:** Audit, persistence, UI.
- **Payload:** `order: Order` (required).
- **Required:** `order`. **Optional:** none.
- **Version:** 1.
- **Invariants:** Order status is `EXPIRED`.
- **State transition:** SUBMITTED/ACCEPTED → EXPIRED.

### Position Lifecycle

#### `PositionOpened` (`position.opened`)

- **Purpose:** A new position was opened (previously flat).
- **Producer:** Portfolio (M7).
- **Consumers:** Risk, persistence, UI.
- **Payload:** `position: Position` (required).
- **Required:** `position`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `position.quantity != 0`; prior quantity was 0.
- **State transition:** FLAT → OPEN (long/short).

#### `PositionUpdated` (`position.updated`)

- **Purpose:** An existing position changed (size or average price).
- **Producer:** Portfolio (M7).
- **Consumers:** Risk, persistence, UI.
- **Payload:** `position: Position` (required); `fill: Fill | None` (optional).
- **Required:** `position`. **Optional:** `fill`.
- **Version:** 1.
- **Invariants:** `position.quantity != 0`.
- **State transition:** OPEN → OPEN (size/price change).

#### `PositionClosed` (`position.closed`)

- **Purpose:** A position returned to flat.
- **Producer:** Portfolio (M7).
- **Consumers:** Risk, persistence, UI.
- **Payload:** `position: Position` (required).
- **Required:** `position`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `position.quantity == 0`.
- **State transition:** OPEN → FLAT.

### Account

#### `AccountUpdated` (`account.updated`)

- **Purpose:** An account's metadata/state changed.
- **Producer:** Broker adapter / Account service.
- **Consumers:** Persistence, UI.
- **Payload:** `account_id: str` (required, ≥1 char).
- **Required:** `account_id`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `account_id` non-empty.
- **State transition:** Account metadata refreshed.

#### `BalanceUpdated` (`balance.updated`)

- **Purpose:** A balance changed on an account.
- **Producer:** Broker adapter / Account service.
- **Consumers:** Risk, portfolio, persistence, UI.
- **Payload:** `balance: Balance` (required).
- **Required:** `balance`. **Optional:** none.
- **Version:** 1.
- **Invariants:** `balance` is a valid domain `Balance`.
- **State transition:** Cash/available balance updated.

### Broker Connectivity

#### `BrokerConnected` (`broker.connected`)

- **Purpose:** A broker adapter established connectivity.
- **Producer:** Broker adapter.
- **Consumers:** Availability monitoring, orchestration, UI.
- **Payload:** `broker: str` (required, ≥1 char); `account_id: str | None`
  (optional).
- **Required:** `broker`. **Optional:** `account_id`.
- **Version:** 1.
- **Invariants:** `broker` non-empty.
- **State transition:** DISCONNECTED → CONNECTED.

#### `BrokerDisconnected` (`broker.disconnected`)

- **Purpose:** A broker adapter lost connectivity.
- **Producer:** Broker adapter.
- **Consumers:** Availability monitoring, risk, orchestration, UI.
- **Payload:** `broker: str` (required, ≥1 char); `account_id: str | None`
  (optional); `reason: str` (optional, ≤256 chars).
- **Required:** `broker`. **Optional:** `account_id`, `reason`.
- **Version:** 1.
- **Invariants:** `broker` non-empty.
- **State transition:** CONNECTED → DISCONNECTED.

### Risk

#### `RiskViolation` (`risk.violation`)

- **Purpose:** A risk check rejected an operation.
- **Producer:** Risk engine (M6).
- **Consumers:** Audit, orchestration, UI, alerting.
- **Payload:** `account_id: str` (required, ≥1 char); `instrument:
  Instrument | None` (optional); `rule: str` (optional, ≤128 chars); `message:
  str` (optional, ≤512 chars); `order: Order | None` (optional).
- **Required:** `account_id`. **Optional:** `instrument`, `rule`, `message`,
  `order`.
- **Version:** 1.
- **Invariants:** `account_id` non-empty.
- **State transition:** No state transition; a risk gate refusal is reported.

---

## Event Semantics — Order Lifecycle

The event bus does **not** imply an event occurred unless the corresponding
state transition actually occurred. The canonical order transitions:

```text
OrderSubmitted
      ↓
OrderAccepted
      ↓
OrderPartiallyFilled ──┐
      ↓               │ (repeat until remaining == 0)
OrderFilled           │
```

Failure / terminal paths:

```text
OrderSubmitted ──► OrderRejected
OrderAccepted  ──► OrderCancelled / OrderExpired
OrderPartiallyFilled ──► OrderFilled / OrderCancelled
```

Publishing an event whose payload does not reflect a real state transition is a
publisher bug, not something the bus guards (the bus is transport; the order
state machine in M4 owns correctness).

---

## Ordering, Duplicates, and Idempotency

- **Ordering scope:** Per-bus total order within a single `InProcessEventBus`
  instance on a single event loop. A bus-level lock serializes all `publish()`
  calls; handler executions never interleave across events. A handler may
  publish a follow-up event on the same task (reentrancy) without deadlocking.
- **Not guaranteed:** ordering across separate bus instances, processes, or a
  future distributed transport.
- **Duplicate delivery:** M2 is at-least-once. The bus does **not** deduplicate.
  Consumers identify duplicates via `event_id` (and can additionally correlate
  by `order_id` / `execution_id` from the payload). A distributed idempotency
  store is intentionally deferred.

---

## Versioning

- Every event declares `__event_type__` (stable string) and `__event_version__`
  (int, default 1). `EventRegistry` keys on `(event_type, version)` so a future
  v2 class can coexist with v1.
- `EventRegistry.resolve(type, version=None)` returns the latest version;
  `version=N` returns a specific version.
- To add a v2 event: define `V2(Event): __event_type__ = "same"; __event_version__ = 2`,
  register it, and keep v1 registered so older consumers/persisted events still
  deserialize. Version-aware handlers dispatch on `envelope.event_version`.

---

## Error Handling

- **Handler exception:** captured into `PublishResult.errors` (list of
  `HandlerError`), logged (type + bounded message + traceback), and does not
  stop other subscribers or crash the bus.
- **No subscribers:** `publish()` succeeds with `delivered_to == 0`.
- **Invalid event / serialization failure:** raised to the caller (typed
  `ValueError`/`TypeError`/`UnknownEventTypeError`/`UnsupportedEventVersionError`).
- **Subscription failure:** non-callable handler raises `TypeError`.
- **Sensitive data:** `HandlerError.message` is bounded and excludes payload
  echoes; never log API keys, credentials, tokens, or passwords.
- **Future extension points:** retry / dead-letter queue are deferred (not
  required at M2). The bus interface is transport-agnostic so an external
  transport (e.g. NATS) can replace `InProcessEventBus` without changing
  domain/application layers.