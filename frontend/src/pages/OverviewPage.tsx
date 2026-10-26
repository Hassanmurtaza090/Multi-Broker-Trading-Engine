/**
 * Dashboard / Overview page (M2).
 *
 * DESIGN NOTE — inferred layout (documented per the M2 rules): the Figma
 * prototype contains NO Dashboard frame; "Overview" exists only as a sidebar
 * destination whose sole designed element is the greeting title
 * ("Good morning, Alex" / eyebrow "TRADING WORKSPACE"). This page therefore
 * composes the established M1 design system (workspace, page-title, stat
 * cards, panels) and reuses existing widgets rather than inventing new
 * visual language:
 *
 *   1. Greeting + account subtitle (real session identity + local time)
 *   2. StatCards (M1) — equity / P&L / buying power headlines
 *   3. Positions / Orders / Watchlist read-only snapshot cards (new)
 *   4. Account / Brokers / Risk panels (existing M11 components)
 *
 * Every value is live store data; the only interactions are navigation
 * shortcuts — the Dashboard performs no order actions (M2 rule).
 */

import { Icon } from "../components/Icon";
import { AccountSummaryPanel } from "../features/account/AccountSummaryPanel";
import { BrokerStatusPanel } from "../features/brokers/BrokerStatusPanel";
import { gotoOrderTicket } from "../features/orders/gotoOrderTicket";
import { OrdersSummaryCard } from "../features/overview/OrdersSummaryCard";
import { PositionsSummaryCard } from "../features/overview/PositionsSummaryCard";
import { WatchlistSnapshot } from "../features/overview/WatchlistSnapshot";
import { RiskPanel } from "../features/risk/RiskPanel";
import { StatCards } from "../features/terminal/StatCards";
import { authStore } from "../stores/authStore";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

export function OverviewPage() {
  const { accountId } = useStoreState(uiStore);
  const { user } = useStoreState(authStore);
  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Trading workspace</p>
          <h1>
            {greeting}, {user?.subject ?? "trader"}
          </h1>
          <p className="page-subtitle">
            {accountId} · live snapshot · simulated brokers — no live trading
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

      <section className="overview-grid" aria-label="Portfolio snapshot">
        <PositionsSummaryCard />
        <OrdersSummaryCard />
        <WatchlistSnapshot />
      </section>

      <section className="overview-grid" aria-label="Account, brokers, and risk">
        <AccountSummaryPanel />
        <BrokerStatusPanel />
        <RiskPanel />
      </section>
    </div>
  );
}
