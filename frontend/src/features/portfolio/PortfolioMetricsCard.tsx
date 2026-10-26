/**
 * Portfolio (M3) — currency-aware portfolio metrics card.
 *
 * Preserves the M3-required distinctions between metrics (each is a
 * separately-labeled backend field — nothing is re-derived or conflated):
 *   - Cash total / Available cash / Buying power  (balance.cash, per ccy)
 *   - Equity (account-level aggregate; NULL on multi-currency accounts —
 *     documented ADR-013 FX limitation, shown as "—" with the reason)
 *   - Exposure — used margin
 *   - Unrealized / Realized P&L (per ccy)
 *   - Market value (per ccy)
 * CURRENCY RULE: values are grouped per currency and NEVER summed across
 * currencies (no FX endpoint exists). Tooltips explain each metric.
 */

import { MoneyText } from "../../components/MoneyText";
import { Panel } from "../../components/Panel";
import { EmptyState, ErrorState, LoadingState } from "../../components/Status";
import { accountStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { formatDecimal } from "../../utils/decimal";

const METRIC_TOOLTIPS = {
  total: "Total cash on the account in this currency (broker-reported).",
  available:
    "Cash available to trade in this currency. Not the same as buying power or free margin.",
  buyingPower:
    "Broker-reported buying power in this currency (null when the broker does not report it).",
  equity:
    "Account-level aggregate value the backend computes. NULL when the account spans multiple currencies (no FX conversion exists yet — ADR-013).",
  exposure:
    "Gross exposure of open positions — the account's used margin as reported by the backend.",
  unrealized:
    "Open-position P&L at the latest marked prices, per currency. Becomes stale when market data ages past the staleness window (positions show their own state).",
  realized: "Closed-trade P&L accumulated on the account, per currency.",
  marketValue:
    "Marked value of open positions in this currency (backend-computed at latest prices).",
} as const;

export function PortfolioMetricsCard() {
  const { balance, balanceState, summary, summaryState, errorMessage } =
    useStoreState(accountStore);

  if (balanceState === "error" && summaryState !== "ready") {
    return (
      <Panel title="Portfolio metrics" subtitle="Balance, equity, margin, and P&L">
        <ErrorState message={errorMessage ?? "Could not load account data."} />
      </Panel>
    );
  }
  if (
    (balanceState === "idle" || balanceState === "loading") &&
    (summaryState === "idle" || summaryState === "loading")
  ) {
    return (
      <Panel title="Portfolio metrics" subtitle="Balance, equity, margin, and P&L">
        <LoadingState label="Loading portfolio metrics…" />
      </Panel>
    );
  }

  const currencies = new Set<string>([
    ...(balance?.cash.map((entry) => entry.currency) ?? []),
    ...(summary ? Object.keys(summary.realized_pnl) : []),
    ...(summary ? Object.keys(summary.unrealized_pnl) : []),
    ...(summary ? Object.keys(summary.market_value) : []),
  ]);
  const multiCurrency = currencies.size > 1;

  const hasNoData =
    (balance === null || balance.cash.length === 0) &&
    (summary === null ||
      (summary.equity === null &&
        Object.keys(summary.realized_pnl).length === 0 &&
        Object.keys(summary.unrealized_pnl).length === 0 &&
        Object.keys(summary.market_value).length === 0));

  return (
    <Panel
      title="Portfolio metrics"
      subtitle={
        multiCurrency
          ? "Per currency — cross-currency totals unavailable (no FX endpoint)"
          : "Balance, equity, margin, and P&L"
      }
    >
      {hasNoData ? (
        <EmptyState
          message="No account metrics reported yet."
          detail="Balances and summary appear after the broker publishes them."
        />
      ) : (
        <>
          <div className="metric-row" title={METRIC_TOOLTIPS.equity}>
            <span className="metric-label">Equity</span>
            <span className="metric-value">
              {summary?.equity != null ? (
                <MoneyText value={summary.equity} />
              ) : (
                <span
                  className="metric-unavailable"
                  title="NULL from the backend: multi-currency accounts have no FX-conversion aggregate yet (ADR-013)."
                >
                  — not reported
                </span>
              )}
            </span>
          </div>
          <div className="metric-row" title={METRIC_TOOLTIPS.exposure}>
            <span className="metric-label">Used margin (exposure)</span>
            <span className="metric-value">
              {summary?.exposure != null ? (
                <MoneyText value={summary.exposure} />
              ) : (
                <span className="metric-unavailable">— not reported</span>
              )}
            </span>
          </div>

          <h3 className="section-title">Cash by currency</h3>
          {balance === null || balance.cash.length === 0 ? (
            <EmptyState message="No balance reported yet." />
          ) : (
            <ul className="snapshot-list">
              {balance.cash.map((entry) => (
                <li key={entry.currency} className="snapshot-row metric-ccy-row">
                  <span className="metric-ccy">{entry.currency}</span>
                  <span title={METRIC_TOOLTIPS.total} className="num">
                    Total <b>{formatDecimal(entry.total)}</b>
                  </span>
                  <span title={METRIC_TOOLTIPS.available} className="num">
                    Available <b>{formatDecimal(entry.available)}</b>
                  </span>
                  <span title={METRIC_TOOLTIPS.buyingPower} className="num">
                    Buying power <b>{formatDecimal(entry.buying_power)}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="section-title">P&L and value by currency</h3>
          {summary === null ? (
            <EmptyState message="No portfolio summary available." />
          ) : currencies.size === 0 ? (
            <p className="state-detail">No per-currency metrics reported.</p>
          ) : (
            <ul className="snapshot-list">
              {[...currencies].map((ccy) => (
                <li key={ccy} className="snapshot-row metric-ccy-row">
                  <span className="metric-ccy">{ccy}</span>
                  <span title={METRIC_TOOLTIPS.unrealized} className="num">
                    Unrealized <MoneyText value={summary.unrealized_pnl[ccy] ?? null} signed />
                  </span>
                  <span title={METRIC_TOOLTIPS.realized} className="num">
                    Realized <MoneyText value={summary.realized_pnl[ccy] ?? null} signed />
                  </span>
                  <span title={METRIC_TOOLTIPS.marketValue} className="num">
                    Value <MoneyText value={summary.market_value[ccy] ?? null} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
