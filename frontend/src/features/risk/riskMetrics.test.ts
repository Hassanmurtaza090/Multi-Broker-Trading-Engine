/**
 * Risk metric computation tests (FE-M8).
 *
 * These assert the financial-correctness rules the module exists to protect:
 * exact decimal arithmetic, per-currency isolation, exclusion (not zero-fill)
 * of unpriced positions, and refusal to derive a ratio from missing inputs.
 */

import { describe, expect, it } from "vitest";

import { computeAllocation } from "../portfolio/allocation";
import {
  RISK_RULES,
  UNAVAILABLE_METRICS,
  directionOf,
  exposureByCurrency,
  exposureToEquityRatio,
  positionMarketValue,
  ratioPercent,
  summarizePositions,
  topConcentrationByCurrency,
} from "./riskMetrics";
import { positionOut } from "../../test/mocks";

describe("exposureByCurrency", () => {
  it("computes long, short, net and gross per currency", () => {
    const groups = exposureByCurrency([
      positionOut({ symbol: "AAPL", currency: "USD", quantity: "10", market_price: "100.00" }),
      positionOut({ symbol: "MSFT", currency: "USD", quantity: "-5", market_price: "200.00" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      currency: "USD",
      long: "1000",
      short: "1000",
      net: "0",
      gross: "2000",
      pricedCount: 2,
      unpricedCount: 0,
    });
  });

  it("never aggregates across currencies", () => {
    const groups = exposureByCurrency([
      positionOut({ symbol: "AAPL", currency: "USD", quantity: "10", market_price: "100.00" }),
      positionOut({ symbol: "SAP", currency: "EUR", quantity: "4", market_price: "50.00" }),
    ]);

    expect(groups.map((group) => group.currency)).toEqual(["EUR", "USD"]);
    expect(groups[0]).toMatchObject({ currency: "EUR", gross: "200" });
    expect(groups[1]).toMatchObject({ currency: "USD", gross: "1000" });
    // No combined figure exists anywhere in the shape.
    expect(groups).toHaveLength(2);
  });

  it("excludes and counts unpriced positions instead of valuing them at zero", () => {
    const groups = exposureByCurrency([
      positionOut({ symbol: "AAPL", currency: "USD", quantity: "10", market_price: "100.00" }),
      positionOut({ symbol: "TSLA", currency: "USD", quantity: "5", market_price: null }),
    ]);

    expect(groups[0]).toMatchObject({
      gross: "1000",
      pricedCount: 1,
      unpricedCount: 1,
    });
  });

  it("counts stale marks but still includes them", () => {
    const groups = exposureByCurrency([
      positionOut({
        symbol: "AAPL",
        currency: "USD",
        quantity: "10",
        market_price: "100.00",
        stale: true,
      }),
    ]);
    expect(groups[0]).toMatchObject({ gross: "1000", staleCount: 1 });
  });

  it("skips flat positions entirely", () => {
    expect(exposureByCurrency([positionOut({ quantity: "0" })])).toEqual([]);
  });

  it("is exact: no float artefacts in the arithmetic", () => {
    const groups = exposureByCurrency([
      positionOut({ symbol: "PENNY", currency: "USD", quantity: "3", market_price: "0.10" }),
    ]);
    expect(groups[0].gross).toBe("0.3");
  });

  it("returns negative net exposure when shorts dominate", () => {
    const groups = exposureByCurrency([
      positionOut({ symbol: "AAPL", currency: "USD", quantity: "-10", market_price: "100.00" }),
    ]);
    expect(groups[0]).toMatchObject({ net: "-1000", gross: "1000", long: "0", short: "1000" });
  });
});

describe("exposureToEquityRatio", () => {
  it("derives a ratio from two reported figures", () => {
    expect(exposureToEquityRatio("50000.00", "100000.00")).toBeCloseTo(0.5, 10);
  });

  it("returns null when either input is missing (never zero)", () => {
    expect(exposureToEquityRatio(null, "100000.00")).toBeNull();
    expect(exposureToEquityRatio("50000.00", null)).toBeNull();
    expect(exposureToEquityRatio(undefined, undefined)).toBeNull();
  });

  it("returns null for non-positive equity, where the ratio is undefined", () => {
    expect(exposureToEquityRatio("50000.00", "0")).toBeNull();
    expect(exposureToEquityRatio("50000.00", "-1000")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(exposureToEquityRatio("not-a-number", "100000.00")).toBeNull();
  });
});

describe("ratioPercent", () => {
  it("rounds to one decimal place", () => {
    expect(ratioPercent(0.12345)).toBe(12.3);
    expect(ratioPercent(1)).toBe(100);
  });

  it("returns null for a null or non-finite ratio", () => {
    expect(ratioPercent(null)).toBeNull();
    expect(ratioPercent(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("directionOf", () => {
  it("derives direction from the signed quantity", () => {
    expect(directionOf("10")).toBe("LONG");
    expect(directionOf("-0.5")).toBe("SHORT");
    expect(directionOf("0")).toBe("FLAT");
  });
});

describe("summarizePositions", () => {
  it("counts open, long, short, stale and unpriced", () => {
    const summary = summarizePositions([
      positionOut({ quantity: "10" }),
      positionOut({ symbol: "MSFT", quantity: "-2", stale: true }),
      positionOut({ symbol: "TSLA", quantity: "3", market_price: null }),
      positionOut({ symbol: "FLAT", quantity: "0" }),
    ]);
    expect(summary).toEqual({ open: 3, long: 2, short: 1, stale: 1, unpriced: 1 });
  });

  it("is zero for no positions (an empty account really has no exposure)", () => {
    expect(summarizePositions([])).toEqual({ open: 0, long: 0, short: 0, stale: 0, unpriced: 0 });
  });
});

describe("positionMarketValue", () => {
  it("multiplies exactly and keeps the sign", () => {
    expect(positionMarketValue(positionOut({ quantity: "10", market_price: "150.25" }))).toBe(
      "1502.5",
    );
    expect(positionMarketValue(positionOut({ quantity: "-10", market_price: "150.25" }))).toBe(
      "-1502.5",
    );
  });

  it("returns null without a market price", () => {
    expect(positionMarketValue(positionOut({ market_price: null }))).toBeNull();
  });
});

describe("topConcentrationByCurrency", () => {
  it("picks the largest instrument per currency from the shared allocation", () => {
    const entries = topConcentrationByCurrency(
      computeAllocation([
        positionOut({ symbol: "AAPL", currency: "USD", quantity: "10", market_price: "100.00" }),
        positionOut({ symbol: "MSFT", currency: "USD", quantity: "1", market_price: "100.00" }),
        positionOut({ symbol: "SAP", currency: "EUR", quantity: "2", market_price: "100.00" }),
      ]),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ currency: "EUR", symbol: "SAP", percent: 100 });
    expect(entries[1]).toMatchObject({ currency: "USD", symbol: "AAPL", percent: 91 });
  });

  it("returns nothing when no position is priced", () => {
    expect(
      topConcentrationByCurrency(computeAllocation([positionOut({ market_price: null })])),
    ).toEqual([]);
  });
});

describe("rule and metric catalogues", () => {
  it("transcribes the eight enforced backend rules", () => {
    expect(RISK_RULES.map((rule) => rule.rule)).toEqual([
      "kill_switch",
      "order_size_limit",
      "position_limit",
      "notional_exposure_limit",
      "available_funds_limit",
      "daily_order_count_limit",
      "daily_loss_limit",
      "trading_session",
    ]);
  });

  it("maps every non-kill-switch rule to a RiskLimits field", () => {
    for (const rule of RISK_RULES) {
      if (rule.rule === "kill_switch") expect(rule.limitField).toBeNull();
      else expect(rule.limitField).toBeTruthy();
    }
  });

  it("declares each unavailable metric with a reason, never a value", () => {
    expect(UNAVAILABLE_METRICS.length).toBeGreaterThan(0);
    for (const metric of UNAVAILABLE_METRICS) {
      expect(metric.reason.length).toBeGreaterThan(20);
      expect(metric).not.toHaveProperty("value");
    }
  });
});
