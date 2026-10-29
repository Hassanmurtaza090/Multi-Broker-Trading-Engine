/**
 * Position-level risk (FE-M8).
 *
 * Every cell is either a server-reported value or "—". Nothing is recomputed:
 * - `unrealized_pnl` is shown exactly as the backend reports it (the server
 *   derives it from the position's average price and the authoritative mark,
 *   in the position's own currency). The UI does NOT recompute P&L, because a
 *   second implementation would be a second source of truth.
 * - `market_value` IS derived here (quantity × market price, exact BigInt
 *   decimal) because `PositionOut` does not carry it. It is labelled as
 *   derived and shows "—" when there is no mark.
 * - Cross-currency totals are never produced. Market value stays in the
 *   position's currency, and the footer sums NOTHING.
 *
 * Stop-loss: there is no position→protective-order linkage anywhere in the
 * API, so no stop price is displayed and no "protected" state is implied. An
 * estimate of risk-to-stop would require that linkage plus contract specs;
 * inventing one would misrepresent exposure.
 */

import { useMemo } from "react";

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { StatusBadge } from "../../components/StatusBadge";
import { positionsStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { formatDecimal } from "../../utils/decimal";
import { directionOf, positionMarketValue, summarizePositions } from "./riskMetrics";
import { usePositionsList } from "./useRiskData";

export function PositionRiskCard() {
  const positions = usePositionsList();
  const { loadState, errorMessage } = useStoreState(positionsStore);

  const counts = useMemo(() => summarizePositions(positions), [positions]);
  const openPositions = useMemo(
    () => positions.filter((position) => directionOf(position.quantity) !== "FLAT"),
    [positions],
  );

  return (
    <Panel
      title="Position risk"
      subtitle="Marks, market value and unrealized P&L per position — reported by the server, never recalculated here"
      actions={
        openPositions.length > 0 ? (
          <span className="risk-counts">
            {counts.open} open · {counts.stale} stale · {counts.unpriced} unpriced
          </span>
        ) : undefined
      }
    >
      {loadState === "loading" && positions.length === 0 ? (
        <LoadingState label="Loading positions…" />
      ) : loadState === "error" && positions.length === 0 ? (
        <ErrorState message={errorMessage ?? "Positions could not be loaded."} />
      ) : openPositions.length === 0 ? (
        <EmptyState
          message="No open positions."
          detail="Position risk appears once the broker reports a non-flat position for this account."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table risk-position-table">
            <thead>
              <tr>
                <th scope="col">Instrument</th>
                <th scope="col">Account</th>
                <th scope="col">Direction</th>
                <th scope="col" className="num">
                  Quantity
                </th>
                <th scope="col" className="num">
                  Avg price
                </th>
                <th scope="col" className="num">
                  Last
                </th>
                <th scope="col" className="num">
                  Market value
                </th>
                <th scope="col" className="num">
                  Unrealized P&amp;L
                </th>
                <th scope="col">Mark</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map((position) => {
                const direction = directionOf(position.quantity);
                const marketValue = positionMarketValue(position);
                return (
                  <tr
                    key={`${position.account_id}|${position.symbol}|${position.exchange}|${position.currency}`}
                  >
                    <td>
                      <span className="cell-primary">{position.symbol}</span>
                      <span className="cell-muted">
                        {position.exchange} · {position.currency}
                      </span>
                    </td>
                    <td>
                      <code>{position.account_id}</code>
                    </td>
                    <td>
                      <span className={`side-indicator ${direction === "LONG" ? "pos" : "neg"}`}>
                        {direction}
                      </span>
                    </td>
                    <td className="num">{formatDecimal(position.quantity)}</td>
                    <td className="num">
                      {position.average_price === null ? (
                        <span className="cell-muted">—</span>
                      ) : (
                        formatDecimal(position.average_price)
                      )}
                    </td>
                    <td className="num">
                      {position.market_price === null ? (
                        <span className="cell-muted">—</span>
                      ) : (
                        formatDecimal(position.market_price)
                      )}
                    </td>
                    <td className="num">
                      {marketValue === null ? (
                        <span className="cell-muted" title="No market price reported">
                          —
                        </span>
                      ) : (
                        <MoneyText value={marketValue} currency={position.currency} />
                      )}
                    </td>
                    <td className="num">
                      {position.unrealized_pnl === null ? (
                        <span className="cell-muted" title="Not reported by the server">
                          —
                        </span>
                      ) : (
                        <MoneyText
                          value={position.unrealized_pnl}
                          currency={position.currency}
                          signed
                        />
                      )}
                    </td>
                    <td>
                      {position.stale ? (
                        <StatusBadge
                          tone="warn"
                          label="Stale"
                          title="The broker's mark is flagged stale — values may not reflect current prices"
                        />
                      ) : position.market_price === null ? (
                        <span className="badge badge-muted">Unpriced</span>
                      ) : (
                        <span className="badge badge-ok">Fresh</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ul className="markets-notes-list risk-notes">
        <li>
          <b>No cross-currency totals.</b> Market values stay in each position&apos;s own currency;
          there is no FX conversion endpoint (ADR-013), so a combined figure would be meaningless.
        </li>
        <li>
          <b>Market value is derived</b> (quantity × last mark, exact decimal) because the API does
          not report it per position. Unrealized P&amp;L is the server&apos;s own value and is never
          recomputed here.
        </li>
        <li>
          <b>No protective-stop display.</b> Nothing links a position to a protective order, so a
          stop-loss level cannot be shown or verified — and risk-to-stop cannot be estimated
          honestly without contract specifications and that linkage.
        </li>
      </ul>
    </Panel>
  );
}
