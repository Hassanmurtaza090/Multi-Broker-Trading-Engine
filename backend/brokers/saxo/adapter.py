"""Saxo adapter — implements the broker ports for Saxo Bank.

This is the ONLY place Saxo-specific logic lives. It mirrors the IBKR adapter's
proven structure while implementing Saxo's genuine differences:

- M3 `MarketDataFeed`: subscribe/unsubscribe + quote/bar push into the market
  data engine. Quotes resolve through the subscription registry (Saxo
  identifies instruments by UIC + AssetType; the adapter never guesses).
- M5 `ExecutionBroker`: submit/cancel/modify + asynchronous execution reports
  into the execution engine (the adapter never bypasses OMS/Execution
  semantics). Saxo additionally reports `Expired`, mapped to `EXPIRED`.
- OAuth session lifecycle: `start()` authorizes; expired tokens are handled
  proactively (`on_token_expired` refresh) and reactively (`_call` refreshes
  once and retries — safe because an auth-rejected request was not processed).
  Refresh failure drops the session (`BrokerDisconnected`, UNAUTHORIZED).
- Connection lifecycle: `BrokerConnected` / `BrokerDisconnected` on the M2 bus;
  `reconnect()` re-subscribes streaming from a deduplicated registry and
  replays broker state (open orders, executions, balances, positions) for
  reconciliation (TS-006).
- Account data: Saxo sends FULL balance snapshots; the adapter keeps the
  latest per currency, publishes `balance.updated` (consumed by M7), and
  relabels broker account keys to the internal account. Broker positions are
  exposed via `position_snapshot()` for the M7 reconciliation boundary.

Duplicate handling mirrors M2/M7 at-least-once semantics: statuses dedupe per
order (last-status tracking), executions by `execution_id`.

Bridging: client callbacks are synchronous; async port handlers receive
reports/events/bus events through pending queues drained on the event loop
(`drain()` is exposed for deterministic tests; `auto_drain=False` disables the
automatic task).
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
from brokers.saxo import contracts as saxo
from brokers.saxo import mapping
from brokers.saxo.client import SaxoAuthError, SaxoCallbacks, SaxoClient, SaxoClientError
from domain.account import Balance
from domain.errors import BrokerError, ErrorCode
from domain.fills import ExecutionReport, ExecutionReportType
from domain.instrument import Instrument
from domain.money import Price, Quantity
from domain.orders import Order
from events import BalanceUpdated, BrokerConnected, BrokerDisconnected, EventBus

logger = logging.getLogger("mtbe.brokers.saxo")

_CONFIRM_TIMEOUT = 10.0
_SUBMIT_STATUS_KEY = "Working"  # transport-level ack recorded for dedup


@dataclass(frozen=True, slots=True)
class _OrderMeta:
    """Adapter-side bookkeeping for one order placed at Saxo."""

    client_order_id: UUID
    account_id: str
    instrument: Instrument
    quantity: Decimal


class _FeedSub:
    """Opaque feed subscription handle (M3 `FeedSubscription` shape)."""

    def __init__(self, instrument: Instrument, adapter: SaxoAdapter) -> None:
        self.instrument = instrument
        self._adapter = adapter

    async def cancel(self) -> None:
        await self._adapter.unsubscribe(self)


class SaxoAdapter:
    """Saxo Bank adapter (sim/sim environment via `SaxoClient`)."""

    def __init__(
        self,
        client: SaxoClient,
        *,
        bus: EventBus | None = None,
        account_id: str,
        broker_name: str = "SAXO",
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
        # client_order_id -> Saxo order id, and Saxo order id -> metadata.
        self._order_ids: dict[str, int] = {}
        self._order_meta: dict[int, _OrderMeta] = {}
        self._last_status: dict[int, str] = {}
        self._order_execs: dict[int, list[saxo.SaxoExecution]] = {}
        self._seen_execution_ids: set[str] = set()
        self._pending_confirms: dict[int, asyncio.Future[saxo.SaxoOrderStatus]] = {}
        # Buffer statuses that fire synchronously inside submit/cancel/modify.
        self._buffering = False
        self._status_buffer: list[saxo.SaxoOrderStatus] = []

        # Streaming registry: (uic, asset_type) -> (SaxoInstrument, Instrument).
        # Doubles as the resolution table for quote/bar callbacks.
        self._desired: dict[tuple[int, str], tuple[saxo.SaxoInstrument, Instrument]] = {}

        # Saxo sends FULL balance snapshots: keep the latest per currency.
        self._balances: dict[str, saxo.SaxoBalance] = {}
        self._positions: dict[str, Any] = {}

        # Queued async deliveries (see module docstring).
        self._pending_reports: list[ExecutionReport] = []
        self._pending_feed_events: list[RawBar | RawQuote] = []
        self._pending_bus_events: list[Any] = []
        self._drain_task: asyncio.Task[None] | None = None

    # -- M3 MarketDataFeed -------------------------------------------------------
    async def start(self) -> None:
        if self._client.is_connected():
            return  # idempotent (duplicate start)
        try:
            self._client.authorize()
        except SaxoClientError as exc:
            raise BrokerError(
                f"Saxo authorization failed: {exc}",
                broker=self._broker_name,
                broker_error_code="AUTH_FAILED",
                code=ErrorCode.UNAUTHORIZED,
            ) from exc

    async def stop(self) -> None:
        if not self._client.is_connected():
            return
        self._shutting_down = True
        try:
            for _, (saxo_instrument, _i) in list(self._desired.items()):
                try:
                    self._client.unsubscribe_market_data(saxo_instrument)
                except SaxoClientError:
                    pass  # best-effort cleanup during shutdown
            self._desired.clear()
            self._client.logout()
        finally:
            self._shutting_down = False

    def attach_handler(self, handler: FeedHandler) -> None:
        self._feed_handler = handler

    async def subscribe(self, instrument: Instrument) -> FeedSubscription:
        self._require_connected()
        saxo_instrument = mapping.instrument_to_saxo(instrument)
        key = (saxo_instrument.uic, saxo_instrument.asset_type)
        if key not in self._desired:
            # Idempotent: duplicate subscribes never reach the client twice.
            self._call(lambda: self._client.subscribe_market_data(saxo_instrument))
            self._desired[key] = (saxo_instrument, instrument)
        return _FeedSub(instrument, self)

    async def unsubscribe(self, subscription: FeedSubscription) -> None:
        saxo_instrument = mapping.instrument_to_saxo(subscription.instrument)
        key = (saxo_instrument.uic, saxo_instrument.asset_type)
        if key in self._desired:
            del self._desired[key]
            try:
                self._client.unsubscribe_market_data(saxo_instrument)
            except SaxoClientError:
                pass  # already gone at the broker

    async def request_historical_bars(self, instrument: Instrument, interval: str) -> None:
        """Saxo-specific capability (not part of the M3 port)."""
        self._require_connected()
        mapping.saxo_interval_to_bar_interval(interval)  # validate before request
        saxo_instrument = mapping.instrument_to_saxo(instrument)
        self._call(lambda: self._client.request_historical_data(saxo_instrument, interval))

    # -- M5 ExecutionBroker ---------------------------------------------------------
    def attach_report_handler(self, handler: ExecutionReportHandler) -> None:
        self._report_handler = handler

    async def submit_order(self, order: Order) -> ExecutionReport:
        self._require_connected()
        saxo_instrument = mapping.instrument_to_saxo(order.instrument)
        saxo_order = mapping.order_to_saxo(
            order, account_key=self._account_id, saxo=saxo_instrument
        )
        self._buffering = True
        try:
            order_id = self._call(lambda: self._client.place_order(saxo_order))
        except SaxoClientError as exc:
            raise BrokerError(
                f"Saxo place_order failed: {exc}",
                broker=self._broker_name,
                code=ErrorCode.CONNECTION_LOST,
            ) from exc
        finally:
            self._buffering = False
            buffered, self._status_buffer = self._status_buffer, []

        self._order_ids[str(order.client_order_id)] = order_id
        self._order_meta[order_id] = _OrderMeta(
            client_order_id=order.client_order_id,
            account_id=order.account_id,
            instrument=order.instrument,
            quantity=order.quantity.value,
        )
        # Process statuses that fired during place_order: record them and
        # consume the decisive one as this call's return report.
        decisive: ExecutionReport | None = None
        for status in buffered:
            self._last_status[order_id] = status.status
            try:
                report_type = mapping.order_status_to_report_type(status.status)
            except ValueError:
                continue  # pre-ack / suspended / fill statuses carry no report
            decisive = self._report_for(order_id, report_type)
        if decisive is not None:
            return decisive
        # Transport-level ack: Saxo accepted the request (async Working
        # callbacks are deduped via the recorded status).
        self._last_status[order_id] = _SUBMIT_STATUS_KEY
        return self._report_for(order_id, ExecutionReportType.ACCEPTED)

    async def cancel_order(self, order: Order) -> ExecutionReport:
        self._require_connected()
        order_id = self._require_order(order)
        status = await self._await_confirm(
            order_id, lambda: self._call(lambda: self._client.cancel_order(order_id)), "cancel"
        )
        try:
            report_type = mapping.order_status_to_report_type(status.status)
        except ValueError:
            raise BrokerError(
                "cannot cancel: order already filling",
                broker=self._broker_name,
                code=ErrorCode.CONFLICT,
            ) from None
        return self._report_for(order_id, report_type)

    async def modify_order(self, order: Order) -> ExecutionReport:
        self._require_connected()
        order_id = self._require_order(order)
        saxo_instrument = mapping.instrument_to_saxo(order.instrument)
        saxo_order = mapping.order_to_saxo(
            order, account_key=self._account_id, saxo=saxo_instrument
        )
        await self._await_confirm(
            order_id,
            lambda: self._call(lambda: self._client.modify_order(order_id, saxo_order)),
            "modify",
        )
        return self._report_for(order_id, ExecutionReportType.REPLACED)

    async def fetch_order_status(self, order: Order) -> ExecutionReport | None:
        """Reconciliation query (M5 `reconcile`): report only NEW information."""
        order_id = self._order_ids.get(str(order.client_order_id))
        if order_id is None:
            return None
        current = self._call(lambda: self._client.get_order_status(order_id))
        if current is None:
            return None
        if current.status == self._last_status.get(order_id):
            return None  # nothing new since the last delivered status
        self._last_status[order_id] = current.status
        if current.status in (saxo.SAXO_FILLED, saxo.SAXO_PARTIALLY_FILLED):
            # Fills need execution data; use the newest cached execution.
            execs = self._order_execs.get(order_id, [])
            if not execs:
                logger.warning(
                    "saxo_reconcile_fill_without_execution",
                    extra={"saxo_order_id": order_id},
                )
                return None  # documented limitation (ADR-015)
            execution = execs[-1]
            meta = self._order_meta[order_id]
            fill = mapping.execution_to_fill(execution, meta.instrument, account_id=meta.account_id)
            report_type = (
                ExecutionReportType.FILL
                if Decimal(execution.cum_quantity) >= meta.quantity
                else ExecutionReportType.PARTIAL_FILL
            )
            return self._report_for(order_id, report_type, fill=fill)
        try:
            report_type = mapping.order_status_to_report_type(current.status)
        except ValueError:
            return None
        return self._report_for(order_id, report_type)

    # -- connection lifecycle / recovery ---------------------------------------------
    async def reconnect(self) -> None:
        """Re-establish the session after an unexpected disconnect (TS-006)."""
        if self._client.is_connected():
            return  # idempotent (duplicate reconnect)
        try:
            self._client.authorize()
        except SaxoClientError as exc:
            raise BrokerError(
                f"Saxo reconnect failed: {exc}",
                broker=self._broker_name,
                broker_error_code="AUTH_FAILED",
                code=ErrorCode.CONNECTION_LOST,
            ) from exc
        # Re-subscribe desired streaming from the dedup registry.
        for _, (saxo_instrument, _i) in self._desired.items():
            self._client.subscribe_market_data(saxo_instrument)
        # Replay broker state for reconciliation (no duplicate effects:
        # statuses dedupe via last-status; executions via execution ids).
        self._client.request_open_orders()
        self._client.request_executions()
        self._client.request_account_summary()
        self._client.request_positions()

    @property
    def is_connected(self) -> bool:
        return self._connected

    # -- Saxo callbacks (synchronous; see module docstring) -----------------------------
    def _as_callbacks(self) -> SaxoCallbacks:
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
        error = mapping.map_saxo_error(code, message)
        # Structured diagnostics only — never tokens/secrets; state changes
        # arrive via on_disconnected / order statuses.
        logger.warning(
            "saxo_error",
            extra={
                "code": error.code.value,
                "broker_error_code": error.broker_error_code,
                "operation": "saxo.error",
            },
        )

    def on_token_expired(self) -> None:
        """Proactive token expiry notification: refresh or drop the session."""
        try:
            self._client.refresh_session()
            logger.info("saxo_session_refreshed", extra={"operation": "saxo.refresh"})
        except SaxoClientError:
            self._connected = False
            self._publish_bus_event(
                BrokerDisconnected(
                    broker=self._broker_name, account_id=self._account_id, reason="session expired"
                )
            )

    def on_order_status(self, status: saxo.SaxoOrderStatus) -> None:
        if self._buffering:
            self._status_buffer.append(status)
            return
        self._process_order_status(status)

    def _process_order_status(self, status: saxo.SaxoOrderStatus) -> None:
        order_id = status.order_id
        last = self._last_status.get(order_id)
        self._last_status[order_id] = status.status
        future = self._pending_confirms.get(order_id)
        if future is not None and not future.done():
            future.set_result(status)  # consumed by cancel/modify; recorded above
            return
        if status.status == last:
            return  # duplicate status callback
        try:
            report_type = mapping.order_status_to_report_type(status.status)
        except ValueError:
            return  # pre-ack / suspended / fill statuses: executions carry fills
        if self._report_handler is not None:
            self._pending_reports.append(self._report_for(order_id, report_type))
            self._schedule_drain()

    def on_execution(self, execution: saxo.SaxoExecution) -> None:
        if execution.execution_id in self._seen_execution_ids:
            return  # duplicate execution (redelivery)
        meta = self._order_meta.get(execution.order_id)
        if meta is None:
            logger.warning(
                "saxo_execution_unknown_order",
                extra={"saxo_order_id": execution.order_id},
            )
            return
        self._seen_execution_ids.add(execution.execution_id)
        self._order_execs.setdefault(execution.order_id, []).append(execution)
        fill = mapping.execution_to_fill(execution, meta.instrument, account_id=meta.account_id)
        report_type = (
            ExecutionReportType.FILL
            if Decimal(execution.cum_quantity) >= meta.quantity
            else ExecutionReportType.PARTIAL_FILL
        )
        self._pending_reports.append(self._report_for(execution.order_id, report_type, fill=fill))
        self._schedule_drain()

    def on_quote(self, quote: saxo.SaxoQuote) -> None:
        entry = self._desired.get((quote.uic, quote.asset_type))
        if entry is None:
            logger.warning(
                "saxo_quote_unsubscribed_instrument",
                extra={"uic": quote.uic, "operation": "saxo.quote"},
            )
            return  # quote for an instrument we do not track
        instrument = entry[1]
        try:
            event = self._to_raw_quote(quote, instrument)
        except (BrokerError, ValueError, ArithmeticError):
            # BrokerError: unmappable data. ValueError: malformed prices
            # (pydantic ValidationError subclasses ValueError).
            # ArithmeticError: Decimal conversion failures (e.g. non-numeric).
            logger.warning("saxo_quote_dropped", extra={"uic": quote.uic})
            return
        self._pending_feed_events.append(event)
        self._schedule_drain()

    def on_bar(self, bar: saxo.SaxoBar) -> None:
        entry = self._desired.get((bar.uic, bar.asset_type))
        if entry is None:
            logger.warning("saxo_bar_unsubscribed_instrument", extra={"uic": bar.uic})
            return
        instrument = entry[1]
        try:
            event = self._to_raw_bar(bar, instrument)
        except (BrokerError, ValueError, ArithmeticError):
            logger.warning("saxo_bar_dropped", extra={"uic": bar.uic})
            return
        self._pending_feed_events.append(event)
        self._schedule_drain()

    def on_balance(self, balance: saxo.SaxoBalance) -> None:
        try:
            mapped = mapping.balance_to_domain(self._account_id, balance)
        except (BrokerError, ValueError, ArithmeticError):
            logger.warning("saxo_balance_dropped", extra={"currency": balance.currency})
            return
        self._balances[balance.currency] = balance
        self._publish_bus_event(BalanceUpdated(balance=mapped))

    def on_position(self, position: saxo.SaxoPosition) -> None:
        try:
            mapped = mapping.position_to_domain(position)
        except (BrokerError, ValueError, ArithmeticError):
            logger.warning("saxo_position_dropped", extra={"uic": position.uic})
            return
        # Relabel broker-side account keys to the internal account this
        # adapter serves (broker-account mapping is adapter responsibility).
        mapped = mapped.model_copy(update={"account_id": self._account_id})
        self._positions[mapped.instrument.primary_identifier] = mapped

    # -- snapshots (M7 reconciliation boundary) ---------------------------------------
    def position_snapshot(self) -> list[Any]:
        """Broker-reported positions (domain models), for M7 reconciliation."""
        return list(self._positions.values())

    def account_balance(self) -> Balance | None:
        """Latest full balance snapshot aggregated across currencies."""
        if not self._balances:
            return None
        cash: dict[str, Any] = {}
        for saxo_balance in self._balances.values():
            mapped = mapping.balance_to_domain(self._account_id, saxo_balance)
            cash.update(mapped.cash)
        return Balance(account_id=self._account_id, cash=cash)

    # -- drains (deterministic delivery for tests) ------------------------------------
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

    # -- internals -------------------------------------------------------------------
    def _require_connected(self) -> None:
        if not self._client.is_connected():
            raise BrokerError(
                "Saxo client not connected",
                broker=self._broker_name,
                code=ErrorCode.CONNECTION_LOST,
            )

    def _require_order(self, order: Order) -> int:
        order_id = self._order_ids.get(str(order.client_order_id))
        if order_id is None:
            raise BrokerError(
                f"order {order.client_order_id} is not at the broker",
                broker=self._broker_name,
                code=ErrorCode.ORDER_NOT_FOUND,
            )
        return order_id

    def _call(self, request: Any) -> Any:
        """Run a Saxo request, refreshing the session once on token expiry.

        Safe to retry: an auth-rejected request was not processed by Saxo.
        Refresh failure maps to UNAUTHORIZED (never leaks raw Saxo errors).
        """
        try:
            return request()
        except SaxoAuthError:
            try:
                self._client.refresh_session()
            except SaxoClientError as exc:
                raise BrokerError(
                    f"Saxo session refresh failed: {exc}",
                    broker=self._broker_name,
                    broker_error_code="REFRESH_FAILED",
                    code=ErrorCode.UNAUTHORIZED,
                ) from exc
            return request()

    async def _await_confirm(
        self, order_id: int, request: Any, operation: str
    ) -> saxo.SaxoOrderStatus:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[saxo.SaxoOrderStatus] = loop.create_future()
        self._pending_confirms[order_id] = future
        try:
            request()
            return await asyncio.wait_for(future, timeout=self._confirm_timeout)
        except TimeoutError as exc:
            raise BrokerError(
                f"Saxo {operation} confirmation timed out",
                broker=self._broker_name,
                broker_error_code="CONFIRM_TIMEOUT",
                code=ErrorCode.TIMEOUT,
            ) from exc
        except SaxoClientError as exc:
            raise BrokerError(
                f"Saxo {operation} failed: {exc}",
                broker=self._broker_name,
                code=ErrorCode.CONNECTION_LOST,
            ) from exc
        finally:
            self._pending_confirms.pop(order_id, None)

    def _report_for(
        self,
        order_id: int,
        report_type: ExecutionReportType,
        *,
        fill: Any = None,
    ) -> ExecutionReport:
        meta = self._order_meta[order_id]
        return ExecutionReport(
            report_id=f"SAXO-{uuid4()}",
            order_client_id=meta.client_order_id,
            broker_order_id=str(order_id),
            account_id=meta.account_id,
            report_type=report_type,
            fill=fill,
        )

    def _to_raw_quote(self, quote: saxo.SaxoQuote, instrument: Instrument) -> RawQuote:
        currency = instrument.currency
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

    def _to_raw_bar(self, bar: saxo.SaxoBar, instrument: Instrument) -> RawBar:
        from domain.market import BarInterval

        interval: BarInterval = mapping.saxo_interval_to_bar_interval(bar.interval)
        currency = instrument.currency
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
    """Forwards `SaxoCallbacks` to the adapter (keeps protocol typing clean)."""

    def __init__(self, adapter: SaxoAdapter) -> None:
        self._adapter = adapter

    def on_connected(self) -> None:
        self._adapter.on_connected()

    def on_disconnected(self) -> None:
        self._adapter.on_disconnected()

    def on_error(self, code: int, message: str) -> None:
        self._adapter.on_error(code, message)

    def on_token_expired(self) -> None:
        self._adapter.on_token_expired()

    def on_order_status(self, status: saxo.SaxoOrderStatus) -> None:
        self._adapter.on_order_status(status)

    def on_execution(self, execution: saxo.SaxoExecution) -> None:
        self._adapter.on_execution(execution)

    def on_quote(self, quote: saxo.SaxoQuote) -> None:
        self._adapter.on_quote(quote)

    def on_bar(self, bar: saxo.SaxoBar) -> None:
        self._adapter.on_bar(bar)

    def on_balance(self, balance: saxo.SaxoBalance) -> None:
        self._adapter.on_balance(balance)

    def on_position(self, position: saxo.SaxoPosition) -> None:
        self._adapter.on_position(position)
