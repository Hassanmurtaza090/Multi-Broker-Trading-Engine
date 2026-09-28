import { describe, expect, it } from "vitest";

import {
  compareDecimal,
  decimalSign,
  decimalToNumber,
  formatDecimal,
  isValidDecimalInput,
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

describe("decimalToNumber", () => {
  it("converts valid decimals, null otherwise", () => {
    expect(decimalToNumber("1.5")).toBe(1.5);
    expect(decimalToNumber("nope")).toBeNull();
    expect(decimalToNumber(null)).toBeNull();
  });
});
