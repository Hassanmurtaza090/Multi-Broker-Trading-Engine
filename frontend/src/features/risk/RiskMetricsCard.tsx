/**
 * "Risk metrics" panel (FE-M8) — the Figma screen's metrics table, filled with
 * what this platform can actually measure.
 *
 * The prototype lists Position concentration, VaR (95%), Max drawdown and
 * Leverage, and shows Daily drawdown + Margin level above it. Only the first is
 * computable here; the rest are rendered as explicit "Not reported" rows with
 * the reason attached, so the absence is visible in the product rather than
 * only in the docs. No row is ever given a plausible-looking substitute value.
 */

import { Panel } from "../../components/Panel";
import { ErrorState, LoadingState } from "../../components/Status";
import { computeAllocation } from "../portfolio/allocation";
import { positionsStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { UNAVAILABLE_METRICS, topConcentrationByCurrency } from "./riskMetrics";
import { usePositionsList } from "./useRiskData";

function NotReportedCell() {
  return <span className="badge badge-muted">Not reported</span>;
}

export function RiskMetricsCard() {
  const positions = usePositionsList();
  const { loadState, errorMessage } = useStoreState(positionsStore);
  const concentration = topConcentrationByCurrency(computeAllocation(positions));
  const pricedPositions = positions.filter((row) => row.market_price !== null).length;

  return (
    <Panel
      title="Risk metrics"
      subtitle="Measured from server-reported positions and summary — nothing here is estimated"
    >
      {loadState === "loading" && positions.length === 0 ? (
        <LoadingState label="Loading positions…" />
      ) : loadState === "error" && positions.length === 0 ? (
        <ErrorState message={errorMessage ?? "Positions could not be loaded."} />
      ) : (
        <div className="table-scroll">
          <table className="data-table risk-metrics-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {concentration.length === 0 ? (
                <tr>
                  <td>Position concentration</td>
                  <td>—</td>
                  <td>
                    {pricedPositions === 0
                      ? "No priced positions to measure."
                      : "No priced exposure in any currency."}
                  </td>
                </tr>
              ) : (
                concentration.map((entry) => (
                  <tr key={`concentration-${entry.currency}`}>
                    <td>Position concentration ({entry.currency})</td>
                    <td className="num">
                      <b>{entry.percent}%</b> {entry.symbol}
                    </td>
                    <td>
                      Largest single-instrument share of {entry.currency} gross exposure. Not a
                      regulatory concentration measure.
                    </td>
                  </tr>
                ))
              )}

              {UNAVAILABLE_METRICS.map((metric) => (
                <tr key={metric.metric}>
                  <td>{metric.metric}</td>
                  <td>
                    <NotReportedCell />
                  </td>
                  <td>{metric.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
