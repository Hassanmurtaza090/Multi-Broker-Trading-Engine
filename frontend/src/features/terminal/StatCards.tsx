/**
 * Statistics cards (M1) — the Figma terminal's stats row, wired to the REAL
 * account read models (M11 accountStore + connectionStore).
 *
 * Honesty rules (AGENTS): every value is an exact-decimal string from the
 * backend; "—" when the backend has not reported a value (never an invented
 * zero); the LIVE badge reflects the actual WS stream state — it degrades
 * to "REST" while disconnected, so a resting badge never looks live.
 *
 * Figma deltas (deliberate, documented):
 * - "Today's P&L" is labeled "Total P&L" — the API exposes cumulative
 *   realized/unrealized P&L, not a day-scoped figure.
 * - The portfolio sparkline and bar meters are omitted: the backend has no
 *   equity history or margin-utilization endpoints, and fabricating them
 *   would violate the no-mock-data policy.
 */

import { MoneyText } from "../../components/MoneyText";
import { ErrorState, LoadingState } from "../../components/Status";
import type { ReactNode } from "react";
import { accountStore, connectionStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { addDecimal, formatDecimal } from "../../utils/decimal";

function joinNodes(items: ReactNode[], separator: ReactNode = " · "): ReactNode[] {
  return items.reduce<ReactNode[]>(
    (acc, item, i) => (i === 0 ? [item] : [...acc, separator, item]),
    [],
  );
}

export function StatCards() {
  const { balance, balanceState, summary, summaryState, errorMessage } =
    useStoreState(accountStore);
  const { state: connectionState } = useStoreState(connectionStore);

  const loading =
    (summaryState === "idle" || summaryState === "loading") &&
    (balanceState === "idle" || balanceState === "loading");
  const failed = summaryState === "error" || balanceState === "error";

  if (failed) {
    return (
      <section className="stats-grid" aria-label="Account statistics">
        <article className="stat-card" style={{ gridColumn: "1 / -1" }}>
          <ErrorState message={errorMessage ?? "Could not load account data."} />
        </article>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="stats-grid" aria-label="Account statistics">
        <article className="stat-card">
          <LoadingState label="Loading account…" />
        </article>
        <article className="stat-card">
          <LoadingState label="Loading P&L…" />
        </article>
        <article className="stat-card">
          <LoadingState label="Loading balances…" />
        </article>
      </section>
    );
  }

  // P&L aggregation: exact per-currency totals; multi-currency accounts are
  // listed rather than summed across currencies (backend: multi-CCY nulls).
  const realized = summary !== null ? Object.entries(summary.realized_pnl) : [];
  const unrealized = summary !== null ? Object.entries(summary.unrealized_pnl) : [];
  const pnlCurrencies = new Set([...realized.map(([c]) => c), ...unrealized.map(([c]) => c)]);
  const singlePnlCurrency = pnlCurrencies.size === 1 ? [...pnlCurrencies][0] : null;
  const pnlTotal =
    singlePnlCurrency !== null
      ? addDecimal(
          realized.find(([c]) => c === singlePnlCurrency)?.[1] ?? "0",
          unrealized.find(([c]) => c === singlePnlCurrency)?.[1] ?? "0",
        )
      : null;

  const buyingPowerEntries =
    balance !== null ? balance.cash.filter((entry) => entry.buying_power !== null) : [];
  const exposure = summary !== null ? summary.exposure : null;
  const live = connectionState === "CONNECTED";

  return (
    <section className="stats-grid" aria-label="Account statistics">
      <article className="stat-card">
        <div className="stat-head">
          <span>Total portfolio value</span>
          <i
            className="live-badge"
            title={live ? "Live via the real-time stream" : "REST — stream not connected"}
          >
            {live ? "LIVE" : "REST"}
          </i>
        </div>
        <h2 className="stat-value">
          <MoneyText value={summary?.equity ?? null} />
        </h2>
        <p className="stat-sub">
          {summary !== null && Object.keys(summary.market_value).length > 0
            ? joinNodes(
                Object.entries(summary.market_value).map(([ccy, value]) => (
                  <span key={`mv-${ccy}`}>
                    Market value{" "}
                    <b>
                      {formatDecimal(value)} {ccy}
                    </b>
                  </span>
                )),
              )
            : "Equity not reported yet"}
        </p>
      </article>

      <article className="stat-card">
        <div className="stat-head">
          <span>Total P&L</span>
        </div>
        <h2 className="stat-value">
          {pnlTotal !== null ? <MoneyText value={pnlTotal} signed /> : "—"}
        </h2>
        <p className="stat-sub">
          {pnlCurrencies.size === 0
            ? "No P&L reported yet"
            : joinNodes(
                [...pnlCurrencies].map((ccy) => (
                  <span key={`pnl-${ccy}`}>
                    Realized{" "}
                    <b>
                      {formatDecimal(realized.find(([c]) => c === ccy)?.[1] ?? null)} {ccy}
                    </b>{" "}
                    · Unrealized{" "}
                    <b>
                      {formatDecimal(unrealized.find(([c]) => c === ccy)?.[1] ?? null)} {ccy}
                    </b>
                  </span>
                )),
              )}
        </p>
      </article>

      <article className="stat-card">
        <div className="stat-head">
          <span>Buying power</span>
        </div>
        <h2 className="stat-value">
          {buyingPowerEntries.length === 1 ? (
            <MoneyText value={buyingPowerEntries[0].buying_power} />
          ) : (
            "—"
          )}
        </h2>
        <p className="stat-sub">
          {buyingPowerEntries.length === 0 ? (
            "No buying power reported"
          ) : buyingPowerEntries.length === 1 ? (
            <span>
              Exposure{" "}
              <b>
                {formatDecimal(exposure)} {buyingPowerEntries[0].currency}
              </b>
            </span>
          ) : (
            joinNodes(
              buyingPowerEntries.map((entry) => (
                <span key={`bp-${entry.currency}`}>
                  <b>
                    {formatDecimal(entry.buying_power)} {entry.currency}
                  </b>
                </span>
              )),
            )
          )}
        </p>
      </article>
    </section>
  );
}
