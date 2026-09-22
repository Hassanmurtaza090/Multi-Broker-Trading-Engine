"""IBKR client port, callbacks, and the simulated (paper/test) client.

`IbkrClient` is the transport port mirroring the IBKR API request surface
(ibapi's EClient); `IbkrCallbacks` mirrors the response surface (EWrapper).
The adapter depends only on these two protocols.

`SimulatedIbkrClient` implements the port entirely in memory — this is the
"simulated/paper mode" required by the M8 roadmap (no live trading). A real
implementation would wrap `ibapi`/`ib_insync` and translate to the same
callback shapes; that wiring (credentials, TWS/Gateway session handling) is
deferred to a controlled environment and documented in ADR-014.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from brokers.ibkr.contracts import (
    IbkrAccountValue,
    IbkrBar,
    IbkrContract,
    IbkrExecution,
    IbkrOrder,
    IbkrOrderStatus,
    IbkrPosition,
    IbkrQuote,
)


class IbkrCallbacks(Protocol):
    """Response surface the client invokes on the adapter (EWrapper shape)."""

    def on_connected(self) -> None: ...

    def on_disconnected(self) -> None: ...

    def on_error(self, code: int, message: str) -> None: ...

    def on_order_status(self, status: IbkrOrderStatus) -> None: ...

    def on_execution(self, execution: IbkrExecution) -> None: ...

    def on_quote(self, quote: IbkrQuote) -> None: ...

    def on_bar(self, bar: IbkrBar) -> None: ...

    def on_account_value(self, value: IbkrAccountValue) -> None: ...

    def on_position(self, position: IbkrPosition) -> None: ...


class IbkrClient(Protocol):
    """Request surface the adapter uses (EClient shape)."""

    def connect(self) -> None: ...

    def disconnect(self) -> None: ...

    def is_connected(self) -> bool: ...

    def place_order(self, order: IbkrOrder) -> int: ...

    def cancel_order(self, ibkr_order_id: int) -> None: ...

    def modify_order(self, ibkr_order_id: int, order: IbkrOrder) -> None: ...

    def request_order_status(self, ibkr_order_id: int) -> IbkrOrderStatus | None: ...

    def request_open_orders(self) -> None: ...

    def request_executions(self) -> None: ...

    def subscribe_market_data(self, contract: IbkrContract) -> None: ...

    def unsubscribe_market_data(self, contract: IbkrContract) -> None: ...

    def request_historical_bars(self, contract: IbkrContract, bar_size: str) -> None: ...

    def request_account_summary(self) -> None: ...

    def request_positions(self) -> None: ...


class IbkrClientError(Exception):
    """Transport-level failure inside the (simulated) IBKR client."""


class SimulatedIbkrClient:
    """In-memory `IbkrClient` for tests and paper mode (no live trading).

    Behavior is configurable via flags and helper methods so tests can drive
    connection failures, errors, fills, and market data deterministically.
    """

    def __init__(self) -> None:
        self.callbacks: IbkrCallbacks | None = None
        self.connected = False
        self.fail_connect = False
        self.auto_ack_orders = True
        self.reject_orders = False
        # market data subscriptions: contract key -> contract
        self.subscriptions: dict[tuple[str, str, str, str], IbkrContract] = {}
        # IBKR order id -> (IbkrOrder, status)
        self.orders: dict[int, tuple[IbkrOrder, IbkrOrderStatus]] = {}
        self._next_order_id = 100
        # order_id -> [executions]
        self.executions: dict[int, list[IbkrExecution]] = {}
        self.account_values: list[IbkrAccountValue] = []
        self.positions: list[IbkrPosition] = []
        self.requested_bars: list[tuple[IbkrContract, str]] = []

    # -- wiring ------------------------------------------------------------------
    def attach_callbacks(self, callbacks: IbkrCallbacks) -> None:
        self.callbacks = callbacks

    def _cb(self) -> IbkrCallbacks:
        if self.callbacks is None:
            raise IbkrClientError("no callbacks attached")
        return self.callbacks

    # -- connection ----------------------------------------------------------------
    def connect(self) -> None:
        if self.connected:
            raise IbkrClientError("already connected")
        if self.fail_connect:
            raise IbkrClientError("connection refused")
        self.connected = True
        self._cb().on_connected()

    def disconnect(self) -> None:
        was_connected = self.connected
        self.connected = False
        if was_connected:
            self._cb().on_disconnected()

    def is_connected(self) -> bool:
        return self.connected

    def simulate_unexpected_disconnect(self) -> None:
        """Drop the connection without a clean disconnect (recovery path).

        Faithful to IBKR: live market-data subscriptions are lost and must be
        re-established by the client after reconnecting.
        """
        self.connected = False
        self.subscriptions.clear()
        self._cb().on_disconnected()

    # -- orders ----------------------------------------------------------------------
    def place_order(self, order: IbkrOrder) -> int:
        if not self.connected:
            raise IbkrClientError("not connected")
        self._next_order_id += 1
        ibkr_order_id = self._next_order_id
        status = IbkrOrderStatus(
            ibkr_order_id=ibkr_order_id,
            status="Submitted" if (self.auto_ack_orders and not self.reject_orders) else "Inactive",
        )
        self.orders[ibkr_order_id] = (order, status)
        self._cb().on_order_status(status)
        return ibkr_order_id

    def cancel_order(self, ibkr_order_id: int) -> None:
        if not self.connected:
            raise IbkrClientError("not connected")
        order = self.orders.get(ibkr_order_id)
        if order is None:
            raise IbkrClientError(f"unknown order id {ibkr_order_id}")
        status = IbkrOrderStatus(ibkr_order_id=ibkr_order_id, status="Cancelled")
        self.orders[ibkr_order_id] = (order[0], status)
        self._cb().on_order_status(status)

    def modify_order(self, ibkr_order_id: int, order: IbkrOrder) -> None:
        if not self.connected:
            raise IbkrClientError("not connected")
        existing = self.orders.get(ibkr_order_id)
        if existing is None:
            raise IbkrClientError(f"unknown order id {ibkr_order_id}")
        status = IbkrOrderStatus(ibkr_order_id=ibkr_order_id, status="Submitted")
        self.orders[ibkr_order_id] = (order, status)
        self._cb().on_order_status(status)

    def request_order_status(self, ibkr_order_id: int) -> IbkrOrderStatus | None:
        entry = self.orders.get(ibkr_order_id)
        if entry is None:
            return None
        return entry[1]

    def request_open_orders(self) -> None:
        """Replay the current status of every known order (reqAllOpenOrders)."""
        if not self.connected:
            raise IbkrClientError("not connected")
        for _, status in self.orders.values():
            self._cb().on_order_status(status)

    def request_executions(self) -> None:
        """Replay every execution seen so far (reqExecutions)."""
        if not self.connected:
            raise IbkrClientError("not connected")
        for executions in self.executions.values():
            for execution in executions:
                self._cb().on_execution(execution)

    def force_status(self, ibkr_order_id: int, status: str) -> None:
        """Test helper: change a stored order status WITHOUT firing callbacks
        (simulates state changing at the broker while we were disconnected)."""
        entry = self.orders.get(ibkr_order_id)
        if entry is None:
            raise IbkrClientError(f"unknown order id {ibkr_order_id}")
        self.orders[ibkr_order_id] = (
            entry[0],
            IbkrOrderStatus(ibkr_order_id=ibkr_order_id, status=status),
        )

    def emit_error(self, code: int, message: str) -> None:
        self._cb().on_error(code, message)

    def emit_execution(self, execution: IbkrExecution) -> None:
        """Simulate an IBKR execution callback (fills an order)."""
        entry = self.orders.get(execution.ibkr_order_id)
        if entry is None:
            raise IbkrClientError(f"execution for unknown order {execution.ibkr_order_id}")
        self.executions.setdefault(execution.ibkr_order_id, []).append(execution)
        # Order status moves to Filled/PartiallyFilled based on cum quantity.
        order = entry[0]
        if execution.cum_quantity == order.quantity:
            new_status = "Filled"
        else:
            new_status = "PartiallyFilled"
        status = IbkrOrderStatus(
            ibkr_order_id=execution.ibkr_order_id,
            status=new_status,
            filled=execution.cum_quantity,
            remaining=str(Decimal(order.quantity) - Decimal(execution.cum_quantity)),
        )
        self.orders[execution.ibkr_order_id] = (order, status)
        self._cb().on_order_status(status)
        self._cb().on_execution(execution)

    # -- market data -------------------------------------------------------------------
    def subscribe_market_data(self, contract: IbkrContract) -> None:
        if not self.connected:
            raise IbkrClientError("not connected")
        self.subscriptions[self._key(contract)] = contract

    def unsubscribe_market_data(self, contract: IbkrContract) -> None:
        self.subscriptions.pop(self._key(contract), None)

    def emit_quote(self, quote: IbkrQuote) -> None:
        self._cb().on_quote(quote)

    def emit_bar(self, bar: IbkrBar) -> None:
        self._cb().on_bar(bar)

    def request_historical_bars(self, contract: IbkrContract, bar_size: str) -> None:
        if not self.connected:
            raise IbkrClientError("not connected")
        self.requested_bars.append((contract, bar_size))

    # -- account / positions --------------------------------------------------------------
    def request_account_summary(self) -> None:
        if not self.connected:
            raise IbkrClientError("not connected")
        for value in self.account_values:
            self._cb().on_account_value(value)

    def request_positions(self) -> None:
        if not self.connected:
            raise IbkrClientError("not connected")
        for position in self.positions:
            self._cb().on_position(position)

    @staticmethod
    def _key(contract: IbkrContract) -> tuple[str, str, str, str]:
        return (contract.symbol, contract.sec_type, contract.exchange, contract.currency)
