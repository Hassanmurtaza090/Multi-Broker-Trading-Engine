/**
 * Risk overview metrics row (FE-M8).
 *
 * Honesty contract, in order of importance:
 * 1. Every monetary value is either a server-reported exact decimal or "—".
 *    There is no zero-filling and no demo fallback.
 * 2. `equity` and `exposure` arrive as bare scalars with no currency field, so
 *    they are shown WITHOUT a currency suffix and labelled accordingly. P&L is
 *    per-currency (a map) and is rendered one line per currency, never summed.
 * 3. The one derived figure — exposure as a share of equity — is explicitly
 *    labelled "derived" and suppressed entirely when either input is missing.
 */

import { MoneyText } from "../../components/MoneyText";
import { ErrorState, LoadingState } from "../../components/Status";
import { accountStore } from "../../stores";
import { useStoreState } from "../../stores/store";
import { exposureToEquityRatio, ratioPercent, summarizePositions } from "./riskMetrics";
import { usePositionsList } from "./useRiskData";

function PercentOfEquity({ exposure, equity }: { exposure: string | null; equity: string | null }) {
  const ratio = exposureToEquityRatio(exposure, equity);
  const percent = ratioPercent(ratio);
  if (percent === null) {
    return (
      <p className="stat-sub">
        Share of equity not derivable — {equity === null ? "equity" : "exposure"} is not reported.
      </p>
    );
  }
  return (
    <p className="stat-sub">
      ≈ <b>{percent}%</b> of equity (derived from the two server figures; the API reports no
      currency for either, so the ratio assumes they match).
    </p>
  );
}

function PnlLines({ pnl }: { pnl: Record<string, string> }) {
  const entries = Object.entries(pnl).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return <h2 className="stat-value">—</h2>;
  }
  return (
    <h2 className="stat-value stat-value-stack">
      {entries.map(([currency, value]) => (
        <span key={currency} className="stat-value-line">
          <MoneyText value={value} signed />
          <span className="stat-value-ccy">{currency}</span>
        </span>
      ))}
    </h2>
  );
}

export function RiskOverviewCards() {
  const { summary, summaryState } = useStoreState(accountStore);
  const positions = usePositionsList();
  const counts = summarizePositions(positions);

  if (summaryState === "loading" && summary === null) {
    return <LoadingState label="Loading account risk data…" />;
  }

  if (summaryState === "error" && summary === null) {
    // No retry button: the terminal resyncs on reconnect and on account
    // switch (useTerminal). Offering a "Retry" that did nothing would be a
    // fake control, so the recovery path is stated instead.
    return (
      <div>
        <ErrorState message="Account risk data could not be loaded." />
        <p className="state-detail">
          The terminal re-requests positions, summary and kill-switch state when the stream
          reconnects or when you switch account.
        </p>
      </div>
    );
  }

  const equity = summary?.equity ?? null;
  const exposure = summary?.exposure ?? null;

  return (
    <>
      {summaryState === "error" ? (
        // useTerminal keeps the last successful summary on failure. Showing it
        // unlabelled would present stale figures as current, so the failure is
        // stated above them.
        <p className="state-detail risk-stale-notice" role="note">
          <b>The last account-summary refresh failed.</b> The figures below are from the previous
          successful response, not the current state — switch account or reconnect to retry.
        </p>
      ) : null}

      <section className="stats-grid" aria-label="Risk overview">
        <article className="stat-card">
          <div className="stat-head">
            <span>Account equity</span>
          </div>
          {equity === null ? <h2 className="stat-value">—</h2> : <MoneyText value={equity} />}
          <p className="stat-sub">
            Server-reported. The API returns a single figure with no currency field, so none is
            shown rather than assumed.
          </p>
        </article>

        <article className="stat-card">
          <div className="stat-head">
            <span>Gross exposure</span>
          </div>
          {exposure === null ? <h2 className="stat-value">—</h2> : <MoneyText value={exposure} />}
          <PercentOfEquity exposure={exposure} equity={equity} />
        </article>

        <article className="stat-card">
          <div className="stat-head">
            <span>Unrealized P&amp;L</span>
          </div>
          <PnlLines pnl={summary?.unrealized_pnl ?? {}} />
          <p className="stat-sub">Per currency, exactly as reported — never summed across them.</p>
        </article>

        <article className="stat-card">
          <div className="stat-head">
            <span>Open positions</span>
          </div>
          <h2 className="stat-value">{counts.open}</h2>
          <p className="stat-sub">
            {counts.long} long · {counts.short} short
            {counts.stale > 0
              ? ` · ${counts.stale} stale mark${counts.stale === 1 ? "" : "s"}`
              : ""}
            {counts.unpriced > 0 ? ` · ${counts.unpriced} unpriced` : ""}
          </p>
        </article>
      </section>
    </>
  );
}
