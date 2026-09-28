/**
 * Financial value rendering (M11). All inputs are exact-decimal strings
 * (ADR-016); formatting never routes through floats.
 */

import { decimalSign, formatDecimal } from "../utils/decimal";

interface MoneyTextProps {
  value: string | null | undefined;
  currency?: string | null;
  /** Color-code by sign (for P&L values). */
  signed?: boolean;
  className?: string;
}

export function MoneyText({ value, currency, signed = false, className }: MoneyTextProps) {
  const sign = signed ? decimalSign(value) : 0;
  const signClass = signed ? (sign > 0 ? " pos" : sign < 0 ? " neg" : "") : "";
  return (
    <span className={`money${signClass}${className ? ` ${className}` : ""}`}>
      {formatDecimal(value)}
      {currency ? <span className="money-currency"> {currency}</span> : null}
    </span>
  );
}
