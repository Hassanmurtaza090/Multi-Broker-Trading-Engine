/**
 * Order history + executions component tests (M5).
 *
 * Covers the behaviours a read-only history module must get right: finished
 * vs working classification, client-side status/side/account/search narrowing,
 * numeric sorting of decimal strings, the honest empty/loading/error/retry
 * states, order-detail inspection (including a failed refresh and the
 * "no persisted executions" statement), multi-fill rendering, and the absence
 * of any trading action.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError, type ApiClient } from "../../services/api";
import { ServicesContext } from "../../services/context";
import { brokersStore, executionsStore, ordersStore, resetAllStores } from "../../stores";
import { recordFill } from "../../stores/executionsStore";
import { createMockApi, fillJ, orderOut } from "../../test/mocks";
import type { OrderOut } from "../../types/api";
import { ExecutionsTable } from "./ExecutionsTable";
import { OrderHistoryTable } from "./OrderHistoryTable";

function renderWithApi(node: ReactNode, api = createMockApi()) {
  return render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      {node}
    </ServicesContext.Provider>,
  );
}

function seedOrders(orders: OrderOut[]) {
  const byId: Record<string, OrderOut> = {};
  const ids: string[] = [];
  for (const order of orders) {
    byId[order.client_order_id] = order;
    ids.push(order.client_order_id);
  }
  ordersStore.setState({ byId, ids, loadState: "ready", errorMessage: null });
}

function seedFill(fill = fillJ()) {
  executionsStore.update((s) => recordFill(s, fill));
}

describe("OrderHistoryTable (M5)", () => {
  beforeEach(() => resetAllStores());

  it("shows an explicit empty state when no orders exist", () => {
    ordersStore.setState({ byId: {}, ids: [], loadState: "ready", errorMessage: null });
    renderWithApi(<OrderHistoryTable />);
    expect(screen.getByText("No order history yet.")).toBeInTheDocument();
  });

  it("shows a loading state before the order list arrives", () => {
    ordersStore.setState({ byId: {}, ids: [], loadState: "loading", errorMessage: null });
    renderWithApi(<OrderHistoryTable />);
    expect(screen.getByText("Loading order history…")).toBeInTheDocument();
  });

  it("shows the API error instead of an empty table, and retries for real", async () => {
    const api = createMockApi();
    ordersStore.setState({
      byId: {},
      ids: [],
      loadState: "error",
      errorMessage: "Cannot reach the trading API. Check the connection.",
    });
    renderWithApi(<OrderHistoryTable />, api);
    expect(screen.getByRole("alert")).toHaveTextContent(/Cannot reach the trading API/);

    api.listOrders.mockResolvedValueOnce([
      orderOut({ client_order_id: "ret-1", status: "FILLED", symbol: "TSLA" }),
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("TSLA");
    expect(api.listOrders).toHaveBeenCalledTimes(1);
    expect(ordersStore.getSnapshot().loadState).toBe("ready");
  });

  it("excludes working orders by default and includes them under 'Everything'", async () => {
    seedOrders([
      orderOut({ client_order_id: "done-1", status: "FILLED", symbol: "AAPL" }),
      orderOut({ client_order_id: "work-1", status: "SUBMITTED", symbol: "MSFT" }),
    ]);
    renderWithApi(<OrderHistoryTable />);
    const user = userEvent.setup();

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by status"), "ALL");
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("narrows by exact status and by side", async () => {
    seedOrders([
      orderOut({ client_order_id: "filled-1", status: "FILLED", symbol: "AAPL", side: "BUY" }),
      orderOut({ client_order_id: "rej-1", status: "REJECTED", symbol: "MSFT", side: "SELL" }),
      orderOut({ client_order_id: "cxl-1", status: "CANCELLED", symbol: "NVDA", side: "SELL" }),
    ]);
    renderWithApi(<OrderHistoryTable />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Filter by status"), "REJECTED");
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
    expect(screen.queryByText("NVDA")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by status"), "FINISHED");
    await user.selectOptions(screen.getByLabelText("Filter by side"), "SELL");
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
  });

  it("searches by symbol and by order id", async () => {
    seedOrders([
      orderOut({ client_order_id: "aaaa1111-0000", status: "FILLED", symbol: "AAPL" }),
      orderOut({ client_order_id: "bbbb2222-0000", status: "FILLED", symbol: "MSFT" }),
    ]);
    renderWithApi(<OrderHistoryTable />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Search order history"), "ms");
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search order history"));
    await user.type(screen.getByLabelText("Search order history"), "aaaa");
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();
  });

  it("shows a no-match state with a working clear-filters control", async () => {
    seedOrders([orderOut({ status: "FILLED", symbol: "AAPL" })]);
    renderWithApi(<OrderHistoryTable />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Search order history"), "ZZZ");
    expect(screen.getByText("No orders match the current filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("sorts quantity numerically — 10 after 9 ascending, before it descending", async () => {
    seedOrders([
      orderOut({ client_order_id: "ten-1", status: "FILLED", symbol: "TEN", quantity: "10" }),
      orderOut({ client_order_id: "nine-1", status: "FILLED", symbol: "NINE", quantity: "9" }),
    ]);
    const { container } = renderWithApi(<OrderHistoryTable />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^Qty/ }));
    let rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("NINE");
    expect(rows[1]).toHaveTextContent("TEN");

    await user.click(screen.getByRole("button", { name: /^Qty/ }));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("TEN");
    expect(rows[1]).toHaveTextContent("NINE");
  });

  it("keeps broker and account identity on every row and offers an account filter only when needed", async () => {
    brokersStore.update((s) => ({
      ...s,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    seedOrders([
      orderOut({ client_order_id: "a1", status: "FILLED", symbol: "AAPL", account_id: "ACC-001" }),
      orderOut({ client_order_id: "b1", status: "FILLED", symbol: "MSFT", account_id: "ACC-002" }),
    ]);
    renderWithApi(<OrderHistoryTable />);
    expect(screen.getAllByText("IBKR").length).toBeGreaterThan(0);

    const accountFilter = screen.getByLabelText("Filter by account");
    await userEvent.setup().selectOptions(accountFilter, "ACC-002");
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
  });

  it("is read-only — no cancel, modify or submit control is rendered", () => {
    seedOrders([orderOut({ status: "SUBMITTED", symbol: "AAPL" })]);
    renderWithApi(<OrderHistoryTable />);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit|buy|sell/i })).not.toBeInTheDocument();
  });

  it("opens the detail dialog from a row and states that no executions were persisted", async () => {
    const api = createMockApi();
    const order = orderOut({ client_order_id: "detail-1", status: "FILLED", symbol: "AAPL" });
    api.getOrder.mockResolvedValueOnce(order);
    seedOrders([order]);
    renderWithApi(<OrderHistoryTable />, api);

    await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTitle(order.client_order_id)).toBeInTheDocument();
    expect(within(dialog).getByText("FILLED")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/No execution records received for this order/),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.getOrder).toHaveBeenCalledWith("detail-1"));
  });

  it("lists the fills captured for that order, newest first", async () => {
    const order = orderOut({ client_order_id: "detail-2", status: "FILLED", symbol: "AAPL" });
    seedOrders([order]);
    seedFill(
      fillJ({
        fill_id: "fill-aaaa1111",
        order_client_id: "detail-2",
        executed_at: "2026-09-27T10:00:01+00:00",
      }),
    );
    seedFill(
      fillJ({
        fill_id: "fill-bbbb2222",
        order_client_id: "detail-2",
        executed_at: "2026-09-27T10:00:09+00:00",
      }),
    );
    renderWithApi(<OrderHistoryTable />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("fill-bbb"); // newest first
    expect(rows[1]).toHaveTextContent("fill-aaa");
  });

  it("surfaces a failed detail refresh and falls back to the cached snapshot", async () => {
    const api = createMockApi();
    api.getOrder.mockRejectedValueOnce(
      new ApiError({ status: 503, code: "UNAVAILABLE", message: "broker unavailable" }),
    );
    seedOrders([orderOut({ client_order_id: "detail-3", status: "FILLED", symbol: "AAPL" })]);
    renderWithApi(<OrderHistoryTable />, api);

    await userEvent.setup().click(screen.getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    // ApiError.userMessage is the curated user-facing text (M11 contract) — not
    // the raw server string — so the assertion follows the shipped copy.
    expect(alert).toHaveTextContent(/Broker connection lost/);
    expect(within(dialog).getByText(/Showing the last snapshot/)).toBeInTheDocument();
    expect(within(dialog).getByTitle("detail-3")).toBeInTheDocument();
  });
});

describe("ExecutionsTable (M5)", () => {
  beforeEach(() => resetAllStores());

  it("states the persistence limitation up front", () => {
    renderWithApi(<ExecutionsTable />);
    expect(screen.getByText(/Session capture, not persisted history/)).toBeInTheDocument();
    expect(screen.getByText("No executions captured in this session yet.")).toBeInTheDocument();
  });

  it("renders one row per fill and shows '—' for unreported commission and fees", () => {
    seedFill(fillJ({ fill_id: "fill-1", quantity: { value: "4" }, commission: null, fees: null }));
    seedFill(
      fillJ({
        fill_id: "fill-2",
        quantity: { value: "6" },
        price: { value: "150.25", currency: { code: "USD" } },
        executed_at: "2026-09-27T10:00:09+00:00",
        commission: { amount: "1.25", currency: { code: "USD" } },
      }),
    );
    renderWithApi(<ExecutionsTable />);

    expect(screen.getByTestId("execution-fill-1")).toBeInTheDocument();
    expect(screen.getByTestId("execution-fill-2")).toBeInTheDocument();
    // 4 x 150.25 = 601 exact, and 6 x 150.25 = 901.5 — no float artifacts.
    expect(screen.getByTestId("execution-fill-1")).toHaveTextContent("601");
    expect(screen.getByTestId("execution-fill-2")).toHaveTextContent("901.5");
    expect(screen.getByTestId("execution-fill-1")).toHaveTextContent("—");
    expect(screen.getByTestId("execution-fill-2")).toHaveTextContent("1.25");
  });

  it("keeps multiple fills of one order as distinct records", () => {
    seedFill(fillJ({ fill_id: "f-a", order_client_id: "order-1" }));
    seedFill(
      fillJ({
        fill_id: "f-b",
        order_client_id: "order-1",
        executed_at: "2026-09-27T10:00:09+00:00",
      }),
    );
    renderWithApi(<ExecutionsTable />);
    expect(screen.getAllByTestId(/^execution-f-/)).toHaveLength(2);
    expect(screen.getByText("2 of 2 fills")).toBeInTheDocument();
  });

  it("filters by side and sorts price numerically", async () => {
    seedFill(
      fillJ({ fill_id: "buy-1", side: "BUY", price: { value: "9", currency: { code: "USD" } } }),
    );
    seedFill(
      fillJ({
        fill_id: "sell-1",
        side: "SELL",
        price: { value: "10", currency: { code: "USD" } },
        executed_at: "2026-09-27T10:00:09+00:00",
      }),
    );
    const { container } = renderWithApi(<ExecutionsTable />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Sell" }));
    expect(screen.getByTestId("execution-sell-1")).toBeInTheDocument();
    expect(screen.queryByTestId("execution-buy-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "All" }));
    await user.click(screen.getByRole("button", { name: /^Price/ }));
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("buy-1"); // price 9 sorts before 10
    expect(rows[1]).toHaveTextContent("sell-1");
  });
});
