/**
 * Order-history filtering / sorting / aggregation — M5.
 *
 * Kept PURE and free of React so the rules can be unit-tested directly. The
 * backend exposes `GET /orders?account_id=` only (no status/side/date query
 * parameters, no pagination — verified in `backend/api/rest.py`), so every
 * filter below is a client-side narrowing of the authoritative order list the
 * terminal already holds. Nothing here mutates or derives order state: the
 * status is always the backend's own value.
 *
 * DATE SEMANTICS: `created_at` is an ISO-8601 UTC string. The `from` / `to`
 * filters compare the UTC calendar day (the first 10 characters) against the
 * `YYYY-MM-DD` input, inclusive on both ends. This is stated in the UI so a
 * user whose session crosses midnight UTC is never misled into thinking the
 * boundary is local time.
 */

import { TERMINAL_STATUSES, type OrderOut, type OrderStatusValue } from "../../types/api";
import { compareDecimal } from "../../utils/decimal";

/** "FINISHED" = any terminal status (no longer working); "ALL" = literally all. */
export type HistoryStatusFilter = "FINISHED" | "ALL" | OrderStatusValue;

export interface HistoryFilters {
  /** Matches the symbol or the client order id (case-insensitive substring). */
  search: string;
  status: HistoryStatusFilter;
  side: "ALL" | "BUY" | "SELL";
  /** "ALL" or an exact account id present in the data. */
  account: string;
  /** Inclusive UTC day bound, `YYYY-MM-DD`, or "" for unbounded. */
  from: string;
  /** Inclusive UTC day bound, `YYYY-MM-DD`, or "" for unbounded. */
  to: string;
}

export type HistorySortKey = "created" | "symbol" | "status" | "quantity" | "filled";

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  search: "",
  status: "FINISHED",
  side: "ALL",
  account: "ALL",
  from: "",
  to: "",
};

/** The UTC calendar day of an ISO timestamp, or "" when unparseable. */
export function utcDay(isoTimestamp: string): string {
  return isoTimestamp.length >= 10 ? isoTimestamp.slice(0, 10) : "";
}

export function isFinished(order: OrderOut): boolean {
  return TERMINAL_STATUSES.has(order.status);
}

export function filterOrders(orders: OrderOut[], filters: HistoryFilters): OrderOut[] {
  const query = filters.search.trim().toUpperCase();
  return orders.filter((order) => {
    if (filters.status === "FINISHED") {
      if (!isFinished(order)) return false;
    } else if (filters.status !== "ALL") {
      if (order.status !== filters.status) return false;
    }
    if (filters.side !== "ALL" && order.side !== filters.side) return false;
    if (filters.account !== "ALL" && order.account_id !== filters.account) return false;
    if (query !== "") {
      const matches =
        order.symbol.toUpperCase().includes(query) ||
        order.client_order_id.toUpperCase().includes(query);
      if (!matches) return false;
    }
    if (filters.from !== "" || filters.to !== "") {
      const day = utcDay(order.created_at);
      if (day === "") return false; // unknown timestamp cannot satisfy a range
      if (filters.from !== "" && day < filters.from) return false;
      if (filters.to !== "" && day > filters.to) return false;
    }
    return true;
  });
}

/**
 * Stable sort by the requested key. Decimal fields compare NUMERICALLY
 * (string comparison would order "10" before "9"); every tie falls back to
 * `created_at` then the id so the table never jitters between renders.
 */
export function sortOrders(orders: OrderOut[], key: HistorySortKey, desc: boolean): OrderOut[] {
  const sorted = orders.slice();
  sorted.sort((a, b) => {
    let result = 0;
    switch (key) {
      case "symbol":
        result = a.symbol.localeCompare(b.symbol);
        break;
      case "status":
        result = a.status.localeCompare(b.status);
        break;
      case "quantity":
        result = compareDecimal(a.quantity, b.quantity);
        break;
      case "filled":
        result = compareDecimal(a.filled_quantity, b.filled_quantity);
        break;
      case "created":
      default:
        // ISO-8601 UTC strings order lexicographically.
        result = a.created_at.localeCompare(b.created_at);
        break;
    }
    if (result === 0) result = a.created_at.localeCompare(b.created_at);
    if (result === 0) result = a.client_order_id.localeCompare(b.client_order_id);
    return desc ? -result : result;
  });
  return sorted;
}

/** Counts per backend status (only statuses actually present are keys). */
export function countByStatus(orders: OrderOut[]): Partial<Record<OrderStatusValue, number>> {
  const counts: Partial<Record<OrderStatusValue, number>> = {};
  for (const order of orders) counts[order.status] = (counts[order.status] ?? 0) + 1;
  return counts;
}

/** Distinct account ids present in the data, sorted (drives the account filter). */
export function distinctAccounts(orders: OrderOut[]): string[] {
  return [...new Set(orders.map((order) => order.account_id))].sort();
}

/** The order-data totals used by the Activity page header. */
export interface HistorySummary {
  finished: number;
  filled: number;
  cancelled: number;
  rejected: number;
  expired: number;
  partiallyFilled: number;
  working: number;
}

export function summarize(orders: OrderOut[]): HistorySummary {
  let filled = 0;
  let cancelled = 0;
  let rejected = 0;
  let expired = 0;
  let partiallyFilled = 0;
  let working = 0;
  for (const order of orders) {
    switch (order.status) {
      case "FILLED":
        filled += 1;
        break;
      case "CANCELLED":
        cancelled += 1;
        break;
      case "REJECTED":
        rejected += 1;
        break;
      case "EXPIRED":
        expired += 1;
        break;
      case "PARTIALLY_FILLED":
        partiallyFilled += 1;
        break;
      default:
        working += 1; // NEW / PENDING_SUBMIT / SUBMITTED / PENDING_CANCEL
        break;
    }
  }
  return {
    finished: filled + cancelled + rejected + expired,
    filled,
    cancelled,
    rejected,
    expired,
    partiallyFilled,
    working,
  };
}
