/**
 * Portfolio allocation computation (M3) — PURE functions, fully unit-tested.
 *
 * Financial-correctness rules (M3 brief):
 * - Values are computed EXACTLY (BigInt string decimals via
 *   multiplyDecimal/addDecimal) from the backend's authoritative position
 *   rows. Floats appear ONLY for bar widths / percentage display
 *   (ADR-017: "floats only for chart pixels").
 * - NEVER sums across currencies: every group is per-currency; shares are
 *   computed only within a currency group. There is no FX-conversion
 *   endpoint (documented ADR-013 limitation), so cross-currency totals are
 *   structurally impossible here.
 * - "Allocation" = share of GROSS exposure within a currency (Σ|market
 *   values|) so short positions contribute without hiding them; each row's
 *   signed market value is shown alongside its share.
 * - Positions without a market price (or zero quantity) are EXCLUDED and
 *   counted — never silently treated as zero value.
 */

import type { PositionOut } from "../../types/api";
import { addDecimal, decimalSign, multiplyDecimal } from "../../utils/decimal";

export interface AllocationRow {
  symbol: string;
  exchange: string;
  /** Signed exact market value (quantity × market price), decimal string. */
  value: string;
  /** |value| as a decimal string (for gross grouping). */
  absValue: string;
  /** Share of the currency group's gross exposure, 0..1 (display float). */
  share: number;
  /** Display percentage (0..100, rounded). */
  percent: number;
  stale: boolean;
}

export interface AllocationGroup {
  currency: string;
  /** Gross exposure for the currency: Σ|market values| (exact string). */
  gross: string;
  rows: AllocationRow[];
  /** Total priced rows in this currency group (rows may be truncated). */
  rowCount: number;
  unpricedCount: number;
  staleCount: number;
}

export interface AllocationResult {
  groups: AllocationGroup[];
  /** Positions excluded because they have no market price. */
  unpricedTotal: number;
}

const MAX_ROWS = 8;

/** |decimal string| — strips a leading minus sign exactly. */
function absDecimal(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

/**
 * Derive per-currency instrument allocation from position rows.
 * Positions with a null market price or zero quantity are excluded
 * (counted per group); everything else is exact string arithmetic.
 */
export function computeAllocation(positions: PositionOut[]): AllocationResult {
  const byCurrency = new Map<string, { priced: PositionOut[]; unpriced: number }>();

  for (const position of positions) {
    if (decimalSign(position.quantity) === 0) continue; // flat rows carry no exposure
    const group = byCurrency.get(position.currency) ?? { priced: [], unpriced: 0 };
    if (position.market_price === null) {
      group.unpriced += 1;
    } else {
      group.priced.push(position);
    }
    byCurrency.set(position.currency, group);
  }

  const groups: AllocationGroup[] = [];
  let unpricedTotal = 0;

  for (const [currency, { priced, unpriced }] of byCurrency) {
    unpricedTotal += unpriced;
    if (priced.length === 0) continue; // nothing renderable — but keep the unpriced count

    // Exact signed market values per position.
    const valued = priced
      .map((position) => ({
        position,
        value: multiplyDecimal(position.quantity, position.market_price as string),
      }))
      .filter((entry): entry is { position: PositionOut; value: string } => entry.value !== null);

    // Gross exposure per currency: Σ|values| (exact).
    let gross: string | null = "0";
    for (const entry of valued) {
      gross = addDecimal(gross, absDecimal(entry.value));
      if (gross === null) break;
    }
    if (gross === null || valued.length === 0) continue;

    const grossNumber = Number(gross);
    const rows: AllocationRow[] = valued
      .map(({ position, value }) => {
        const absValue = absDecimal(value);
        // Share as a display float only (bar width / percentage label).
        const share = grossNumber > 0 ? Number(absValue) / grossNumber : 0;
        return {
          symbol: position.symbol,
          exchange: position.exchange,
          value,
          absValue,
          share,
          percent: Math.round(share * 100),
          stale: position.stale,
        };
      })
      .sort((a, b) => Number(b.absValue) - Number(a.absValue));

    groups.push({
      currency,
      gross,
      rows: rows.slice(0, MAX_ROWS),
      rowCount: rows.length,
      unpricedCount: unpriced,
      staleCount: rows.filter((row) => row.stale).length,
    });
  }

  groups.sort((a, b) => a.currency.localeCompare(b.currency));
  return { groups, unpricedTotal };
}
