/**
 * M13 terminal-boundary integration flow: the real App (auth gate, stores,
 * useTerminal wiring, panels) with only the TRANSPORT mocked (mock API +
 * MockWebSocket). Covers the React Terminal row of the integration flow:
 * login -> live terminal -> submit -> WS-driven blotter update -> cancel ->
 * connection-loss banner.
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "./services/api";
import App from "./App";
import { resetAllStores } from "./stores";
import {
  createMockApi,
  envelope,
  loginForTests,
  MockWebSocket,
  mockSocketFactory,
  orderJ,
  orderOut,
  TEST_TRADER,
} from "./test/mocks";

function renderApp(api = createMockApi()) {
  render(<App services={{ api: api as unknown as ApiClient }} socketFactory={mockSocketFactory} />);
  return api;
}

async function connectStream() {
  await act(async () => {}); // ws-ticket fetch -> factory
  MockWebSocket.latest().open();
  await act(async () => {}); // onopen -> REST resync
}

async function fillTicket(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Symbol"), "AAPL");
  await user.type(screen.getByLabelText("Quantity"), "10");
  await user.type(screen.getByLabelText("Limit price"), "150.25");
}

describe("terminal integration flow", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    resetAllStores();
    vi.unstubAllGlobals();
  });

  it(
    "login -> submit -> WS-driven update -> cancel -> loss banner",
    { timeout: 15000 },
    async () => {
      const api = renderApp();
      await loginForTests(TEST_TRADER);
      await connectStream();

      // 1. Submit an order through the ticket (UI -> store -> API).
      api.createOrder.mockResolvedValueOnce(orderOut({ status: "SUBMITTED" }));
      const user = userEvent.setup();
      await fillTicket(user);
      await user.click(screen.getByRole("button", { name: /submit buy/i }));
      expect(api.createOrder).toHaveBeenCalledTimes(1);
      await screen.findByText("SUBMITTED");

      // 2. The broker accepts + partially fills: WS events drive the blotter
      //    with no manual refresh (the terminal's core real-time contract).
      const orderId = orderOut().client_order_id;
      act(() => {
        MockWebSocket.latest().receive(
          envelope("order.accepted", { order: orderJ({ status: "SUBMITTED" }) }, "evt-acc"),
        );
        MockWebSocket.latest().receive(
          envelope(
            "order.partially_filled",
            {
              order: orderJ({
                status: "PARTIALLY_FILLED",
                filled_quantity: { value: "4" },
              }),
            },
            "evt-partial",
          ),
        );
      });
      expect(await screen.findByText("PARTIALLY_FILLED")).toBeInTheDocument();

      // 3. Cancel through the blotter: confirmation -> API -> store updated.
      api.cancelOrder.mockResolvedValueOnce(
        orderOut({ status: "CANCELLED", remaining_quantity: "10", filled_quantity: "4" }),
      );
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      const dialog = screen.getByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));
      expect(api.cancelOrder).toHaveBeenCalledWith(orderId);
      expect(await screen.findByText("CANCELLED")).toBeInTheDocument();

      // 4. Connection loss: the banner flags stale data (ADR-016 UX contract);
      //    a reconnect with a fresh WS ticket resumes the stream.
      vi.useFakeTimers(); // BEFORE the close: the backoff timer must be fake
      act(() => {
        MockWebSocket.latest().serverClose(1006, "lost");
      });
      // The banner renders synchronously with the connection-store update.
      const banner = screen.getByText(
        (_, element) => element?.classList.contains("connection-banner") ?? false,
      );
      expect(banner).toHaveTextContent(/reconnecting/i);

      try {
        await act(async () => {
          vi.advanceTimersByTime(500); // backoff fires -> fresh ticket -> factory
          await Promise.resolve();
        });
      } finally {
        vi.useRealTimers();
      }
      await act(async () => {}); // ticket fetch -> new MockWebSocket
      expect(MockWebSocket.instances).toHaveLength(2); // a NEW socket, not the dead one
      MockWebSocket.latest().open();
      await act(async () => {});
      expect(screen.getAllByText(/Stream: CONNECTED/).length).toBeGreaterThan(0);
      // A second ticket was consumed for the reconnect (single-use, M12).
      expect(api.createWsTicket).toHaveBeenCalledTimes(2);
    },
  );
});
