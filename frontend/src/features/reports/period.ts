/**
 * Report period resolution (FE-M10) — PURE and deterministic.
 *
 * WHAT A PERIOD CAN AND CANNOT DO HERE (verified against the backend first):
 * there is no reporting/analytics endpoint and no persisted history — the OMS
 * and the portfolio are in-memory read models. `GET /orders` takes only an
 * optional `account_id` and supports no date range. Every period filter below
 * is therefore a CLIENT-SIDE narrowing of the records this terminal already
 * holds, and it can only apply to records that carry a timestamp:
 *
 *   - orders   → `created_at`   (UTC calendar day, the FE-M5 `utcDay` rule)
 *   - fills    → `executed_at`  (UTC calendar day; session capture only)
 *
 * It CANNOT scope the account snapshot (`summary` / `balance` / `positions`):
 * those endpoints return current state with no period attribution, so a
 * "Last 7 days" statement would be a lie. The UI says so on every affected
 * card rather than silently ignoring the control.
 *
 * Bounds are INCLUSIVE UTC calendar days. `now` is injectable so boundary
 * behaviour is testable without depending on the wall clock.
 */

import type { OrderOut } from "../../types/api";
import type { FillJ } from "../../types/events";
import { utcDay } from "../history/orderHistoryFilters";

export type ReportPeriod = "LAST_7_DAYS" | "LAST_30_DAYS" | "THIS_YEAR";

/** Option order mirrors the Figma "Generate a report" range select. */
export const REPORT_PERIODS: readonly { value: ReportPeriod; label: string }[] = [
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "LAST_7_DAYS", label: "Last 7 days" },
  { value: "THIS_YEAR", label: "This year" },
];

export const DEFAULT_REPORT_PERIOD: ReportPeriod = "LAST_30_DAYS";

export interface PeriodRange {
  /** Inclusive UTC day bound (`YYYY-MM-DD`); "" means unbounded. */
  fromDay: string;
  /** Inclusive UTC day bound (`YYYY-MM-DD`); "" means unbounded. */
  toDay: string;
  /** Human-readable bound shown in the UI and inside exported files. */
  label: string;
}

function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Shift a UTC calendar day by `days` (DST-proof: dates are built in UTC). */
function shiftUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/**
 * Resolve a period to inclusive UTC day bounds.
 *
 * "Last 7 days" covers today plus the 6 preceding UTC days (7 calendar days
 * inclusive); "Last 30 days" likewise covers 30 inclusive days; "This year"
 * runs from 1 January UTC. An unreadable clock yields unbounded bounds AND
 * says so in `label`, so the degradation is never invisible.
 */
export function resolvePeriodRange(period: ReportPeriod, now: Date): PeriodRange {
  if (Number.isNaN(now.getTime())) {
    return {
      fromDay: "",
      toDay: "",
      label: "unbounded — the terminal clock could not be read",
    };
  }
  const toDay = utcDayOf(now);
  let fromDay: string;
  switch (period) {
    case "LAST_7_DAYS":
      fromDay = utcDayOf(shiftUtcDays(now, -6));
      break;
    case "LAST_30_DAYS":
      fromDay = utcDayOf(shiftUtcDays(now, -29));
      break;
    case "THIS_YEAR":
    default:
      fromDay = `${now.getUTCFullYear()}-01-01`;
      break;
  }
  return {
    fromDay,
    toDay,
    label: `${fromDay} … ${toDay} (UTC calendar days, inclusive)`,
  };
}

/** Inclusive UTC-calendar-day membership (same convention as order history). */
export function dayInRange(isoTimestamp: string, range: PeriodRange): boolean {
  const day = utcDay(isoTimestamp);
  if (day === "") return false; // an unknown timestamp cannot satisfy a range
  if (range.fromDay !== "" && day < range.fromDay) return false;
  if (range.toDay !== "" && day > range.toDay) return false;
  return true;
}

export function filterOrdersByPeriod(orders: readonly OrderOut[], range: PeriodRange): OrderOut[] {
  return orders.filter((order) => dayInRange(order.created_at, range));
}

export function filterFillsByPeriod(fills: readonly FillJ[], range: PeriodRange): FillJ[] {
  return fills.filter((fill) => dayInRange(fill.executed_at, range));
}
