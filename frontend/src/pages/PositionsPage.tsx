/**
 * Positions page (M11 → M4): the full positions management view.
 *
 * M4 layout: the enhanced sortable/filterable PositionsTable gets full
 * width (9 columns); account detail and broker context sit below. The page
 * title row keeps the workspace conventions.
 */

import { AccountSummaryPanel } from "../features/account/AccountSummaryPanel";
import { BrokerStatusPanel } from "../features/brokers/BrokerStatusPanel";
import { PositionsTable } from "../features/positions/PositionsTable";
import { gotoOrderTicket } from "../features/orders/gotoOrderTicket";
import { uiStore } from "../stores";
import { useStoreState } from "../stores/store";

export function PositionsPage() {
  const { accountId } = useStoreState(uiStore);

  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Trading workspace</p>
          <h1>Positions</h1>
          <p className="page-subtitle">
            {accountId} · live positions — unpriced values show as "—", never an invented zero
          </p>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => uiStore.update((s) => ({ ...s, view: "accounts" }))}
            title="Open the Portfolio & Account Overview"
          >
            Portfolio
          </button>
          <button type="button" className="primary" onClick={gotoOrderTicket}>
            New order
          </button>
        </div>
      </section>

      <PositionsTable />

      <section className="overview-grid-2" aria-label="Account and broker detail">
        <AccountSummaryPanel />
        <BrokerStatusPanel />
      </section>
    </div>
  );
}
