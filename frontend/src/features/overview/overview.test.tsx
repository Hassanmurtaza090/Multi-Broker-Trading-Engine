/**
 * M2 Dashboard (Overview) tests: greeting, real-data summaries, explicit
 * empty/loading states, and the navigation shortcuts (no order execution
 * lives on the Dashboard).
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { OverviewPage } from "../../pages/OverviewPage";
import { ordersStore, positionsStore, resetAllStores, marketStore, uiStore } from "../../stores";
import { applyPositionEvent } from "../../stores/positionsStore";
import {
  createMockApi,
  loginForTests,
  orderOut,
  positionJ,
  quoteOut,
  TEST_TRADER,
} from "../../test/mocks";
import { OrdersSummaryCard } from "./OrdersSummaryCard";
import { PositionsSummaryCard } from "./PositionsSummaryCard";
import { WatchlistSnapshot } from "./WatchlistSnapshot";

const AAPL = { symbol: "AAPL", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" };

describe("OverviewPage (Dashboard)", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("greets the signed-in user and shows the real account context", async () => {
    await loginForTests(TEST_TRADER);
    render(<OverviewPage />);
    expect(
      screen.getByRole("heading", { name: /Good (morning|afternoon|evening), trader/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ACC-001 · live snapshot/)).toBeInTheDocument();
  });

  it("shows explicit empty states once loaded with no data", async () => {
    await loginForTests(TEST_TRADER);
    act(() => {
      positionsStore.update((s) => ({ ...s, loadState: "ready" }));
      ordersStore.update((s) => ({ ...s, loadState: "ready" }));
    });
    render(<OverviewPage />);
    expect(screen.getByText("No open positions.")).toBeInTheDocument();
    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
    expect(screen.getByText("Watchlist is empty.")).toBeInTheDocument();
  });

  it("navigates to the Trade screen (ticket focus) from New order", async () => {
    await loginForTests(TEST_TRADER);
    render(<OverviewPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /New order/i }));
    expect(uiStore.getSnapshot().view).toBe("dashboard");
  });

  it("composes the reused M11/M1 panels (account, brokers, risk)", async () => {
    await loginForTests(TEST_TRADER);
    render(<OverviewPage />);
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brokers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Risk" })).toBeInTheDocument();
  });
});

describe("PositionsSummaryCard", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("summarizes open positions from the store and links to the full view", async () => {
    await loginForTests(TEST_TRADER);
    act(() => {
      positionsStore.update((s) =>
        applyPositionEvent(
          { ...s, loadState: "ready" },
          positionJ({
            unrealized_pnl: { amount: "12.50", currency: { code: "USD" } },
          }),
          false,
        ),
      );
    });
    render(<PositionsSummaryCard />);
    expect(
      screen.getByText((_, element) => element?.textContent === "1 open position"),
    ).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View positions" }));
    expect(uiStore.getSnapshot().view).toBe("positions");
  });

  it("renders an explicit empty state (never invented rows)", async () => {
    await loginForTests(TEST_TRADER);
    positionsStore.update((s) => ({ ...s, loadState: "ready" }));
    render(<PositionsSummaryCard />);
    expect(screen.getByText("No open positions.")).toBeInTheDocument();
  });
});

describe("OrdersSummaryCard", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("counts working orders, lists recent activity, and links to Orders", async () => {
    await loginForTests(TEST_TRADER);
    ordersStore.update((s) => ({
      ...s,
      loadState: "ready",
      byId: {
        "o-open": orderOut({ client_order_id: "o-open", status: "SUBMITTED", symbol: "AAPL" }),
        "o-done": orderOut({ client_order_id: "o-done", status: "FILLED", symbol: "MSFT" }),
      },
      ids: ["o-open", "o-done"],
    }));
    render(<OrdersSummaryCard />);
    expect(
      screen.getByText((_, element) => element?.textContent === "1 working · 2 total"),
    ).toBeInTheDocument();
    expect(screen.getByText("SUBMITTED")).toBeInTheDocument();
    expect(screen.getByText("FILLED")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View orders" }));
    expect(uiStore.getSnapshot().view).toBe("orders");
  });

  it("renders an explicit empty state", () => {
    ordersStore.update((s) => ({ ...s, loadState: "ready" }));
    render(<OrdersSummaryCard />);
    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
  });
});

describe("WatchlistSnapshot", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("renders live quotes and jumps to Trade with the instrument selected", async () => {
    await loginForTests(TEST_TRADER);
    const { applyQuoteOut } = await import("../../stores/marketStore");
    act(() => {
      marketStore.update((s) => applyQuoteOut({ ...s, watchlist: [AAPL] }, AAPL, quoteOut()));
    });
    render(<WatchlistSnapshot />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("150.25")).toBeInTheDocument();
    expect(screen.getByText(/Polled|Live/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    expect(uiStore.getSnapshot().view).toBe("dashboard");
    expect(uiStore.getSnapshot().selectedInstrument?.symbol).toBe("AAPL");
  });

  it("renders an explicit empty state with a shortcut to Trade", async () => {
    await loginForTests(TEST_TRADER);
    render(<WatchlistSnapshot />);
    expect(screen.getByText("Watchlist is empty.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open Trade" }));
    expect(uiStore.getSnapshot().view).toBe("dashboard");
  });
});

describe("mock api sanity (the overview consumes no additional endpoints)", () => {
  it("exposes the same M10 surface — no invented endpoints", () => {
    const api = createMockApi();
    const methods = Object.keys(api).sort();
    expect(methods).toContain("getAccountSummary");
    expect(methods).toContain("listPositions");
    expect(methods).toContain("listOrders");
    expect(methods).toContain("listBrokers");
    expect(methods).toContain("getKillSwitch");
    // No activity/executions/strategies/analytics endpoints exist or are used.
    expect(methods).not.toContain("listActivity");
    expect(methods).not.toContain("getExecutions");
  });
});
