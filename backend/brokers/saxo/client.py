"""Saxo client port, callbacks, and the simulated (sim/paper) client.

`SaxoClient` is the transport port mirroring the Saxo OpenAPI request surface
(REST + streaming); `SaxoCallbacks` mirrors the response/callback surface. The
adapter depends only on these two protocols.

Session model: Saxo authenticates via OAuth2. `authorize()` establishes a
session (`SaxoSession` holds opaque tokens + expiry — never logged, never
committed); `refresh_session()` renews it after expiry; `logout()` cleans up.
Token/credential acquisition (client secret, redirect flows) belongs to a real
transport implementation reading the project's configuration mechanism
(`.env`, never committed) — deferred and documented in ADR-015.

`SimulatedSaxoClient` implements the port entirely in memory — the sim/paper
mode required by the M9 roadmap (no live trading).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from brokers.saxo.contracts import (
    SaxoBalance,
    SaxoBar,
    SaxoExecution,
    SaxoInstrument,
    SaxoOrder,
    SaxoOrderStatus,
    SaxoPosition,
    SaxoQuote,
    SaxoSession,
)


class SaxoCallbacks(Protocol):
    """Response surface the client invokes on the adapter."""

    def on_connected(self) -> None: ...

    def on_disconnected(self) -> None: ...

    def on_error(self, code: int, message: str) -> None: ...

    def on_token_expired(self) -> None: ...

    def on_order_status(self, status: SaxoOrderStatus) -> None: ...

    def on_execution(self, execution: SaxoExecution) -> None: ...

    def on_quote(self, quote: SaxoQuote) -> None: ...

    def on_bar(self, bar: SaxoBar) -> None: ...

    def on_balance(self, balance: SaxoBalance) -> None: ...

    def on_position(self, position: SaxoPosition) -> None: ...


class SaxoClient(Protocol):
    """Request surface the adapter uses."""

    def attach_callbacks(self, callbacks: SaxoCallbacks) -> None: ...

    def authorize(self) -> SaxoSession: ...

    def refresh_session(self) -> SaxoSession: ...

    def logout(self) -> None: ...

    def is_connected(self) -> bool: ...

    def place_order(self, order: SaxoOrder) -> int: ...

    def cancel_order(self, order_id: int) -> None: ...

    def modify_order(self, order_id: int, order: SaxoOrder) -> None: ...

    def get_order_status(self, order_id: int) -> SaxoOrderStatus | None: ...

    def request_open_orders(self) -> None: ...

    def request_executions(self) -> None: ...

    def subscribe_market_data(self, instrument: SaxoInstrument) -> None: ...

    def unsubscribe_market_data(self, instrument: SaxoInstrument) -> None: ...

    def request_historical_data(self, instrument: SaxoInstrument, interval: str) -> None: ...

    def request_account_summary(self) -> None: ...

    def request_positions(self) -> None: ...


class SaxoClientError(Exception):
    """Transport-level failure inside the (simulated) Saxo client."""


class SaxoAuthError(SaxoClientError):
    """The session token is expired or invalid (retryable after refresh)."""


class SimulatedSaxoClient:
    """In-memory `SaxoClient` for tests and sim/paper mode (no live trading).

    Behavior is configurable via flags and helper methods so tests can drive
    authentication failures, token expiry, refresh failures, errors, fills, and
    market data deterministically.
    """

    def __init__(self) -> None:
        self.callbacks: SaxoCallbacks | None = None
        self.connected = False
        self.authorized = False
        self.session: SaxoSession | None = None
        self.fail_authorize = False
        self.fail_refresh = False
        self.session_expired = False
        self.auto_ack_orders = True
        self.reject_orders = False
        # Streaming subscriptions: (uic, asset_type) -> SaxoInstrument.
        self.subscriptions: dict[tuple[int, str], SaxoInstrument] = {}
        # order_id -> (SaxoOrder, status).
        self.orders: dict[int, tuple[SaxoOrder, SaxoOrderStatus]] = {}
        self._next_order_id = 200
        self.executions: dict[int, list[SaxoExecution]] = {}
        self.balances: list[SaxoBalance] = []
        self.positions: list[SaxoPosition] = []
        self.requested_bars: list[tuple[SaxoInstrument, str]] = []

    # -- wiring ------------------------------------------------------------------
    def attach_callbacks(self, callbacks: SaxoCallbacks) -> None:
        self.callbacks = callbacks

    def _cb(self) -> SaxoCallbacks:
        if self.callbacks is None:
            raise SaxoClientError("no callbacks attached")
        return self.callbacks

    def _require_session(self) -> None:
        if not self.connected or not self.authorized or self.session is None:
            raise SaxoClientError("not connected")
        if self.session_expired:
            raise SaxoAuthError("session token expired")

    # -- session lifecycle ---------------------------------------------------------
    def authorize(self) -> SaxoSession:
        if self.fail_authorize:
            raise SaxoClientError("authorization failed")
        self.authorized = True
        self.connected = True
        self.session_expired = False
        self.session = SaxoSession(
            access_token="opaque-sim-access-token",
            refresh_token="opaque-sim-refresh-token",
            expires_at_unix=9_999_999_999,
        )
        self._cb().on_connected()
        return self.session

    def refresh_session(self) -> SaxoSession:
        if self.fail_refresh:
            raise SaxoClientError("refresh token rejected")
        self.session_expired = False
        self.session = SaxoSession(
            access_token="opaque-sim-access-token-2",
            refresh_token="opaque-sim-refresh-token-2",
            expires_at_unix=9_999_999_999,
        )
        return self.session

    def logout(self) -> None:
        was_connected = self.connected
        self.connected = False
        self.authorized = False
        self.session = None
        self.session_expired = False
        if was_connected:
            self._cb().on_disconnected()

    def is_connected(self) -> bool:
        return self.connected

    def expire_session(self) -> None:
        """Test helper: mark the session token expired and notify the adapter
        (models Saxo's proactive 'AccessTokenExpired' stream message)."""
        self.session_expired = True
        self._cb().on_token_expired()

    def simulate_unexpected_disconnect(self) -> None:
        """Drop the connection without a clean logout (recovery path).

        Faithful to Saxo: streaming subscriptions are lost and must be
        re-established after reconnecting.
        """
        self.connected = False
        self.subscriptions.clear()
        self._cb().on_disconnected()

    # -- orders ----------------------------------------------------------------------
    def place_order(self, order: SaxoOrder) -> int:
        self._require_session()
        self._next_order_id += 1
        order_id = self._next_order_id
        status = SaxoOrderStatus(
            order_id=order_id,
            status="Working" if (self.auto_ack_orders and not self.reject_orders) else "Rejected",
        )
        self.orders[order_id] = (order, status)
        self._cb().on_order_status(status)
        return order_id

    def cancel_order(self, order_id: int) -> None:
        self._require_session()
        entry = self.orders.get(order_id)
        if entry is None:
            raise SaxoClientError(f"unknown order id {order_id}")
        status = SaxoOrderStatus(order_id=order_id, status="Cancelled")
        self.orders[order_id] = (entry[0], status)
        self._cb().on_order_status(status)

    def modify_order(self, order_id: int, order: SaxoOrder) -> None:
        self._require_session()
        if order_id not in self.orders:
            raise SaxoClientError(f"unknown order id {order_id}")
        status = SaxoOrderStatus(order_id=order_id, status="Working")
        self.orders[order_id] = (order, status)
        self._cb().on_order_status(status)

    def get_order_status(self, order_id: int) -> SaxoOrderStatus | None:
        entry = self.orders.get(order_id)
        return entry[1] if entry is not None else None

    def request_open_orders(self) -> None:
        self._require_session()
        for _, status in self.orders.values():
            self._cb().on_order_status(status)

    def request_executions(self) -> None:
        self._require_session()
        for executions in self.executions.values():
            for execution in executions:
                self._cb().on_execution(execution)

    def emit_error(self, code: int, message: str) -> None:
        self._cb().on_error(code, message)

    def emit_execution(self, execution: SaxoExecution) -> None:
        """Simulate a Saxo execution callback (fills an order)."""
        entry = self.orders.get(execution.order_id)
        if entry is None:
            raise SaxoClientError(f"execution for unknown order {execution.order_id}")
        order = entry[0]
        self.executions.setdefault(execution.order_id, []).append(execution)
        new_status = (
            "Filled"
            if Decimal(execution.cum_quantity) == Decimal(order.quantity)
            else "PartiallyFilled"
        )
        status = SaxoOrderStatus(
            order_id=execution.order_id,
            status=new_status,
            filled=execution.cum_quantity,
            remaining=str(Decimal(order.quantity) - Decimal(execution.cum_quantity)),
        )
        self.orders[execution.order_id] = (order, status)
        self._cb().on_order_status(status)
        self._cb().on_execution(execution)

    def force_status(self, order_id: int, status: str) -> None:
        """Test helper: change a stored status WITHOUT firing callbacks."""
        entry = self.orders.get(order_id)
        if entry is None:
            raise SaxoClientError(f"unknown order id {order_id}")
        self.orders[order_id] = (entry[0], SaxoOrderStatus(order_id=order_id, status=status))

    # -- market data ---------------------------------------------------------------------
    def subscribe_market_data(self, instrument: SaxoInstrument) -> None:
        self._require_session()
        self.subscriptions[(instrument.uic, instrument.asset_type)] = instrument

    def unsubscribe_market_data(self, instrument: SaxoInstrument) -> None:
        self.subscriptions.pop((instrument.uic, instrument.asset_type), None)

    def emit_quote(self, quote: SaxoQuote) -> None:
        self._cb().on_quote(quote)

    def emit_bar(self, bar: SaxoBar) -> None:
        self._cb().on_bar(bar)

    def request_historical_data(self, instrument: SaxoInstrument, interval: str) -> None:
        self._require_session()
        self.requested_bars.append((instrument, interval))

    # -- account / positions -----------------------------------------------------------------
    def request_account_summary(self) -> None:
        self._require_session()
        for balance in self.balances:
            self._cb().on_balance(balance)

    def request_positions(self) -> None:
        self._require_session()
        for position in self.positions:
            self._cb().on_position(position)
