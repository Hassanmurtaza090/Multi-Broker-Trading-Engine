"""Pre-trade risk rules.

Each rule is a deterministic function of the `RiskContext` and the `OrderRequest`.
Rules are fail-closed: when a rule requires data that is unavailable or stale, it
returns `REJECT` with `data_unavailable=True` unless the rule is not configured
(its limit is `None`), in which case it returns `APPROVE` and is not enforced.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from domain.market import MarketQuote
from domain.money import Money, Quantity
from domain.orders import OrderRequest, OrderSide
from risk.models import RiskContext, RuleResult
from risk.policy import RiskLimits


class RiskRule:
    """Base class for a pre-trade risk rule."""

    name: str = "rule"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        raise NotImplementedError


def _approve(rule: str) -> RuleResult:
    return RuleResult(rule=rule, approved=True)


def _reject(rule: str, reason: str, *, unavailable: bool = False) -> RuleResult:
    return RuleResult(rule=rule, approved=False, reason=reason, data_unavailable=unavailable)


def _notional(order: OrderRequest, quote: MarketQuote | None) -> Money | None:
    if quote is None or quote.last is None:
        return None
    return Money(amount=order.quantity.value * quote.last.value, currency=quote.last.currency)


def _signed_quantity(order: OrderRequest) -> Quantity:
    return order.quantity if order.side is OrderSide.BUY else -order.quantity


class KillSwitchRule(RiskRule):
    """Emergency halt: reject all orders while the kill switch is active."""

    name = "kill_switch"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if ctx.kill_switch_active:
            return _reject(self.name, "trading halted by kill switch")
        return _approve(self.name)


class OrderSizeLimitRule(RiskRule):
    """Reject orders whose quantity exceeds the configured per-order limit."""

    name = "order_size_limit"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if limits.max_order_quantity is None:
            return _approve(self.name)
        if order.quantity > limits.max_order_quantity:
            return _reject(self.name, "order quantity exceeds limit")
        return _approve(self.name)


class PositionLimitRule(RiskRule):
    """Reject orders that would push the net position beyond the configured bound."""

    name = "position_limit"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if limits.position_limit is None:
            return _approve(self.name)
        current = ctx.positions.get(order.instrument.primary_identifier)
        current_qty = current.quantity.value if current is not None else 0
        resulting = current_qty + _signed_quantity(order).value
        if abs(resulting) > abs(limits.position_limit.value):
            return _reject(
                self.name,
                f"resulting position {resulting} exceeds limit {limits.position_limit}",
            )
        return _approve(self.name)


class NotionalExposureLimitRule(RiskRule):
    """Reject orders that would push total notional exposure beyond the limit."""

    name = "notional_exposure_limit"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if limits.max_notional_exposure is None:
            return _approve(self.name)
        if ctx.quote_stale or ctx.quote is None:
            return _reject(self.name, "market data unavailable/stale", unavailable=True)
        notional = _notional(order, ctx.quote)
        if notional is None:
            return _reject(self.name, "market data unavailable", unavailable=True)
        current = ctx.current_exposure or Money(amount=Decimal(0), currency=notional.currency)
        if notional.currency != current.currency:
            return _reject(self.name, "exposure currency mismatch", unavailable=True)
        total = current.amount + notional.amount
        if total > limits.max_notional_exposure.amount:
            return _reject(self.name, "total notional exposure exceeds limit")
        return _approve(self.name)


class AvailableFundsLimitRule(RiskRule):
    """Reject buy orders whose notional exceeds available cash / buying power."""

    name = "available_funds_limit"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if not limits.require_available_funds:
            return _approve(self.name)
        if order.side is not OrderSide.BUY:
            return _approve(self.name)  # SELL is not cash-gated
        if ctx.balance is None:
            return _reject(self.name, "account balance unavailable", unavailable=True)
        if ctx.quote_stale or ctx.quote is None:
            return _reject(self.name, "market data unavailable/stale", unavailable=True)
        notional = _notional(order, ctx.quote)
        if notional is None:
            return _reject(self.name, "market data unavailable", unavailable=True)
        cash = ctx.balance.cash.get(notional.currency.code)
        if cash is None:
            return _reject(self.name, "no cash balance for currency", unavailable=True)
        available = cash.buying_power or cash.available
        if notional.amount > available.amount:
            return _reject(self.name, "insufficient available funds")
        return _approve(self.name)


class DailyOrderCountLimitRule(RiskRule):
    """Reject orders once today's order count reaches the configured limit."""

    name = "daily_order_count_limit"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if limits.max_daily_orders is None:
            return _approve(self.name)
        if ctx.order_count_today >= limits.max_daily_orders:
            return _reject(self.name, "daily order count limit reached")
        return _approve(self.name)


class DailyLossLimitRule(RiskRule):
    """Reject orders when cumulative realized P&L today breaches the loss limit.

    `max_daily_loss` is a POSITIVE loss magnitude (e.g. 50 -> floor at -50):
    the rule rejects when today's realized P&L is below `-(max_daily_loss)`.
    Depends on M7's realized-P&L data via `DailyPnlProvider`. Fail-closed when
    configured but P&L is unavailable.
    """

    name = "daily_loss_limit"

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if limits.max_daily_loss is None:
            return _approve(self.name)
        if limits.max_daily_loss.amount < 0:
            # Misconfigured (negative) limit: fail closed rather than guess.
            return _reject(
                self.name, "max_daily_loss must be a positive magnitude", unavailable=True
            )
        if ctx.daily_pnl is None:
            return _reject(self.name, "realized P&L unavailable", unavailable=True)
        if ctx.daily_pnl.amount < -limits.max_daily_loss.amount:
            return _reject(self.name, "daily loss limit exceeded")
        return _approve(self.name)


class TradingSessionRule(RiskRule):
    """Reject orders outside the configured daily trading window (UTC)."""

    name = "trading_session"

    @staticmethod
    def _in_window(now: datetime, limits: RiskLimits) -> bool:
        window = limits.trading_window
        if window is None:
            return True
        t = now.time()
        if window.end > window.start:
            return window.start <= t <= window.end
        # Wraps midnight.
        return t >= window.start or t <= window.end

    def evaluate(self, ctx: RiskContext, order: OrderRequest, limits: RiskLimits) -> RuleResult:
        if limits.trading_window is None:
            return _approve(self.name)
        if not self._in_window(ctx.now, limits):
            return _reject(self.name, "outside trading session")
        return _approve(self.name)


ALL_RULES: tuple[type[RiskRule], ...] = (
    KillSwitchRule,
    OrderSizeLimitRule,
    PositionLimitRule,
    NotionalExposureLimitRule,
    AvailableFundsLimitRule,
    DailyOrderCountLimitRule,
    DailyLossLimitRule,
    TradingSessionRule,
)
