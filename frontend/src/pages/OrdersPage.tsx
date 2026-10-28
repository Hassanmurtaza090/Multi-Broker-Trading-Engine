/**
 * Orders page (M11): order entry (risk-gated ticket) + full order blotter.
 */

import { OrderBlotter } from "../features/orders/OrderBlotter";
import { OrderTicket } from "../features/orders/OrderTicket";
import { RiskPanel } from "../features/risk/RiskPanel";

export function OrdersPage() {
  return (
    <div className="workspace">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Trading workspace</p>
          <h1>Orders</h1>
          <p className="page-subtitle">
            Order entry and blotter — every order is risk-gated server-side
          </p>
        </div>
      </section>
      <div className="page-grid">
        <div>
          <OrderTicket />
          <RiskPanel />
        </div>
        <OrderBlotter />
      </div>
    </div>
  );
}
