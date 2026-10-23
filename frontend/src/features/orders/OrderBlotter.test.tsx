/**
 * Order blotter component tests (M11): list rendering, state-machine-driven
 * actions, confirmed cancel, and modify flow.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError, type ApiClient } from "../../services/api";
import { ServicesContext } from "../../services/context";
import { ordersStore, resetAllStores } from "../../stores";
import { createMockApi, orderOut } from "../../test/mocks";
import { OrderBlotter } from "./OrderBlotter";

function renderBlotter(api = createMockApi(), initialFilter?: "ALL" | "OPEN" | "TERMINAL") {
  render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      <OrderBlotter initialFilter={initialFilter} />
    </ServicesContext.Provider>,
  );
  return api;
}

describe("OrderBlotter", () => {
  beforeEach(() => {
    resetAllStores();
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
    ordersStore.update((s) => ({
      ...s,
      byId: { "o-1": orderOut({ client_order_id: "o-1", status: "FILLED" }) },
      ids: ["o-1"],
    }));
    renderBlotter();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Modify" })).toBeDisabled();
  });

  it("cancel requires confirmation and updates the store on success", async () => {
    ordersStore.update((s) => ({
      ...s,
      byId: { "o-1": orderOut({ client_order_id: "o-1" }) },
      ids: ["o-1"],
    }));
    const api = renderBlotter();
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
    const api = renderBlotter();
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
    const api = renderBlotter();
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

  it("status filter narrows the visible rows", async () => {
    ordersStore.update((s) => ({
      ...s,
      byId: {
        "o-open": orderOut({ client_order_id: "o-open", status: "SUBMITTED", symbol: "AAPL" }),
        "o-done": orderOut({ client_order_id: "o-done", status: "FILLED", symbol: "MSFT" }),
      },
      ids: ["o-open", "o-done"],
    }));
    renderBlotter();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Filter orders by status"), "OPEN");
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter orders by status"), "TERMINAL");
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("opens pre-filtered when mounted with a fixed initial filter (tabs card)", () => {
    ordersStore.update((s) => ({
      ...s,
      byId: {
        "o-open": orderOut({ client_order_id: "o-open", status: "SUBMITTED", symbol: "AAPL" }),
        "o-done": orderOut({ client_order_id: "o-done", status: "FILLED", symbol: "MSFT" }),
      },
      ids: ["o-open", "o-done"],
    }));
    renderBlotter(createMockApi(), "OPEN");
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter orders by status")).toHaveValue("OPEN");
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
});
