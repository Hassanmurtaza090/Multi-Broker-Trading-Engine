/**
 * M1 trading-terminal components: statistics cards, chart workspace, the
 * positions/orders tabs card, and the new shared primitives (Icon,
 * SegmentedControl). Asserts the honesty contract too: unreported values
 * render "—", never invented zeros.
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { Icon } from "../../components/Icon";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ApiClient } from "../../services/api";
import { ServicesContext } from "../../services/context";
import {
  accountStore,
  connectionStore,
  marketStore,
  ordersStore,
  positionsStore,
  resetAllStores,
  uiStore,
} from "../../stores";
import { applyQuoteJ } from "../../stores/marketStore";
import { applyPositionEvent } from "../../stores/positionsStore";
import { createMockApi, orderOut, positionJ, quoteJ } from "../../test/mocks";
import { ChartWorkspace } from "./ChartWorkspace";
import { PositionsTabsCard } from "./PositionsTabsCard";
import { StatCards } from "./StatCards";

const AAPL = { symbol: "AAPL", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" };

function withApi(node: ReactElement, api = createMockApi()) {
  return render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      {node}
    </ServicesContext.Provider>,
  );
}

describe("Icon (Figma icon set)", () => {
  it("renders inline svgs at the requested size, hidden from assistive tech", () => {
    const { container } = render(
      <>
        <Icon name="chart" />
        <Icon name="orders" size={14} />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toHaveAttribute("aria-hidden", "true");
    expect(svgs[1]).toHaveAttribute("width", "14");
  });
});

describe("SegmentedControl", () => {
  it("behaves as an accessible radiogroup", async () => {
    function Demo() {
      const [value, setValue] = useState("LIMIT");
      return (
        <SegmentedControl
          aria-label="Type"
          name="type"
          value={value}
          onChange={setValue}
          options={[
            { value: "MARKET", label: "MARKET" },
            { value: "LIMIT", label: "LIMIT" },
          ]}
        />
      );
    }
    render(<Demo />);
    const group = screen.getByRole("radiogroup", { name: "Type" });
    expect(within(group).getByRole("radio", { name: "MARKET" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(group).getByRole("radio", { name: "LIMIT" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const user = userEvent.setup();
    await user.click(within(group).getByRole("radio", { name: "MARKET" }));
    expect(within(group).getByRole("radio", { name: "MARKET" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("StatCards", () => {
  beforeEach(() => resetAllStores());

  it("renders the REAL account summary values with exact formatting", () => {
    accountStore.update((s) => ({
      ...s,
      balanceState: "ready",
      summaryState: "ready",
      balance: {
        account_id: "ACC-001",
        cash: [
          { currency: "USD", total: "100000.00", available: "99000.00", buying_power: "128450.00" },
        ],
      },
      summary: {
        account_id: "ACC-001",
        equity: "284692.48",
        exposure: "56242.48",
        realized_pnl: { USD: "1240.80" },
        unrealized_pnl: { USD: "3580.40" },
        market_value: { USD: "1250.00" },
      },
    }));
    connectionStore.update((s) => ({ ...s, state: "CONNECTED" }));
    render(<StatCards />);
    expect(screen.getByText("Total portfolio value")).toBeInTheDocument();
    expect(screen.getByText("284,692.48")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument(); // real stream state
    expect(screen.getByText("4,821.2")).toBeInTheDocument(); // exact 1240.80 + 3580.40
    expect(screen.getByText(/1,240\.8/)).toBeInTheDocument();
    expect(screen.getByText(/3,580\.4/)).toBeInTheDocument();
    expect(screen.getByText("128,450")).toBeInTheDocument(); // buying power
  });

  it("degrades the LIVE badge to REST while the stream is down", () => {
    accountStore.update((s) => ({ ...s, balanceState: "missing", summaryState: "ready" }));
    render(<StatCards />);
    expect(screen.getByText("REST")).toBeInTheDocument();
  });

  it("renders — for unreported values, never invented zeros", () => {
    accountStore.update((s) => ({
      ...s,
      balanceState: "missing",
      summaryState: "ready",
      summary: null,
    }));
    render(<StatCards />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.00")).not.toBeInTheDocument();
  });

  it("shows an explicit error state when the account read fails", () => {
    accountStore.update((s) => ({
      ...s,
      summaryState: "error",
      errorMessage: "account read failed",
    }));
    render(<StatCards />);
    expect(screen.getByText(/account read failed/)).toBeInTheDocument();
  });
});

describe("ChartWorkspace", () => {
  beforeEach(() => resetAllStores());

  it("shows an explicit empty state with no instrument selected", () => {
    render(<ChartWorkspace />);
    expect(screen.getByText("No instrument selected.")).toBeInTheDocument();
  });

  it("draws only observed prices and disables unavailable controls", () => {
    uiStore.update((s) => ({ ...s, selectedInstrument: AAPL }));
    const now = Date.now();
    act(() => {
      marketStore.update((s) =>
        applyQuoteJ(
          s,
          quoteJ({
            last: { value: "150.25", currency: { code: "USD" } },
            timestamp: new Date(now - 2000).toISOString(),
          }),
          now,
        ),
      );
      marketStore.update((s) =>
        applyQuoteJ(
          s,
          quoteJ({
            last: { value: "151.00", currency: { code: "USD" } },
            timestamp: new Date(now - 1000).toISOString(),
          }),
          now,
        ),
      );
      marketStore.update((s) => ({ ...s, clockTick: now }));
    });
    const { container } = render(<ChartWorkspace />);
    expect(container.querySelector(".chart-line")).not.toBeNull();
    expect(container.querySelector(".last-price")?.textContent).toBe("151");
    // No subscribe API → the timeframe controls are honestly disabled.
    const timeframe = container.querySelector<HTMLButtonElement>(".timeframes button");
    expect(timeframe?.disabled).toBe(true);
    // Real staleness readout, not a decorative one.
    const dataNote = container.querySelector(".chart-footer b");
    expect(dataNote?.textContent).toContain("MARKET DATA");
    expect(dataNote?.textContent).toContain("FRESH");
  });

  it("flags stale market data in the footer", () => {
    uiStore.update((s) => ({ ...s, selectedInstrument: AAPL }));
    act(() => {
      marketStore.update((s) =>
        applyQuoteJ(
          s,
          quoteJ({ last: { value: "150.25", currency: { code: "USD" } } }),
          Date.now(),
        ),
      );
    });
    const { container } = render(<ChartWorkspace />);
    expect(container.querySelector(".chart-footer b")?.textContent).toContain("STALE");
  });

  it("waits explicitly when the instrument has no price history yet", () => {
    uiStore.update((s) => ({ ...s, selectedInstrument: AAPL }));
    render(<ChartWorkspace />);
    expect(screen.getByText(/Waiting for price data/)).toBeInTheDocument();
  });
});

describe("PositionsTabsCard", () => {
  beforeEach(() => resetAllStores());

  it("defaults to the live Orders tab so WS-driven fills stay visible without refresh", () => {
    ordersStore.update((s) => ({
      ...s,
      loadState: "ready",
      byId: {
        "o-open": orderOut({ client_order_id: "o-open", status: "SUBMITTED", symbol: "AAPL" }),
        "o-done": orderOut({ client_order_id: "o-done", status: "FILLED", symbol: "MSFT" }),
      },
      ids: ["o-open", "o-done"],
    }));
    withApi(<PositionsTabsCard />);
    expect(screen.getByRole("tab", { name: "Orders" })).toHaveAttribute("aria-selected", "true");
    // The live blotter shows working AND terminal rows: a confirmed cancel or
    // fill stays visible (the M13 terminal contract).
    expect(screen.getByText("SUBMITTED")).toBeInTheDocument();
    expect(screen.getByText("FILLED")).toBeInTheDocument();
    // The badge is the REAL working-order count.
    expect(within(screen.getByRole("tab", { name: "Orders" })).getByText("1")).toBeInTheDocument();
  });

  it("switches to history and positions tabs with live content", async () => {
    ordersStore.update((s) => ({
      ...s,
      loadState: "ready",
      byId: {
        "o-open": orderOut({ client_order_id: "o-open", status: "SUBMITTED", symbol: "AAPL" }),
        "o-done": orderOut({ client_order_id: "o-done", status: "FILLED", symbol: "MSFT" }),
      },
      ids: ["o-open", "o-done"],
    }));
    positionsStore.update((s) =>
      applyPositionEvent({ ...s, loadState: "ready" }, positionJ(), false),
    );

    withApi(<PositionsTabsCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Order history" }));
    expect(screen.getByText("FILLED")).toBeInTheDocument();
    expect(screen.queryByText("SUBMITTED")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Positions" }));
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument(); // signed quantity from the row
  });

  it("Expand view navigates to the full-screen page for the active tab", async () => {
    withApi(<PositionsTabsCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Expand view/i }));
    expect(uiStore.getSnapshot().view).toBe("orders"); // active tab is Open orders

    await user.click(screen.getByRole("tab", { name: "Positions" }));
    await user.click(screen.getByRole("button", { name: /Expand view/i }));
    expect(uiStore.getSnapshot().view).toBe("positions");
  });
});
