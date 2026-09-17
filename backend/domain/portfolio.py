"""Portfolio: aggregate of accounts, positions, balances, and P&L."""

from __future__ import annotations

from collections.abc import Iterable

from pydantic import BaseModel, ConfigDict, Field

from domain.account import Balance
from domain.position import Position


class Portfolio(BaseModel):
    """An aggregate view of positions and balances for a set of accounts.

    M1 establishes the model and simple aggregation helpers. Full valuation and
    P&L computation is implemented in M7 (Portfolio & P&L).
    """

    model_config = ConfigDict(frozen=True)

    accounts: frozenset[str] = Field(default_factory=frozenset)
    positions: tuple[Position, ...] = ()
    balances: tuple[Balance, ...] = ()

    def position_for(self, account_id: str, symbol: str) -> Position | None:
        for pos in self.positions:
            if pos.account_id == account_id and pos.instrument.symbol == symbol:
                return pos
        return None

    def positions_for_account(self, account_id: str) -> tuple[Position, ...]:
        return tuple(p for p in self.positions if p.account_id == account_id)

    def net_exposure_by_symbol(self, account_id: str) -> dict[str, Position]:
        """Return the net position per unique symbol for an account."""
        result: dict[str, Position] = {}
        for pos in self.positions_for_account(account_id):
            result[pos.instrument.symbol] = pos
        return result

    def balance_for(self, account_id: str) -> Balance | None:
        for b in self.balances:
            if b.account_id == account_id:
                return b
        return None

    @classmethod
    def from_parts(
        cls,
        positions: Iterable[Position] = (),
        balances: Iterable[Balance] = (),
    ) -> Portfolio:
        positions_tuple = tuple(positions)
        balances_tuple = tuple(balances)
        accounts = {p.account_id for p in positions_tuple} | {b.account_id for b in balances_tuple}
        return cls(accounts=frozenset(accounts), positions=positions_tuple, balances=balances_tuple)
