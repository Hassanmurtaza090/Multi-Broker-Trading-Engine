import { describe, expect, it } from "vitest";

import {
  instrumentJ,
  orderJ,
  orderOut,
  positionJ,
  positionOut,
  quoteJ,
  quoteOut,
} from "../test/mocks";
import { instrumentKey, descriptorFromJ, type InstrumentDescriptor } from "../utils/instrument";
import { formatDecimal } from "../utils/decimal";
import { createAccountStore } from "./accountStore";
import { applyBrokerEvent, createBrokersStore } from "./brokersStore";
import {
  applyQuoteJ,
  applyQuoteOut,
  addWatch,
  createMarketStore,
  HISTORY_LIMIT,
  isQuoteStale,
  removeWatch,
} from "./marketStore";
import { balanceFromJ, orderFromJ, positionFromJ } from "./mappers";
import { createOrdersStore, replaceOrders, upsertOrder } from "./ordersStore";
import { applyPositionEvent, createPositionsStore, replacePositions } from "./positionsStore";
import { createRiskStore, pushViolation, VIOLATIONS_LIMIT } from "./riskStore";

const AAPL: InstrumentDescriptor = descriptorFromJ(instrumentJ());
const keyAapl = instrumentKey(AAPL);

describe("orders store", () => {
  it("upserts by client_order_id (WS replay cannot duplicate)", () => {
    const store = createOrdersStore();
    store.update((s) => upsertOrder(s, orderFromJ(orderJ())));
    store.update((s) => upsertOrder(s, orderFromJ(orderJ({ status: "FILLED" }))));
    const state = store.getSnapshot();
    expect(state.ids).toHaveLength(1);
    expect(state.byId[orderJ().client_order_id].status).toBe("FILLED");
  });

  it("maps remaining_quantity exactly from WS payloads (string decimals)", () => {
    const store = createOrdersStore();
    store.update((s) =>
      upsertOrder(
        s,
        orderFromJ(orderJ({ quantity: { value: "0.10" }, filled_quantity: { value: "0.03" } })),
      ),
    );
    expect(store.getSnapshot().byId[orderJ().client_order_id].remaining_quantity).toBe("0.07");
  });

  it("maps remaining_quantity when the backend serializes scaled zero as 0E-8", () => {
    // str(Decimal("0.00000000")) is "0E-8" — the pre-M1 mapper crashed
    // BigInt() on it (found live via the Playwright visual check).
    const store = createOrdersStore();
    store.update((s) =>
      upsertOrder(
        s,
        orderFromJ(
          orderJ({ quantity: { value: "10.00000000" }, filled_quantity: { value: "0E-8" } }),
        ),
      ),
    );
    const order = store.getSnapshot().byId[orderJ().client_order_id];
    expect(order.remaining_quantity).toBe("10");
    // The wire value is preserved; the display layer normalizes it to "0".
    expect(order.filled_quantity).toBe("0E-8");
    expect(formatDecimal(order.filled_quantity)).toBe("0");
  });

  it("replaceOrders is authoritative and newest-first", () => {
    let state = createOrdersStore().getSnapshot();
    state = replaceOrders(state, [
      orderOut({ client_order_id: "a", created_at: "2026-09-27T10:00:00+00:00" }),
      orderOut({ client_order_id: "b", created_at: "2026-09-27T11:00:00+00:00" }),
    ]);
    expect(state.ids).toEqual(["b", "a"]);
    expect(state.loadState).toBe("ready");
  });
});

describe("positions store", () => {
  it("WS events reconcile with REST rows (same identity key)", () => {
    let state = createPositionsStore().getSnapshot();
    state = replacePositions(state, [positionOut()]);
    state = applyPositionEvent(state, positionJ({ quantity: { value: "5" } }), false);
    expect(state.keys).toHaveLength(1);
    expect(state.keys[0]).toBe("ACC-001|AAPL|NASDAQ|USD");
    const row = state.byKey[state.keys[0]];
    expect(row.quantity).toBe("5");
    // REST-only fields survive the WS update (no blanking to undefined).
    expect(row.market_price).toBe("151.00");
    expect(row.stale).toBe(false);
  });

  it("position.closed removes the row", () => {
    let state = createPositionsStore().getSnapshot();
    state = replacePositions(state, [positionOut()]);
    state = applyPositionEvent(state, positionJ({ quantity: { value: "0" } }), true);
    expect(state.keys).toHaveLength(0);
  });

  it("a WS-opened position defaults conservative stale=true until REST resync", () => {
    let state = createPositionsStore().getSnapshot();
    state = applyPositionEvent(state, positionJ(), false);
    expect(state.byKey[state.keys[0]].stale).toBe(true);
  });

  it("positionFromJ preserves prior REST fields when payload lacks them", () => {
    const previous = positionOut({ market_price: "151.00", unrealized_pnl: "12.50" });
    const mapped = positionFromJ(positionJ({ unrealized_pnl: null }), previous);
    expect(mapped.unrealized_pnl).toBe("12.50");
    expect(mapped.market_price).toBe("151.00");
  });
});

describe("market store", () => {
  it("merges REST and WS quotes for the same instrument", () => {
    let state = createMarketStore().getSnapshot();
    state = addWatch(state, AAPL);
    state = applyQuoteOut(state, AAPL, quoteOut({ last: "150.25", stale: true }));
    expect(state.quotes[keyAapl].serverStale).toBe(true);
    state = applyQuoteJ(
      state,
      quoteJ({ last: { value: "151.00", currency: { code: "USD" } } }),
      1000,
    );
    expect(state.quotes[keyAapl].last).toBe("151.00");
    expect(state.quotes[keyAapl].serverStale).toBe(false);
    expect(state.quotes[keyAapl].lastStreamAt).toBe(1000);
  });

  it("caps per-instrument history", () => {
    let state = createMarketStore().getSnapshot();
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      state = applyQuoteJ(
        state,
        quoteJ({ last: { value: String(100 + i), currency: { code: "USD" } } }),
        i,
      );
    }
    expect(state.history[keyAapl]).toHaveLength(HISTORY_LIMIT);
  });

  it("staleness combines the server flag and the client-side age window", () => {
    let state = createMarketStore().getSnapshot();
    state = applyQuoteOut(state, AAPL, quoteOut({ stale: true }));
    expect(isQuoteStale(state.quotes[keyAapl], Date.now(), 10_000)).toBe(true);

    state = applyQuoteOut(
      state,
      AAPL,
      quoteOut({ stale: false, timestamp: "2026-09-27T10:00:00+00:00" }),
    );
    const t = Date.parse("2026-09-27T10:00:11+00:00");
    expect(isQuoteStale(state.quotes[keyAapl], t, 10_000)).toBe(true);
    expect(
      isQuoteStale(state.quotes[keyAapl], Date.parse("2026-09-27T10:00:05+00:00"), 10_000),
    ).toBe(false);
  });

  it("removeWatch purges quote/fetch/history for the instrument", () => {
    let state = createMarketStore().getSnapshot();
    state = addWatch(state, AAPL);
    state = applyQuoteJ(state, quoteJ(), 1000);
    state = removeWatch(state, AAPL);
    expect(state.watchlist).toHaveLength(0);
    expect(state.quotes[keyAapl]).toBeUndefined();
    expect(state.history[keyAapl]).toBeUndefined();
  });
});

describe("brokers store", () => {
  it("broker events upsert connectivity", () => {
    let state = createBrokersStore().getSnapshot();
    state = applyBrokerEvent(state, "IBKR", true);
    state = applyBrokerEvent(state, "IBKR", false);
    expect(state.brokers).toEqual([{ name: "IBKR", connected: false }]);
  });
});

describe("risk store", () => {
  it("keeps a bounded newest-first violation feed", () => {
    let state = createRiskStore().getSnapshot();
    for (let i = 0; i < VIOLATIONS_LIMIT + 5; i += 1) {
      state = pushViolation(state, `evt-${i}`, "2026-09-27T10:00:00+00:00", {
        account_id: "ACC-001",
        instrument: null,
        rule: "kill_switch",
        message: "blocked",
      });
    }
    expect(state.violations).toHaveLength(VIOLATIONS_LIMIT);
    expect(state.violations[0].eventId).toBe(`evt-${VIOLATIONS_LIMIT + 4}`);
  });
});

describe("mappers", () => {
  it("balanceFromJ normalizes cash entries sorted by currency", () => {
    const mapped = balanceFromJ({
      account_id: "ACC-001",
      cash: {
        USD: {
          currency: { code: "USD" },
          total: { amount: "100.00", currency: { code: "USD" } },
          available: { amount: "90.00", currency: { code: "USD" } },
          buying_power: null,
        },
        EUR: {
          currency: { code: "EUR" },
          total: { amount: "50.00", currency: { code: "EUR" } },
          available: { amount: "50.00", currency: { code: "EUR" } },
          buying_power: { amount: "60.00", currency: { code: "EUR" } },
        },
      },
      equity: null,
      margin_used: null,
      realized_pnl: null,
      unrealized_pnl: null,
    });
    expect(mapped.cash.map((c) => c.currency)).toEqual(["EUR", "USD"]);
    expect(mapped.cash[1].buying_power).toBeNull();
  });
});

describe("account store", () => {
  it("resets cleanly", () => {
    const store = createAccountStore();
    store.update((s) => ({ ...s, killSwitchActive: true }));
    store.reset();
    expect(store.getSnapshot().killSwitchActive).toBeNull();
  });
});
