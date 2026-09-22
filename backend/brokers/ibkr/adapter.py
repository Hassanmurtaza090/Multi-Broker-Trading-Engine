"""IBKR adapter — implements the broker ports for Interactive Brokers.

This is the ONLY place IBKR-specific logic lives. It implements:

- M3 `MarketDataFeed`: subscribe/unsubscribe + quote/bar push into the market
  data engine (the engine publishes `market.*` events; IBKR's combined tick maps
  to `RawQuote` — `RawTick` is not produced, documented).
- M5 `ExecutionBroker`: submit/cancel/modify + asynchronous execution reports
  into the execution engine (which drives the OMS — the adapter never bypasses
  OMS/Execution semantics).
- Connection lifecycle: publishes `BrokerConnected` / `BrokerDisconnected`
  on the M2 bus; `reconnect()` re-subscribes market data from a deduplicated
  registry and replays broker state (open orders, executions, account,
  positions) for reconciliation (TS-006).
- Account data: IBKR account values are mapped to `Balance` and published as
  `balance.updated` events (consumed by M7). Broker positions are exposed via
  `position_snapshot()` for the M7 `apply_broker_snapshot` reconciliation
  boundary (wired by the application layer, ADR-013).

Duplicate handling: IBKR repeats order-status callbacks and can redeliver
executions; the adapter dedupes statuses per order (last-status tracking) and
executions by `execution_id` (matching the at-least-once semantics of M2/M7).

Bridging: IBKR client callbacks are synchronous; async port handlers
(`FeedHandler`, `ExecutionReportHandler`) receive reports/events through
pending queues drained on the event loop (`drain_pending_reports()` /
`drain_feed_events()` are exposed for deterministic tests).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from brokers.base import (
    ExecutionReportHandler,
    FeedHandler,
    FeedSubscription,
    RawBar,
    RawQuote,
)
from brokers.ibkr import contracts as ibkr
from brokers.ibkr import mapping
from brokers.ibkr.client import IbkrCallbacks, IbkrClient, IbkrClientError
from domain.account import Balance
from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReport, ExecutionReportType
from domain.instrument import Instrument
from domain.market import BarInterval
from domain.money import Currency, Price, Quantity
from domain.orders import Order
from events import BalanceUpdated, BrokerConnected, BrokerDisconnected, EventBus

logger = logging.getLogger("mtbe.brokers.ibkr")

_CONFIRM_TIMEOUT = 10.0
_SUBMIT_STATUS_KEY = "Submitted"  # transport-level ack recorded for dedup


@dataclass(frozen=True, slots=True)
class _OrderMeta:
    """Adapter-side bookkeeping for one order placed at IBKR."""

    client_order_id: UUID
    account_id: str
    instrument: Instrument
    quantity: Decimal


class _FeedSub:
    """Opaque feed subscription handle (M3 `FeedSubscription` shape)."""

    def __init__(self, instrument: Instrument, adapter: IbkrAdapter) -> None:
        self.instrument = instrument
        self._adapter = adapter

    async def cancel(self) -> None:
        await self._adapter.unsubscribe(self)


class IbkrAdapter:
    """Interactive Brokers adapter (simulated/paper mode via `IbkrClient`)."""

    def __init__(
        self,
        client: IbkrClient,
        *,
        bus: EventBus | None = None,
        account_id: str,
        broker_name: str = "IBKR",
        confirm_timeout: float = _CONFIRM_TIMEOUT,
        auto_drain: bool = True,
    ) -> None:
        # The simulated client (and any real client) receives callbacks here.
        attach = getattr(client, "attach_callbacks", None)
        if attach is not None:
            attach(self._as_callbacks())
        self._client = client
        self._bus = bus
        self._account_id = account_id
        self._broker_name = broker_name
        self._confirm_timeout = confirm_timeout
        # When False, queued deliveries wait for an explicit drain() call
        # (deterministic tests). Production keeps True (auto drain task).
        self._auto_drain = auto_drain

        self._feed_handler: FeedHandler | None = None
        self._report_handler: ExecutionReportHandler | None = None

        self._connected = False
        self._shutting_down = False
        # client_order_id -> IBKR order id, and IBKR order id -> metadata.
        self._order_ids: dict[str, int] = {}
        self._order_meta: dict[int, _OrderMeta] = {}
        self._last_status: dict[int, str] = {}
        self._order_execs: dict[int, list[ibkr.IbkrExecution]] = {}
        self._seen_execution_ids: set[str] = set()
        self._pending_confirms: dict[int, asyncio.Future[ibkr.IbkrOrderStatus]] = {}
        # Buffer statuses that fire synchronously inside submit/cancel/modify.
        self._buffering = False
        self._status_buffer: list[ibkr.IbkrOrderStatus] = []

        # Market-data registry: contract key -> (contract, instrument).
        self._desired: dict[tuple[str, str, str, str], tuple[ibkr.IbkrContract, Instrument]] = {}

        # Account values keyed by (key, currency); positions by instrument key.
        self._account_values: dict[tuple[str, str], ibkr.IbkrAccountValue] = {}
        self._positions: dict[str, Any] = {}

        # Queued async deliveries (see module docstring): one drain for
        # reports, feed events, and bus events — deterministic via `drain()`.
        self._pending_reports: list[ExecutionReport] = []
        self._pending_feed_events: list[RawBar | RawQuote] = []
        self._pending_bus_events: list[Any] = []
        self._drain_task: asyncio.Task[None] | None = None

    # -- M3 MarketDataFeed -----------------------------------------------------
    async def start(self) -> None:
        if self._client.is_connected():
            return  # idempotent (duplicate start)
        try:
            self._client.connect()
        except IbkrClientError as exc:
            raise BrokerError(
                f"IBKR connect failed: {exc}",
                broker=self._broker_name,
                broker_error_code="CONNECT_FAILED",
                code=ErrorCode.CONNECTION_LOST,
            ) from exc

    async def stop(self) -> None:
        if not self._client.is_connected():
            return
        self._shutting_down = True
        try:
            for _, (contract, _i) in list(self._desired.items()):
                try:
                    self._client.unsubscribe_market_data(contract)
                except IbkrClientError:
                    pass  # best-effort cleanup during shutdown
            self._desired.clear()
            self._client.disconnect()
        finally:
            self._shutting_down = False

    def attach_handler(self, handler: FeedHandler) -> None:
        self._feed_handler = handler

    async def subscribe(self, instrument: Instrument) -> FeedSubscription:
        self._require_connected()
        contract = mapping.instrument_to_contract(instrument)
        key = _contract_key(contract)
        if key not in self._desired:
            # Idempotent: duplicate subscribes never reach the client twice.
            self._client.subscribe_market_data(contract)
            self._desired[key] = (contract, instrument)
        return _FeedSub(instrument, self)

    async def unsubscribe(self, subscription: FeedSubscription) -> None:
        contract = mapping.instrument_to_contract(subscription.instrument)
        key = _contract_key(contract)
        if key in self._desired:
            del self._desired[key]
            try:
                self._client.unsubscribe_market_data(contract)
            except IbkrClientError:
                pass  # already gone at the broker

    async def request_historical_bars(self, instrument: Instrument, bar_size: str) -> None:
        """IBKR-specific capability (not part of the M3 port)."""
        self._require_connected()
        mapping.ibkr_bar_size_to_interval(bar_size)  # validate before request
        contract = mapping.instrument_to_contract(instrument)
        self._client.request_historical_bars(contract, bar_size)

    # -- M5 ExecutionBroker ------------------------------------------------------
    def attach_report_handler(self, handler: ExecutionReportHandler) -> None:
        self._report_handler = handler

    async def submit_order(self, order: Order) -> ExecutionReport:
        self._require_connected()
        ibkr_order = mapping.order_to_ibkr(order)
        self._buffering = True
        try:
            ibkr_order_id = self._client.place_order(ibkr_order)
        except IbkrClientError as exc:
            raise BrokerError(
                f"IBKR place_order failed: {exc}",
                broker=self._broker_name,
                code=ErrorCode.CONNECTION_LOST,
            ) from exc
        finally:
            self._buffering = False
            buffered, self._status_buffer = self._status_buffer, []

        self._order_ids[str(order.client_order_id)] = ibkr_order_id
        self._order_meta[ibkr_order_id] = _OrderMeta(
            client_order_id=order.client_order_id,
            account_id=order.account_id,
            instrument=order.instrument,
            quantity=order.quantity.value,
        )
        # Process statuses that fired during place_order: record them and
        # consume the decisive one as this call's return report.
        decisive: ExecutionReport | None = None
        for status in buffered:
            self._last_status[ibkr_order_id] = status.status
            try:
                report_type = mapping.order_status_to_report_type(status.status)
            except ValueError:
                continue  # pre-ack / fill statuses carry no report here
            decisive = self._report_for(ibkr_order_id, report_type)
        if decisive is not None:
            return decisive
        # Transport-level ack: IBKR accepted the request (async Submitted
        # callbacks are deduped via the recorded status).
        self._last_status[ibkr_order_id] = _SUBMIT_STATUS_KEY
        return self._report_for(ibkr_order_id, ExecutionReportType.ACCEPTED)

    async def cancel_order(self, order: Order) -> ExecutionReport:
        self._require_connected()
        ibkr_order_id = self._require_order(order)
        status = await self._await_confirm(
            ibkr_order_id, lambda: self._client.cancel_order(ibkr_order_id), "cancel"
        )
        if status.status in (ibkr.IBKR_FILLED, ibkr.IBKR_PARTIALLY_FILLED):
            raise BrokerError(
                "cannot cancel: order already filling",
                broker=self._broker_name,
                code=ErrorCode.CONFLICT,
            )
        return self._report_for(ibkr_order_id, ExecutionReportType.CANCELLED)

    async def modify_order(self, order: Order) -> ExecutionReport:
        self._require_connected()
        ibkr_order_id = self._require_order(order)
        ibkr_order = mapping.order_to_ibkr(order)
        await self._await_confirm(
            ibkr_order_id, lambda: self._client.modify_order(ibkr_order_id, ibkr_order), "modify"
        )
        return self._report_for(ibkr_order_id, ExecutionReportType.REPLACED)

    async def fetch_order_status(self, order: Order) -> ExecutionReport | None:
        """Reconciliation query (M5 `reconcile`): report only NEW information."""
        ibkr_order_id = self._order_ids.get(str(order.client_order_id))
        if ibkr_order_id is None:
            return None
        current = self._client.request_order_status(ibkr_order_id)
        if current is None:
            return None
        if current.status == self._last_status.get(ibkr_order_id):
            return None  # nothing new since the last delivered status
        self._last_status[ibkr_order_id] = current.status
        if current.status in (ibkr.IBKR_FILLED, ibkr.IBKR_PARTIALLY_FILLED):
            # Fills need execution data; use the newest cached execution.
            execs = self._order_execs.get(ibkr_order_id, [])
            if not execs:
                logger.warning(
                    "ibkr_reconcile_fill_without_execution",
                    extra={"ibkr_order_id": ibkr_order_id},
                )
                return None  # documented limitation (ADR-014)
            execution = execs[-1]
            meta = self._order_meta[ibkr_order_id]
            fill = mapping.execution_to_fill(execution, meta.instrument, account_id=meta.account_id)
            report_type = (
                ExecutionReportType.FILL
                if Decimal(execution.cum_quantity) >= meta.quantity
                else ExecutionReportType.PARTIAL_FILL
            )
            return self._report_for(ibkr_order_id, report_type, fill=fill)
        try:
            report_type = mapping.order_status_to_report_type(current.status)
        except ValueError:
            return None
        return self._report_for(ibkr_order_id, report_type)

    # -- connection lifecycle / recovery -------------------------------------------
    async def reconnect(self) -> None:
        """Re-establish the session after an unexpected disconnect (TS-006)."""
        if self._client.is_connected():
            return  # idempotent (duplicate reconnect)
        try:
            self._client.connect()
        except IbkrClientError as exc:
            raise BrokerError(
                f"IBKR reconnect failed: {exc}",
                broker=self._broker_name,
                broker_error_code="CONNECT_FAILED",
                code=ErrorCode.CONNECTION_LOST,
            ) from exc
        # Re-subscribe desired market data from the dedup registry.
        for _, (contract, _i) in self._desired.items():
            self._client.subscribe_market_data(contract)
        # Replay broker state for reconciliation (no duplicate effects:
        # statuses dedupe via last-status; executions via execution ids).
        self._client.request_open_orders()
        self._client.request_executions()
        self._client.request_account_summary()
        self._client.request_positions()

    @property
    def is_connected(self) -> bool:
        return self._connected

    # -- IBKR callbacks (synchronous; see module docstring) -------------------------
    def _as_callbacks(self) -> IbkrCallbacks:
        return _CallbackShim(self)

    def on_connected(self) -> None:
        self._connected = True
        self._publish_bus_event(
            BrokerConnected(broker=self._broker_name, account_id=self._account_id)
        )

    def on_disconnected(self) -> None:
        was_connected = self._connected
        self._connected = False
        reason = "shutdown" if self._shutting_down else "connection lost"
        if was_connected:
            self._publish_bus_event(
                BrokerDisconnected(
                    broker=self._broker_name, account_id=self._account_id, reason=reason
                )
            )

    def on_error(self, code: int, message: str) -> None:
        error = mapping.map_ibkr_error(code, message)
        # Structured diagnostics only — never secrets; state changes arrive
        # via on_disconnected / order statuses.
        logger.warning(
            "ibkr_error",
            extra={
                "code": error.code.value,
                "broker_error_code": error.broker_error_code,
                "operation": "ibkr.error",
            },
        )

    def on_order_status(self, status: ibkr.IbkrOrderStatus) -> None:
        if self._buffering:
            self._status_buffer.append(status)
            return
        self._process_order_status(status)

    def _process_order_status(self, status: ibkr.IbkrOrderStatus) -> None:
        ibkr_order_id = status.ibkr_order_id
        last = self._last_status.get(ibkr_order_id)
        self._last_status[ibkr_order_id] = status.status
        future = self._pending_confirms.get(ibkr_order_id)
        if future is not None and not future.done():
            future.set_result(status)  # consumed by cancel/modify; recorded above
            return
        if status.status == last:
            return  # duplicate status callback
        try:
            report_type = mapping.order_status_to_report_type(status.status)
        except ValueError:
            return  # pre-ack / fill statuses: executions carry the fills
        if self._report_handler is not None:
            self._pending_reports.append(self._report_for(ibkr_order_id, report_type))
            self._schedule_report_drain()

    def on_execution(self, execution: ibkr.IbkrExecution) -> None:
        if execution.execution_id in self._seen_execution_ids:
            return  # duplicate execution (redelivery)
        meta = self._order_meta.get(execution.ibkr_order_id)
        if meta is None:
            logger.warning(
                "ibkr_execution_unknown_order",
                extra={"ibkr_order_id": execution.ibkr_order_id},
            )
            return
        self._seen_execution_ids.add(execution.execution_id)
        self._order_execs.setdefault(execution.ibkr_order_id, []).append(execution)
        fill = mapping.execution_to_fill(execution, meta.instrument, account_id=meta.account_id)
        report_type = (
            ExecutionReportType.FILL
            if Decimal(execution.cum_quantity) >= meta.quantity
            else ExecutionReportType.PARTIAL_FILL
        )
        self._pending_reports.append(
            self._report_for(execution.ibkr_order_id, report_type, fill=fill)
        )
        self._schedule_report_drain()

    def on_quote(self, quote: ibkr.IbkrQuote) -> None:
        try:
            event = self._to_raw_quote(quote)
        except (BrokerError, ValueError):
            # BrokerError: unmappable contract. ValueError: malformed prices
            # (pydantic ValidationError subclasses ValueError).
            logger.warning("ibkr_quote_dropped", extra={"symbol": quote.contract.symbol})
            return
        self._pending_feed_events.append(event)
        self._schedule_feed_drain()

    def on_bar(self, bar: ibkr.IbkrBar) -> None:
        try:
            event = self._to_raw_bar(bar)
        except (BrokerError, ValueError):
            logger.warning("ibkr_bar_dropped", extra={"symbol": bar.contract.symbol})
            return
        self._pending_feed_events.append(event)
        self._schedule_feed_drain()

    def on_account_value(self, value: ibkr.IbkrAccountValue) -> None:
        self._account_values[(value.key, value.currency)] = value
        try:
            balance = mapping.account_values_to_balance(
                self._account_id, list(self._account_values.values())
            )
        except BrokerError:
            return  # incomplete data — wait for more values
        self._publish_bus_event(BalanceUpdated(balance=balance))

    def on_position(self, position: ibkr.IbkrPosition) -> None:
        try:
            mapped = mapping.ibkr_position_to_position(position)
        except BrokerError:
            logger.warning("ibkr_position_dropped", extra={"symbol": position.contract.symbol})
            return
        # Relabel broker-side account ids to the internal account this
        # adapter serves (broker-account mapping is adapter responsibility).
        mapped = mapped.model_copy(update={"account_id": self._account_id})
        self._positions[mapped.instrument.primary_identifier] = mapped

    # -- snapshots (M7 reconciliation boundary) ---------------------------------------
    def position_snapshot(self) -> list[Any]:
        """Broker-reported positions (domain models), for M7 reconciliation."""
        return list(self._positions.values())

    def account_balance(self) -> Balance | None:
        try:
            return mapping.account_values_to_balance(
                self._account_id, list(self._account_values.values())
            )
        except BrokerError:
            return None

    # -- drains (deterministic delivery for tests) --------------------------------------
    async def drain(self) -> None:
        """Deliver all queued reports, feed events, and bus events.

        In a live loop the scheduled drain task calls this automatically; tests
        call it explicitly for determinism.
        """
        while self._pending_reports or self._pending_feed_events or self._pending_bus_events:
            for report in self._pending_reports[:]:
                self._pending_reports.remove(report)
                if self._report_handler is not None:
                    await self._report_handler(report)
            for event in self._pending_feed_events[:]:
                self._pending_feed_events.remove(event)
                if self._feed_handler is not None:
                    await self._feed_handler(event)
            for event in self._pending_bus_events[:]:
                self._pending_bus_events.remove(event)
                if self._bus is not None:
                    await self._bus.publish(event, source=f"broker.{self._broker_name}")

    # -- internals -----------------------------------------------------------------------
    def _require_connected(self) -> None:
        if not self._client.is_connected():
            raise BrokerError(
                "IBKR client not connected",
                broker=self._broker_name,
                code=ErrorCode.CONNECTION_LOST,
            )

    def _require_order(self, order: Order) -> int:
        ibkr_order_id = self._order_ids.get(str(order.client_order_id))
        if ibkr_order_id is None:
            raise BrokerError(
                f"order {order.client_order_id} is not at the broker",
                broker=self._broker_name,
                code=ErrorCode.ORDER_NOT_FOUND,
            )
        return ibkr_order_id

    async def _await_confirm(
        self, ibkr_order_id: int, request: Any, operation: str
    ) -> ibkr.IbkrOrderStatus:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[ibkr.IbkrOrderStatus] = loop.create_future()
        self._pending_confirms[ibkr_order_id] = future
        try:
            request()
            return await asyncio.wait_for(future, timeout=self._confirm_timeout)
        except TimeoutError as exc:
            raise BrokerError(
                f"IBKR {operation} confirmation timed out",
                broker=self._broker_name,
                broker_error_code="CONFIRM_TIMEOUT",
                code=ErrorCode.TIMEOUT,
            ) from exc
        except IbkrClientError as exc:
            raise BrokerError(
                f"IBKR {operation} failed: {exc}",
                broker=self._broker_name,
                code=ErrorCode.CONNECTION_LOST,
            ) from exc
        finally:
            self._pending_confirms.pop(ibkr_order_id, None)

    def _report_for(
        self,
        ibkr_order_id: int,
        report_type: ExecutionReportType,
        *,
        fill: Any = None,
    ) -> ExecutionReport:
        meta = self._order_meta[ibkr_order_id]
        return ExecutionReport(
            report_id=f"IBKR-{uuid4()}",
            order_client_id=meta.client_order_id,
            broker_order_id=str(ibkr_order_id),
            account_id=meta.account_id,
            report_type=report_type,
            fill=fill,
        )

    def _to_raw_quote(self, quote: ibkr.IbkrQuote) -> RawQuote:
        instrument = mapping.contract_to_instrument(quote.contract)
        currency = Currency(code=quote.contract.currency)
        ts = (
            datetime.fromtimestamp(quote.timestamp_unix, tz=UTC)
            if quote.timestamp_unix
            else datetime.now(UTC)
        )
        return RawQuote(
            instrument=instrument,
            bid=Price(value=Decimal(quote.bid), currency=currency)
            if quote.bid is not None
            else None,
            ask=Price(value=Decimal(quote.ask), currency=currency)
            if quote.ask is not None
            else None,
            last=Price(value=Decimal(quote.last), currency=currency)
            if quote.last is not None
            else None,
            bid_size=Quantity(value=Decimal(quote.bid_size))
            if quote.bid_size is not None
            else None,
            ask_size=Quantity(value=Decimal(quote.ask_size))
            if quote.ask_size is not None
            else None,
            timestamp=ts,
        )

    def _to_raw_bar(self, bar: ibkr.IbkrBar) -> RawBar:
        instrument = mapping.contract_to_instrument(bar.contract)
        currency = Currency(code=bar.contract.currency)
        interval: BarInterval = mapping.ibkr_bar_size_to_interval(bar.interval)
        return RawBar(
            instrument=instrument,
            interval=interval,
            open=Price(value=Decimal(bar.open), currency=currency),
            high=Price(value=Decimal(bar.high), currency=currency),
            low=Price(value=Decimal(bar.low), currency=currency),
            close=Price(value=Decimal(bar.close), currency=currency),
            volume=Quantity(value=Decimal(bar.volume)),
            timestamp=datetime.fromtimestamp(bar.timestamp_unix, tz=UTC),
        )

    def _publish_bus_event(self, event: Any) -> None:
        """Queue a bus event for delivery on the event loop (never a second loop)."""
        if self._bus is None:
            return
        self._pending_bus_events.append(event)
        self._schedule_drain()

    def _schedule_report_drain(self) -> None:
        self._schedule_drain()

    def _schedule_feed_drain(self) -> None:
        self._schedule_drain()

    def _schedule_drain(self) -> None:
        if not self._auto_drain:
            return  # explicit drain() in tests keeps delivery deterministic
        if self._drain_task is not None and not self._drain_task.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # drained explicitly via drain() in sync contexts
        self._drain_task = loop.create_task(self.drain())


class _CallbackShim:
    """Forwards `IbkrCallbacks` to the adapter (keeps protocol typing clean)."""

    def __init__(self, adapter: IbkrAdapter) -> None:
        self._adapter = adapter

    def on_connected(self) -> None:
        self._adapter.on_connected()

    def on_disconnected(self) -> None:
        self._adapter.on_disconnected()

    def on_error(self, code: int, message: str) -> None:
        self._adapter.on_error(code, message)

    def on_order_status(self, status: ibkr.IbkrOrderStatus) -> None:
        self._adapter.on_order_status(status)

    def on_execution(self, execution: ibkr.IbkrExecution) -> None:
        self._adapter.on_execution(execution)

    def on_quote(self, quote: ibkr.IbkrQuote) -> None:
        self._adapter.on_quote(quote)

    def on_bar(self, bar: ibkr.IbkrBar) -> None:
        self._adapter.on_bar(bar)

    def on_account_value(self, value: ibkr.IbkrAccountValue) -> None:
        self._adapter.on_account_value(value)

    def on_position(self, position: ibkr.IbkrPosition) -> None:
        self._adapter.on_position(position)


def _contract_key(contract: ibkr.IbkrContract) -> tuple[str, str, str, str]:
    return (contract.symbol, contract.sec_type, contract.exchange, contract.currency)
