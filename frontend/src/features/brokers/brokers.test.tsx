/**
 * Broker Connections & Account Management tests (FE-M9).
 *
 * These tests verify the honest capability-reporting page:
 * - Live broker status from GET /brokers (no connect/disconnect)
 * - Current account details from summary/balance
 * - Known broker capabilities (IBKR, Saxo) with simulated limitations
 * - Backend gaps table with exact required work
 * - No fabricated connections, credentials, or account data
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ServicesContext } from "../../services/context";
import type { ApiClient } from "../../services/api";
import type { AccountSummaryOut, BalanceOut } from "../../types/api";
import { accountStore, brokersStore, resetAllStores } from "../../stores";
import { loginForTests, createMockApi, TEST_TRADER } from "../../test/mocks";
import { BrokerConnectionsPage } from "../../pages/BrokerConnectionsPage";

function withApi(node: ReactElement, api = createMockApi()) {
  return render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      {node}
    </ServicesContext.Provider>,
  );
}

const FULL_SUMMARY: AccountSummaryOut = {
  account_id: "ACC-001",
  equity: "100000.00",
  exposure: "25000.00",
  realized_pnl: { USD: "120.00" },
  unrealized_pnl: { USD: "50.00", EUR: "10.00" },
  market_value: { USD: "25000.00" },
};

const FULL_BALANCE: BalanceOut = {
  account_id: "ACC-001",
  cash: [
    { currency: "USD", total: "100000.00", available: "99000.00", buying_power: "200000.00" },
    { currency: "EUR", total: "5000.00", available: "4500.00", buying_power: null },
  ],
};

describe("BrokerConnectionsPage", () => {
  beforeEach(() => resetAllStores());

  it("shows loading state while broker status is in flight", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({ ...s, loadState: "loading" }));
    withApi(<BrokerConnectionsPage />);
    expect(screen.getByText("Contacting gateway…")).toBeInTheDocument();
  });

  it("shows error state when broker status fails", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({ ...s, loadState: "error", errorMessage: "gateway down" }));
    withApi(<BrokerConnectionsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("gateway down");
  });

  it("shows empty state when no brokers configured", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({ ...s, loadState: "ready", brokers: [] }));
    withApi(<BrokerConnectionsPage />);
    expect(screen.getByText("No broker configured.")).toBeInTheDocument();
  });

  it("renders live broker status with connection badge", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    withApi(<BrokerConnectionsPage />);

    // Check the broker status panel specifically
    const statusPanel = screen.getByRole("region", { name: "Runtime Broker Status" });
    expect(within(statusPanel).getByText("IBKR")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Adapter: IbkrAdapter")).toBeInTheDocument();
    expect(within(statusPanel).getByText("simulated")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Connected")).toBeInTheDocument();
  });

  it("shows disconnected badge when broker is down", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "SAXO", connected: false }],
    }));
    withApi(<BrokerConnectionsPage />);

    // Check the broker status table specifically
    const statusPanel = screen.getByRole("region", { name: "Runtime Broker Status" });
    expect(within(statusPanel).getByText("SAXO")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows account equity, exposure, and per-currency P&L", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));
    withApi(<BrokerConnectionsPage />);

    expect(screen.getByText("100,000")).toBeInTheDocument(); // equity
    expect(screen.getByText("25,000")).toBeInTheDocument(); // exposure
    // P&L shows USD and EUR (multiple occurrences across sections)
    expect(screen.getAllByText("USD").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("EUR").length).toBeGreaterThanOrEqual(2);
    // Per-currency P&L shown separately, never summed
    expect(screen.queryByText("180")).not.toBeInTheDocument(); // 120 + 50 + 10 = 180 (would be wrong sum)
  });

  it("shows balance with total/available/buying-power per currency", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));

    const api = createMockApi();
    api.getBalance.mockResolvedValueOnce(FULL_BALANCE);

    withApi(<BrokerConnectionsPage />, api);

    // Wait for loading to complete and data to appear
    await waitFor(() => {
      expect(screen.getByText("100,000")).toBeInTheDocument(); // USD total (from equity or balance)
    });
    // Now check the balance-specific data
    await waitFor(() => {
      expect(screen.getByText("Cash Balances")).toBeInTheDocument();
      expect(screen.getByText("99,000")).toBeInTheDocument(); // USD available
      expect(screen.getByText("200,000")).toBeInTheDocument(); // USD buying power
      expect(screen.getByText("5,000")).toBeInTheDocument(); // EUR total
      expect(screen.getByText("4,500")).toBeInTheDocument(); // EUR available
      expect(screen.getByText("—")).toBeInTheDocument(); // EUR buying power is null
    });
  });

  it("shows kill switch state from the store", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({
      ...s,
      summary: FULL_SUMMARY,
      summaryState: "ready",
      killSwitchActive: true,
      killSwitchState: "ready",
    }));
    withApi(<BrokerConnectionsPage />);

    expect(screen.getByText("KILL SWITCH ACTIVE")).toBeInTheDocument();
    expect(screen.getByText(/active/)).toBeInTheDocument();
  });

  it("renders known broker capabilities for IBKR and Saxo", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));
    withApi(<BrokerConnectionsPage />);

    expect(screen.getByText("Known Broker Capabilities")).toBeInTheDocument();
    // Check capabilities section specifically
    const capabilitiesPanel = screen.getByRole("region", { name: "Known Broker Capabilities" });
    // Just verify the section headers are present (they appear twice - once per broker card)
    expect(within(capabilitiesPanel).getAllByText("Asset Classes")).toHaveLength(2);
    expect(within(capabilitiesPanel).getAllByText("Order Types")).toHaveLength(2);
    expect(within(capabilitiesPanel).getAllByText("Market Data")).toHaveLength(2);
    expect(within(capabilitiesPanel).getAllByText("Account Data")).toHaveLength(2);
    expect(within(capabilitiesPanel).getAllByText("Execution")).toHaveLength(2);
    expect(within(capabilitiesPanel).getAllByText("Environments")).toHaveLength(2);
    expect(within(capabilitiesPanel).getAllByText("Simulated Limitations")).toHaveLength(2);
    // Verify IBKR card is current, Saxo is not
    const ibkrElements = within(capabilitiesPanel).getAllByText("IBKR");
    const saxoElements = within(capabilitiesPanel).getAllByText("SAXO");
    expect(ibkrElements.length).toBeGreaterThan(0);
    expect(saxoElements.length).toBeGreaterThan(0);
    const ibkrCard = ibkrElements[0].closest("article");
    const saxoCard = saxoElements[0].closest("article");
    expect(ibkrCard).toBeInTheDocument();
    expect(saxoCard).toBeInTheDocument();
    expect(ibkrCard).toHaveClass("current");
    expect(saxoCard).not.toHaveClass("current");
  });

  it("highlights the currently active broker", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "SAXO", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));
    withApi(<BrokerConnectionsPage />);

    // Saxo should be marked ACTIVE in the capabilities section
    const capabilitiesPanel = screen.getByRole("region", { name: "Known Broker Capabilities" });
    const saxoElements = within(capabilitiesPanel).getAllByText("SAXO");
    expect(saxoElements.length).toBeGreaterThan(0);
    const saxoCard = saxoElements[0].closest("article");
    expect(saxoCard).toBeInTheDocument();
    expect(saxoCard).toHaveClass("current");
    expect(within(saxoCard!).getByText("ACTIVE")).toBeInTheDocument();
  });

  it("shows backend gaps table with exact required work", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));
    withApi(<BrokerConnectionsPage />);

    expect(screen.getByText("Not Supported by This Backend")).toBeInTheDocument();
    expect(screen.getByText("Broker connect / disconnect")).toBeInTheDocument();
    expect(screen.getByText("Credential management")).toBeInTheDocument();
    expect(screen.getByText("Account registry / multi-account")).toBeInTheDocument();
    expect(screen.getByText("Broker health details")).toBeInTheDocument();
    expect(screen.getByText("Live broker switching")).toBeInTheDocument();

    // Check required work descriptions
    expect(screen.getByText(/POST \/api\/v1\/brokers\/connect/)).toBeInTheDocument();
    expect(screen.getByText(/credential vault/)).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/v1\/accounts/)).toBeInTheDocument();
    expect(screen.getByText(/last_health_check/)).toBeInTheDocument();
    expect(screen.getByText(/POST \/api\/v1\/runtime\/broker/)).toBeInTheDocument();
  });

  it("never shows a connect or disconnect button", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));
    withApi(<BrokerConnectionsPage />);

    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /link account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add account/i })).not.toBeInTheDocument();
  });

  it("shows balance loading state before data arrives", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));

    const api = createMockApi();
    let resolveBalance: (value: BalanceOut) => void;
    api.getBalance.mockReturnValueOnce(
      new Promise<BalanceOut>((resolve) => {
        resolveBalance = resolve;
      }),
    );

    withApi(<BrokerConnectionsPage />, api);

    expect(screen.getByText("Loading balance…")).toBeInTheDocument();

    resolveBalance!(FULL_BALANCE);
    await waitFor(() => expect(screen.getByText("Cash Balances")).toBeInTheDocument());
  });

  it("shows balance error state without fabricating data", async () => {
    await loginForTests(TEST_TRADER);
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    accountStore.update((s) => ({ ...s, summary: FULL_SUMMARY, summaryState: "ready" }));

    const api = createMockApi();
    api.getBalance.mockRejectedValueOnce(new Error("balance service down"));

    withApi(<BrokerConnectionsPage />, api);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("balance service down");
    });
    // Equity from summary is still shown (correct - it came from a successful summary load)
    // Only the balance section should show the error
    expect(screen.getByText("Cash Balances")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
