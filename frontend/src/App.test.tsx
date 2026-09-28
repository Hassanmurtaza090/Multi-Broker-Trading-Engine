import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "./services/api";
import App from "./App";
import { resetAllStores, uiStore } from "./stores";
import { createMockApi, MockWebSocket, mockSocketFactory, orderJ, envelope } from "./test/mocks";

function renderApp() {
  const api = createMockApi();
  render(<App services={{ api: api as unknown as ApiClient }} socketFactory={mockSocketFactory} />);
  return api;
}

describe("App (trading terminal)", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    resetAllStores();
  });

  it("renders the terminal chrome and connects the real-time stream", async () => {
    renderApp();
    expect(screen.getByText("Multi-Broker Trading Engine")).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toContain("/ws?topics=all");

    // Connecting → stream badge flips to CONNECTED once the socket opens.
    await act(async () => {
      MockWebSocket.latest().open();
      await Promise.resolve();
    });
    expect(screen.getAllByText(/Stream: CONNECTED/).length).toBeGreaterThan(0);
  });

  it("switches views via the nav", async () => {
    renderApp();
    await act(async () => {
      uiStore.update((s) => ({ ...s, view: "orders" }));
    });
    expect(screen.getByRole("button", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Order Ticket")).toBeInTheDocument();
  });

  it("shows WS-driven order events in the blotter without manual refresh", async () => {
    renderApp();
    await act(async () => {
      MockWebSocket.latest().open();
      await Promise.resolve();
    });
    act(() => {
      MockWebSocket.latest().receive(
        envelope("order.submitted", { order: orderJ({ status: "SUBMITTED" }) }),
      );
    });
    expect(screen.getByText("SUBMITTED")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });
});
