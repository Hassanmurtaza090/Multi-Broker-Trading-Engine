/**
 * Reports & performance analytics tests (FE-M10).
 *
 * The suite is split the same way the module is:
 *   - pure CSV serialization (quoting, CRLF, injection guard, nulls);
 *   - period resolution and UTC-day filtering with a FIXED clock;
 *   - metric derivations (per currency, realized vs unrealized, no cross-currency
 *     sums, no null-as-zero);
 *   - row builders over real DTO shapes;
 *   - download plumbing (blob content captured, no network in the handler);
 *   - the page: card availability, period scoping, and the exact disabled
 *     reasons — never a silently substituted dataset.
 *
 * All fixtures are deterministic and mocked; no production account or live
 * trading activity is involved.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportsPage } from "../../pages/ReportsPage";
import { ServicesContext } from "../../services/context";
import type { ApiClient } from "../../services/api";
import {
  accountStore,
  brokersStore,
  executionsStore,
  ordersStore,
  positionsStore,
  resetAllStores,
  riskStore,
} from "../../stores";
import { keyForPositionOut } from "../../stores/positionsStore";
import {
  balanceOut,
  createMockApi,
  fillJ,
  loginForTests,
  orderOut,
  positionOut,
  TEST_TRADER,
} from "../../test/mocks";
import type { AccountSummaryOut, OrderOut, PositionOut } from "../../types/api";
import type { FillJ } from "../../types/events";
import { buildBars } from "./bars";
import {
  buildAccountStatement,
  buildCustomReport,
  buildPnlReport,
  buildRiskReport,
  buildTradeHistory,
  DEFAULT_ORDER_COLUMN_KEYS,
  ORDER_COLUMNS,
  POSITION_COLUMNS,
  selectColumns,
} from "./builders";
import { CSV_NEWLINE, guardInjection, toCsv, toCsvCell } from "./csv";
import { downloadCsv, reportFilename } from "./download";
import {
  commissionCoverage,
  countOrderOutcomes,
  notionalByCurrency,
  pnlContributions,
  positionMarketValue,
  summaryCurrencies,
} from "./metrics";
import {
  dayInRange,
  filterFillsByPeriod,
  filterOrdersByPeriod,
  resolvePeriodRange,
} from "./period";

// jsdom cannot navigate to a `blob:` URL and prints a "not implemented"
// error for every download. The anchor click is stubbed for the whole file: the
// tests still exercise `downloadCsv` end to end (object URL, anchor, cleanup)
// without depending on jsdom's navigation support.
beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- deterministic clock + fixtures ---------------------------------------------

const NOW = new Date("2026-10-31T12:00:00Z");
const IN_PERIOD = "2026-10-30T09:15:00+00:00";
const OUTSIDE_30_DAYS = "2026-09-27T10:00:00+00:00";

const SUMMARY: AccountSummaryOut = {
  account_id: "ACC-001",
  equity: "100000.00",
  exposure: "25000.00",
  realized_pnl: { USD: "120.50" },
  unrealized_pnl: { USD: "50.00", EUR: "10.00" },
  market_value: { USD: "25000.00" },
};

function seedOrders(orders: OrderOut[]) {
  const byId: Record<string, OrderOut> = {};
  const ids: string[] = [];
  for (const order of orders) {
    byId[order.client_order_id] = order;
    ids.push(order.client_order_id);
  }
  ordersStore.setState({ byId, ids, loadState: "ready", errorMessage: null });
}

function seedPositions(rows: Partial<PositionOut>[]) {
  const byKey: Record<string, PositionOut> = {};
  const keys: string[] = [];
  for (const row of rows) {
    const position = positionOut(row);
    const key = keyForPositionOut(position);
    byKey[key] = position;
    keys.push(key);
  }
  positionsStore.setState({ byKey, keys, loadState: "ready", errorMessage: null });
}

function seedFills(fills: FillJ[]) {
  const byId: Record<string, FillJ> = {};
  const ids: string[] = [];
  for (const fill of fills) {
    byId[fill.fill_id] = fill;
    ids.push(fill.fill_id);
  }
  executionsStore.setState({
    byId,
    ids,
    capturedFrom: fills.length > 0 ? fills[0].executed_at : null,
    hasCapture: fills.length > 0,
  });
}

function seedSummary(summary: AccountSummaryOut = SUMMARY) {
  accountStore.update((state) => ({
    ...state,
    summary,
    summaryState: "ready",
    balance: balanceOut(),
    balanceState: "ready",
    killSwitchActive: false,
    killSwitchState: "ready",
  }));
}

/** Read a Blob as text through FileReader (jsdom Blob has no `.text()`). */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function withProviders(node: ReactElement, api = createMockApi()) {
  return render(
    <ServicesContext.Provider value={{ api: api as unknown as ApiClient }}>
      {node}
    </ServicesContext.Provider>,
  );
}

// --- CSV ------------------------------------------------------------------------

describe("toCsv (RFC 4180 shape + injection guard)", () => {
  it("writes CRLF records and a trailing CRLF with empty rows allowed", () => {
    expect(toCsv(["A", "B"], [])).toBe(`A,B${CSV_NEWLINE}`);
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe(`A,B${CSV_NEWLINE}1,2${CSV_NEWLINE}`);
  });

  it("quotes commas, quotes, newlines and padded values; doubles inner quotes", () => {
    const csv = toCsv(["a", "b", "c", "d"], [["x,y", 'he said "hi"', "line1\nline2", "  pad  "]]);
    expect(csv).toBe(
      `a,b,c,d${CSV_NEWLINE}"x,y","he said ""hi""","line1\nline2","  pad  "${CSV_NEWLINE}`,
    );
  });

  it("renders a null cell as EMPTY — never as zero", () => {
    expect(toCsvCell(null)).toBe("");
    expect(toCsvCell(undefined)).toBe("");
    const csv = toCsv(["value"], [[null]]);
    expect(csv).toBe(`value${CSV_NEWLINE}${CSV_NEWLINE}`);
    expect(csv).not.toContain("0");
  });

  it("guards formula triggers with a leading apostrophe", () => {
    expect(guardInjection("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(guardInjection("+1+1")).toBe("'+1+1");
    expect(guardInjection("@cmd")).toBe("'@cmd");
    expect(guardInjection("\tcmd")).toBe("'\tcmd");
    expect(guardInjection("\rcmd")).toBe("'\rcmd");
    expect(guardInjection("-1+1")).toBe("'-1+1");
    expect(guardInjection("normal")).toBe("normal");
  });

  it("keeps a plain negative number a NUMBER (documented deviation)", () => {
    // The blanket OWASP rule would prefix this and corrupt every negative P&L
    // figure in the export; a plain decimal is data, not a formula.
    expect(guardInjection("-12.34")).toBe("-12.34");
    expect(toCsvCell("-1000")).toBe("-1000");
    expect(guardInjection("-0.5")).toBe("-0.5");
  });
});

// --- period ---------------------------------------------------------------------

describe("period resolution and filtering", () => {
  it("resolves inclusive UTC day bounds from an injected clock", () => {
    expect(resolvePeriodRange("LAST_7_DAYS", NOW)).toEqual({
      fromDay: "2026-10-25",
      toDay: "2026-10-31",
      label: "2026-10-25 … 2026-10-31 (UTC calendar days, inclusive)",
    });
    expect(resolvePeriodRange("LAST_30_DAYS", NOW).fromDay).toBe("2026-10-02");
    expect(resolvePeriodRange("THIS_YEAR", NOW)).toEqual({
      fromDay: "2026-01-01",
      toDay: "2026-10-31",
      label: "2026-01-01 … 2026-10-31 (UTC calendar days, inclusive)",
    });
  });

  it("crosses a month and a year boundary without drifting", () => {
    const newYear = new Date("2026-01-02T00:00:00Z");
    expect(resolvePeriodRange("LAST_7_DAYS", newYear).fromDay).toBe("2025-12-27");
    const march = new Date("2026-03-01T23:00:00Z");
    expect(resolvePeriodRange("LAST_30_DAYS", march).fromDay).toBe("2026-01-31");
  });

  it("states an unreadable clock instead of silently widening the window", () => {
    const range = resolvePeriodRange("LAST_7_DAYS", new Date("nonsense"));
    expect(range).toEqual({
      fromDay: "",
      toDay: "",
      label: "unbounded — the terminal clock could not be read",
    });
  });

  it("is inclusive on both bounds and rejects unknown timestamps", () => {
    const range = resolvePeriodRange("LAST_30_DAYS", NOW);
    expect(dayInRange("2026-10-02T00:00:00Z", range)).toBe(true);
    expect(dayInRange("2026-10-31T23:59:59Z", range)).toBe(true);
    expect(dayInRange("2026-10-01T23:59:59Z", range)).toBe(false);
    expect(dayInRange("2026-11-01T00:00:00Z", range)).toBe(false);
    // "not-a-date" length >= 10 would slice to "not-a-date"; an unparseable
    // timestamp can never satisfy a range.
    expect(dayInRange("2026-10", range)).toBe(false);
  });

  it("filters orders by created_at and fills by executed_at, per set", () => {
    const range = resolvePeriodRange("LAST_30_DAYS", NOW);
    const orders = [
      orderOut({ client_order_id: "a", created_at: IN_PERIOD }),
      orderOut({ client_order_id: "b", created_at: OUTSIDE_30_DAYS }),
    ];
    expect(filterOrdersByPeriod(orders, range).map((o) => o.client_order_id)).toEqual(["a"]);
    const fills = [
      fillJ({ fill_id: "f1", executed_at: IN_PERIOD }),
      fillJ({ fill_id: "f2", executed_at: OUTSIDE_30_DAYS }),
    ];
    expect(filterFillsByPeriod(fills, range).map((f) => f.fill_id)).toEqual(["f1"]);
  });
});

// --- metrics --------------------------------------------------------------------

describe("report metrics", () => {
  it("counts orders by the backend's own status, one row per order", () => {
    const counts = countOrderOutcomes([
      orderOut({ status: "FILLED" }),
      orderOut({ client_order_id: "2", status: "PARTIALLY_FILLED" }),
      orderOut({ client_order_id: "3", status: "REJECTED" }),
      orderOut({ client_order_id: "4", status: "SUBMITTED" }),
    ]);
    // PARTIALLY_FILLED is NOT terminal, so it is neither "finished" nor
    // conflated with a working order — the backend status is used verbatim.
    expect(counts).toEqual({
      total: 4,
      finished: 2,
      filled: 1,
      cancelled: 0,
      rejected: 1,
      expired: 0,
      partiallyFilled: 1,
      working: 1,
    });
  });

  it("sums fill notional exactly, per currency, and never across currencies", () => {
    const fills = [
      fillJ({
        fill_id: "f1",
        quantity: { value: "10" },
        price: { value: "150.25", currency: { code: "USD" } },
      }),
      fillJ({
        fill_id: "f2",
        quantity: { value: "5" },
        price: { value: "100", currency: { code: "USD" } },
      }),
      fillJ({
        fill_id: "f3",
        quantity: { value: "2" },
        price: { value: "50.5", currency: { code: "EUR" } },
      }),
    ];
    expect(notionalByCurrency(fills)).toEqual([
      { currency: "EUR", amount: "101" },
      { currency: "USD", amount: "2002.5" },
    ]);
  });

  it("reports cost-data coverage instead of inventing a complete commission total", () => {
    const fills = [
      fillJ({ fill_id: "f1", commission: { amount: "1.00", currency: { code: "USD" } } }),
      fillJ({ fill_id: "f2", fees: { amount: "0.50", currency: { code: "USD" } } }),
      fillJ({ fill_id: "f3" }),
    ];
    expect(commissionCoverage(fills)).toEqual({ reported: 2, total: 3 });
    expect(commissionCoverage([])).toEqual({ reported: 0, total: 0 });
  });

  it("keeps realized and unrealized separate, per currency", () => {
    const contributions = pnlContributions(SUMMARY);
    expect(contributions).toEqual([
      { label: "EUR unrealized", value: "10.00", currency: "EUR", basis: "unrealized" },
      { label: "USD realized", value: "120.50", currency: "USD", basis: "realized" },
      { label: "USD unrealized", value: "50.00", currency: "USD", basis: "unrealized" },
    ]);
    // No cross-currency and no netted entry can appear:
    expect(contributions).toHaveLength(3);
    expect(pnlContributions(null)).toEqual([]);
    expect(summaryCurrencies(SUMMARY)).toEqual(["EUR", "USD"]);
  });

  it("derives per-position market value exactly and blanks it without a price", () => {
    expect(positionMarketValue(positionOut({ quantity: "10", market_price: "151.00" }))).toBe(
      "1510",
    );
    expect(positionMarketValue(positionOut({ quantity: "-5", market_price: "200.00" }))).toBe(
      "-1000",
    );
    expect(positionMarketValue(positionOut({ market_price: null }))).toBeNull();
  });
});

// --- builders -------------------------------------------------------------------

describe("report builders", () => {
  it("Account Statement keeps a null equity blank with the reason, never zero", () => {
    const table = buildAccountStatement({
      accountId: "ACC-001",
      asOfIso: NOW.toISOString(),
      summary: { ...SUMMARY, equity: null, exposure: null },
      balance: balanceOut(),
      positions: [positionOut({ symbol: "AAPL", quantity: "10", market_price: "151.00" })],
    });
    const equity = table.rows.find((row) => row[1] === "Equity");
    expect(equity?.[5]).toBeNull();
    expect(String(equity?.[6])).toContain("not reported");
    expect(table.rows.some((row) => row[5] === "0")).toBe(false);
    expect(table.headers).toEqual([
      "Section",
      "Item",
      "Currency",
      "Quantity",
      "Price",
      "Value",
      "Note",
    ]);
  });

  it("Account Statement carries per-currency P&L rows and a buying-power blank", () => {
    const table = buildAccountStatement({
      accountId: "ACC-001",
      asOfIso: NOW.toISOString(),
      summary: SUMMARY,
      balance: {
        account_id: "ACC-001",
        cash: [{ currency: "EUR", total: "5000.00", available: "4500.00", buying_power: null }],
      },
      positions: [],
    });
    expect(table.rows).toContainEqual([
      "P&L",
      "Realized P&L",
      "USD",
      null,
      null,
      "120.50",
      "cumulative since engine start — not a daily figure",
    ]);
    const buyingPower = table.rows.find((row) => row[1] === "Buying power");
    expect(buyingPower?.[5]).toBeNull();
    // Nothing is zero-filled: no cell in the table is the literal "0".
    expect(table.rows.some((row) => row.some((cell) => cell === "0"))).toBe(false);
  });

  it("notes a missing balance instead of emitting a zero cash row", () => {
    const table = buildAccountStatement({
      accountId: "ACC-001",
      asOfIso: NOW.toISOString(),
      summary: SUMMARY,
      balance: null,
      positions: [],
    });
    const row = table.rows.find((entry) => entry[0] === "Cash");
    expect(row?.[5]).toBeNull();
    expect(String(row?.[6])).toContain("404");
  });

  it("Trade History maps one row per order with every documented column", () => {
    const table = buildTradeHistory(
      [
        orderOut({
          client_order_id: "ord-1",
          status: "PARTIALLY_FILLED",
          limit_price: "150.25",
          stop_price: null,
          broker_order_id: null,
          rejection_reason: null,
        }),
      ],
      "IBKR",
    );
    expect(table.headers).toHaveLength(18);
    expect(table.rows).toHaveLength(1);
    const row = table.rows[0];
    expect(row[1]).toBe("ord-1");
    expect(row[3]).toBe("IBKR");
    expect(row[10]).toBe("PARTIALLY_FILLED");
    expect(row[11]).toBe("10");
    // Unreported optional fields stay empty (never "0"):
    expect(row[14]).toBe("150.25");
    expect(row[15]).toBeNull();
    expect(row[16]).toBeNull();
    expect(row[17]).toBeNull();
  });

  it("P&L Report keeps realized and unrealized in separate columns", () => {
    const table = buildPnlReport(SUMMARY, [
      positionOut({
        symbol: "AAPL",
        quantity: "10",
        market_price: "151.00",
        unrealized_pnl: "5.00",
      }),
      positionOut({ symbol: "NOPRICE", quantity: "3", market_price: null, unrealized_pnl: null }),
    ]);
    expect(table.headers).toEqual([
      "Level",
      "Item",
      "Currency",
      "Realized P&L",
      "Unrealized P&L",
      "Market value",
    ]);
    expect(table.rows).toContainEqual([
      "Account total",
      "Portfolio summary",
      "USD",
      "120.50",
      "50.00",
      "25000.00",
    ]);
    const position = table.rows.find((row) => row[1] === "AAPL (NASDAQ)");
    expect(position?.[4]).toBe("5.00");
    const unpriced = table.rows.find((row) => row[1] === "NOPRICE (NASDAQ)");
    expect(unpriced?.[5]).toBeNull();
    // The limitation travels inside the exported file:
    expect(String(table.rows[table.rows.length - 1][1])).toContain("No FX conversion");
  });

  it("P&L Report states a missing summary rather than emitting zero rows", () => {
    const table = buildPnlReport(null, []);
    expect(table.rows).toContainEqual([
      "Account total",
      "Summary not loaded",
      null,
      null,
      null,
      null,
    ]);
  });

  it("Risk Report fabricates no violation row when none was captured", () => {
    const table = buildRiskReport({
      accountId: "ACC-001",
      killSwitchActive: false,
      exposure: "25000.00",
      positions: [positionOut({ symbol: "AAPL" })],
      violations: [],
    });
    expect(table.rows.some((row) => String(row[0]).startsWith("Risk violation"))).toBe(false);
    expect(table.rows).toContainEqual([
      "State",
      "Kill switch",
      null,
      "INACTIVE",
      expect.any(String),
    ]);
    expect(toCsv(table.headers, table.rows)).not.toContain("None captured");
  });

  it("Risk Report leaves the kill switch blank when the read did not answer", () => {
    const table = buildRiskReport({
      accountId: "ACC-001",
      killSwitchActive: null,
      exposure: null,
      positions: [],
      violations: [
        {
          eventId: "e1",
          accountId: "ACC-001",
          rule: "MaxOrderQuantity",
          message: "qty 999 > 100",
          symbol: "AAPL",
          timestamp: IN_PERIOD,
        },
      ],
    });
    const killSwitch = table.rows.find((row) => row[1] === "Kill switch");
    expect(killSwitch?.[3]).toBeNull();
    const violation = table.rows.find((row) => String(row[0]).startsWith("Risk violation"));
    expect(violation?.[1]).toBe("MaxOrderQuantity");
    expect(String(violation?.[4])).toContain("AAPL");
  });

  it("Custom Report writes only the selected columns, in canonical field order", () => {
    const selected = selectColumns(ORDER_COLUMNS, ["status", "symbol"]); // ticked in reverse
    expect(selected.map((column) => column.key)).toEqual(["symbol", "status"]);
    const table = buildCustomReport(
      [orderOut({ symbol: "MSFT", status: "FILLED", limit_price: null })],
      selected,
    );
    expect(table.headers).toEqual(["Symbol", "Status"]);
    expect(table.rows).toEqual([["MSFT", "FILLED"]]);
  });

  it("Custom Report can use the position field set, nulls preserved", () => {
    const selected = selectColumns(POSITION_COLUMNS, ["symbol", "average_price"]);
    const table = buildCustomReport([positionOut({ average_price: null })], selected);
    expect(table.headers).toEqual(["Symbol", "Average price"]);
    expect(table.rows).toEqual([["AAPL", null]]);
    // The unreported price is an EMPTY cell ("AAPL,") — not "0", and not a
    // dropped column (a missing column would silently break column parity).
    expect(toCsv(table.headers, table.rows)).toBe(
      `Symbol,Average price${CSV_NEWLINE}AAPL,${CSV_NEWLINE}`,
    );
  });

  it("exposes the documented default order columns", () => {
    expect(DEFAULT_ORDER_COLUMN_KEYS).toEqual([
      "created_at",
      "symbol",
      "side",
      "order_type",
      "status",
      "quantity",
      "filled_quantity",
      "limit_price",
    ]);
    expect(toCsv(["x"], []).endsWith(CSV_NEWLINE)).toBe(true); // header-only CSV is valid
  });
});

// --- download -------------------------------------------------------------------

describe("download", () => {
  const captured: Blob[] = [];

  beforeEach(() => {
    captured.length = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob: Blob) => {
        captured.push(blob);
        return "blob:test-url";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a filesystem-safe filename with account and UTC timestamp", () => {
    expect(reportFilename("trade-history", "ACC-001", new Date("2026-10-31T12:34:56Z"))).toBe(
      "report-trade-history-ACC-001-20261031-123456Z.csv",
    );
    expect(reportFilename("pnl report", "a/b c", new Date("2026-10-31T00:00:00Z"))).toBe(
      "report-pnl-report-a_b_c-20261031-000000Z.csv",
    );
    expect(reportFilename("s", "", new Date("nonsense"))).toBe("report-s-account-unknown-time.csv");
  });

  it("hands the CSV to the browser as a text/csv blob and revokes the URL", () => {
    expect(downloadCsv("report-x.csv", "a,b\r\n1,2\r\n")).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].type).toContain("text/csv");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("reports failure instead of claiming a file when the environment refuses", () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw new Error("not permitted");
      }),
    });
    expect(downloadCsv("report-x.csv", "a\r\n")).toBe(false);
  });
});

// --- bars -----------------------------------------------------------------------

describe("bar scaling", () => {
  it("scales to the largest absolute value so a short cannot hide", () => {
    const rows = buildBars([
      { label: "long", value: "100", display: "100" },
      { label: "short", value: "-50", display: "-50" },
    ]);
    expect(rows.map((row) => row.percent)).toEqual([100, 50]);
    expect(rows.map((row) => row.tone)).toEqual(["pos", "neg"]);
  });

  it("never fabricates a full-width bar for an all-zero list", () => {
    expect(buildBars([{ label: "z", value: "0", display: "0" }])[0].percent).toBe(0);
    expect(buildBars([])).toEqual([]);
  });

  it("honours a tone override so counts are not coloured by their sign", () => {
    const rows = buildBars([{ label: "filled", value: "3", display: "3", tone: "flat" }]);
    expect(rows[0].tone).toBe("flat");
    expect(rows[0].percent).toBe(100);
  });

  it("survives an unparseable value without producing NaN widths", () => {
    const rows = buildBars([{ label: "bad", value: "abc", display: "abc" }]);
    expect(rows[0].percent).toBe(0);
    expect(rows[0].tone).toBe("flat");
  });
});

// --- page -----------------------------------------------------------------------

describe("ReportsPage", () => {
  beforeEach(() => {
    resetAllStores();
    seedSummary();
    brokersStore.update((state) => ({
      ...state,
      loadState: "ready",
      brokers: [{ name: "IBKR", connected: true }],
    }));
    seedPositions([{ symbol: "AAPL", quantity: "10", market_price: "151.00" }]);
  });

  async function renderReports(now: Date = NOW, api = createMockApi()) {
    await loginForTests(TEST_TRADER);
    withProviders(<ReportsPage now={now} />, api);
    return api;
  }

  it("renders the design's five report cards plus the honest gap tables", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    await renderReports();
    for (const title of [
      "Account Statement",
      "Trade History",
      "P&L Report",
      "Risk Report",
      "Custom Report",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "Generate a report" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Performance summary" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Execution statistics" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "How these figures are calculated" }),
    ).toBeInTheDocument();
    const gaps = screen.getByRole("region", { name: "Not available in this build" });
    // Unsupported export capabilities are named with the exact backend work,
    // never replaced by a plausible-looking substitute:
    expect(
      within(gaps).getByText(/"PDF preview" \(the design’s second format\)/),
    ).toBeInTheDocument();
    // More than one gap row points at the same backend ask:
    expect(within(gaps).getAllByText("B4 — report generation").length).toBeGreaterThan(1);
    expect(within(gaps).getByText("B5 — executions read model")).toBeInTheDocument();
    expect(within(gaps).getByText("B6 — risk-violation history")).toBeInTheDocument();
    expect(within(gaps).getByText("B3 — equity/P&L time series")).toBeInTheDocument();

    // Metrics that cannot be computed correctly are listed as NOT COMPUTED with
    // the reason, instead of being approximated:
    const methodology = screen.getByRole("region", {
      name: "How these figures are calculated",
    });
    expect(within(methodology).getByText("Slippage")).toBeInTheDocument();
    expect(within(methodology).getByText(/Net P&L \(gross/)).toBeInTheDocument();
    expect(within(methodology).getByText("Execution latency")).toBeInTheDocument();
    expect(within(methodology).getAllByText("NOT COMPUTED")).toHaveLength(4);
  });

  it("offers CSV as the only format — the PDF option is not faked", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    await renderReports();
    const format = screen.getByLabelText("Report format") as HTMLSelectElement;
    expect(format.disabled).toBe(true);
    expect(Array.from(format.options).map((option) => option.value)).toEqual(["CSV"]);
    expect(format.title).toContain("PDF needs a backend endpoint");
  });

  it("disables a card with the real reason when its source failed", async () => {
    ordersStore.setState({
      byId: {},
      ids: [],
      loadState: "error",
      errorMessage: "orders read failed",
    });
    await renderReports();
    const card = screen.getByTestId("report-card-trade-history");
    const button = within(card).getByRole("button", { name: "Download CSV" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "orders read failed");
    expect(within(card).getByText("orders read failed")).toBeInTheDocument();
  });

  it("disables a card with the reason when the period holds no records", async () => {
    seedOrders([orderOut({ created_at: OUTSIDE_30_DAYS })]);
    await renderReports();
    const card = screen.getByTestId("report-card-trade-history");
    expect(within(card).getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(
      within(card).getByText(
        "No orders submitted in 2026-10-02 … 2026-10-31 (UTC calendar days, inclusive).",
      ),
    ).toBeInTheDocument();
  });

  it("changes the applied range and re-enables the card when the period widens", async () => {
    seedOrders([orderOut({ created_at: OUTSIDE_30_DAYS })]);
    await renderReports();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Report date range"), "THIS_YEAR");
    const card = screen.getByTestId("report-card-trade-history");
    expect(within(card).getByRole("button", { name: "Download CSV" })).toBeEnabled();
    // The applied window is visible on the control AND on every period-scoped
    // card, so a widened period can never be silent:
    expect(screen.getAllByText(/2026-01-01 … 2026-10-31/).length).toBeGreaterThan(1);
  });

  it("downloads a CSV built from the loaded orders and makes NO network call", async () => {
    seedOrders([orderOut({ client_order_id: "ord-1", created_at: IN_PERIOD, status: "FILLED" })]);
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const captured: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob: Blob) => {
        captured.push(blob);
        return "blob:page-url";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    const api = await renderReports();

    const card = screen.getByTestId("report-card-trade-history");
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Download CSV" }));

    await waitFor(() => {
      expect(within(card).getByRole("status")).toHaveTextContent(
        /Downloaded report-trade-history-ACC-001-/,
      );
    });
    expect(captured).toHaveLength(1);
    // jsdom's Blob has no `.text()`; FileReader is the portable reader here.
    const csv = await readBlob(captured[0]);
    expect(csv).toContain("Submitted (UTC),Order id");
    expect(csv).toContain("ord-1");
    expect(csv).toContain("FILLED");
    expect(csv.endsWith("\r\n")).toBe(true);

    // The download path performs no I/O: no fetch, no API call of any kind.
    expect(fetched).not.toHaveBeenCalled();
    for (const mock of Object.values(api)) expect(mock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows a failure state when the browser refuses the download", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw new Error("blocked");
      }),
    });
    await renderReports();
    const card = screen.getByTestId("report-card-trade-history");
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Download CSV" }));
    await waitFor(() => {
      expect(within(card).getByRole("alert")).toHaveTextContent(/refused the file download/);
    });
  });

  it("summarises the snapshot per currency and never nets realized against unrealized", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    await renderReports();
    const summaryPanel = screen.getByRole("region", { name: "Performance summary" });
    // Per-currency rows for both currencies:
    expect(within(summaryPanel).getByText("USD realized")).toBeInTheDocument();
    expect(within(summaryPanel).getByText("EUR unrealized")).toBeInTheDocument();
    // Equity has no currency and is rendered verbatim:
    expect(within(summaryPanel).getByText("100,000")).toBeInTheDocument();
    // The bars state their scale in writing rather than implying precision:
    expect(
      within(summaryPanel).getByText(/scaled to the largest absolute value/),
    ).toBeInTheDocument();
    // No cross-currency total exists anywhere on the page:
    expect(screen.queryByText("250,120")).not.toBeInTheDocument();
  });

  it("reports order outcomes as counts and session fills with their limits", async () => {
    seedOrders([
      orderOut({ client_order_id: "o1", created_at: IN_PERIOD, status: "FILLED" }),
      orderOut({ client_order_id: "o2", created_at: IN_PERIOD, status: "PARTIALLY_FILLED" }),
      orderOut({ client_order_id: "o3", created_at: OUTSIDE_30_DAYS, status: "FILLED" }),
    ]);
    seedFills([
      fillJ({
        fill_id: "f1",
        executed_at: IN_PERIOD,
        quantity: { value: "10" },
        price: { value: "150.25", currency: { code: "USD" } },
      }),
      fillJ({ fill_id: "f2", executed_at: OUTSIDE_30_DAYS }),
    ]);
    await renderReports();
    const stats = screen.getByRole("region", { name: "Execution statistics" });
    expect(within(stats).getByText(/^2 order\(s\) submitted in this period\./)).toBeInTheDocument();
    expect(within(stats).getByText(/a partially filled order counts once/)).toBeInTheDocument();
    // Only the in-period fill contributes:
    expect(within(stats).getByText("1,502.5")).toBeInTheDocument();
    expect(
      within(stats).getByText(/Commission or fee data was reported on 0 of 1/),
    ).toBeInTheDocument();
    expect(within(stats).getByText(/Session memory only/)).toBeInTheDocument();
  });

  it("states an empty session capture instead of showing a zero total", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    seedFills([]);
    await renderReports();
    const stats = screen.getByRole("region", { name: "Execution statistics" });
    expect(within(stats).getByText(/No fills captured in/)).toBeInTheDocument();
    expect(within(stats).getByText(/backend ask B5/)).toBeInTheDocument();
    // The timestamp basis is stated: a fill outside the period is excluded,
    // never silently counted, and the epoch-stamped simulated fills are named.
    expect(within(stats).getByText(/Unix epoch \(1970-01-01\)/)).toBeInTheDocument();
    expect(within(stats).getByText(/0 fill\(s\) arrived over the WebSocket/)).toBeInTheDocument();
  });

  it("distinguishes fills captured this session from fills inside the period", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    // An epoch-stamped simulated fill: present in the session capture, outside
    // every real period. It must be reported, not hidden and not re-dated.
    seedFills([fillJ({ fill_id: "f-epoch", executed_at: "1970-01-01T00:00:00+00:00" })]);
    await renderReports();
    const stats = screen.getByRole("region", { name: "Execution statistics" });
    expect(within(stats).getByText(/No fills captured in/)).toBeInTheDocument();
    expect(within(stats).getByText(/1 fill\(s\) arrived over the WebSocket/)).toBeInTheDocument();
    expect(
      within(stats).getByText(/of which 0 fall inside the selected period/),
    ).toBeInTheDocument();
    expect(
      within(stats).getByText(/first captured 1970-01-01T00:00:00\+00:00/),
    ).toBeInTheDocument();
  });

  it("lets the Custom Report pick a data set and columns, and blocks an empty selection", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD, symbol: "MSFT" })]);
    await renderReports();
    const card = screen.getByTestId("report-card-custom-report");
    const user = userEvent.setup();

    // Default selection is the documented order field set, and it is enabled:
    expect(within(card).getByRole("button", { name: "Download CSV" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Custom report columns" })).toBeInTheDocument();

    // Untick everything → disabled with a stated reason:
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    for (const box of boxes) {
      if (box.checked) await user.click(box);
    }
    expect(within(card).getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(within(card).getByText("Select at least one column.")).toBeInTheDocument();

    // Switch the field set to positions and tick one column:
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Custom report data set" }),
      "positions",
    );
    await user.click(screen.getByRole("checkbox", { name: "Symbol" }));
    expect(within(card).getByRole("button", { name: "Download CSV" })).toBeEnabled();
  });

  it("shows the loading state for the snapshot before the account data arrives", async () => {
    resetAllStores();
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    await renderReports();
    const summaryPanel = screen.getByRole("region", { name: "Performance summary" });
    expect(within(summaryPanel).getByText(/Loading the account snapshot/)).toBeInTheDocument();
  });

  it("surfaces the account error on the snapshot panel and blocks the statement card", async () => {
    accountStore.update((state) => ({
      ...state,
      summary: null,
      summaryState: "error",
      errorMessage: "account read failed",
    }));
    await renderReports();
    const summaryPanel = screen.getByRole("region", { name: "Performance summary" });
    expect(within(summaryPanel).getByRole("alert")).toHaveTextContent("account read failed");
    const card = screen.getByTestId("report-card-account-statement");
    expect(within(card).getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(within(card).getByText("account read failed")).toBeInTheDocument();
  });

  it("carries the session violation count into the Risk Report scope note", async () => {
    seedOrders([orderOut({ created_at: IN_PERIOD })]);
    riskStore.setState({
      violations: [
        {
          eventId: "e1",
          accountId: "ACC-001",
          rule: "MaxOrderQuantity",
          message: "qty 999 > 100",
          symbol: "AAPL",
          timestamp: IN_PERIOD,
        },
      ],
    });
    await renderReports();
    const card = screen.getByTestId("report-card-risk-report");
    expect(
      within(card).getByText(/1 violation\(s\) captured since this terminal opened/),
    ).toBeInTheDocument();
  });
});
