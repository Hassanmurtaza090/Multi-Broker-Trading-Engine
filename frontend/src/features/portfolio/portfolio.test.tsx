/**
 * Portfolio & Account Overview tests (M3): account scope/switching (scoped
 * and wildcard users), currency-aware metrics (never summed across
 * currencies; NULL equity explained, never zero-filled), allocation
 * rendering with exclusions, page composition, and navigation shortcuts.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { UserOut } from "../../types/api";
import { AccountsCard } from "./AccountsCard";
import { AllocationCard } from "./AllocationCard";
import { PortfolioMetricsCard } from "./PortfolioMetricsCard";
import { AccountsPage } from "../../pages/AccountsPage";
import { PortfolioPage } from "../../pages/PortfolioPage";
import { accountStore, brokersStore, positionsStore, resetAllStores, uiStore } from "../../stores";
import { keyForPositionOut } from "../../stores/positionsStore";
import { loginForTests, positionOut, TEST_ADMIN, TEST_TRADER } from "../../test/mocks";

const MULTI_ACCOUNT_USER: UserOut = {
  subject: "multi",
  roles: ["trader"],
  accounts: ["ACC-001", "ACC-002"],
  permissions: [
    "orders:read",
    "orders:write",
    "positions:read",
    "account:read",
    "market:read",
    "risk:read",
    "brokers:read",
  ],
};

function seedPositions(rows: Parameters<typeof positionOut>[0][]) {
  const byKey: Record<
    string,
    (typeof rows)[number] extends never ? never : ReturnType<typeof positionOut>
  > = {};
  const keys: string[] = [];
  for (const row of rows) {
    const position = positionOut(row);
    const key = keyForPositionOut(position);
    byKey[key] = position;
    keys.push(key);
  }
  positionsStore.setState({ byKey, keys, loadState: "ready", errorMessage: null });
}

describe("AccountsCard", () => {
  beforeEach(() => resetAllStores());

  it("lists the scoped accounts and switches the active one (re-sync trigger)", async () => {
    await loginForTests(MULTI_ACCOUNT_USER);
    render(<AccountsCard />);
    const active = screen.getByRole("button", { name: /ACC-001/ });
    expect(within(active).getByText("ACTIVE")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ACC-002/ }));
    expect(uiStore.getSnapshot().accountId).toBe("ACC-002");
    expect(
      within(screen.getByRole("button", { name: /ACC-002/ })).getByText("ACTIVE"),
    ).toBeInTheDocument();
  });

  it("offers free entry for wildcard-scope admins (same as the header selector)", async () => {
    await loginForTests(TEST_ADMIN); // accounts: ["*"]
    render(<AccountsCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ACC-001/ }));
    const input = screen.getByLabelText("Account id");
    await user.clear(input);
    await user.type(input, "ACC-009");
    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(uiStore.getSnapshot().accountId).toBe("ACC-009");
  });

  it("shows broker identity with honest connection states", () => {
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [
        { name: "IBKR", connected: true },
        { name: "SAXO", connected: false },
      ],
    }));
    render(<AccountsCard />);
    expect(screen.getByText("IBKR")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("documents the single-account runtime — never claims cross-account aggregation", () => {
    render(<AccountsCard />);
    expect(screen.getByText(/one broker account per runtime/)).toBeInTheDocument();
    expect(screen.getByText(/No cross-account aggregation exists/)).toBeInTheDocument();
  });
});

describe("PortfolioMetricsCard", () => {
  beforeEach(() => resetAllStores());

  it("renders per-currency metrics and NEVER sums across currencies", () => {
    accountStore.update((s) => ({
      ...s,
      balanceState: "ready",
      summaryState: "ready",
      balance: {
        account_id: "ACC-001",
        cash: [
          { currency: "USD", total: "100000.00", available: "99000.00", buying_power: "200000.00" },
          { currency: "EUR", total: "50000.00", available: "48000.00", buying_power: null },
        ],
      },
      summary: {
        account_id: "ACC-001",
        equity: null, // multi-currency accounts: backend returns NULL (ADR-013)
        exposure: "15000.00",
        realized_pnl: { USD: "100.00" },
        unrealized_pnl: { USD: "50.00" },
        market_value: { USD: "1250.00" },
      },
    }));
    render(<PortfolioMetricsCard />);
    // Per-currency labels appear in both the cash and P&L tables — never summed.
    expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EUR").length).toBeGreaterThan(0);
    expect(screen.getByText(/cross-currency totals unavailable/)).toBeInTheDocument();
    // No fabricated cross-currency total (100000 + 50000 must never appear):
    expect(screen.queryByText(/150,?000/)).not.toBeInTheDocument();
    // NULL equity (multi-ccy) is explained, never zero:
    expect(screen.getAllByText(/— not reported/).length).toBeGreaterThan(0);
    expect(screen.getByTitle(/multi-currency accounts have no FX/)).toBeInTheDocument();
    // Buying power null for EUR renders "—", never an invented zero:
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // Metrics carry explanatory tooltips (per-currency rows → multiple):
    expect(screen.getAllByTitle(/Cash available to trade/).length).toBe(2);
    expect(screen.getAllByTitle(/Gross exposure of open positions/).length).toBe(1);
  });

  it("shows explicit missing/loading states", () => {
    accountStore.update((s) => ({
      ...s,
      balanceState: "missing",
      summaryState: "ready",
      summary: {
        account_id: "ACC-001",
        equity: "101250.00",
        exposure: "1500.00",
        realized_pnl: {},
        unrealized_pnl: {},
        market_value: {},
      },
    }));
    const { rerender } = render(<PortfolioMetricsCard />);
    expect(screen.getByText("101,250")).toBeInTheDocument();
    expect(screen.getByText("No balance reported yet.")).toBeInTheDocument();

    resetAllStores();
    rerender(<PortfolioMetricsCard />);
    expect(screen.getByText(/Loading portfolio metrics/)).toBeInTheDocument();
  });

  it("renders an explicit error state with the real message", () => {
    accountStore.update((s) => ({
      ...s,
      balanceState: "error",
      summaryState: "error",
      errorMessage: "account read failed",
    }));
    render(<PortfolioMetricsCard />);
    expect(screen.getByText(/account read failed/)).toBeInTheDocument();
  });
});

describe("AllocationCard", () => {
  beforeEach(() => resetAllStores());

  it("renders per-currency gross allocation with shares and exclusions", () => {
    seedPositions([
      { symbol: "AAPL", quantity: "10", market_price: "151.00" },
      { symbol: "MSFT", quantity: "-5", market_price: "200.00" },
      { symbol: "NOMARK", quantity: "3", market_price: null },
    ]);
    render(<AllocationCard />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("-1,000")).toBeInTheDocument(); // signed short value
    expect(screen.getByText(/unpriced position\(s\) excluded/)).toBeInTheDocument();
    expect(screen.getByText(/never across currencies/)).toBeInTheDocument();
  });

  it("renders explicit empty and unpriced-only states", () => {
    positionsStore.update((s) => ({ ...s, loadState: "ready" }));
    const { rerender } = render(<AllocationCard />);
    expect(screen.getByText("No positions to allocate.")).toBeInTheDocument();

    seedPositions([{ symbol: "NOMARK", quantity: "3", market_price: null }]);
    rerender(<AllocationCard />);
    expect(screen.getByText("No priced positions.")).toBeInTheDocument();
    expect(screen.getByText(/excluded rather than shown as zero/)).toBeInTheDocument();
  });

  it("flags stale marks", () => {
    seedPositions([{ symbol: "AAPL", quantity: "10", market_price: "151.00", stale: true }]);
    render(<AllocationCard />);
    expect(screen.getByText("1 stale")).toBeInTheDocument();
  });
});

describe("AccountsPage (renamed from PortfolioPage in FE-M10)", () => {
  beforeEach(() => resetAllStores());

  it("composes the accounts cards with navigation shortcuts (read-only — no order actions)", async () => {
    await loginForTests(TEST_TRADER);
    render(<AccountsPage />);
    expect(screen.getByRole("heading", { name: "Accounts", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/ACC-001 · simulated brokers/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accounts", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Portfolio metrics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Allocation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brokers" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open Trade" }));
    expect(uiStore.getSnapshot().view).toBe("dashboard");
    await user.click(screen.getByRole("button", { name: "View positions" }));
    expect(uiStore.getSnapshot().view).toBe("positions");
    await user.click(screen.getByRole("button", { name: "Open Portfolio" }));
    expect(uiStore.getSnapshot().view).toBe("portfolio");
    // No order submission/cancel/modify controls exist on this page:
    expect(screen.queryByRole("button", { name: /submit|cancel|modify/i })).not.toBeInTheDocument();
  });
});

describe("PortfolioPage (FE-M10 — the promoted Portfolio destination)", () => {
  beforeEach(() => resetAllStores());

  it("composes metrics, allocation, the positions read model and the design gaps", async () => {
    await loginForTests(TEST_TRADER);
    render(<PortfolioPage />);
    expect(screen.getByRole("heading", { name: "Portfolio", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/ACC-001 · equity, P&L and allocation/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Portfolio metrics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Allocation" })).toBeInTheDocument();
    // Reuses the authoritative positions table rather than forking a second one:
    expect(screen.getByRole("heading", { name: "Positions" })).toBeInTheDocument();

    const gaps = screen.getByRole("region", { name: "Not available in this build" });
    expect(within(gaps).getByText("Day P&L")).toBeInTheDocument();
    expect(within(gaps).getByText("Cross-currency portfolio total")).toBeInTheDocument();
    expect(within(gaps).getByText("Cross-broker account balances table")).toBeInTheDocument();
    // Every gap names the backend work instead of showing a plausible number:
    expect(within(gaps).getByText("B2 — account registry")).toBeInTheDocument();
    // Day P&L and the equity/P&L series share the same backend ask:
    expect(within(gaps).getAllByText("B3 — equity/P&L time series").length).toBeGreaterThan(1);
    expect(within(gaps).getByText("ADR-013 revision plus an FX source")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open Accounts" }));
    expect(uiStore.getSnapshot().view).toBe("accounts");
    // Read-only: no order controls on the Portfolio workspace either.
    expect(screen.queryByRole("button", { name: /submit|cancel|modify/i })).not.toBeInTheDocument();
  });
});
