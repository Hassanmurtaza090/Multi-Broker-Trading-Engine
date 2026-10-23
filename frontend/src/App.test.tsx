/**
 * App tests (M11/M12): auth gate + terminal wiring through the real stores.
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "./services/api";
import App from "./App";
import { authStore, resetAllStores, uiStore } from "./stores";
import {
  createMockApi,
  envelope,
  loginForTests,
  MockWebSocket,
  mockSocketFactory,
  orderJ,
  TEST_ADMIN,
  TEST_TRADER,
  tokenPairFor,
} from "./test/mocks";

function renderApp(api = createMockApi()) {
  render(<App services={{ api: api as unknown as ApiClient }} socketFactory={mockSocketFactory} />);
  return api;
}

describe("App (trading terminal)", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    resetAllStores();
    vi.unstubAllGlobals();
  });

  it("shows ONLY the login view when unauthenticated (nothing else renders)", () => {
    renderApp();
    expect(screen.getByText("Sign in to the trading terminal")).toBeInTheDocument();
    // No terminal chrome leaks pre-authentication.
    expect(screen.queryByText("Multi-Broker Trading Engine")).toBeInTheDocument(); // login title
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0); // no socket pre-login
  });

  it("mounts the terminal (and connects the stream) after login", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    expect(screen.getAllByText("Multi-Broker Trading Engine").length).toBeGreaterThan(0);
    await act(async () => {});
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toContain("/ws?topics=all&ticket=");

    await act(async () => {
      MockWebSocket.latest().open();
      await Promise.resolve();
    });
    expect(screen.getAllByText(/Stream: CONNECTED/).length).toBeGreaterThan(0);
  });

  it("unmounts the terminal and returns to login when the session expires", async () => {
    const { authService } = await import("./services/auth");
    await loginForTests(TEST_TRADER);
    renderApp();
    await act(async () => {});
    expect(MockWebSocket.instances).toHaveLength(1);

    // Server rejects the session (e.g. refresh failed) → authService expires.
    act(() => {
      authService.expire();
    });
    expect(authStore.getSnapshot().status).toBe("logged_out");
    expect(screen.getByText("Sign in to the trading terminal")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("switches views via the nav", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    await act(async () => {
      uiStore.update((s) => ({ ...s, view: "orders" }));
    });
    expect(screen.getByRole("button", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Order Ticket")).toBeInTheDocument();
  });

  it("renders the sidebar shell: real destinations enabled, unimplemented disabled", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Views" });
    // Implemented destinations navigate.
    expect(within(nav).getByRole("button", { name: "Trade" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Positions" })).toBeInTheDocument();
    // Unimplemented Figma destinations are visibly disabled — never dead links.
    const disabledLabels = within(nav)
      .getAllByRole("button")
      .filter((b) => (b as HTMLButtonElement).disabled)
      .map((b) => b.textContent ?? "");
    expect(disabledLabels.length).toBe(5); // Overview, Accounts, Activity, Strategies, Settings
    expect(disabledLabels.join(",")).toContain("Overview");
    // The header search exists (real client-side watchlist filter).
    expect(screen.getByLabelText("Search instruments")).toBeInTheDocument();
  });

  it("switches views through the sidebar (Trade ↔ Positions)", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Positions" }));
    expect(screen.getByRole("heading", { name: "Positions", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Trade" }));
    expect(screen.getByRole("heading", { name: "Trading Terminal", level: 1 })).toBeInTheDocument();
  });

  it("shows WS-driven order events in the blotter without manual refresh", async () => {
    const api = renderApp();
    await loginForTests(TEST_TRADER);
    await act(async () => {});
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
    expect(api.listOrders).toHaveBeenCalled();
  });

  it("renders a logout control that ends the session", async () => {
    const { authService } = await import("./services/auth");
    await loginForTests(TEST_TRADER);
    // Stub fetch for the logout call (the authService uses a real client).
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /log out/i }));
    await vi.waitFor(() => {
      expect(authService.getAccessToken()).toBeNull();
    });
    expect(screen.getByText("Sign in to the trading terminal")).toBeInTheDocument();
  });

  it("LoginView rejects bad credentials with a GENERIC error (no enumeration)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "invalid credentials" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );
    renderApp();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), "whoever");
    await user.type(screen.getByLabelText(/password/i), "wrong-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText("Invalid username or password.");
    expect(screen.getByText("Sign in to the trading terminal")).toBeInTheDocument();
  });

  it("admin users keep the free-entry account selector (wildcard scope)", async () => {
    await loginForTests(TEST_ADMIN);
    renderApp();
    expect(screen.getByTitle("Switch account")).toBeInTheDocument();
    expect(tokenPairFor(TEST_ADMIN).user.accounts).toEqual(["*"]);
  });
});
