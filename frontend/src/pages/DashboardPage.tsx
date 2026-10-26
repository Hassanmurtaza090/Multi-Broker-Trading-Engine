/**
 * Trading terminal page (M11 dashboard → M1 Figma "Trading Terminal").
 *
 * The Figma Trade screen: page title row, statistics cards (real account
 * data), chart workspace, trading grid (Markets + Order Ticket), the
 * positions/orders tabs card — followed by a functional strip with the
 * risk and broker panels (the Figma screen has no equivalents, but the
 * kill-switch surface and multi-broker list are required trading
 * information — AGENTS: clearly display broker and connection status).
 */

import { Icon } from "../components/Icon";
import { BrokerStatusPanel } from "../features/brokers/BrokerStatusPanel";
import { gotoOrderTicket } from "../features/orders/gotoOrderTicket";
import { OrderTicket } from "../features/orders/OrderTicket";
import { RiskPanel } from "../features/risk/RiskPanel";
import { ChartWorkspace } from "../features/terminal/ChartWorkspace";
import { PositionsTabsCard } from "../features/terminal/PositionsTabsCard";
import { StatCards } from "../features/terminal/StatCards";
import { WatchlistPanel } from "../features/watchlist/WatchlistPanel";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";

export function DashboardPage() {
  const { accountId } = useStoreState(uiStore);

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Multi-broker execution</p>
          <h1>Trading Terminal</h1>
          <p className="page-subtitle">
            {accountId} · simulated brokers · demo data — no live trading
          </p>
        </div>
        <div className="title-actions">
          <button type="button" className="primary" onClick={gotoOrderTicket}>
            <Icon name="plus" size={16} />
            New order
          </button>
        </div>
      </section>

      <StatCards />

      <ChartWorkspace />

      <section className="trading-grid" aria-label="Markets and order entry">
        <WatchlistPanel />
        <OrderTicket />
      </section>

      <PositionsTabsCard />

      <section className="functional-strip" aria-label="Risk and brokers">
        <RiskPanel />
        <BrokerStatusPanel />
      </section>
    </div>
  );
}
