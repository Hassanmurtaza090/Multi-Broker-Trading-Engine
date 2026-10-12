/**
 * Terminal wiring integration tests (M11/M12): mock API + MockWebSocket
 * through the real `useTerminal` hook and the REAL stores — exercises the
 * full event-routing / resync / WS-ticket contract without a backend.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../services/api";
import {
  accountStore,
  brokersStore,
  connectionStore,
  ordersStore,
  positionsStore,
  resetAllStores,
  riskStore,
  uiStore,
} from "../stores";
import {
  balanceOut,
  createMockApi,
  envelope,
  MockWebSocket,
  mockSocketFactory,
  orderJ,
  positionJ,
} from "../test/mocks";
import { useTerminal } from "./useTerminal";

function setup() {
  const api = createMockApi();
  const hook = renderHook(() =>
    useTerminal({
      api: api as unknown as ApiClient,
      socketFactory: mockSocketFactory,
    }),
  );
  return { api, hook };
}

/** The socket open is async (WS ticket fetch, M12): flush the ticket
 *  resolution, then complete the connection, then flush the resync. */
async function connectOnce() {
  await act(async () => {}); // ticket fetch → factory(...)
  MockWebSocket.latest().open();
  await act(async () => {}); // onopen → resyncAll
}

describe("useTerminal wiring", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    resetAllStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("performs a full REST resync once the WS connects", async () => {
    const { api } = setup();
    await connectOnce();
    // Initial mount load + post-connect resync (both idempotent).
    expect(api.listBrokers.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(api.listOrders.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(api.listPositions).toHaveBeenCalledWith("ACC-001");
    expect(api.getBalance).toHaveBeenCalledWith("ACC-001");
    expect(api.getAccountSummary).toHaveBeenCalledWith("ACC-001");
    expect(api.getKillSwitch).toHaveBeenCalledWith("ACC-001");
    expect(connectionStore.getSnapshot().state).toBe("CONNECTED");
    expect(brokersStore.getSnapshot().brokers).toEqual([{ name: "IBKR", connected: true }]);
    expect(accountStore.getSnapshot().balance?.account_id).toBe("ACC-001");
  });

  it("fetches a fresh single-use WS ticket for every connection (M12)", async () => {
    const { api } = setup();
    await connectOnce();
    expect(api.createWsTicket).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.latest().url).toContain("/ws?topics=all&ticket=wst-mock-ticket");

    // Server-initiated close → reconnect must obtain a NEW ticket.
    api.createWsTicket.mockClear();
    vi.useFakeTimers();
    act(() => {
      MockWebSocket.latest().serverClose(1006, "lost");
    });
    await act(async () => {
      vi.advanceTimersByTime(500); // base backoff
      await Promise.resolve();
    });
    await act(async () => {}); // ticket → factory
    expect(api.createWsTicket).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("stores a 404 balance as the explicit 'missing' empty state", async () => {
    const { ApiError } = await import("../services/api");
    const api = createMockApi();
    // Every attempt (mount + connect resync) reports "no balance known".
    api.getBalance.mockRejectedValue(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "no balance" }),
    );
    renderHook(() =>
      useTerminal({ api: api as unknown as ApiClient, socketFactory: mockSocketFactory }),
    );
    await connectOnce();
    expect(accountStore.getSnapshot().balance).toBeNull();
    expect(accountStore.getSnapshot().balanceState).toBe("missing");
  });

  it("routes order events into the orders store (idempotent upsert)", async () => {
    setup();
    await connectOnce();
    const ws = MockWebSocket.latest();
    act(() => {
      ws.receive(envelope("order.submitted", { order: orderJ({ status: "PENDING_SUBMIT" }) }));
      ws.receive(envelope("order.accepted", { order: orderJ({ status: "SUBMITTED" }) }, "evt-2"));
    });
    const state = ordersStore.getSnapshot();
    expect(state.ids).toEqual([orderJ().client_order_id]);
    expect(state.byId[orderJ().client_order_id].status).toBe("SUBMITTED");
    expect(state.byId[orderJ().client_order_id].remaining_quantity).toBe("10");
  });

  it("applies position events for the watched account and debounces a REST resync", async () => {
    vi.useFakeTimers();
    const { api } = setup();
    await connectOnce();
    api.listPositions.mockClear();
    const ws = MockWebSocket.latest();
    act(() => {
      // Foreign account: ignored entirely (event AND resync).
      ws.receive(
        envelope(
          "position.opened",
          { position: positionJ({ account_id: "OTHER" }) },
          "evt-foreign",
        ),
      );
      ws.receive(envelope("position.opened", { position: positionJ() }, "evt-pos-1"));
    });
    expect(positionsStore.getSnapshot().keys).toEqual(["ACC-001|AAPL|NASDAQ|USD"]);
    await act(async () => {
      vi.advanceTimersByTime(300); // debounce fires
      await Promise.resolve();
    });
    expect(api.listPositions).toHaveBeenCalledTimes(1);
    expect(api.listPositions).toHaveBeenLastCalledWith("ACC-001");
  });

  it("records risk violations in the visible feed", async () => {
    setup();
    await connectOnce();
    act(() => {
      MockWebSocket.latest().receive(
        envelope(
          "risk.violation",
          {
            account_id: "ACC-001",
            instrument: null,
            rule: "kill_switch",
            message: "kill switch is active",
          },
          "evt-risk-1",
        ),
      );
    });
    const { violations } = riskStore.getSnapshot();
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("kill_switch");
  });

  it("flags connection loss and resyncs after reconnect", async () => {
    vi.useFakeTimers();
    const { api } = setup();
    await connectOnce();
    // Mount load (1) + post-connect resync (2).
    expect(api.listOrders.mock.calls.length).toBe(2);

    act(() => {
      MockWebSocket.latest().serverClose(1006, "lost");
    });
    expect(connectionStore.getSnapshot().state).toBe("RECONNECTING");
    expect(connectionStore.getSnapshot().attempt).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(500); // base backoff (ticket fetch is a microtask)
      await Promise.resolve();
    });
    await act(async () => {});
    MockWebSocket.latest().open();
    await act(async () => {});
    expect(connectionStore.getSnapshot().state).toBe("CONNECTED");
    // Resync after reconnect = 3.
    expect(api.listOrders.mock.calls.length).toBe(3);
  });

  it("applies balance.updated events to the account store", async () => {
    setup();
    await connectOnce();
    act(() => {
      MockWebSocket.latest().receive(
        envelope(
          "balance.updated",
          {
            balance: {
              account_id: "ACC-001",
              cash: {
                USD: {
                  currency: { code: "USD" },
                  total: { amount: "42.50", currency: { code: "USD" } },
                  available: { amount: "42.50", currency: { code: "USD" } },
                  buying_power: null,
                },
              },
              equity: null,
              margin_used: null,
              realized_pnl: null,
              unrealized_pnl: null,
            },
          },
          "evt-bal-1",
        ),
      );
    });
    expect(accountStore.getSnapshot().balance?.cash[0].total).toBe("42.50");
  });

  it("account switch clears account-scoped state and resyncs the new account", async () => {
    const { api } = setup();
    await connectOnce();
    expect(balanceOut().account_id).toBe("ACC-001");

    act(() => {
      uiStore.update((s) => ({ ...s, accountId: "ACC-002" }));
    });
    // State cleared synchronously to avoid showing the old account's data.
    expect(accountStore.getSnapshot().balance).toBeNull();
    expect(positionsStore.getSnapshot().keys).toHaveLength(0);

    await vi.waitFor(() => {
      expect(api.listPositions).toHaveBeenCalledWith("ACC-002");
    });
    expect(api.getKillSwitch).toHaveBeenCalledWith("ACC-002");
  });
});
