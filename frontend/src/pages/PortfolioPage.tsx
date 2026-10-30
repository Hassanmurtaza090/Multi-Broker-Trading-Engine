/**
 * Portfolio workspace (FE-M10) — the Figma sidebar's "Portfolio" destination.
 *
 * DESIGN SOURCE: the retrieved Figma Make project
 * "Multi-Broker-Trading-Engine-UI" (`src/App.tsx`): the sidebar lists
 * Portfolio (`navItems`, after Activity) and the Portfolio screen is a metrics
 * row plus a two-column detail grid (asset-allocation donut / account balances
 * table) and a "Portfolio holdings" table.
 *
 * WHAT IS BUILT, AND FROM WHAT:
 *   - PortfolioMetricsCard — equity, gross exposure, per-currency cash, P&L and
 *     market value, straight from `GET /accounts/{id}/summary` and `/balance`.
 *   - AllocationCard — per-currency gross exposure by instrument, derived
 *     exactly from the backend's own position marks.
 *   - PositionsTable — the authoritative positions read model, reused rather
 *     than forked into a second "holdings" table (same rows, same marks).
 *
 * WHAT IS DELIBERATELY NOT BUILT: the design's Day P&L, asset-class donut,
 * cross-broker balance table and cross-currency total have no data source.
 * Inventing them would put fabricated numbers in front of a trader, so the
 * page states the gap and the exact backend work instead (table below).
 *
 * Read-only: no order submission, cancel or modify control exists here.
 */

import { Icon } from "../components/Icon";
import { Panel } from "../components/Panel";
import { AllocationCard } from "../features/portfolio/AllocationCard";
import { PortfolioMetricsCard } from "../features/portfolio/PortfolioMetricsCard";
import { PositionsTable } from "../features/positions/PositionsTable";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";

const UNSUPPORTED: readonly { element: string; reason: string; ask: string }[] = [
  {
    element: "Day P&L",
    reason:
      "No start-of-day equity and no prior close exist in any read model. Today's realized P&L cannot be isolated: realized P&L is cumulative since engine start.",
    ask: "B3 — equity/P&L time series",
  },
  {
    element: "Asset-allocation donut (Cash / Stocks / Forex / Options / Others)",
    reason:
      "PositionOut carries symbol, exchange and currency only — there is no asset-class bucket per position, and no valuation per class.",
    ask: "New position field or an allocation-by-class endpoint",
  },
  {
    element: "Cross-broker account balances table",
    reason:
      "The runtime binds ONE broker account (ADR-016) and there is no account registry to enumerate the others; balances are per account, per currency.",
    ask: "B2 — account registry",
  },
  {
    element: "Cross-currency portfolio total",
    reason:
      "There is no FX conversion and no exchange-rate timestamp, so summing currencies would produce a meaningless number (ADR-013).",
    ask: "ADR-013 revision plus an FX source",
  },
  {
    element: "Equity / P&L sparkline beyond this session",
    reason:
      "No historical series is exposed — only the current snapshot, so a line would have to be synthesised.",
    ask: "B3 — equity/P&L time series",
  },
  {
    element: "P&L % per holding",
    reason:
      "Requires a cost-basis ratio the API does not publish. Deriving it in the browser would create a second, unofficial source of truth for a financial figure.",
    ask: "Published per-position return field",
  },
];

export function PortfolioPage() {
  const { accountId } = useStoreState(uiStore);

  return (
    <div className="workspace portfolio-page">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Portfolio</p>
          <h1>Portfolio</h1>
          <p className="page-subtitle">{accountId} · equity, P&amp;L and allocation — read-only</p>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "accounts" }))}
            title="Accounts, cash and broker status"
          >
            Open Accounts
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "positions" }))}
            title="Open the full Positions view"
          >
            View positions
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "dashboard" }))}
            title="Open the Trading Terminal"
          >
            <Icon name="chart" size={16} />
            Open Trade
          </button>
        </div>
      </section>

      <PortfolioMetricsCard />

      <section className="overview-grid-2" aria-label="Allocation and design gaps">
        <AllocationCard />
        <Panel
          title="Not available in this build"
          subtitle="Figma elements with no data source — stated, not simulated"
        >
          <div className="table-scroll">
            <table className="data-table gap-table">
              <thead>
                <tr>
                  <th>Design element</th>
                  <th>Why it is not built</th>
                  <th>Backend work required</th>
                </tr>
              </thead>
              <tbody>
                {UNSUPPORTED.map((row) => (
                  <tr key={row.element}>
                    <td>{row.element}</td>
                    <td>{row.reason}</td>
                    <td>
                      <code>{row.ask}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <PositionsTable />
    </div>
  );
}
