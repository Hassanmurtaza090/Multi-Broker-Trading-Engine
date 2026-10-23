/**
 * Positions page (M11): positions + account/P&L detail.
 */

import { AccountSummaryPanel } from "../features/account/AccountSummaryPanel";
import { PositionsTable } from "../features/positions/PositionsTable";

export function PositionsPage() {
  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Trading workspace</p>
          <h1>Positions</h1>
          <p className="page-subtitle">
            Live positions and account detail — unpriced values show as "—"
          </p>
        </div>
      </section>
      <div className="page-grid">
        <PositionsTable />
        <AccountSummaryPanel />
      </div>
    </div>
  );
}
