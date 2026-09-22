"""Risk Engine (M6).

Pre-trade risk validation, position/cash/exposure/activity controls, and a
kill switch. Broker-independent: it evaluates the internal domain models and
reads authoritative state via the ports in `risk/views`.
"""

from __future__ import annotations

from risk.engine import RiskEngine
from risk.gate import RiskGatedExecutor, RiskGateResult
from risk.models import RiskContext, RiskDecision, RuleResult
from risk.policy import RiskLimits, RiskPolicy, TradingWindow
from risk.rules import RiskRule
from risk.views import AccountView, DailyPnlProvider, MarketDataView, PortfolioView

__all__ = [
    "RiskEngine",
    "RiskGatedExecutor",
    "RiskGateResult",
    "RiskContext",
    "RiskDecision",
    "RuleResult",
    "RiskLimits",
    "RiskPolicy",
    "TradingWindow",
    "RiskRule",
    "PortfolioView",
    "AccountView",
    "MarketDataView",
    "DailyPnlProvider",
]
