/**
 * Presentation panels (M11): positions, account, risk/kill-switch, watchlist,
 * brokers, and the connection banner — state rendering and interactions.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError, type ApiClient } from "../services/api";
import { ServicesContext } from "../services/context";
import {
  accountStore,
  brokersStore,
  connectionStore,
  marketStore,
  positionsStore,
  resetAllStores,
  riskStore,
  uiStore,
} from "../stores";
import { applyPositionEvent } from "../stores/positionsStore";
import { createMockApi, positionJ, positionOut, quoteOut } from "../test/mocks";
import { instrumentKey } from "../utils/instrument";
import { AccountSummaryPanel } from "./account/AccountSummaryPanel";
import { BrokerStatusPanel } from "./brokers/BrokerStatusPanel";
import { ConnectionBanner } from "./connection/ConnectionBanner";
import { PositionsTable } from "./positions/PositionsTable";
import { RiskPanel } from "./risk/RiskPanel";
import { WatchlistPanel } from "./watchlist/WatchlistPanel";

function withApi(node: ReactElement, api = createMockApi()) {
  return render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      {node}
    </ServicesContext.Provider>,
  );
}

describe("PositionsTable", () => {
  beforeEach(() => resetAllStores());

  it("renders an explicit empty state", () => {
    positionsStore.update((s) => ({ ...s, loadState: "ready" }));
    render(<PositionsTable />);
    expect(screen.getByText("No open positions.")).toBeInTheDocument();
  });

  it("renders rows with signed quantities and P&L coloring", () => {
    positionsStore.update((s) =>
      applyPositionEvent(
        { ...s, loadState: "ready" },
        positionJ({ quantity: { value: "-5" } }),
        false,
      ),
    );
    render(<PositionsTable />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("-5")).toBeInTheDocument();
  });

  it("badges stale market data (never silently fresh)", () => {
    const state = positionsStore.getSnapshot();
    const withStale = { ...positionOut({ stale: true }) };
    positionsStore.setState({
      ...state,
      loadState: "ready",
      byKey: {
        [`${withStale.account_id}|${withStale.symbol}|${withStale.exchange}|${withStale.currency}`]:
          withStale,
      },
      keys: [
        `${withStale.account_id}|${withStale.symbol}|${withStale.exchange}|${withStale.currency}`,
      ],
    });
    render(<PositionsTable />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("renders missing market values as a dash, never an invented zero", () => {
    const state = positionsStore.getSnapshot();
    const unpriced = { ...positionOut({ market_price: null, unrealized_pnl: null }) };
    positionsStore.setState({
      ...state,
      loadState: "ready",
      byKey: { k1: unpriced },
      keys: ["k1"],
    });
    render(<PositionsTable />);
    expect(screen.queryByText("0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("AccountSummaryPanel", () => {
  beforeEach(() => resetAllStores());

  it("shows 'no balance reported' for the 404 missing state (distinct from error)", () => {
    accountStore.update((s) => ({ ...s, balanceState: "missing", summaryState: "missing" }));
    render(<AccountSummaryPanel />);
    expect(screen.getByText("No balance reported yet.")).toBeInTheDocument();
  });

  it("renders balances and a P&L summary", () => {
    accountStore.update((s) => ({
      ...s,
      balanceState: "ready",
      summaryState: "ready",
      balance: {
        account_id: "ACC-001",
        cash: [
          { currency: "USD", total: "100000.00", available: "99000.00", buying_power: "200000.00" },
        ],
      },
      summary: {
        account_id: "ACC-001",
        equity: "101250.00",
        exposure: "1502.50",
        realized_pnl: { USD: "125.00" },
        unrealized_pnl: { USD: "7.50" },
        market_value: { USD: "1250.00" },
      },
    }));
    render(<AccountSummaryPanel />);
    expect(screen.getByText("100,000")).toBeInTheDocument();
    expect(screen.getByText("Equity")).toBeInTheDocument();
    expect(screen.getByText("101,250")).toBeInTheDocument();
    expect(screen.getByText("Realized P&L (USD)")).toBeInTheDocument();
  });
});

describe("RiskPanel", () => {
  beforeEach(() => resetAllStores());

  it("toggles the kill switch only after confirmation", async () => {
    const api = createMockApi();
    api.setKillSwitch.mockResolvedValueOnce({ account_id: "ACC-001", active: true });
    accountStore.update((s) => ({ ...s, killSwitchActive: false, killSwitchState: "ready" }));
    withApi(<RiskPanel />, api);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Activate kill switch" }));
    expect(api.setKillSwitch).not.toHaveBeenCalled(); // confirmation required

    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activate" }));

    await screen.findByText("KILL SWITCH ACTIVE");
    expect(api.setKillSwitch).toHaveBeenCalledWith("ACC-001", true);
    expect(accountStore.getSnapshot().killSwitchActive).toBe(true);
  });

  it("keeps state and reports the error when the toggle fails", async () => {
    const api = createMockApi();
    api.setKillSwitch.mockRejectedValueOnce(
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "fetch failed" }),
    );
    accountStore.update((s) => ({ ...s, killSwitchActive: false, killSwitchState: "ready" }));
    withApi(<RiskPanel />, api);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Activate kill switch" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Activate" }),
    );
    await screen.findByRole("alert");
    expect(accountStore.getSnapshot().killSwitchActive).toBe(false);
  });

  it("renders the risk violation feed", () => {
    riskStore.update(() => ({
      violations: [
        {
          eventId: "evt-v1",
          accountId: "ACC-001",
          rule: "max_order_size",
          message: "exceeds 100",
          symbol: "AAPL",
          timestamp: "2026-09-27T10:00:00+00:00",
        },
      ],
    }));
    accountStore.update((s) => ({ ...s, killSwitchActive: false }));
    render(<RiskPanel />);
    expect(screen.getByText("max_order_size")).toBeInTheDocument();
    expect(screen.getByText(/exceeds 100/)).toBeInTheDocument();
  });
});

describe("WatchlistPanel", () => {
  beforeEach(() => resetAllStores());

  it("starts with an empty state and an explicit 'add demo' affordance", async () => {
    render(<WatchlistPanel />);
    expect(screen.getByText("Watchlist is empty.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add AAPL \(demo\)/ }));
    expect(screen.getByTestId("watch-AAPL")).toBeInTheDocument();
  });

  it("adds and removes instruments", async () => {
    render(<WatchlistPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ Watch" }));
    await user.type(screen.getByLabelText("Symbol"), "msft");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const key = instrumentKey({
      symbol: "MSFT",
      asset_class: "EQUITY",
      currency: "USD",
      exchange: "UNKNOWN",
    });
    expect(instrumentKey(marketStore.getSnapshot().watchlist[0])).toBe(key);
    expect(screen.getByTestId("watch-MSFT")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove MSFT from watchlist" }));
    expect(screen.queryByTestId("watch-MSFT")).not.toBeInTheDocument();
  });

  it("shows quotes and live/stale badges", async () => {
    const { applyQuoteOut } = await import("../stores/marketStore");
    const descriptor = {
      symbol: "AAPL",
      asset_class: "EQUITY",
      currency: "USD",
      exchange: "NASDAQ",
    };
    marketStore.update((s) =>
      applyQuoteOut(
        { ...s, watchlist: [descriptor] },
        descriptor,
        quoteOut({ last: "150.25", stale: true }),
      ),
    );
    render(<WatchlistPanel />);
    expect(screen.getByText("150.25")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });
});

describe("BrokerStatusPanel", () => {
  beforeEach(() => resetAllStores());

  it("renders per-broker connectivity, including multiple brokers", () => {
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [
        { name: "IBKR", connected: true },
        { name: "SAXO", connected: false },
      ],
    }));
    render(<BrokerStatusPanel />);
    expect(screen.getByText("IBKR")).toBeInTheDocument();
    expect(screen.getByText("SAXO")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});

describe("ConnectionBanner", () => {
  beforeEach(() => resetAllStores());

  it("is hidden while connected", () => {
    connectionStore.update((s) => ({ ...s, state: "CONNECTED" }));
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns while reconnecting with the attempt count", () => {
    connectionStore.update((s) => ({ ...s, state: "RECONNECTING", attempt: 3 }));
    render(<ConnectionBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(/attempt 3/);
  });

  it("signals staleness risk while disconnected", () => {
    connectionStore.update((s) => ({ ...s, state: "DISCONNECTED" }));
    render(<ConnectionBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(/may be stale/);
  });
});

describe("view state", () => {
  beforeEach(() => resetAllStores());

  it("defaults to the dashboard on ACC-001 (or VITE_ACCOUNT_ID)", () => {
    expect(uiStore.getSnapshot().view).toBe("dashboard");
    expect(uiStore.getSnapshot().accountId).toBe("ACC-001");
  });
});
