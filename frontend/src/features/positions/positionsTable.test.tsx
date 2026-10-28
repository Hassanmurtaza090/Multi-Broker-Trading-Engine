/**
 * Positions table tests (M4): sortable columns (numeric, never string-sort),
 * direction + symbol filters, LONG/SHORT chips, per-currency unrealized
 * totals (within-currency exact sums only), no-match empty state, row-click
 * charting (watchlist identity preferred), broker column, compact mode.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { PositionsTable } from "./PositionsTable";
import { brokersStore, marketStore, positionsStore, resetAllStores, uiStore } from "../../stores";
import { keyForPositionOut } from "../../stores/positionsStore";
import { positionOut } from "../../test/mocks";

function seedPositions(rows: Parameters<typeof positionOut>[0][]) {
  const byKey: Record<string, ReturnType<typeof positionOut>> = {};
  const keys: string[] = [];
  for (const row of rows) {
    const position = positionOut(row);
    const key = keyForPositionOut(position);
    byKey[key] = position;
    keys.push(key);
  }
  positionsStore.setState({ byKey, keys, loadState: "ready", errorMessage: null });
}

function renderTable(compact = false) {
  const { container } = render(<PositionsTable compact={compact} />);
  return { container };
}

describe("PositionsTable (M4)", () => {
  beforeEach(() => resetAllStores());

  it("renders LONG/SHORT direction chips and the runtime broker column", () => {
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    seedPositions([
      { symbol: "AAPL", quantity: "10" },
      { symbol: "MSFT", quantity: "-5" },
    ]);
    renderTable();
    expect(screen.getByTestId("position-AAPL")).toHaveTextContent("LONG");
    expect(screen.getByTestId("position-MSFT")).toHaveTextContent("SHORT");
    expect(screen.getAllByText("IBKR").length).toBeGreaterThan(0);
  });

  it("sorts quantity and market price NUMERICALLY (not lexicographically)", async () => {
    seedPositions([
      { symbol: "AAA", quantity: "9", market_price: "101.00" },
      { symbol: "BBB", quantity: "10", market_price: "99.00" },
    ]);
    const { container } = renderTable();
    const user = userEvent.setup();

    // Ascending by quantity: 9 (AAA) before 10 (BBB) — string sort would invert.
    await user.click(screen.getByRole("button", { name: /^Qty/ }));
    let rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("AAA");
    expect(rows[1]).toHaveTextContent("BBB");

    // New column → ascending first: market 99.00 (BBB) before 101.00 (AAA).
    await user.click(screen.getByRole("button", { name: /^Market/ }));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("BBB");
    expect(rows[1]).toHaveTextContent("AAA");

    // Toggle → descending market: 101.00 (AAA) first.
    await user.click(screen.getByRole("button", { name: /^Market/ }));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("AAA");
    expect(rows[1]).toHaveTextContent("BBB");
  });

  it("filters by direction (long/short) and by symbol text", async () => {
    seedPositions([
      { symbol: "AAPL", quantity: "10" },
      { symbol: "MSFT", quantity: "-5" },
      { symbol: "NVDA", quantity: "3" },
    ]);
    renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Short" }));
    expect(screen.queryByTestId("position-AAPL")).not.toBeInTheDocument();
    expect(screen.getByTestId("position-MSFT")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Long" }));
    expect(screen.queryByTestId("position-MSFT")).not.toBeInTheDocument();
    expect(screen.getByTestId("position-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("position-NVDA")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "All" }));
    await user.type(screen.getByLabelText("Filter positions by symbol"), "MS");
    expect(screen.getByTestId("position-MSFT")).toBeInTheDocument();
    expect(screen.queryByTestId("position-AAPL")).not.toBeInTheDocument();
  });

  it("shows an explicit no-match state when filters exclude everything", async () => {
    seedPositions([{ symbol: "AAPL", quantity: "10" }]);
    renderTable();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Filter positions by symbol"), "ZZZ");
    expect(screen.getByText("No positions match the current filters.")).toBeInTheDocument();
  });

  it("summarizes long/short counts and per-currency unrealized totals exactly", () => {
    seedPositions([
      { symbol: "AAPL", quantity: "10", unrealized_pnl: "12.50" },
      { symbol: "MSFT", quantity: "-5", unrealized_pnl: "30.00" },
    ]);
    renderTable();
    expect(screen.getByText(/1 long · 1 short/)).toBeInTheDocument();
    // Exact within-currency sum: 12.50 + 30.00 = 42.5 — never a float artifact.
    expect(screen.getByText(/42\.5/)).toBeInTheDocument();
    // Both positions are USD: exactly ONE unrealized total line (no cross-ccy sums).
    expect(screen.getAllByText(/Unrealized USD/).length).toBe(1);
  });

  it("row click selects the instrument for the Trade screen, preferring the watched identity", async () => {
    const watched = { symbol: "AAPL", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" };
    marketStore.update((s) => ({ ...s, watchlist: [watched] }));
    seedPositions([{ symbol: "AAPL", quantity: "10" }]);
    renderTable();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("position-AAPL"));
    const selected = uiStore.getSnapshot().selectedInstrument;
    expect(selected?.symbol).toBe("AAPL");
    expect(selected?.asset_class).toBe("EQUITY"); // matched the watched descriptor
    expect(uiStore.getSnapshot().view).toBe("dashboard");
  });

  it("row click without a watchlist match still selects, with the honest UNKNOWN class", async () => {
    seedPositions([{ symbol: "GME", quantity: "2" }]);
    renderTable();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("position-GME"));
    const selected = uiStore.getSnapshot().selectedInstrument;
    expect(selected?.symbol).toBe("GME");
    expect(selected?.asset_class).toBe("UNKNOWN");
    expect(uiStore.getSnapshot().view).toBe("dashboard");
  });

  it("compact mode (tabs card): dense table only — no toolbar, no sortable headers", () => {
    seedPositions([{ symbol: "AAPL", quantity: "10" }]);
    const { container } = renderTable(true);
    expect(screen.queryByLabelText("Filter positions by symbol")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Filter positions by direction" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Qty/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("position-AAPL")).toBeInTheDocument();
    expect(container.querySelectorAll("thead th").length).toBeGreaterThan(0);
  });
});
