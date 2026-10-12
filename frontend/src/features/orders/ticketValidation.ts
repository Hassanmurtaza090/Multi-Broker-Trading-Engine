/**
 * Order-ticket input validation (M11).
 *
 * Input-shape validation ONLY (presentable form errors): all financial and
 * risk validation stays server-side (M1 domain invariants, M6 risk gate) —
 * the ticket never decides whether an order is acceptable.
 */

import { decimalSign, isValidDecimalInput } from "../../utils/decimal";

export function parseIdentifiers(raw: string): Record<string, string> | null {
  /**
   * Parse the ticket's optional identifiers input: "KEY=VALUE" pairs
   * separated by commas (broker-neutral metadata — ADR-015 — resolved by
   * adapters, e.g. SAXO_UIC=211). Returns null on malformed input.
   */
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) return null;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key.length === 0 || value.length === 0 || key.length > 32 || value.length > 128) {
      return null;
    }
    out[key] = value;
  }
  return out;
}

export function validateTicket(args: {
  symbol: string;
  currency: string;
  quantity: string;
  limitPrice: string;
  stopPrice: string;
  needsLimit: boolean;
  needsStop: boolean;
}): string | null {
  if (args.symbol.trim() === "") return "Enter a symbol.";
  if (!/^[A-Za-z]{3}$/.test(args.currency.trim())) return "Currency must be a 3-letter code.";
  if (!isValidDecimalInput(args.quantity) || decimalSign(args.quantity) !== 1) {
    return "Quantity must be a positive decimal.";
  }
  if (args.needsLimit) {
    if (args.limitPrice.trim() === "") return "Limit price is required for this order type.";
    if (!isValidDecimalInput(args.limitPrice) || decimalSign(args.limitPrice) !== 1) {
      return "Limit price must be a positive decimal.";
    }
  }
  if (args.needsStop) {
    if (args.stopPrice.trim() === "") return "Stop price is required for this order type.";
    if (!isValidDecimalInput(args.stopPrice) || decimalSign(args.stopPrice) !== 1) {
      return "Stop price must be a positive decimal.";
    }
  }
  return null;
}
