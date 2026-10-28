/**
 * Session price change (M6) — a derived metric with an explicit, narrow scope.
 *
 * WHY THIS IS NOT A "24H CHANGE": the market-data contract (`QuoteOut` in
 * `backend/api/schemas.py`) reports `bid`, `ask`, `last`, `mid`, `timestamp`
 * and `stale` only. There is no previous-close, day-open, or change field, and
 * no historical-bars endpoint, so a daily or 24-hour change CANNOT be computed
 * honestly. The Figma mock's "24H" column is therefore left unimplemented
 * rather than filled with a made-up number.
 *
 * What IS shown is the change across the quotes this terminal actually
 * observed on the market stream during the current session — the same rolling
 * buffer that feeds the dashboard chart. It is real observed data with an
 * explicit window (first sample time + sample count); it is never labelled
 * daily/24h, and it is absent ("—") until at least two observations exist.
 *
 * Arithmetic note: the buffer holds display numbers (the chart's own
 * representation), so this derived, display-only metric uses doubles rounded
 * for presentation. It is never used for order sizing, P&L, or any
 * authoritative calculation — the engine owns all money arithmetic.
 */

import type { PricePoint } from "../../stores/marketStore";

export interface SessionChange {
  /** last − first observed price (may be 0). */
  absolute: number;
  /** Percentage move, or null when the first observed price was 0. */
  percent: number | null;
  /** Epoch ms of the first observation in the window. */
  fromMs: number;
  /** Epoch ms of the latest observation. */
  toMs: number;
  /** Number of observations in the window (>= 2). */
  samples: number;
}

/** Change over the observed window, or null when fewer than two samples exist. */
export function sessionChange(points: PricePoint[]): SessionChange | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!Number.isFinite(first.price) || !Number.isFinite(last.price)) return null;
  const absolute = last.price - first.price;
  const percent = first.price === 0 ? null : (absolute / first.price) * 100;
  return {
    absolute,
    percent,
    fromMs: first.t,
    toMs: last.t,
    samples: points.length,
  };
}

/**
 * Signed decimal string with deterministic grouping (no locale dependence, so
 * a value renders and tests identically in every environment). Trailing zeros
 * are trimmed; a negative zero renders as "0".
 */
export function formatSignedNumber(value: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(maxFractionDigits);
  const [intPart, fracPart = ""] = fixed.split(".");
  const trimmedFrac = fracPart.replace(/0+$/, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = trimmedFrac === "" ? grouped : `${grouped}.${trimmedFrac}`;
  const isZero = trimmedFrac === "" && /^0+$/.test(intPart);
  const sign = isZero ? "" : value > 0 ? "+" : "-";
  return `${sign}${body}`;
}

/** Signed percentage string ("+0.84%", "-1.20%", "0.00%"); "—" when unknown. */
export function formatSignedPercent(value: number | null, fractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const fixed = value.toFixed(fractionDigits);
  const rounded = Number(fixed);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(fractionDigits)}%`;
}
