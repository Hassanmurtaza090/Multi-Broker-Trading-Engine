"""REST API (M10/M12) — a thin delegation surface over the engine.

Every endpoint delegates to the application runtime (`EngineRuntime`) and its
components; NO business logic lives here. The runtime is attached to the app
by the factory (`api.app.create_app`) and retrieved via `get_runtime`.

Canonical flows:
- POST /api/v1/orders → idempotent replay by key (200) else the M6 risk-gated
  submission (RiskGatedExecutor) — risk can never be bypassed via the API.
- cancel/modify → Execution Engine (broker-confirmed semantics preserved).
- reads → OMS / Portfolio read models (authoritative state).
- kill-switch → Risk Engine (M6) emergency control.

Authorization (M12): the router-wide dependency authenticates every request;
each endpoint then enforces its permission AND the principal's account scope
server-side — including scope checks on loaded order resources (IDOR guard)
and response filtering on order listings. The frontend hides controls as UX
only; it is never a security boundary.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from api.errors import ApiRiskRejectionError
from api.schemas import (
    AccountSummaryOut,
    BalanceOut,
    BrokerStatusOut,
    HealthOut,
    KillSwitchIn,
    KillSwitchOut,
    OrderCreateIn,
    OrderModifyIn,
    OrderOut,
    PositionOut,
    QuoteOut,
    RiskDecisionOut,
    balance_to_out,
    build_order_request,
    decision_to_out,
    order_to_out,
    position_to_out,
    quote_to_out,
)
from api.security import (
    Principal,
    get_current_principal,
    require_account_access,
    require_permission,
)
from application.runtime import EngineRuntime
from domain.errors import DomainError, ErrorCode, InvalidArgumentError
from domain.instrument import AssetClass, Exchange, Instrument
from domain.money import Currency, Price
from portfolio import PortfolioService
from risk.models import RiskDecision

logger = logging.getLogger("mtbe.api")

router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_principal)])


def get_runtime(request: Request) -> EngineRuntime:
    return request.app.state.runtime  # type: ignore[no-any-return]


RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]
PrincipalDep = Annotated[Principal, Depends(get_current_principal)]


def _not_found(message: str) -> DomainError:
    """A 404-mapped domain error for missing read models."""
    return DomainError(message, code=ErrorCode.NOT_FOUND)


# --- health -----------------------------------------------------------------------


@router.get("/health", response_model=HealthOut, tags=["system"])
async def health(runtime: RuntimeDep) -> HealthOut:
    return HealthOut(
        status="ok" if runtime.broker_connected() else "degraded",
        broker=runtime.broker_name,
        broker_connected=runtime.broker_connected(),
    )


# --- orders -------------------------------------------------------------------------


@router.post("/orders", response_model=OrderOut, status_code=201, tags=["orders"])
async def create_order(
    body: OrderCreateIn,
    runtime: RuntimeDep,
    principal: PrincipalDep,
    response: Response,
) -> OrderOut:
    """Submit an order through the mandatory risk gate.

    Idempotent: replaying the same `idempotency_key` returns the original
    order with HTTP 200 instead of creating a duplicate (TS-004).
    """
    require_permission(principal, "orders:write")
    require_account_access(principal, body.account_id)
    existing = (
        runtime.find_order_by_idempotency_key(body.idempotency_key)
        if body.idempotency_key
        else None
    )
    if existing is not None:
        # Idempotent replay — 200 (already existed), never a duplicate.
        require_account_access(principal, existing.account_id)
        response.status_code = 200
        return order_to_out(existing)

    request_obj = build_order_request(body)
    result = await runtime.gate.submit(request_obj)
    if not result.approved or result.order is None:
        # Rejections are decisions, not exceptions: rendered as 422 with the
        # explainable decision body by the ApiRiskRejectionError handler.
        raise ApiRiskRejectionError(result.decision)
    return order_to_out(result.order)


@router.get("/orders", response_model=list[OrderOut], tags=["orders"])
async def list_orders(
    runtime: RuntimeDep,
    principal: PrincipalDep,
    account_id: Annotated[str | None, Query(max_length=128)] = None,
) -> list[OrderOut]:
    require_permission(principal, "orders:read")
    if account_id is not None:
        require_account_access(principal, account_id)
        return [order_to_out(o) for o in runtime.oms.list_orders(account_id)]
    # No filter given: return ONLY the accounts in the caller's scope
    # (server-side response filtering; admins with "*" see everything).
    visible = principal.account_ids_visible()
    orders = runtime.oms.list_orders(None)
    if visible is not None:
        orders = [o for o in orders if principal.can_access_account(o.account_id)]
    return [order_to_out(o) for o in orders]


@router.get("/orders/{client_order_id}", response_model=OrderOut, tags=["orders"])
async def get_order(
    client_order_id: UUID, runtime: RuntimeDep, principal: PrincipalDep
) -> OrderOut:
    require_permission(principal, "orders:read")
    order = runtime.oms.get_order(client_order_id)
    # IDOR guard: possession of an order id never grants cross-account access.
    require_account_access(principal, order.account_id)
    return order_to_out(order)


@router.post(
    "/orders/{client_order_id}/cancel",
    response_model=OrderOut,
    status_code=200,
    tags=["orders"],
)
async def cancel_order(
    client_order_id: UUID, runtime: RuntimeDep, principal: PrincipalDep
) -> OrderOut:
    """Request cancellation via the Execution Engine (broker-confirmed)."""
    require_permission(principal, "orders:write")
    order = runtime.oms.get_order(client_order_id)
    require_account_access(principal, order.account_id)
    await runtime.executor.cancel(client_order_id)
    return order_to_out(runtime.oms.get_order(client_order_id))


@router.post(
    "/orders/{client_order_id}/modify",
    response_model=OrderOut,
    status_code=200,
    tags=["orders"],
)
async def modify_order(
    client_order_id: UUID,
    body: OrderModifyIn,
    runtime: RuntimeDep,
    principal: PrincipalDep,
) -> OrderOut:
    """Modify a working order's price terms (local reflection + broker ack)."""
    require_permission(principal, "orders:write")
    if body.limit_price is None and body.stop_price is None:
        raise InvalidArgumentError("at least one price must be provided")
    order = runtime.oms.get_order(client_order_id)
    require_account_access(principal, order.account_id)
    currency = order.instrument.currency
    limit_price = (
        Price(value=Decimal(body.limit_price), currency=currency)
        if body.limit_price is not None
        else None
    )
    stop_price = (
        Price(value=Decimal(body.stop_price), currency=currency)
        if body.stop_price is not None
        else None
    )
    await runtime.executor.modify(client_order_id, limit_price=limit_price, stop_price=stop_price)
    return order_to_out(runtime.oms.get_order(client_order_id))


# --- account / portfolio ---------------------------------------------------------------


@router.get(
    "/accounts/{account_id}/positions",
    response_model=list[PositionOut],
    tags=["portfolio"],
)
async def list_positions(
    account_id: str, runtime: RuntimeDep, principal: PrincipalDep
) -> list[PositionOut]:
    require_permission(principal, "positions:read")
    require_account_access(principal, account_id)
    portfolio: PortfolioService = runtime.portfolio
    out: list[PositionOut] = []
    for position in portfolio.positions(account_id).values():
        unrealized = portfolio.unrealized_pnl(account_id, position.instrument)
        quote = portfolio.quote(position.instrument)
        market_price = quote.last if quote is not None else None
        out.append(
            position_to_out(
                position,
                unrealized,
                market_price,
                portfolio.is_stale(position.instrument),
            )
        )
    return out


@router.get("/accounts/{account_id}/balance", response_model=BalanceOut, tags=["portfolio"])
async def get_balance(account_id: str, runtime: RuntimeDep, principal: PrincipalDep) -> BalanceOut:
    require_permission(principal, "account:read")
    require_account_access(principal, account_id)
    balance = runtime.portfolio.balance(account_id)
    if balance is None:
        raise _not_found(f"no balance known for account {account_id}")
    return balance_to_out(balance)


@router.get(
    "/accounts/{account_id}/summary",
    response_model=AccountSummaryOut,
    tags=["portfolio"],
)
async def account_summary(
    account_id: str, runtime: RuntimeDep, principal: PrincipalDep
) -> AccountSummaryOut:
    require_permission(principal, "account:read")
    require_account_access(principal, account_id)
    portfolio: PortfolioService = runtime.portfolio
    equity = portfolio.equity(account_id)
    exposure = portfolio.exposure(account_id)
    return AccountSummaryOut(
        account_id=account_id,
        equity=str(equity.amount) if equity is not None else None,
        exposure=str(exposure.amount) if exposure is not None else None,
        realized_pnl={
            code: str(pnl.amount)
            for code, pnl in portfolio.realized_pnl_by_currency(account_id).items()
        }
        if hasattr(portfolio, "realized_pnl_by_currency")
        else {},
        unrealized_pnl={
            code: str(pnl.amount)
            for code, pnl in portfolio.unrealized_pnl_by_currency(account_id).items()
        },
        market_value={
            code: str(value.amount)
            for code, value in portfolio.market_value_by_currency(account_id).items()
        },
    )


# --- market data -------------------------------------------------------------------------


@router.get("/market/quote", response_model=QuoteOut, tags=["market"])
async def get_quote(
    runtime: RuntimeDep,
    principal: PrincipalDep,
    symbol: Annotated[str, Query(max_length=64)],
    asset_class: Annotated[str, Query(max_length=32)],
    currency: Annotated[str, Query(max_length=3)],
    exchange: Annotated[str | None, Query(max_length=32)] = None,
) -> QuoteOut:
    """Latest quote for an instrument (M3/M7 authoritative price store)."""
    require_permission(principal, "market:read")
    try:
        instrument = Instrument(
            symbol=symbol,
            asset_class=AssetClass(asset_class.upper()),
            currency=Currency(code=currency),
            exchange=Exchange(exchange.upper()) if exchange else Exchange.UNKNOWN,
        )
    except ValueError as exc:
        raise InvalidArgumentError(f"invalid instrument: {exc}") from exc
    portfolio: PortfolioService = runtime.portfolio
    quote = portfolio.quote(instrument)
    if quote is None:
        raise _not_found(f"no quote available for {symbol}")
    return quote_to_out(quote, portfolio.is_stale(instrument))


# --- risk ----------------------------------------------------------------------------------


@router.get(
    "/accounts/{account_id}/risk/kill-switch",
    response_model=KillSwitchOut,
    tags=["risk"],
)
async def kill_switch_status(
    account_id: str, runtime: RuntimeDep, principal: PrincipalDep
) -> KillSwitchOut:
    require_permission(principal, "risk:read")
    require_account_access(principal, account_id)
    return KillSwitchOut(
        account_id=account_id, active=runtime.risk.is_kill_switch_active(account_id)
    )


@router.post(
    "/accounts/{account_id}/risk/kill-switch",
    response_model=KillSwitchOut,
    tags=["risk"],
)
async def set_kill_switch(
    account_id: str,
    body: KillSwitchIn,
    runtime: RuntimeDep,
    principal: PrincipalDep,
) -> KillSwitchOut:
    """Activate/deactivate the emergency kill switch (M6).

    Privileged: requires the `risk:admin` permission (admin role). The
    principal's subject is audit-logged (FR-012/TS-009) — never credentials.
    """
    require_permission(principal, "risk:admin")
    require_account_access(principal, account_id)
    runtime.risk.set_kill_switch(account_id, active=body.active)
    logger.info(
        "risk_kill_switch_set",
        extra={
            "operation": "risk.kill_switch",
            "subject": principal.subject,
            "account_id": account_id,
            "active": body.active,
        },
    )
    return KillSwitchOut(
        account_id=account_id, active=runtime.risk.is_kill_switch_active(account_id)
    )


@router.post(
    "/accounts/{account_id}/risk/evaluate",
    response_model=RiskDecisionOut,
    tags=["risk"],
)
async def evaluate_risk(
    body: OrderCreateIn,
    account_id: str,
    runtime: RuntimeDep,
    principal: PrincipalDep,
) -> RiskDecisionOut:
    """Dry-run the risk gate for an order (no order is created/executed)."""
    require_permission(principal, "orders:write")
    require_account_access(principal, account_id)
    request_obj = build_order_request(body)
    decision: RiskDecision = await runtime.risk.evaluate(request_obj)
    return decision_to_out(decision)


# --- brokers ---------------------------------------------------------------------------------


@router.get("/brokers", response_model=list[BrokerStatusOut], tags=["brokers"])
async def broker_status(runtime: RuntimeDep, principal: PrincipalDep) -> list[BrokerStatusOut]:
    """Broker connectivity (internal abstraction only — no broker specifics)."""
    require_permission(principal, "brokers:read")
    return [BrokerStatusOut(name=runtime.broker_name, connected=runtime.broker_connected())]
