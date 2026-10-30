/**
 * Accounts page (M3; renamed from `PortfolioPage` in FE-M10).
 *
 * DESIGN NOTE — inferred layout (documented per the M3 rules): the Figma
 * prototype contains NO accounts frame ("Accounts" is a sidebar destination
 * with a wallet icon only). This page composes the established FE-M1 design
 * system (workspace, page-title, panels, stat/snapshot styles) with three
 * cards:
 *
 *   1. AccountsCard — user scope, active account, switching (reuses the
 *      uiStore.accountId mechanism + useTerminal's account-switch resync),
 *      broker identity + connection state.
 *   2. PortfolioMetricsCard — currency-aware metrics with per-metric
 *      tooltips; NEVER sums across currencies; NULL equity (multi-ccy
 *      accounts, ADR-013) shown as "not reported", never zero.
 *   3. AllocationCard — per-currency gross exposure by instrument, derived
 *      exactly from backend position marks (pure computeAllocation).
 *
 * FE-M10 NAMING FIX: this file used to be `PortfolioPage.tsx` while rendering
 * the Accounts destination and heading itself "Portfolio" — the name lied.
 * The composition is deliberately unchanged (the M3 tests still cover it);
 * only the file name, the eyebrow and the h1 changed. The Figma "Portfolio"
 * destination is now its own page (`pages/PortfolioPage.tsx`).
 *
 * Reused: BrokerStatusPanel (M11), shared primitives. Read-only — no order
 * execution anywhere on this page (M3 rule). Refresh = account switching or
 * reconnection (the existing resync paths); no decorative refresh button.
 */

import { Icon } from "../components/Icon";
import { BrokerStatusPanel } from "../features/brokers/BrokerStatusPanel";
import { AccountsCard } from "../features/portfolio/AccountsCard";
import { AllocationCard } from "../features/portfolio/AllocationCard";
import { PortfolioMetricsCard } from "../features/portfolio/PortfolioMetricsCard";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";

export function AccountsPage() {
  const { accountId } = useStoreState(uiStore);

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Account & portfolio</p>
          <h1>Accounts</h1>
          <p className="page-subtitle">{accountId} · simulated brokers — no live trading</p>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "portfolio" }))}
            title="Open the Portfolio view (equity, P&L and allocation)"
          >
            Open Portfolio
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

      <section className="overview-grid-2" aria-label="Accounts and portfolio metrics">
        <AccountsCard />
        <PortfolioMetricsCard />
      </section>

      <section className="overview-grid-2" aria-label="Allocation and brokers">
        <AllocationCard />
        <BrokerStatusPanel />
      </section>
    </div>
  );
}
