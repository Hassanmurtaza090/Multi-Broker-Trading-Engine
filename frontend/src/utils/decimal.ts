/**
 * Exact-decimal string utilities (M11).
 *
 * Financial values travel as fixed-point JSON strings (ADR-016). These helpers
 * format and compare them WITHOUT converting to floats, so no precision is
 * ever lost. Floats are used only where precision is irrelevant (chart pixel
 * coordinates), via `decimalToNumber`.
 */

export const EMPTY_DISPLAY = "—";

/**
 * Expand scientific notation to a plain decimal string (M1 fix).
 *
 * The backend serializes exact decimals via Python `Decimal`, which emits
 * scientific notation for scaled values — most commonly ZERO with scale
 * (`str(Decimal("0.00000000"))` → "0E-8"), e.g. an order's filled quantity
 * before any fill. Only the uppercase-E wire form is expanded: lowercase
 * user input ("1e5") stays untouched so input validation keeps rejecting it.
 * Non-scientific input is returned unchanged; null/undefined becomes "".
 */
export function expandScientificDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?E([+-]?\d+)$/.exec(raw);
  if (!match) return raw;
  const [, sign = "", intPart, fracPart = "", exponentRaw = "0"] = match;
  const exponent = Number(exponentRaw);
  const digits = intPart + fracPart;
  const point = intPart.length + exponent;
  let out: string;
  if (point <= 0) {
    out = `0.${"0".repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    out = digits + "0".repeat(point - digits.length);
  } else {
    out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}${out}`;
}

interface Parts {
  negative: boolean;
  int: string;
  frac: string;
}

/** Parse a plain decimal string into sign/int/frac parts. Returns null if invalid. */
function parse(value: string): Parts | null {
  const trimmed = value.trim();
  // Require at least one digit: "12", "12.5", "-0.05"; reject "", ".", "e5".
  const match = /^(-?)(\d+(?:\.(\d+))?|\.\d+)$/.exec(trimmed);
  if (!match) return null;
  const body = match[2];
  const dot = body.indexOf(".");
  const int = dot === -1 ? body : body.slice(0, dot) || "0";
  const frac = dot === -1 ? "" : body.slice(dot + 1);
  return { negative: match[1] === "-", int, frac };
}

/** Group the integer part with thousands separators; keep decimals as-is. */
export function formatDecimal(
  value: string | null | undefined,
  options: { emptyDisplay?: string } = {},
): string {
  if (value === null || value === undefined) return options.emptyDisplay ?? EMPTY_DISPLAY;
  // The wire can carry scientific notation for scaled zeros ("0E-8" — Python
  // Decimal serialization); expand before parsing so it displays as "0".
  const parts = parse(expandScientificDecimal(value));
  if (!parts) return value;
  const int = parts.int.replace(/^0+(?=\d)/, "");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = parts.frac.replace(/0+$/, "");
  const sign = parts.negative && (int !== "0" || frac !== "") ? "-" : "";
  return frac ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/** -1 / 0 / +1 for a decimal string. Unknown/invalid input → 0 (display-safe). */
export function decimalSign(value: string | null | undefined): -1 | 0 | 1 {
  if (value === null || value === undefined) return 0;
  const parts = parse(value);
  if (!parts) return 0;
  const digits = parts.int + parts.frac;
  if (/^0*$/.test(digits)) return 0;
  return parts.negative ? -1 : 1;
}

/** Compare two decimal strings exactly: -1 (a<b), 0 (a==b), 1 (a>b). */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    throw new Error(`cannot compare non-decimal values: "${a}" / "${b}"`);
  }
  const zeroA = /^0*$/.test(pa.int + pa.frac);
  const zeroB = /^0*$/.test(pb.int + pb.frac);
  if (zeroA && zeroB) return 0;
  if (pa.negative !== pb.negative) return pa.negative ? (zeroA ? 0 : -1) : zeroB ? 0 : 1;

  const intA = pa.int.replace(/^0+/, "") || "0";
  const intB = pb.int.replace(/^0+/, "") || "0";
  let result: -1 | 0 | 1 = 0;
  if (intA.length !== intB.length) {
    result = intA.length < intB.length ? -1 : 1;
  } else if (intA !== intB) {
    result = intA < intB ? -1 : 1;
  } else {
    const fracLen = Math.max(pa.frac.length, pb.frac.length);
    const fracA = pa.frac.padEnd(fracLen, "0");
    const fracB = pb.frac.padEnd(fracLen, "0");
    if (fracA !== fracB) result = fracA < fracB ? -1 : 1;
  }
  return pa.negative ? (-result as -1 | 0 | 1) : result;
}

export function isPositiveDecimal(value: string | null | undefined): boolean {
  return decimalSign(value) === 1;
}

export function isNegativeDecimal(value: string | null | undefined): boolean {
  return decimalSign(value) === -1;
}

export function isZeroDecimal(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return decimalSign(value) === 0;
}

/** True when the string is a syntactically valid, finite decimal (user input check). */
export function isValidDecimalInput(value: string): boolean {
  return parse(value) !== null;
}

/**
 * Float conversion for non-financial purposes ONLY (chart pixel scaling).
 * Never use for money math or comparisons.
 */
export function decimalToNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (parse(value) === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// --- exact display arithmetic (M1) ---------------------------------------------
// BigInt-based add/multiply on the decimal STRINGS. Used only for DISPLAY
// estimates and summaries (e.g. "Est. total" = quantity × live last price,
// single-currency P&L totals); authoritative money math stays server-side.

interface BigIntParts {
  negative: boolean;
  digits: bigint;
  scale: number;
}

function parseBigInt(value: string): BigIntParts | null {
  // Expand wire-format scientific notation ("0E-8") before parsing.
  const parts = parse(expandScientificDecimal(value));
  if (!parts) return null;
  return {
    negative: parts.negative,
    digits: BigInt(parts.int + parts.frac),
    scale: parts.frac.length,
  };
}

function joinBigInt(parts: BigIntParts): string {
  const sign = parts.negative && parts.digits !== 0n ? "-" : "";
  if (parts.scale === 0) return `${sign}${parts.digits.toString()}`;
  let frac = parts.digits
    .toString()
    .padStart(parts.scale + 1, "0")
    .slice(-parts.scale);
  // Display normalization: strip trailing fraction zeros ("4.00" → "4") so
  // summaries read like the backend's own minimal decimal strings.
  frac = frac.replace(/0+$/, "");
  if (frac === "") return `${sign}${parts.digits.toString().slice(0, -parts.scale) || "0"}`;
  const raw = parts.digits.toString().padStart(parts.scale + 1, "0");
  return `${sign}${raw.slice(0, -parts.scale)}.${frac}`;
}

/** Exact sum of two decimal strings; null if either input is invalid. */
export function addDecimal(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const pa = parseBigInt(a ?? "");
  const pb = parseBigInt(b ?? "");
  if (pa === null || pb === null) return null;
  const scale = Math.max(pa.scale, pb.scale);
  const shift = (p: BigIntParts) => p.digits * 10n ** BigInt(scale - p.scale);
  const left = pa.negative ? -shift(pa) : shift(pa);
  const right = pb.negative ? -shift(pb) : shift(pb);
  const sum = left + right;
  return joinBigInt({ negative: sum < 0n, digits: sum < 0n ? -sum : sum, scale });
}

/** Exact product of two decimal strings; null if either input is invalid. */
export function multiplyDecimal(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const pa = parseBigInt(a ?? "");
  const pb = parseBigInt(b ?? "");
  if (pa === null || pb === null) return null;
  const product = pa.digits * pb.digits;
  const negative = pa.negative !== pb.negative && product !== 0n;
  return joinBigInt({ negative, digits: product, scale: pa.scale + pb.scale });
}
