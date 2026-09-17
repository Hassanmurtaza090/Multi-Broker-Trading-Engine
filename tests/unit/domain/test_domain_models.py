"""Unit tests for account, balance, position, fills, portfolio, market, errors."""

from __future__ import annotations

from decimal import Decimal

import pytest

from domain.account import Account, Balance, CashBalance
from domain.errors import (
    BrokerError,
    DuplicateOrderError,
    ErrorCode,
    RiskRejectedError,
    StaleDataError,
)
from domain.fills import ExecutionReport, ExecutionReportType, Fill
from domain.instrument import Instrument
from domain.market import MarketQuote, QuoteType
from domain.money import Currency, Money, Price, Quantity
from domain.orders import OrderSide
from domain.portfolio import Portfolio
from domain.position import Position


class TestAccountBalance:
    def test_cash_available_le_total(self, usd: Currency) -> None:
        cb = CashBalance(
            currency=usd,
            total=Money(amount="100", currency=usd),
            available=Money(amount="50", currency=usd),
        )
        assert cb.available.amount <= cb.total.amount

    def test_cash_available_exceeds_total_rejected(self, usd: Currency) -> None:
        with pytest.raises(ValueError):
            CashBalance(
                currency=usd,
                total=Money(amount="100", currency=usd),
                available=Money(amount="150", currency=usd),
            )

    def test_cash_mismatched_currency_rejected(self, usd: Currency, eur: Currency) -> None:
        with pytest.raises(ValueError):
            CashBalance(
                currency=usd,
                total=Money(amount="100", currency=usd),
                available=Money(amount="50", currency=eur),
            )

    def test_balance_cash_for(self, usd: Currency) -> None:
        cb = CashBalance(
            currency=usd,
            total=Money(amount="100", currency=usd),
            available=Money(amount="50", currency=usd),
        )
        bal = Balance(account_id="ACC-001", cash={"USD": cb})
        assert bal.cash_for("USD") is cb
        assert bal.cash_for(usd) is cb
        assert bal.cash_for("EUR") is None

    def test_account_requires_broker(self, usd: Currency) -> None:
        with pytest.raises(ValueError):
            Account(account_id="ACC-001", broker="", base_currency=usd)


class TestPosition:
    def _make_long(self, aapl: Instrument, qty: str = "100") -> Position:
        return Position(
            account_id="ACC-001",
            instrument=aapl,
            quantity=Quantity(value=qty),
            average_price=Price(value="100", currency=aapl.currency),
        )

    def test_direction(self, aapl: Instrument) -> None:
        assert self._make_long(aapl, "100").direction == "LONG"
        assert self._make_long(aapl, "-100").direction == "SHORT"
        assert self._make_long(aapl, "0").direction == "FLAT"

    def test_apply_fill_increases_same_direction_vwap(self, aapl: Instrument) -> None:
        pos = self._make_long(aapl, "100")  # avg 100
        new = pos.apply_fill(Quantity(value="100"), Price(value="110", currency=aapl.currency))
        assert new.quantity.value == Decimal("200")
        assert new.average_price == Price(value="105", currency=aapl.currency)

    def test_apply_fill_reduces_keeps_avg(self, aapl: Instrument) -> None:
        pos = self._make_long(aapl, "100")  # avg 100
        new = pos.apply_fill(Quantity(value="-50"), Price(value="120", currency=aapl.currency))
        assert new.quantity.value == Decimal("50")
        assert new.average_price == Price(value="100", currency=aapl.currency)

    def test_apply_fill_to_flat(self, aapl: Instrument) -> None:
        pos = self._make_long(aapl, "100")
        new = pos.apply_fill(Quantity(value="-100"), Price(value="120", currency=aapl.currency))
        assert new.quantity.value == Decimal("0")
        assert new.average_price is None

    def test_apply_fill_flips_side(self, aapl: Instrument) -> None:
        pos = self._make_long(aapl, "100")
        new = pos.apply_fill(Quantity(value="-150"), Price(value="120", currency=aapl.currency))
        assert new.quantity.value == Decimal("-50")
        assert new.direction == "SHORT"
        # When flipping short, average resets to fill price.
        assert new.average_price == Price(value="120", currency=aapl.currency)


class TestFills:
    def _make_fill(self, aapl: Instrument, side: OrderSide = OrderSide.BUY, qty: str = "10") -> Fill:
        from uuid import uuid4

        return Fill(
            fill_id="F-1",
            order_client_id=uuid4(),
            account_id="ACC-001",
            instrument=aapl,
            side=side,
            quantity=Quantity(value=qty),
            price=Price(value="100", currency=aapl.currency),
        )

    def test_signed_quantity(self, aapl: Instrument) -> None:
        assert self._make_fill(aapl, OrderSide.BUY).signed_quantity.value == Decimal("10")
        assert self._make_fill(aapl, OrderSide.SELL).signed_quantity.value == Decimal("-10")

    def test_gross_and_signed_value(self, aapl: Instrument) -> None:
        buy = self._make_fill(aapl, OrderSide.BUY, qty="10")
        assert buy.gross_value.amount == Decimal("1000.00")
        assert buy.signed_value.amount == Decimal("1000.00")
        sell = self._make_fill(aapl, OrderSide.SELL, qty="10")
        assert sell.signed_value.amount == Decimal("-1000.00")

    def test_quantity_must_be_positive(self, aapl: Instrument) -> None:
        from uuid import uuid4

        with pytest.raises(ValueError):
            Fill(
                fill_id="F-1",
                order_client_id=uuid4(),
                account_id="ACC-001",
                instrument=aapl,
                side=OrderSide.BUY,
                quantity=Quantity(value="0"),
                price=Price(value="100", currency=aapl.currency),
            )

    def test_execution_report_fill_client_match(self, aapl: Instrument) -> None:
        from uuid import uuid4

        cid = uuid4()
        fill = Fill(
            fill_id="F-1",
            order_client_id=cid,
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            quantity=Quantity(value="10"),
            price=Price(value="100", currency=aapl.currency),
        )
        report = ExecutionReport(
            report_id="R-1",
            order_client_id=cid,
            account_id="ACC-001",
            report_type=ExecutionReportType.FILL,
            fill=fill,
        )
        assert report.fill is fill

    def test_execution_report_fill_mismatch_rejected(self, aapl: Instrument) -> None:
        from uuid import uuid4

        fill = Fill(
            fill_id="F-1",
            order_client_id=uuid4(),
            account_id="ACC-001",
            instrument=aapl,
            side=OrderSide.BUY,
            quantity=Quantity(value="10"),
            price=Price(value="100", currency=aapl.currency),
        )
        with pytest.raises(ValueError):
            ExecutionReport(
                report_id="R-1",
                order_client_id=uuid4(),
                account_id="ACC-001",
                report_type=ExecutionReportType.FILL,
                fill=fill,
            )


class TestPortfolio:
    def _pos(self, account: str, symbol: str, qty: str, usd: Currency) -> Position:
        inst = Instrument(symbol=symbol, asset_class="EQUITY", currency=usd)
        return Position(
            account_id=account,
            instrument=inst,
            quantity=Quantity(value=qty),
            average_price=Price(value="100", currency=usd),
        )

    def test_from_parts_and_lookup(self, usd: Currency) -> None:
        p1 = self._pos("A", "AAPL", "100", usd)
        p2 = self._pos("A", "MSFT", "50", usd)
        p3 = self._pos("B", "AAPL", "10", usd)
        pf = Portfolio.from_parts(positions=[p1, p2, p3])
        assert pf.accounts == frozenset({"A", "B"})
        assert pf.positions_for_account("A") == (p1, p2)
        assert pf.position_for("B", "AAPL") is p3
        assert pf.position_for("B", "NOPE") is None
        assert set(pf.net_exposure_by_symbol("A")) == {"AAPL", "MSFT"}


class TestMarketQuote:
    def _quote(self, aapl: Instrument, bid="99", ask="101") -> MarketQuote:
        return MarketQuote(
            instrument=aapl,
            bid=Price(value=bid, currency=aapl.currency),
            ask=Price(value=ask, currency=aapl.currency),
        )

    def test_mid_and_spread(self, aapl: Instrument) -> None:
        q = self._quote(aapl)
        assert q.mid == Price(value="100", currency=aapl.currency)
        assert q.spread == Price(value="2", currency=aapl.currency)

    def test_bid_exceed_ask_rejected(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            self._quote(aapl, bid="101", ask="99")

    def test_empty_quote_rejected(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            MarketQuote(instrument=aapl)

    def test_negative_size_rejected(self, aapl: Instrument) -> None:
        with pytest.raises(ValueError):
            MarketQuote(
                instrument=aapl,
                bid=Price(value="99", currency=aapl.currency),
                bid_size=Quantity(value="-1"),
            )

    def test_quote_type_enum(self) -> None:
        assert QuoteType.BID.value == "BID"
        assert QuoteType.MID.value == "MID"


class TestErrors:
    def test_domain_error_to_dict(self) -> None:
        e = StaleDataError("data too old", detail="15s")
        assert e.code == ErrorCode.STALE_DATA
        assert e.to_dict() == {"code": "STALE_DATA", "message": "data too old", "detail": "15s"}

    def test_broker_error_to_dict(self) -> None:
        e = BrokerError("connection refused", broker="IBKR", broker_error_code="504")
        assert e.broker == "IBKR"
        d = e.to_dict()
        assert d["broker"] == "IBKR"
        assert d["broker_error_code"] == "504"

    def test_codes(self) -> None:
        assert DuplicateOrderError.code == ErrorCode.DUPLICATE_ORDER
        assert RiskRejectedError.code == ErrorCode.RISK_REJECTED

    def test_str(self) -> None:
        assert str(StaleDataError("x")) == "STALE_DATA: x"