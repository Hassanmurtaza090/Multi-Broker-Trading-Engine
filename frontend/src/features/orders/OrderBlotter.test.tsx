/**
 * Order blotter component tests (M11 → M4 upgrade): list rendering,
 * state-machine-driven actions (trader-permission gated), confirmed cancel,
 * modify flow, the M4 status segmented filter (All / Working / Done),
 * sortable columns, and the new identifier/remaining/created columns.
 * Compact mode (the terminal tabs card) is covered too.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError, type ApiClient } from "../../services/api";
import { ServicesContext } from "../../services/context";
import { ordersStore, resetAllStores } from "../../stores";
import { createMockApi, loginForTests, orderOut, TEST_TRADER, TEST_VIEWER } from "../../test/mocks";
import { OrderBlotter } from "./OrderBlotter";

function renderBlotter(
  api = createMockApi(),
  initialFilter?: "ALL" | "OPEN" | "TERMINAL",
  compact = false,
) {
  const { container } = render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      <OrderBlotter initialFilter={initialFilter} compact={compact} />
    </ServicesContext.Provider>,
  );
  return { api, container };
}

function seedOrders() {
  ordersStore.update((s) => ({
    ...s,
    loadState: "ready",
    byId: {
      "o-open-1": orderOut({ client_order_id: "o-open-1", status: "SUBMITTED", symbol: "AAPL" }),
      "o-done-1": orderOut({ client_order_id: "o-done-1", status: "FILLED", symbol: "MSFT" }),
    },
    ids: ["o-open-1", "o-done-1"],
  }));
}

describe("OrderBlotter", () => {
  beforeEach(async () => {
    resetAllStores();
    await loginForTests(TEST_TRADER); // trader: orders:write → actions visible
    ordersStore.update((s) => ({ ...s, loadState: "ready" }));
  });

  it("shows an empty state when there are no orders", () => {
    renderBlotter();
    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
  });

  it("renders orders newest-first with status badges", () => {
    ordersStore.update((s) => ({
      ...s,
      byId: {
        "o-new": orderOut({ client_order_id: "o-new", status: "SUBMITTED" }),
        "o-old": orderOut({ client_order_id: "o-old", status: "FILLED", symbol: "MSFT" }),
      },
      ids: ["o-new", "o-old"],
    }));
    renderBlotter();
    expect(screen.getByText("SUBMITTED")).toBeInTheDocument();
    expect(screen.getByText("FILLED")).toBeInTheDocument();
  });

  it("disables cancel/modify for terminal orders", () => {
    seedOrders();
    renderBlotter();
    const doneRow = screen.getByText("MSFT").closest("tr") as HTMLElement;
    expect(within(doneRow).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(doneRow).getByRole("button", { name: "Modify" })).toBeDisabled();
  });

  it("cancel requires confirmation and updates the store on success", async () => {
    ordersStore.update((s) => ({
      ...s,
      byId: { "o-1": orderOut({ client_order_id: "o-1" }) },
      ids: ["o-1"],
    }));
    const api = renderBlotter().api;
    api.cancelOrder.mockResolvedValueOnce(
      orderOut({ client_order_id: "o-1", status: "CANCELLED" }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    await screen.findByText("CANCELLED");
    expect(api.cancelOrder).toHaveBeenCalledWith("o-1");
    expect(ordersStore.getSnapshot().byId["o-1"].status).toBe("CANCELLED");
  });

  it("surfaces a double-cancel conflict (409) instead of pretending success", async () => {
    ordersStore.update((s) => ({
      ...s,
      byId: { "o-1": orderOut({ client_order_id: "o-1" }) },
      ids: ["o-1"],
    }));
    const api = renderBlotter().api;
    api.cancelOrder.mockRejectedValueOnce(
      new ApiError({ status: 409, code: "CONFLICT", message: "order already cancelled" }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel order" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("order already cancelled");
  });

  it("modify dialog posts price changes and closes on success", async () => {
    ordersStore.update((s) => ({
      ...s,
      byId: { "o-1": orderOut({ client_order_id: "o-1" }) },
      ids: ["o-1"],
    }));
    const api = renderBlotter().api;
    api.modifyOrder.mockResolvedValueOnce(
      orderOut({ client_order_id: "o-1", limit_price: "151.00" }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Modify" }));
    const dialog = screen.getByRole("dialog");
    const limitInput = within(dialog).getByLabelText("Limit price");
    await user.clear(limitInput);
    await user.type(limitInput, "151.00");
    await user.click(within(dialog).getByRole("button", { name: "Modify order" }));

    await screen.findByText("151");
    expect(api.modifyOrder).toHaveBeenCalledWith("o-1", {
      limit_price: "151.00",
      stop_price: null,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("status segmented filter narrows the visible rows", async () => {
    seedOrders();
    renderBlotter();
    const user = userEvent.setup();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Working" }));
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Done" }));
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("opens pre-filtered when mounted with a fixed initial filter", () => {
    seedOrders();
    renderBlotter(createMockApi(), "OPEN");
    expect(screen.getByRole("radio", { name: "Working" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();
  });

  it("shows an error state when the initial load failed", () => {
    ordersStore.update((s) => ({
      ...s,
      loadState: "error",
      errorMessage: "Cannot reach the trading API. Check the connection.",
    }));
    renderBlotter();
    expect(screen.getByRole("alert")).toHaveTextContent(/Cannot reach the trading API/);
  });

  // --- M4 additions -----------------------------------------------------------

  it("shows the order identifier (full id on hover), remaining qty, and created time", () => {
    const order = orderOut({ client_order_id: "abcdef01-1234", symbol: "AAPL" });
    ordersStore.update((s) => ({
      ...s,
      byId: { [order.client_order_id]: order },
      ids: [order.client_order_id],
    }));
    renderBlotter();
    expect(screen.getByText("abcdef01")).toBeInTheDocument(); // first 8 chars
    expect(screen.getByTitle(order.client_order_id)).toBeInTheDocument(); // full id tooltip
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    expect(screen.getByTitle(order.created_at)).toBeInTheDocument(); // created time
  });

  it("sorts quantity NUMERICALLY — not lexicographically (10 > 9)", async () => {
    ordersStore.update((s) => ({
      ...s,
      loadState: "ready",
      byId: {
        "q-ten-1": orderOut({ client_order_id: "q-ten-1", symbol: "AAPL", quantity: "10" }),
        "q-nine-": orderOut({ client_order_id: "q-nine-", symbol: "MSFT", quantity: "9" }),
      },
      // MSFT (9) listed first — lexicographic sort would keep it first on desc.
      ids: ["q-nine-", "q-ten-1"],
    }));
    const { container } = renderBlotter();
    const user = userEvent.setup();

    // Ascending: 9 (MSFT) before 10 (AAPL) — string sort would say "10" < "9".
    await user.click(screen.getByRole("button", { name: /^Qty/ }));
    let rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("MSFT");
    expect(rows[1].textContent).toContain("AAPL");

    // Descending: 10 first.
    await user.click(screen.getByRole("button", { name: /^Qty/ }));
    rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("AAPL");
    expect(rows[1].textContent).toContain("MSFT");
  });

  it("hides Cancel/Modify for read-only users and shows the server-enforced note", async () => {
    await loginForTests(TEST_VIEWER); // viewer: no orders:write
    seedOrders();
    renderBlotter();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
    expect(screen.getByText(/your role does not include order actions/)).toBeInTheDocument();
  });

  it("compact mode (tabs card): dense table, no filter control, no id/remaining/created columns — actions kept", () => {
    seedOrders();
    renderBlotter(createMockApi(), "OPEN", true);
    expect(
      screen.queryByRole("radiogroup", { name: "Filter orders by status" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Remaining")).not.toBeInTheDocument();
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByTitle("o-open-1")).not.toBeInTheDocument();
    // The tabs-card contract: working order + cancel affordance stay visible.
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
