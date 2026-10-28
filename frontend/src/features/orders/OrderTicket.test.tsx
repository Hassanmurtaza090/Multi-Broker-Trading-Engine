/**
 * Order ticket component tests (M11): validation, submission outcomes, the
 * idempotency-key lifecycle, and the risk dry-run.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError, type ApiClient } from "../../services/api";
import { ServicesContext } from "../../services/context";
import { accountStore, marketStore, ordersStore, resetAllStores } from "../../stores";
import { createMockApi, loginForTests, orderOut, quoteOut, TEST_VIEWER } from "../../test/mocks";
import { OrderTicket } from "./OrderTicket";

function renderTicket(api: ReturnType<typeof createMockApi> = createMockApi()) {
  render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      <OrderTicket />
    </ServicesContext.Provider>,
  );
  return api;
}

async function fillValidTicket(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Symbol"), "AAPL");
  await user.type(screen.getByLabelText("Quantity"), "10");
  await user.type(screen.getByLabelText("Limit price"), "150.25");
}

describe("OrderTicket", () => {
  beforeEach(async () => {
    resetAllStores();
    await loginForTests(); // trader: orders:write on ACC-001
  });

  it("blocks submission until required fields are valid", async () => {
    const user = userEvent.setup();
    const api = renderTicket();
    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Enter a symbol.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Symbol"), "AAPL");
    expect(screen.getByText("Quantity must be a positive decimal.")).toBeInTheDocument();

    await fillValidTicket(user);
    expect(submit).toBeEnabled();
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it("submits through the API and upserts the returned order into the blotter store", async () => {
    const api = renderTicket();
    api.createOrder.mockResolvedValueOnce(orderOut());
    const user = userEvent.setup();
    await fillValidTicket(user);
    await user.click(screen.getByRole("button", { name: /submit buy/i }));

    await screen.findByText(/Order SUBMITTED/);
    const body = api.createOrder.mock.calls[0][0];
    expect(body.account_id).toBe("ACC-001");
    expect(body.instrument.symbol).toBe("AAPL");
    expect(body.quantity).toBe("10");
    expect(body.limit_price).toBe("150.25");
    expect(body.idempotency_key).toBeTruthy();
    expect(ordersStore.getSnapshot().ids).toContain(orderOut().client_order_id);
  });

  it("renders risk-gate rejections (422) with rule-level violations", async () => {
    const api = renderTicket();
    api.createOrder.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        code: "RISK_REJECTED",
        message: "order rejected by risk",
        violations: [
          { rule: "kill_switch", reason: "kill switch is active", data_unavailable: false },
        ],
      }),
    );
    const user = userEvent.setup();
    await fillValidTicket(user);
    await user.click(screen.getByRole("button", { name: /submit buy/i }));

    await screen.findByText("Order rejected by risk controls.");
    expect(screen.getByText("kill_switch")).toBeInTheDocument();
    expect(screen.getByText("kill switch is active")).toBeInTheDocument();
  });

  it("keeps the same idempotency key after a timeout so retry is a safe replay", async () => {
    const api = renderTicket();
    const user = userEvent.setup();
    await fillValidTicket(user);

    api.createOrder.mockRejectedValueOnce(
      new ApiError({ status: 504, code: "TIMEOUT", message: "broker timeout" }),
    );
    await user.click(screen.getByRole("button", { name: /submit buy/i }));
    await screen.findByText(/Submission key retained/);
    const firstKey = api.createOrder.mock.calls[0][0].idempotency_key;

    // Retry replays the SAME key (TS-004) — the form was not reset.
    api.createOrder.mockResolvedValueOnce(orderOut());
    await user.click(screen.getByRole("button", { name: /submit buy/i }));
    await screen.findByText(/Order SUBMITTED/);
    expect(api.createOrder.mock.calls[1][0].idempotency_key).toBe(firstKey);
  });

  it("rotates the idempotency key after a successful submission", async () => {
    const api = renderTicket();
    api.createOrder.mockResolvedValue(orderOut());
    const user = userEvent.setup();
    await fillValidTicket(user);
    await user.click(screen.getByRole("button", { name: /submit buy/i }));
    await screen.findByText(/Order SUBMITTED/);
    const firstKey = api.createOrder.mock.calls[0][0].idempotency_key;

    await fillValidTicket(user); // form resets after success; refill
    await user.click(screen.getByRole("button", { name: /submit buy/i }));
    await screen.findAllByText(/Order SUBMITTED/);
    expect(api.createOrder.mock.calls[1][0].idempotency_key).not.toBe(firstKey);
  });

  it("dry-runs the risk gate without creating an order", async () => {
    const api = renderTicket();
    api.evaluateRisk.mockResolvedValueOnce({
      approved: false,
      violations: [{ rule: "order_size", reason: "exceeds limit", data_unavailable: false }],
    });
    const user = userEvent.setup();
    await fillValidTicket(user);
    await user.click(screen.getByRole("button", { name: /check risk/i }));

    await screen.findByText("Risk check would reject this order.");
    expect(screen.getByText("order_size")).toBeInTheDocument();
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(api.evaluateRisk).toHaveBeenCalledWith(
      "ACC-001",
      expect.objectContaining({ side: "BUY" }),
    );
  });

  it("warns when the account kill switch is active", () => {
    accountStore.update((s) => ({ ...s, killSwitchActive: true }));
    renderTicket();
    expect(screen.getByText(/Kill switch is ACTIVE/)).toBeInTheDocument();
  });

  it("shows viewers a read-only notice instead of the form (UX only; server enforces)", async () => {
    await loginForTests(TEST_VIEWER); // viewer: no orders:write
    renderTicket();
    expect(screen.getByText("Read-only access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
  });

  it("shows stop price input only for stop order types", async () => {
    const user = userEvent.setup();
    renderTicket();
    expect(screen.queryByLabelText("Stop price")).not.toBeInTheDocument();
    // M1: the order type is the Figma segmented control (radiogroup).
    await user.click(screen.getByRole("radio", { name: "STOP_LIMIT" }));
    expect(screen.getByLabelText("Stop price")).toBeInTheDocument();
  });

  it("computes an exact estimated total from the live quote (no float artifacts)", async () => {
    const user = userEvent.setup();
    renderTicket();
    const { applyQuoteOut } = await import("../../stores/marketStore");
    act(() => {
      marketStore.update((s) =>
        applyQuoteOut(
          s,
          { symbol: "AAPL", asset_class: "EQUITY", currency: "USD", exchange: "NASDAQ" },
          quoteOut({ last: "150.25" }),
        ),
      );
    });
    await user.type(screen.getByLabelText("Symbol"), "AAPL");
    await user.selectOptions(screen.getByLabelText("Exchange"), "NASDAQ");
    expect(screen.getByLabelText(/estimated total/i)).toHaveValue("—"); // no quantity yet
    await user.type(screen.getByLabelText("Quantity"), "10");
    expect(screen.getByLabelText(/estimated total/i)).toHaveValue("1,502.5");
  });

  it("shows — as the estimate when no live quote exists for the entered instrument", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText("Symbol"), "ZZZZ");
    await user.type(screen.getByLabelText("Quantity"), "10");
    expect(screen.getByLabelText(/estimated total/i)).toHaveValue("—");
  });

  it("suppresses the quantity error once input is valid (no double submit while pending)", async () => {
    const api = renderTicket();
    let resolveCreate: (v: unknown) => void = () => {};
    api.createOrder.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCreate = resolve)),
    );
    const user = userEvent.setup();
    await fillValidTicket(user);
    const submit = screen.getByRole("button", { name: /submit buy/i });
    await user.click(submit);
    expect(submit).toBeDisabled(); // in-flight guard (TS-003 UX)
    await resolveCreate(orderOut());
    await screen.findByText(/Order SUBMITTED/);
  });
});
