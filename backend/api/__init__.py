"""API Gateway (M10).

FastAPI application exposing the trading engine over REST + WebSocket. The
API layer is a pure delegation/serialization boundary: no business logic, no
broker knowledge (consumers interact with internal abstractions only).
"""

from __future__ import annotations

from api.app import create_app
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
)
from api.security import Principal, get_current_principal
from api.ws import WebSocketHub

__all__ = [
    "create_app",
    "ApiRiskRejectionError",
    "WebSocketHub",
    "Principal",
    "get_current_principal",
    "OrderCreateIn",
    "OrderModifyIn",
    "OrderOut",
    "PositionOut",
    "BalanceOut",
    "AccountSummaryOut",
    "QuoteOut",
    "RiskDecisionOut",
    "BrokerStatusOut",
    "KillSwitchIn",
    "KillSwitchOut",
    "HealthOut",
]
