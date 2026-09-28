/**
 * Positions table (M11): live positions with signed quantity, average price,
 * realized/unrealized P&L, market price, and staleness.
 *
 * Data policy mirrors the backend (ADR-013): unpriced values render as "—",
 * never as an invented zero; stale market data is badged.
 */

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { positionsStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { decimalSign, formatDecimal } from "../../utils/decimal";

export function PositionsTable() {
  const { byKey, keys, loadState, errorMessage } = useStoreState(positionsStore);

  const rows = keys.map((key) => byKey[key]);

  return (
    <Panel title="Positions">
      {loadState === "idle" || (loadState === "loading" && keys.length === 0) ? (
        <LoadingState label="Loading positions…" />
      ) : loadState === "error" && keys.length === 0 ? (
        <ErrorState message={errorMessage ?? "Could not load positions."} />
      ) : keys.length === 0 ? (
        <EmptyState
          message="No open positions."
          detail="Positions appear after your first executed fill."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Qty</th>
              <th className="num">Avg Price</th>
              <th className="num">Market</th>
              <th className="num">Realized</th>
              <th className="num">Unrealized</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => (
              <PositionRow key={`${position.account_id}|${position.symbol}`} {...position} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function PositionRow({
  symbol,
  exchange,
  currency,
  quantity,
  average_price,
  realized_pnl,
  unrealized_pnl,
  market_price,
  stale,
}: {
  symbol: string;
  exchange: string;
  currency: string;
  quantity: string;
  average_price: string | null;
  realized_pnl: string | null;
  unrealized_pnl: string | null;
  market_price: string | null;
  stale: boolean;
}) {
  const sign = decimalSign(quantity);
  return (
    <tr>
      <td>
        <span className="symbol">{symbol}</span>
        <span className="symbol-venue">{exchange}</span>
      </td>
      <td className={`num ${sign > 0 ? "pos" : sign < 0 ? "neg" : ""}`}>
        {formatDecimal(quantity)}
      </td>
      <td className="num">{formatDecimal(average_price)}</td>
      <td className="num">{formatDecimal(market_price)}</td>
      <td className="num">
        <MoneyText value={realized_pnl} currency={currency} signed />
      </td>
      <td className="num">
        <MoneyText value={unrealized_pnl} currency={currency} signed />
      </td>
      <td>
        {stale ? (
          <StatusBadge
            tone="warn"
            label="Stale"
            title="Market data is stale — values may not reflect current prices"
          />
        ) : (
          <StatusBadge tone="ok" label="Fresh" />
        )}
      </td>
    </tr>
  );
}
