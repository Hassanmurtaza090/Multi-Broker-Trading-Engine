import { describe, expect, it } from "vitest";

import {
  addDecimal,
  compareDecimal,
  decimalSign,
  decimalToNumber,
  expandScientificDecimal,
  formatDecimal,
  isValidDecimalInput,
  multiplyDecimal,
} from "./decimal";

describe("formatDecimal", () => {
  it("groups thousands and preserves exact decimals", () => {
    expect(formatDecimal("1234567.890")).toBe("1,234,567.89");
    expect(formatDecimal("0.00000001")).toBe("0.00000001");
    expect(formatDecimal("1000000")).toBe("1,000,000");
  });

  it("renders negative values with a single leading sign", () => {
    expect(formatDecimal("-1234.50")).toBe("-1,234.5");
    expect(formatDecimal("-0.0001")).toBe("-0.0001");
  });

  it("normalizes trailing fraction zeros and leading int zeros", () => {
    expect(formatDecimal("00123.4500")).toBe("123.45");
    expect(formatDecimal("10.00")).toBe("10");
  });

  it("renders a dash for null/undefined, never a fake zero", () => {
    expect(formatDecimal(null)).toBe("—");
    expect(formatDecimal(undefined)).toBe("—");
    expect(formatDecimal(null, { emptyDisplay: "n/a" })).toBe("n/a");
  });

  it("does not render '-0'", () => {
    expect(formatDecimal("-0.00")).toBe("0");
  });
});

describe("decimalSign", () => {
  it("detects sign exactly", () => {
    expect(decimalSign("0.001")).toBe(1);
    expect(decimalSign("-0.001")).toBe(-1);
    expect(decimalSign("0.0000")).toBe(0);
    expect(decimalSign("-0")).toBe(0);
    expect(decimalSign(null)).toBe(0);
  });
});

describe("compareDecimal", () => {
  it("compares across magnitudes without floats", () => {
    expect(compareDecimal("10", "9.999999")).toBe(1);
    expect(compareDecimal("0.00000001", "0.00000002")).toBe(-1);
    expect(compareDecimal("1.10", "1.1")).toBe(0);
    expect(compareDecimal("-5", "2")).toBe(-1);
    expect(compareDecimal("-2", "-10")).toBe(1);
    expect(compareDecimal("0.00", "-0")).toBe(0);
  });

  it("rejects non-decimal input", () => {
    expect(() => compareDecimal("abc", "1")).toThrow();
  });
});

describe("isValidDecimalInput", () => {
  it("accepts plain decimals only", () => {
    expect(isValidDecimalInput("123.456")).toBe(true);
    expect(isValidDecimalInput("-0.5")).toBe(true);
    expect(isValidDecimalInput("10")).toBe(true);
    expect(isValidDecimalInput("1e5")).toBe(false);
    expect(isValidDecimalInput("")).toBe(false);
    expect(isValidDecimalInput("12,00")).toBe(false);
    expect(isValidDecimalInput("abc")).toBe(false);
  });
});

describe("wire-format scientific notation (Python Decimal)", () => {
  // str(Decimal("0.00000000")) === "0E-8" — the backend emits this for scaled
  // zeros (e.g. filled_quantity before any fill). Found by the M1 Playwright
  // visual check against the live sim backend (uncaught BigInt crash).

  it("formatDecimal displays scaled zeros as 0, never raw 0E-8", () => {
    expect(formatDecimal("0E-8")).toBe("0");
    expect(formatDecimal("-0E-8")).toBe("0");
    expect(formatDecimal("1E+2")).toBe("100");
    expect(formatDecimal("1.5E-1")).toBe("0.15");
    expect(formatDecimal("-1.5E-1")).toBe("-0.15");
  });

  it("exact display arithmetic tolerates scientific notation inputs", () => {
    expect(addDecimal("0E-8", "5")).toBe("5");
    expect(multiplyDecimal("10", "0E-8")).toBe("0");
  });

  it("expands only scientific input; leaves plain decimals untouched", () => {
    expect(expandScientificDecimal("150.25")).toBe("150.25");
    expect(expandScientificDecimal("0E-8")).toBe("0.00000000");
    // Lowercase user input is NOT wire format — stays untouched so
    // isValidDecimalInput keeps rejecting it.
    expect(expandScientificDecimal("1e5")).toBe("1e5");
    expect(expandScientificDecimal(null)).toBe("");
    expect(expandScientificDecimal(undefined)).toBe("");
  });
});

describe("decimalToNumber", () => {
  it("converts valid decimals, null otherwise", () => {
    expect(decimalToNumber("1.5")).toBe(1.5);
    expect(decimalToNumber("nope")).toBeNull();
    expect(decimalToNumber(null)).toBeNull();
  });
});

describe("addDecimal (exact display arithmetic)", () => {
  it("adds with scale alignment and no float artifacts", () => {
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(addDecimal("1.25", "2.75")).toBe("4");
    expect(addDecimal("1000000.05", "0.05")).toBe("1000000.1");
    expect(addDecimal("1.005", "0.995")).toBe("2");
  });

  it("handles mixed signs exactly", () => {
    expect(addDecimal("-5", "3")).toBe("-2");
    expect(addDecimal("5", "-3")).toBe("2");
    expect(addDecimal("-0.5", "0.5")).toBe("0");
  });

  it("returns null for invalid input instead of guessing", () => {
    expect(addDecimal("abc", "1")).toBeNull();
    expect(addDecimal(null, "1")).toBeNull();
    expect(addDecimal(undefined, undefined)).toBeNull();
  });
});

describe("multiplyDecimal (exact display arithmetic)", () => {
  it("multiplies exactly (the ticket's Est. total path)", () => {
    expect(multiplyDecimal("10", "150.25")).toBe("1502.5");
    expect(multiplyDecimal("0.10", "67842.12")).toBe("6784.212");
    expect(multiplyDecimal("2.5", "4")).toBe("10");
    expect(multiplyDecimal("0.1", "0.2")).toBe("0.02");
  });

  it("handles signs without rendering '-0'", () => {
    expect(multiplyDecimal("-2", "3")).toBe("-6");
    expect(multiplyDecimal("-2", "-3")).toBe("6");
    expect(multiplyDecimal("-0", "5")).toBe("0");
  });

  it("returns null for invalid input instead of guessing", () => {
    expect(multiplyDecimal("1e5", "2")).toBeNull();
    expect(multiplyDecimal("", "2")).toBeNull();
    expect(multiplyDecimal("2", null)).toBeNull();
  });
});
