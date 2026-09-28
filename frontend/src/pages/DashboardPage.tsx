/**
 * Dashboard page (M11): market watch, chart, account, brokers, risk, positions.
 */

import { AccountSummaryPanel } from "../features/account/AccountSummaryPanel";
import { BrokerStatusPanel } from "../features/brokers/BrokerStatusPanel";
import { OrderBlotter } from "../features/orders/OrderBlotter";
import { OrderTicket } from "../features/orders/OrderTicket";
import { PositionsTable } from "../features/positions/PositionsTable";
import { RiskPanel } from "../features/risk/RiskPanel";
import { PriceChartPanel } from "../features/watchlist/PriceChartPanel";
import { WatchlistPanel } from "../features/watchlist/WatchlistPanel";

export function DashboardPage() {
  return (
    <div className="dashboard-grid">
      <div className="dashboard-col">
        <WatchlistPanel />
        <PriceChartPanel />
      </div>
      <div className="dashboard-col dashboard-col-wide">
        <PositionsTable />
        <OrderBlotter />
      </div>
      <div className="dashboard-col">
        <OrderTicket />
        <AccountSummaryPanel />
        <RiskPanel />
        <BrokerStatusPanel />
      </div>
    </div>
  );
}
