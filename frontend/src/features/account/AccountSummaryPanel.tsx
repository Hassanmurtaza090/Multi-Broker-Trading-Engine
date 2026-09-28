/**
 * Account panel (M11): balances, equity/exposure, and P&L summary.
 *
 * Distinct states: loading → skeleton; 404 balance → explicit "not reported"
 * empty state (never a fake zero — mirrors the backend's never-silently-zero
 * policy, ADR-013); error → retry-able error state.
 */

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { accountStore } from "../../stores";
import { useStoreState } from "../../stores/store";

export function AccountSummaryPanel() {
  const { balance, balanceState, summary, summaryState, errorMessage } =
    useStoreState(accountStore);

  return (
    <Panel title="Account">
      {balanceState === "error" || summaryState === "error" ? (
        <ErrorState message={errorMessage ?? "Could not load account data."} />
      ) : (
        <div className="account-grid">
          <section aria-label="Balances">
            <h3 className="section-title">Balances</h3>
            {balanceState === "idle" || balanceState === "loading" ? (
              <LoadingState />
            ) : balanceState === "missing" ? (
              <EmptyState
                message="No balance reported yet."
                detail="The broker has not published account balances for this account."
              />
            ) : balance === null || balance.cash.length === 0 ? (
              <EmptyState message="No cash balances." />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th className="num">Cash</th>
                    <th className="num">Available</th>
                    <th className="num">Buying Power</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.cash.map((entry) => (
                    <tr key={entry.currency}>
                      <td>{entry.currency}</td>
                      <td className="num">
                        <MoneyText value={entry.total} />
                      </td>
                      <td className="num">
                        <MoneyText value={entry.available} />
                      </td>
                      <td className="num">
                        <MoneyText value={entry.buying_power} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section aria-label="Portfolio summary">
            <h3 className="section-title">Summary</h3>
            {summaryState === "idle" || summaryState === "loading" ? (
              <LoadingState />
            ) : summary === null ? (
              <EmptyState message="No portfolio summary available." />
            ) : (
              <div className="summary-grid">
                <div className="summary-item">
                  <span className="summary-label">Equity</span>
                  <MoneyText value={summary.equity} />
                </div>
                <div className="summary-item">
                  <span className="summary-label">Exposure</span>
                  <MoneyText value={summary.exposure} />
                </div>
                {Object.entries(summary.realized_pnl).map(([ccy, value]) => (
                  <div className="summary-item" key={`realized-${ccy}`}>
                    <span className="summary-label">Realized P&L ({ccy})</span>
                    <MoneyText value={value} currency={ccy} signed />
                  </div>
                ))}
                {Object.entries(summary.unrealized_pnl).map(([ccy, value]) => (
                  <div className="summary-item" key={`unrealized-${ccy}`}>
                    <span className="summary-label">Unrealized P&L ({ccy})</span>
                    <MoneyText value={value} currency={ccy} signed />
                  </div>
                ))}
                {Object.entries(summary.market_value).map(([ccy, value]) => (
                  <div className="summary-item" key={`mv-${ccy}`}>
                    <span className="summary-label">Market Value ({ccy})</span>
                    <MoneyText value={value} currency={ccy} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}
