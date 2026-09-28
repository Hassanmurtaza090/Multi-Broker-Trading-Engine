/**
 * Orders page (M11): order entry (risk-gated ticket) + full order blotter.
 */

import { OrderBlotter } from "../features/orders/OrderBlotter";
import { OrderTicket } from "../features/orders/OrderTicket";
import { RiskPanel } from "../features/risk/RiskPanel";

export function OrdersPage() {
  return (
    <div className="page-grid">
      <div>
        <OrderTicket />
        <RiskPanel />
      </div>
      <OrderBlotter />
    </div>
  );
}
