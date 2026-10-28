/**
 * Order-history filter/sort/aggregate unit tests (M5).
 *
 * These cover the rules that decide what a user sees on a read-only history
 * screen, so they are asserted directly against real `OrderOut` objects rather
 * than through the DOM: status classification, client-side narrowing (the
 * backend only filters by account), UTC date-range semantics, numeric sorting
 * of decimal strings, and the summary counts.
 */

import { describe, expect, it } from "vitest";

import { orderOut } from "../../test/mocks";
import {
  countByStatus,
  distinctAccounts,
  EMPTY_HISTORY_FILTERS,
  filterOrders,
  isFinished,
  sortOrders,
  summarize,
  utcDay,
  type HistoryFilters,
} from "./orderHistoryFilters";

function filters(overrides: Partial<HistoryFilters> = {}): HistoryFilters {
  return { ...EMPTY_HISTORY_FILTERS, ...overrides };
}

describe("orderHistoryFilters", () => {
  it("treats FILLED/CANCELLED/REJECTED/EXPIRED as finished and working states as not", () => {
    expect(isFinished(orderOut({ status: "FILLED" }))).toBe(true);
    expect(isFinished(orderOut({ status: "CANCELLED" }))).toBe(true);
    expect(isFinished(orderOut({ status: "REJECTED" }))).toBe(true);
    expect(isFinished(orderOut({ status: "EXPIRED" }))).toBe(true);
    expect(isFinished(orderOut({ status: "SUBMITTED" }))).toBe(false);
    expect(isFinished(orderOut({ status: "PARTIALLY_FILLED" }))).toBe(false);
    expect(isFinished(orderOut({ status: "PENDING_CANCEL" }))).toBe(false);
  });

  it("default filter shows finished orders only — a working order is never history", () => {
    const orders = [
      orderOut({ client_order_id: "a", status: "FILLED", symbol: "AAPL" }),
      orderOut({ client_order_id: "b", status: "SUBMITTED", symbol: "MSFT" }),
      orderOut({ client_order_id: "c", status: "PARTIALLY_FILLED", symbol: "NVDA" }),
    ];
    const visible = filterOrders(orders, filters());
    expect(visible.map((o) => o.client_order_id)).toEqual(["a"]);
  });

  it("status filter narrows to an exact backend status", () => {
    const orders = [
      orderOut({ client_order_id: "a", status: "FILLED" }),
      orderOut({ client_order_id: "b", status: "REJECTED" }),
      orderOut({ client_order_id: "c", status: "PARTIALLY_FILLED" }),
    ];
    expect(filterOrders(orders, filters({ status: "REJECTED" })).map((o) => o.status)).toEqual([
      "REJECTED",
    ]);
    expect(
      filterOrders(orders, filters({ status: "PARTIALLY_FILLED" })).map((o) => o.status),
    ).toEqual(["PARTIALLY_FILLED"]);
    expect(filterOrders(orders, filters({ status: "ALL" }))).toHaveLength(3);
  });

  it("filters by side and by account without merging identities", () => {
    const orders = [
      orderOut({ client_order_id: "a", status: "FILLED", side: "BUY", account_id: "ACC-001" }),
      orderOut({ client_order_id: "b", status: "FILLED", side: "SELL", account_id: "ACC-002" }),
    ];
    expect(filterOrders(orders, filters({ side: "SELL" })).map((o) => o.client_order_id)).toEqual([
      "b",
    ]);
    expect(filterOrders(orders, filters({ account: "ACC-002" })).map((o) => o.account_id)).toEqual([
      "ACC-002",
    ]);
  });

  it("searches by symbol and by order id, case-insensitively", () => {
    const orders = [
      orderOut({ client_order_id: "aaaa1111-0000", status: "FILLED", symbol: "AAPL" }),
      orderOut({ client_order_id: "bbbb2222-0000", status: "FILLED", symbol: "MSFT" }),
    ];
    expect(filterOrders(orders, filters({ search: "msft" })).map((o) => o.symbol)).toEqual([
      "MSFT",
    ]);
    expect(filterOrders(orders, filters({ search: "BBBB" })).map((o) => o.client_order_id)).toEqual(
      ["bbbb2222-0000"],
    );
  });

  it("applies an inclusive UTC-day range on created_at", () => {
    const insideFirst = orderOut({
      client_order_id: "a",
      status: "FILLED",
      created_at: "2026-09-20T00:00:00+00:00",
    });
    const insideLast = orderOut({
      client_order_id: "b",
      status: "FILLED",
      created_at: "2026-09-21T23:59:59+00:00",
    });
    const before = orderOut({
      client_order_id: "c",
      status: "FILLED",
      created_at: "2026-09-19T23:59:59+00:00",
    });
    const after = orderOut({
      client_order_id: "d",
      status: "FILLED",
      created_at: "2026-09-22T00:00:00+00:00",
    });
    const orders = [before, insideFirst, insideLast, after];
    const visible = filterOrders(orders, filters({ from: "2026-09-20", to: "2026-09-21" }));
    expect(visible.map((o) => o.client_order_id)).toEqual(["a", "b"]);
  });

  it("excludes orders with an unparseable timestamp when a range is set", () => {
    const orders = [orderOut({ status: "FILLED", created_at: "" })];
    expect(filterOrders(orders, filters({ from: "2026-01-01" }))).toHaveLength(0);
    expect(filterOrders(orders, filters())).toHaveLength(1); // no range → not filtered
  });

  it("utcDay reads the calendar day from the ISO string", () => {
    expect(utcDay("2026-09-27T10:00:00+00:00")).toBe("2026-09-27");
    expect(utcDay("")).toBe("");
  });

  it("sorts decimal quantities NUMERICALLY, not lexicographically", () => {
    const orders = [
      orderOut({ client_order_id: "ten", status: "FILLED", quantity: "10" }),
      orderOut({ client_order_id: "nine", status: "FILLED", quantity: "9" }),
      orderOut({ client_order_id: "hundred", status: "FILLED", quantity: "100" }),
    ];
    expect(sortOrders(orders, "quantity", false).map((o) => o.quantity)).toEqual([
      "9",
      "10",
      "100",
    ]);
    expect(sortOrders(orders, "quantity", true).map((o) => o.quantity)).toEqual(["100", "10", "9"]);
  });

  it("sorts by filled quantity and by created timestamp, with deterministic tie-breaks", () => {
    const orders = [
      orderOut({ client_order_id: "b", status: "FILLED", filled_quantity: "5" }),
      orderOut({ client_order_id: "a", status: "FILLED", filled_quantity: "0" }),
    ];
    expect(sortOrders(orders, "filled", false).map((o) => o.client_order_id)).toEqual(["a", "b"]);

    const sameTime = [
      orderOut({ client_order_id: "y", status: "FILLED", created_at: "2026-09-27T10:00:00+00:00" }),
      orderOut({ client_order_id: "x", status: "FILLED", created_at: "2026-09-27T10:00:00+00:00" }),
    ];
    // Ties resolve by id so repeated renders never reshuffle the table.
    expect(sortOrders(sameTime, "created", false).map((o) => o.client_order_id)).toEqual([
      "x",
      "y",
    ]);
  });

  it("summarizes statuses without inventing a count", () => {
    const orders = [
      orderOut({ status: "FILLED" }),
      orderOut({ status: "CANCELLED" }),
      orderOut({ status: "REJECTED" }),
      orderOut({ status: "EXPIRED" }),
      orderOut({ status: "PARTIALLY_FILLED" }),
      orderOut({ status: "SUBMITTED" }),
      orderOut({ status: "NEW" }),
    ];
    const summary = summarize(orders);
    expect(summary).toEqual({
      finished: 4,
      filled: 1,
      cancelled: 1,
      rejected: 1,
      expired: 1,
      partiallyFilled: 1,
      working: 2,
    });
  });

  it("counts per status and lists distinct accounts", () => {
    const orders = [
      orderOut({ status: "FILLED", account_id: "ACC-002" }),
      orderOut({ status: "FILLED", account_id: "ACC-001" }),
      orderOut({ status: "REJECTED", account_id: "ACC-001" }),
    ];
    expect(countByStatus(orders)).toEqual({ FILLED: 2, REJECTED: 1 });
    expect(distinctAccounts(orders)).toEqual(["ACC-001", "ACC-002"]);
  });
});
