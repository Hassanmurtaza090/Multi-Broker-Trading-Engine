/**
 * Trading terminal root (M11/M12).
 *
 * M12: the app is authentication-gated — unauthenticated users see only the
 * login view; the terminal (and its WS/REST wiring) mounts AFTER a session
 * exists. Session expiry mid-flight flips the store to `logged_out` and
 * unmounts the terminal (all sockets/queries cleaned up via effect cleanup).
 *
 * Composition: ServicesContext carries the M10 API client with the auth
 * session attached (bearer + 401-refresh); `useTerminal` wires the WS stream
 * + REST resync into the stores exactly once per login.
 */

import { useMemo } from "react";

import { useTerminal } from "./hooks/useTerminal";
import { TerminalLayout } from "./layouts/TerminalLayout";
import { AccountsPage } from "./pages/AccountsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { AdministrationPage } from "./pages/AdministrationPage";
import { BrokerConnectionsPage } from "./pages/BrokerConnectionsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MarketsPage } from "./pages/MarketsPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { PositionsPage } from "./pages/PositionsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RiskPage } from "./pages/RiskPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StrategiesPage } from "./pages/StrategiesPage";
import { createTerminalServices, ServicesContext, type TerminalServices } from "./services/context";
import type { WebSocketFactory } from "./services/ws";
import { authStore } from "./stores/authStore";
import { uiStore } from "./stores";
import { useStoreState } from "./stores/store";
import { LoginView } from "./features/auth/LoginView";
import type { TerminalView } from "./stores/uiStore";

interface AppProps {
  services?: TerminalServices;
  socketFactory?: WebSocketFactory;
}

export default function App({ services, socketFactory }: AppProps) {
  const resolved = useMemo(() => services ?? createTerminalServices(), [services]);
  const auth = useStoreState(authStore);
  const { view } = useStoreState(uiStore);

  return (
    <ServicesContext.Provider value={resolved}>
      {auth.status !== "logged_in" ? (
        <LoginView />
      ) : (
        <TerminalOnceLoggedIn services={resolved} socketFactory={socketFactory} view={view} />
      )}
    </ServicesContext.Provider>
  );
}

/** Mounts the terminal (and its socket wiring) only while authenticated.
 *  Extracted so the WS effect starts/stops exactly with the session. */
function TerminalOnceLoggedIn({
  services,
  socketFactory,
  view,
}: {
  services: TerminalServices;
  socketFactory?: WebSocketFactory;
  view: TerminalView;
}) {
  useTerminal({ api: services.api, socketFactory });
  return (
    <TerminalLayout>
      {view === "dashboard" ? (
        <DashboardPage />
      ) : view === "orders" ? (
        <OrdersPage />
      ) : view === "positions" ? (
        <PositionsPage />
      ) : view === "overview" ? (
        <OverviewPage />
      ) : view === "activity" ? (
        <ActivityPage />
      ) : view === "markets" ? (
        <MarketsPage />
      ) : view === "strategies" ? (
        <StrategiesPage />
      ) : view === "risk" ? (
        <RiskPage />
      ) : view === "brokers" ? (
        <BrokerConnectionsPage />
      ) : view === "accounts" ? (
        <AccountsPage />
      ) : view === "portfolio" ? (
        <PortfolioPage />
      ) : view === "reports" ? (
        <ReportsPage />
      ) : view === "administration" ? (
        <AdministrationPage />
      ) : view === "settings" ? (
        <SettingsPage />
      ) : (
        // Unreachable for the current `TerminalView` union; Overview is the
        // safe read-only landing view if a new view id is ever added.
        <OverviewPage />
      )}
    </TerminalLayout>
  );
}
