/**
 * Positions page (M11): positions + account/P&L detail.
 */

import { AccountSummaryPanel } from "../features/account/AccountSummaryPanel";
import { PositionsTable } from "../features/positions/PositionsTable";

export function PositionsPage() {
  return (
    <div className="page-grid">
      <PositionsTable />
      <AccountSummaryPanel />
    </div>
  );
}
