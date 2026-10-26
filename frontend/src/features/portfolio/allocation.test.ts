/**
 * Allocation computation tests (M3) — the financial-correctness rules:
 * exact string math, per-currency grouping (never cross-currency sums),
 * signed short values, gross-exposure shares, exclusion of unpriced rows.
 */

import { describe, expect, it } from "vitest";

import { positionOut } from "../../test/mocks";
import { computeAllocation } from "./allocation";

describe("computeAllocation", () => {
  it("groups strictly per currency and never sums across currencies", () => {
    const result = computeAllocation([
      positionOut({ symbol: "AAPL", quantity: "10", market_price: "151.00" }),
      positionOut({ symbol: "MSFT", quantity: "5", market_price: "200.00" }),
      positionOut({ symbol: "EURLOT", quantity: "100", market_price: "1.10", currency: "EUR" }),
    ]);
    expect(result.groups.map((g) => g.currency)).toEqual(["EUR", "USD"]);
    const usd = result.groups.find((g) => g.currency === "USD");
    expect(usd?.gross).toBe("2510"); // 1510 + 1000 — EUR value excluded
    const eur = result.groups.find((g) => g.currency === "EUR");
    expect(eur?.gross).toBe("110"); // 100 × 1.10 exactly
  });

  it("computes shares within a currency group and rounds display percents", () => {
    const result = computeAllocation([
      positionOut({ symbol: "AAPL", quantity: "10", market_price: "151.00" }),
      positionOut({ symbol: "MSFT", quantity: "5", market_price: "200.00" }),
    ]);
    const rows = result.groups[0].rows;
    expect(rows[0].symbol).toBe("AAPL"); // sorted by absolute value desc
    expect(rows[0].percent).toBe(60);
    expect(rows[1].symbol).toBe("MSFT");
    expect(rows[1].percent).toBe(40);
  });

  it("preserves SHORT positions as negative signed values in gross exposure", () => {
    const result = computeAllocation([
      positionOut({ symbol: "AAPL", quantity: "10", market_price: "151.00" }),
      positionOut({ symbol: "MSFT", quantity: "-5", market_price: "200.00" }),
    ]);
    const rows = result.groups[0].rows;
    expect(rows[1].value).toBe("-1000"); // signed value shown to the user
    expect(rows[1].absValue).toBe("1000"); // |value| feeds the gross sum
    expect(result.groups[0].gross).toBe("2510"); // gross = Σ|values|
  });

  it("excludes unpriced positions (counted, never zero-filled) and flat rows", () => {
    const result = computeAllocation([
      positionOut({ symbol: "AAPL", quantity: "10", market_price: "151.00" }),
      positionOut({ symbol: "NOMARK", quantity: "3", market_price: null }),
      positionOut({ symbol: "FLAT", quantity: "0", market_price: "10.00" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].unpricedCount).toBe(1);
    expect(result.groups[0].rowCount).toBe(1); // FLAT skipped entirely
    expect(result.unpricedTotal).toBe(1);
    expect(result.groups[0].rows.map((r) => r.symbol)).toEqual(["AAPL"]);
  });

  it("reports stale marks per currency group", () => {
    const result = computeAllocation([
      positionOut({ symbol: "AAPL", quantity: "10", market_price: "151.00", stale: true }),
    ]);
    expect(result.groups[0].staleCount).toBe(1);
    expect(result.groups[0].rows[0].stale).toBe(true);
  });

  it("returns an empty result for no positions", () => {
    const result = computeAllocation([]);
    expect(result.groups).toEqual([]);
    expect(result.unpricedTotal).toBe(0);
  });

  it("caps displayed rows but reports the true row count", () => {
    const positions = Array.from({ length: 10 }, (_, i) =>
      positionOut({
        symbol: `SYM${i}`,
        quantity: String(10 - i),
        market_price: "100.00",
      }),
    );
    const result = computeAllocation(positions);
    expect(result.groups[0].rows).toHaveLength(8); // MAX_ROWS
    expect(result.groups[0].rowCount).toBe(10);
  });
});
