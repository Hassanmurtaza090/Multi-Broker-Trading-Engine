/**
 * Risk metrics (FE-M8) — PURE functions, unit-tested, no React.
 *
 * Source-of-truth rules (AGENTS + FE_SCOPE_RISK_PORTFOLIO_REPORTS §2):
 * - Exact-decimal string arithmetic only (BigInt via `utils/decimal`). Floats
 *   are used SOLELY for percentage labels and bar widths — the same rule the
 *   M3 allocation module follows ("floats only for chart pixels").
 * - NEVER sum across currencies. Every exposure figure here is grouped by the
 *   position's own currency; there is no FX conversion endpoint (ADR-013), so
 *   a cross-currency total is structurally impossible rather than merely
 *   avoided.
 * - Backend values win. `PositionOut.unrealized_pnl` and
 *   `AccountSummaryOut.exposure` are displayed exactly as reported; the only
 *   derived numbers here are quantities the API does not report per field
 *   (long/short split, gross/net per currency, concentration share, exposure
 *   as a share of equity) and each is labelled as derived in the UI.
 * - Missing is not zero. A position without a market price is EXCLUDED from
 *   every exposure figure and counted, never valued at 0.
 *
 * What this module deliberately cannot produce, because the data does not
 * exist: margin usage/level, used margin, VaR, max drawdown, leverage, return
 * series. Those are surfaced as explicit "not reported" rows, never estimated.
 */

import type { PositionOut } from "../../types/api";
import { addDecimal, decimalSign, decimalToNumber, multiplyDecimal } from "../../utils/decimal";
import type { AllocationResult } from "../portfolio/allocation";

// --- risk rule catalogue ---------------------------------------------------------

/**
 * The eight pre-trade rules the backend actually runs, transcribed from
 * `backend/risk/rules.py` (`ALL_RULES`) and `backend/risk/policy.py`
 * (`RiskLimits`). These are ENFORCED by the risk gate on every order
 * submission — the UI only reports the rule set, it never performs the check.
 */
export interface RiskRuleInfo {
  /** Exact backend rule name (as returned by `RuleResultOut.rule`). */
  rule: string;
  title: string;
  /** What the rule blocks when its limit is configured. */
  enforces: string;
  /**
   * `RiskLimits` field that configures the rule (verified in
   * `backend/risk/policy.py`), or `null` for the unconditional kill switch.
   */
  limitField: string | null;
  /** True when the rule needs market/portfolio data to decide. */
  needsData: boolean;
}

export const RISK_RULES: readonly RiskRuleInfo[] = [
  {
    rule: "kill_switch",
    title: "Kill switch",
    enforces: "Rejects every order while the account's emergency halt is active.",
    limitField: null,
    needsData: false,
  },
  {
    rule: "order_size_limit",
    title: "Max order size",
    enforces: "Rejects an order whose quantity exceeds the per-order limit.",
    limitField: "max_order_quantity",
    needsData: false,
  },
  {
    rule: "position_limit",
    title: "Max position size",
    enforces: "Rejects an order that would push the net position beyond the limit.",
    limitField: "position_limit",
    needsData: false,
  },
  {
    rule: "notional_exposure_limit",
    title: "Max notional exposure",
    enforces: "Rejects an order that would push total notional exposure past the limit.",
    limitField: "max_notional_exposure",
    needsData: true,
  },
  {
    rule: "available_funds_limit",
    title: "Available funds",
    enforces: "Rejects a buy whose notional exceeds available cash / buying power.",
    limitField: "require_available_funds",
    needsData: true,
  },
  {
    rule: "daily_order_count_limit",
    title: "Daily order count",
    enforces: "Rejects orders once the day's order count reaches the limit.",
    limitField: "max_daily_orders",
    needsData: false,
  },
  {
    rule: "daily_loss_limit",
    title: "Daily loss",
    enforces: "Rejects orders when today's realized P&L breaches the loss limit.",
    limitField: "max_daily_loss",
    needsData: true,
  },
  {
    rule: "trading_session",
    title: "Trading session",
    enforces: "Rejects orders placed outside the configured UTC trading window.",
    limitField: "trading_window",
    needsData: false,
  },
];

/**
 * Metrics the Figma Risk screen shows that this platform cannot compute from
 * any existing data. Rendered as explicit "not reported" rows so the absence
 * is visible in the UI rather than only in documentation.
 */
export interface UnavailableMetric {
  metric: string;
  reason: string;
}

export const UNAVAILABLE_METRICS: readonly UnavailableMetric[] = [
  {
    metric: "Daily drawdown",
    reason:
      "No equity time series and no start-of-day equity exist, so a drawdown cannot be measured. A value here would be invented.",
  },
  {
    metric: "Margin level / used margin",
    reason: "No margin, requirement or leverage data appears in any API response.",
  },
  {
    metric: "VaR (95%)",
    reason:
      "Requires a return series and a covariance model. Estimating one from a handful of session quotes would be statistically meaningless and would look authoritative.",
  },
  {
    metric: "Max drawdown",
    reason: "Requires the same persisted equity curve as daily drawdown.",
  },
  {
    metric: "Leverage",
    reason:
      "Requires equity and gross exposure in a single currency — cross-currency totals are impossible without FX conversion (ADR-013).",
  },
];

// --- derived metrics -------------------------------------------------------------

/**
 * Exposure as a share of equity (0..1), or `null` when it cannot be derived
 * honestly.
 *
 * Both inputs are server-reported scalars with no currency field on the wire,
 * so the ratio is unitless and only meaningful when both are the same
 * currency — which the API does not state. The UI therefore labels it
 * "derived" and treats `null` (not zero) as the answer whenever either side is
 * missing, equity is zero/negative, or the inputs cannot be parsed.
 */
export function exposureToEquityRatio(
  exposure: string | null | undefined,
  equity: string | null | undefined,
): number | null {
  if (exposure === null || exposure === undefined || equity === null || equity === undefined) {
    return null;
  }
  if (decimalSign(equity) <= 0) return null;
  const exposureNumber = decimalToNumber(exposure);
  const equityNumber = decimalToNumber(equity);
  if (exposureNumber === null || equityNumber === null || equityNumber === 0) return null;
  return exposureNumber / equityNumber;
}

/** Display percentage (rounded to one decimal) for a ratio, or `null`. */
export function ratioPercent(ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return Math.round(ratio * 1000) / 10;
}

export type PositionDirection = "LONG" | "SHORT" | "FLAT";

/** Direction from the signed quantity (never inferred from P&L). */
export function directionOf(quantity: string): PositionDirection {
  const sign = decimalSign(quantity);
  if (sign > 0) return "LONG";
  if (sign < 0) return "SHORT";
  return "FLAT";
}

export interface CurrencyExposure {
  currency: string;
  /** Σ|quantity × market price| — gross exposure for this currency (exact). */
  gross: string;
  /** Σ market value of long positions (exact, positive). */
  long: string;
  /** |Σ market value of short positions| (exact, positive magnitude). */
  short: string;
  /** Σ signed market value (long − short) (exact). */
  net: string;
  /** Priced, non-flat positions contributing to this group. */
  pricedCount: number;
  /** Positions excluded because no market price was reported. */
  unpricedCount: number;
  /** Priced rows whose mark is flagged stale by the backend. */
  staleCount: number;
}

/** |decimal| without floats. */
function absDecimal(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

/**
 * Per-currency long / short / net / gross exposure from the authoritative
 * position rows. Positions with no market price or zero quantity are excluded
 * and counted — never treated as zero value, never silently dropped.
 */
export function exposureByCurrency(positions: readonly PositionOut[]): CurrencyExposure[] {
  const groups = new Map<
    string,
    {
      gross: string;
      long: string;
      short: string;
      net: string;
      pricedCount: number;
      unpricedCount: number;
      staleCount: number;
    }
  >();

  for (const position of positions) {
    const direction = directionOf(position.quantity);
    if (direction === "FLAT") continue;

    const group = groups.get(position.currency) ?? {
      gross: "0",
      long: "0",
      short: "0",
      net: "0",
      pricedCount: 0,
      unpricedCount: 0,
      staleCount: 0,
    };

    if (position.market_price === null) {
      group.unpricedCount += 1;
      groups.set(position.currency, group);
      continue;
    }

    const value = multiplyDecimal(position.quantity, position.market_price);
    const absValue = value === null ? null : absDecimal(value);
    const gross = absValue === null ? null : addDecimal(group.gross, absValue);
    const net = value === null ? null : addDecimal(group.net, value);
    const side =
      value === null
        ? null
        : direction === "LONG"
          ? addDecimal(group.long, value)
          : addDecimal(group.short, absValue as string);

    if (gross === null || net === null || side === null) {
      // Unparseable decimal: treat as unpriced rather than as zero.
      group.unpricedCount += 1;
      groups.set(position.currency, group);
      continue;
    }

    group.gross = gross;
    group.net = net;
    if (direction === "LONG") group.long = side;
    else group.short = side;
    group.pricedCount += 1;
    if (position.stale) group.staleCount += 1;
    groups.set(position.currency, group);
  }

  return [...groups.entries()]
    .map(([currency, group]) => ({ currency, ...group }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface ConcentrationEntry {
  currency: string;
  symbol: string;
  exchange: string;
  /** Share of the currency group's GROSS exposure (0..1, display float). */
  share: number;
  /** Rounded percentage for display. */
  percent: number;
}

/**
 * Largest single-instrument share of gross exposure per currency, reusing the
 * M3 allocation computation rather than forking it.
 *
 * Explicitly NOT "position concentration" in a regulatory sense: it is one
 * instrument's share of one currency's gross exposure, computed from marks.
 */
export function topConcentrationByCurrency(allocation: AllocationResult): ConcentrationEntry[] {
  return allocation.groups
    .filter((group) => group.rows.length > 0)
    .map((group) => {
      const top = group.rows[0];
      return {
        currency: group.currency,
        symbol: top.symbol,
        exchange: top.exchange,
        share: top.share,
        percent: top.percent,
      };
    });
}

export interface PositionSummary {
  open: number;
  long: number;
  short: number;
  stale: number;
  unpriced: number;
}

/** Counts for the metrics row and the position table's header. */
export function summarizePositions(positions: readonly PositionOut[]): PositionSummary {
  let open = 0;
  let long = 0;
  let short = 0;
  let stale = 0;
  let unpriced = 0;
  for (const position of positions) {
    const direction = directionOf(position.quantity);
    if (direction === "FLAT") continue;
    open += 1;
    if (direction === "LONG") long += 1;
    else short += 1;
    if (position.stale) stale += 1;
    if (position.market_price === null) unpriced += 1;
  }
  return { open, long, short, stale, unpriced };
}

/** Exact market value of one position, or `null` when it cannot be priced. */
export function positionMarketValue(position: PositionOut): string | null {
  if (position.market_price === null) return null;
  return multiplyDecimal(position.quantity, position.market_price);
}
