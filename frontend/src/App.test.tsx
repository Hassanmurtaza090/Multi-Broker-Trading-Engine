/**
 * App tests (M11/M12): auth gate + terminal wiring through the real stores.
 */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "./services/api";
import App from "./App";
import { authStore, resetAllStores, uiStore, watchlistActions } from "./stores";
import {
  createMockApi,
  envelope,
  fillJ,
  loginForTests,
  MockWebSocket,
  mockSocketFactory,
  orderJ,
  quoteJ,
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
    // Implemented destinations navigate (M2: Overview; M3: Accounts; M5:
    // Activity; M6: Markets — the Figma sidebar calls this destination "Market
    // Data" (App.tsx navItems); the label rename is a tracked follow-up; M7:
    // Strategies — capability state, PLATFORM section).
    expect(within(nav).getByRole("button", { name: "Overview" })).toBeEnabled();
    expect(within(nav).getByRole("button", { name: "Accounts" })).toBeEnabled();
    expect(within(nav).getByRole("button", { name: "Activity" })).toBeEnabled();
    expect(within(nav).getByRole("button", { name: "Markets" })).toBeEnabled();
    expect(within(nav).getByRole("button", { name: "Strategies" })).toBeEnabled();
    expect(within(nav).getByRole("button", { name: "Risk Management" })).toBeEnabled();
    expect(within(nav).getByRole("button", { name: "Trade" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Positions" })).toBeInTheDocument();
    // Unimplemented Figma destinations are visibly disabled — never dead links.
    const disabledLabels = within(nav)
      .getAllByRole("button")
      .filter((b) => (b as HTMLButtonElement).disabled)
      .map((b) => b.textContent ?? "");
    expect(disabledLabels).toEqual(["Settings"]);
    expect(disabledLabels.join(",")).not.toContain("Overview");
    // The header search exists (real client-side watchlist filter).
    expect(screen.getByLabelText("Search instruments")).toBeInTheDocument();
  });

  it("places Strategies in the PLATFORM group, matching the design sidebar", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Views" });
    const platformHeading = within(nav).getByText("PLATFORM");
    const strategies = within(nav).getByRole("button", { name: "Strategies" });
    // Strategies renders AFTER the PLATFORM separator (and before Settings).
    expect(
      platformHeading.compareDocumentPosition(strategies) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // M8: Risk Management follows Strategies in the same group.
    const risk = within(nav).getByRole("button", { name: "Risk Management" });
    expect(
      platformHeading.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      strategies.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const workspaceHeading = within(nav).getByText("WORKSPACE");
    expect(
      workspaceHeading.compareDocumentPosition(strategies) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("switches views through the sidebar (Positions, Overview, Trade, Accounts, Activity, Markets, Strategies)", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Positions" }));
    expect(screen.getByRole("heading", { name: "Positions", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Overview" }));
    expect(
      screen.getByRole("heading", {
        name: /Good (morning|afternoon|evening), trader/,
        level: 1,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Trade" }));
    expect(screen.getByRole("heading", { name: "Trading Terminal", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.getByRole("heading", { name: "Portfolio", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("heading", { name: "Activity", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Markets" }));
    expect(screen.getByRole("heading", { name: "Markets", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Watchlists", level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Strategies" }));
    expect(screen.getByRole("heading", { name: "Strategies", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("CAPABILITY NOT PRESENT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Risk Management" }));
    expect(screen.getByRole("heading", { name: "Risk Management", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Risk limits" })).toBeInTheDocument();
  });

  it("captures WS fills and shows them on the Activity screen (M5)", async () => {
    await loginForTests(TEST_TRADER);
    renderApp();
    await act(async () => {});
    await act(async () => {
      MockWebSocket.latest().open();
      await Promise.resolve();
    });
    act(() => {
      MockWebSocket.latest().receive(
        envelope("order.filled", {
          order: orderJ({ status: "FILLED", filled_quantity: { value: "10" } }),
          fill: fillJ({ fill_id: "fill-ws-0001" }),
        }),
      );
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Activity" }));
    await user.click(screen.getByRole("radio", { name: "Executions" }));

    // The fill travelled WS -> executionsStore -> Activity table unchanged.
    expect(screen.getByTestId("execution-fill-ws-0001")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 fills")).toBeInTheDocument();
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

  it("streams a market quote into the Markets screen row (M6 single pipeline)", async () => {
    // The watchlist is the source of the instrument set; the quote arrives on
    // the terminal's ONE existing WebSocket — no second connection anywhere.
    watchlistActions.addInstrument({
      symbol: "AAPL",
      asset_class: "EQUITY",
      currency: "USD",
      exchange: "NASDAQ",
    });
    await loginForTests(TEST_TRADER);
    renderApp();
    await act(async () => {});
    await act(async () => {
      MockWebSocket.latest().open();
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      MockWebSocket.latest().receive(
        envelope("market.quote.updated", {
          quote: quoteJ({ timestamp: new Date().toISOString() }),
        }),
      );
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Markets" }));

    const row = screen.getByTestId("market-row-AAPL");
    expect(within(row).getByText("150.25")).toBeInTheDocument();
    // A stream-driven quote is labelled Live; the freshness rule is shared.
    expect(within(row).getByText("Live")).toBeInTheDocument();
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
