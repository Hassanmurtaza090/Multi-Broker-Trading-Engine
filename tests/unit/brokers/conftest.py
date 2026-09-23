"""Shared fixtures for IBKR adapter tests."""

from __future__ import annotations

from uuid import uuid4

import pytest

from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency, Price, Quantity
from domain.orders import Order, OrderSide, OrderType, TimeInForce
from events import InProcessEventBus
from brokers.ibkr import IbkrAdapter, SimulatedIbkrClient
from brokers.saxo import SaxoAdapter, SimulatedSaxoClient
from brokers.ibkr.contracts import (
    IbkrAccountValue,
    IbkrBar,
    IbkrContract,
    IbkrExecution,
    IbkrOrder,
    IbkrPosition,
    IbkrQuote,
)
from brokers.saxo.contracts import (
    SaxoBalance,
    SaxoBar,
    SaxoExecution,
    SaxoInstrument,
    SaxoOrder,
    SaxoPosition,
    SaxoQuote,
)


@pytest.fixture()
def usd() -> Currency:
    return Currency(code="USD")


@pytest.fixture()
def eur() -> Currency:
    return Currency(code="EUR")


@pytest.fixture()
def aapl(usd: Currency) -> Instrument:
    return Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
    )


@pytest.fixture()
def eurusd(eur: Currency) -> Instrument:
    return Instrument(
        symbol="EUR/USD",
        asset_class=AssetClass.FOREX,
        currency=eur,
        exchange=Exchange.OTC,
    )


@pytest.fixture()
def bus() -> InProcessEventBus:
    return InProcessEventBus()


@pytest.fixture()
def client() -> SimulatedIbkrClient:
    return SimulatedIbkrClient()


@pytest.fixture()
def adapter(client: SimulatedIbkrClient, bus: InProcessEventBus) -> IbkrAdapter:
    # auto_drain=False -> tests drain queued deliveries explicitly.
    return IbkrAdapter(client, bus=bus, account_id="DU123456", auto_drain=False)


def make_order(aapl: Instrument, usd: Currency, *, side: OrderSide = OrderSide.BUY, quantity: str = "10", limit_price: str = "100") -> Order:
    return Order(
        account_id="ACC-001",
        instrument=aapl,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Quantity(value=quantity),
        limit_price=Price(value=limit_price, currency=usd),
        time_in_force=TimeInForce.DAY,
    )


def make_execution(ibkr_order_id: int, order: Order, *, execution_id: str, quantity: str, cum: str, price: str = "100", at: int = 1_700_000_000) -> IbkrExecution:
    contract_symbol = order.instrument.symbol
    return IbkrExecution(
        execution_id=execution_id,
        ibkr_order_id=ibkr_order_id,
        order_ref=str(order.client_order_id),
        symbol=contract_symbol,
        sec_type="STK",
        exchange="NASDAQ",
        currency=order.instrument.currency.code,
        side="BOT" if order.side is OrderSide.BUY else "SLD",
        quantity=quantity,
        price=price,
        cum_quantity=cum,
        executed_at_unix=at,
    )


def make_quote(contract: IbkrContract, *, bid: str = "99", ask: str = "101", last: str = "100", at: int = 1_700_000_000) -> IbkrQuote:
    return IbkrQuote(
        contract=contract,
        bid=bid,
        ask=ask,
        bid_size="100",
        ask_size="100",
        last=last,
        timestamp_unix=at,
    )


def aapl_contract() -> IbkrContract:
    return IbkrContract(symbol="AAPL", sec_type="STK", exchange="NASDAQ", currency="USD", con_id=12345)


def account_values_usd() -> list[IbkrAccountValue]:
    return [
        IbkrAccountValue(key="TotalCashValue", value="10000", currency="USD"),
        IbkrAccountValue(key="AvailableFunds", value="8000", currency="USD"),
        IbkrAccountValue(key="BuyingPower", value="40000", currency="USD"),
        IbkrAccountValue(key="SomeOtherKey", value="irrelevant", currency="USD"),
    ]


# --- Saxo fixtures ---------------------------------------------------------------

SAXO_AAPL_UIC = 211


@pytest.fixture()
def saxo_client() -> SimulatedSaxoClient:
    return SimulatedSaxoClient()


@pytest.fixture()
def saxo_adapter(saxo_client: SimulatedSaxoClient, bus: InProcessEventBus) -> SaxoAdapter:
    # auto_drain=False -> tests drain queued deliveries explicitly.
    return SaxoAdapter(saxo_client, bus=bus, account_id="ACC-001", auto_drain=False)


def saxo_aapl(usd) -> Instrument:
    """AAPL carrying the broker-neutral Saxo UIC identifier."""
    return Instrument(
        symbol="AAPL",
        asset_class=AssetClass.EQUITY,
        currency=usd,
        exchange=Exchange.NASDAQ,
        identifiers={"SAXO_UIC": str(SAXO_AAPL_UIC)},
    )


def saxo_eurusd(eur) -> Instrument:
    return Instrument(
        symbol="EUR/USD",
        asset_class=AssetClass.FOREX,
        currency=eur,
        exchange=Exchange.OTC,
        identifiers={"SAXO_UIC": "1"},
    )


def saxo_aapl_instrument() -> SaxoInstrument:
    return SaxoInstrument(
        uic=SAXO_AAPL_UIC,
        asset_type="Stock",
        symbol="AAPL",
        currency="USD",
        exchange="NASDAQ",
    )


def make_saxo_quote(*, uic: int = SAXO_AAPL_UIC, asset_type: str = "Stock", bid="99", ask="101", last="100", at: int = 1_700_000_000) -> SaxoQuote:
    return SaxoQuote(
        uic=uic,
        asset_type=asset_type,
        bid=bid,
        ask=ask,
        bid_size="100",
        ask_size="100",
        last=last,
        timestamp_unix=at,
    )


def make_saxo_execution(order_id: int, order: Order, *, execution_id: str, quantity: str, cum: str, price: str = "100", at: int = 1_700_000_000) -> SaxoExecution:
    return SaxoExecution(
        execution_id=execution_id,
        order_id=order_id,
        external_reference=str(order.client_order_id),
        uic=int(order.instrument.identifiers["SAXO_UIC"]),
        asset_type="Stock",
        buy_sell="buy" if order.side.value == "BUY" else "sell",
        quantity=quantity,
        price=price,
        cum_quantity=cum,
        executed_at_unix=at,
    )


def saxo_balance_usd() -> SaxoBalance:
    return SaxoBalance(
        account_key="SAXO-ACC",
        currency="USD",
        cash_amount="10000",
        available="8000",
        margin_available="40000",
        equity="12000",
    )


def saxo_position_aapl() -> SaxoPosition:
    return SaxoPosition(
        account_key="SAXO-ACC",
        uic=SAXO_AAPL_UIC,
        asset_type="Stock",
        symbol="AAPL",
        currency="USD",
        position_size="100",
        average_open_price="100",
        exchange="NASDAQ",
    )


__all__ = [
    "usd", "eur", "aapl", "eurusd", "bus", "client", "adapter",
    "make_order", "make_execution", "make_quote", "aapl_contract", "account_values_usd",
    "IbkrContract", "IbkrOrder", "IbkrExecution", "IbkrAccountValue", "IbkrPosition",
    "IbkrQuote", "IbkrBar", "OrderSide", "uuid4",
    # Saxo
    "saxo_client", "saxo_adapter", "saxo_aapl", "saxo_eurusd",
    "saxo_aapl_instrument", "make_saxo_quote", "make_saxo_execution",
    "saxo_balance_usd", "saxo_position_aapl", "SAXO_AAPL_UIC",
    "SaxoInstrument", "SaxoOrder", "SaxoExecution", "SaxoBalance",
    "SaxoPosition", "SaxoQuote", "SaxoBar",
]