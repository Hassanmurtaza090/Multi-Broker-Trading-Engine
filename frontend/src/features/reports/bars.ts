/**
 * Bar scaling (FE-M10) — PURE. Floats are used ONLY for bar widths.
 *
 * ADR-017 boundary: the VALUE travelling through here is an exact decimal
 * string and is rendered by the caller verbatim; `decimalToNumber` is applied
 * solely to size the bar, so a float rounding error can never reach a figure
 * on screen or in an export.
 *
 * Scaling: bars are sized to the largest ABSOLUTE value in the list, so a
 * short (negative) position cannot hide behind a long one. An all-zero list
 * produces zero-width bars — never a fabricated full-width bar.
 */

import { decimalSign, decimalToNumber } from "../../utils/decimal";

export type BarTone = "pos" | "neg" | "flat";

export interface BarItem {
  label: string;
  /** Exact decimal string (may be negative). */
  value: string;
  /** Already-formatted text shown next to the bar, units included. */
  display: string;
  /**
   * Optional tone override. Needed by count-based lists, where the sign of a
   * count carries no meaning — painting "3 cancelled" green because 3 is
   * positive would editorialize.
   */
  tone?: BarTone;
}

export interface BarRow extends BarItem {
  /** 0..100 display float — bar width only. */
  percent: number;
  tone: BarTone;
}

export function buildBars(items: readonly BarItem[]): BarRow[] {
  let max = 0;
  const magnitudes = items.map((item) => {
    const parsed = decimalToNumber(item.value);
    const magnitude = parsed === null ? 0 : Math.abs(parsed);
    if (magnitude > max) max = magnitude;
    return magnitude;
  });
  return items.map((item, index) => ({
    label: item.label,
    value: item.value,
    display: item.display,
    percent: max > 0 ? (magnitudes[index] / max) * 100 : 0,
    tone: item.tone ?? toneFor(item.value),
  }));
}

function toneFor(value: string): BarRow["tone"] {
  const sign = decimalSign(value);
  if (sign > 0) return "pos";
  if (sign < 0) return "neg";
  return "flat";
}
