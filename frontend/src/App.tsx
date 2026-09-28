/**
 * Trading terminal root (M11).
 *
 * Composition: ServicesContext carries the M10 API client (production: same
 * origin, Vite-dev-proxied); `useTerminal` wires the WS stream + REST resync
 * into the stores exactly once for the app lifetime. Optional props allow
 * tests to inject a mock API client / socket factory.
 */

import { useMemo } from "react";

import { useTerminal } from "./hooks/useTerminal";
import { TerminalLayout } from "./layouts/TerminalLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { OrdersPage } from "./pages/OrdersPage";
import { PositionsPage } from "./pages/PositionsPage";
import { createTerminalServices, ServicesContext, type TerminalServices } from "./services/context";
import type { WebSocketFactory } from "./services/ws";
import { uiStore } from "./stores";
import { useStoreState } from "./stores/store";

interface AppProps {
  services?: TerminalServices;
  socketFactory?: WebSocketFactory;
}

export default function App({ services, socketFactory }: AppProps) {
  const resolved = useMemo(() => services ?? createTerminalServices(), [services]);
  useTerminal({ api: resolved.api, socketFactory });

  const { view } = useStoreState(uiStore);

  return (
    <ServicesContext.Provider value={resolved}>
      <TerminalLayout>
        {view === "dashboard" ? (
          <DashboardPage />
        ) : view === "orders" ? (
          <OrdersPage />
        ) : (
          <PositionsPage />
        )}
      </TerminalLayout>
    </ServicesContext.Provider>
  );
}
