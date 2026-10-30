/**
 * Report metrics (FE-M10) — PURE derivations, each with a stated formula.
 *
 * FINANCIAL RULES ENFORCED HERE:
 * - Exact decimal strings only (`multiplyDecimal` / `addDecimal`); floats are
 *   never used to produce a value, only inside the bar renderer for widths.
 * - NEVER sum across currencies. Every aggregate is keyed by currency, because
 *   no FX conversion exists (ADR-013) and there is no exchange-rate timestamp.
 * - An absent value stays absent (`null`), never 0.
 * - Order counts come from the backend's own `status` field (reusing the M5
 *   `summarize`), never re-derived from quantities, and a partially filled
 *   order is ONE order — not one trade per execution.
 *
 * Everything a report adds on top of the raw DTO is listed in the Reports
 * page's methodology table, which is generated from the same knowledge as
 * this module.
 */

import type { AccountSummaryOut, OrderOut, PositionOut } from "../../types/api";
import type { FillJ } from "../../types/events";
import { addDecimal, multiplyDecimal } from "../../utils/decimal";
import { summarize, type HistorySummary } from "../history/orderHistoryFilters";

export interface CurrencyAmount {
  currency: string;
  amount: string;
}

export interface OrderOutcomeCounts extends HistorySummary {
  /** Every order in the set, working ones included. */
  total: number;
}

/**
 * Order outcome counts over a set of orders. Deliberately the M5 `summarize`
 * plus a total — one implementation, one set of status semantics.
 */
export function countOrderOutcomes(orders: readonly OrderOut[]): OrderOutcomeCounts {
  return { total: orders.length, ...summarize([...orders]) };
}

/**
 * Exact per-currency gross notional of a set of fills:
 *
 *     notional(currency) = Σ quantity × executed price        (per fill)
 *
 * This is a TRADED TURNOVER, not a profit and not a valuation: no fees, no
 * reference price, no FX, and buys add to it exactly like sells do. It is
 * labelled as such wherever it is displayed.
 */
export function notionalByCurrency(fills: readonly FillJ[]): CurrencyAmount[] {
  const totals = new Map<string, string>();
  for (const fill of fills) {
    const value = multiplyDecimal(fill.quantity.value, fill.price.value);
    if (value === null) continue;
    const currency = fill.price.currency.code;
    const next = addDecimal(totals.get(currency) ?? "0", value);
    if (next !== null) totals.set(currency, next);
  }
  return [...totals]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface CommissionCoverage {
  /** Fills carrying a broker-reported commission or fee. */
  reported: number;
  total: number;
}

/**
 * How complete the cost data is. Commission/fees are OPTIONAL per fill
 * (`backend/domain/fills.py`), so the terminal reports coverage instead of
 * pretending a total cost exists when most fills omit it.
 */
export function commissionCoverage(fills: readonly FillJ[]): CommissionCoverage {
  let reported = 0;
  for (const fill of fills) {
    if (fill.commission !== null || fill.fees !== null) reported += 1;
  }
  return { reported, total: fills.length };
}

export interface PnlContribution {
  /** e.g. "USD realized" — currency and basis are always in the label. */
  label: string;
  /** Signed exact decimal string, straight from the backend map. */
  value: string;
  currency: string;
  basis: "realized" | "unrealized";
}

/**
 * Signed P&L contributions, one entry per (currency, basis). Realized and
 * unrealized are separate series by construction — they are different facts
 * and are never netted here (netting would be a derived metric with its own
 * meaning, and it is not computed anywhere in this build).
 */
export function pnlContributions(summary: AccountSummaryOut | null): PnlContribution[] {
  if (summary === null) return [];
  const currencies = [
    ...new Set([...Object.keys(summary.realized_pnl), ...Object.keys(summary.unrealized_pnl)]),
  ].sort();
  const items: PnlContribution[] = [];
  for (const currency of currencies) {
    const realized = summary.realized_pnl[currency];
    const unrealized = summary.unrealized_pnl[currency];
    if (realized !== undefined) {
      items.push({ label: `${currency} realized`, value: realized, currency, basis: "realized" });
    }
    if (unrealized !== undefined) {
      items.push({
        label: `${currency} unrealized`,
        value: unrealized,
        currency,
        basis: "unrealized",
      });
    }
  }
  return items;
}

/**
 * Per-position market value, exact:
 *
 *     market value = quantity × market price
 *
 * The backend exposes this only as a per-currency TOTAL (`summary.market_value`),
 * not per position. The derivation is the same one `computeAllocation` (M3)
 * already performs on the backend's own position rows; `null` when the
 * position has no market price.
 */
export function positionMarketValue(position: PositionOut): string | null {
  if (position.market_price === null) return null;
  return multiplyDecimal(position.quantity, position.market_price);
}

/** Currencies present in a summary's three per-currency maps, sorted. */
export function summaryCurrencies(summary: AccountSummaryOut | null): string[] {
  if (summary === null) return [];
  return [
    ...new Set([
      ...Object.keys(summary.realized_pnl),
      ...Object.keys(summary.unrealized_pnl),
      ...Object.keys(summary.market_value),
    ]),
  ].sort();
}
