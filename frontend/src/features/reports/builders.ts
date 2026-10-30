/**
 * Report row builders (FE-M10) — PURE. Typed read models in, CSV table out.
 *
 * EVERY CELL IS TRACEABLE. Each builder maps fields that exist in the API
 * DTOs (or in records the terminal received over the WebSocket) — nothing is
 * inferred from a status, nothing is invented, and no value is filled in
 * because a fetch failed. A cell the backend did not report stays `null`,
 * which serializes to an empty CSV cell (never "0").
 *
 * The two derived cells in this module are declared in the Reports page's
 * methodology table:
 *   - Position "market value" = quantity × market price (exact decimal), the
 *     same derivation the M3 allocation already uses. `null` without a price.
 *   - Exposure / equity are backend account-level aggregates; the API reports
 *     no currency for them, so the Currency cell stays empty.
 *
 * Limitations travel WITH the data (trailing "Note" rows and per-cell notes),
 * so an exported file cannot be mistaken for a statement the backend never
 * produced.
 */

import type { RiskViolationItem } from "../../stores/riskStore";
import type { AccountSummaryOut, BalanceOut, OrderOut, PositionOut } from "../../types/api";
import type { CsvCell } from "./csv";
import { positionMarketValue, summaryCurrencies } from "./metrics";

export interface CsvTable {
  headers: string[];
  rows: CsvCell[][];
}

// --- Account statement ------------------------------------------------------------

export const ACCOUNT_STATEMENT_HEADERS: readonly string[] = [
  "Section",
  "Item",
  "Currency",
  "Quantity",
  "Price",
  "Value",
  "Note",
];

export interface AccountStatementInput {
  accountId: string;
  /** ISO timestamp of the export — the snapshot moment, at the caller's clock. */
  asOfIso: string;
  summary: AccountSummaryOut | null;
  balance: BalanceOut | null;
  positions: readonly PositionOut[];
}

export function buildAccountStatement(input: AccountStatementInput): CsvTable {
  const rows: CsvCell[][] = [
    [
      "Snapshot",
      "Account",
      null,
      null,
      null,
      input.accountId,
      "the runtime binds one broker account (ADR-016)",
    ],
    [
      "Snapshot",
      "As of (UTC)",
      null,
      null,
      null,
      input.asOfIso,
      "point-in-time snapshot taken at export time — not a periodic statement",
    ],
  ];

  if (input.summary === null) {
    rows.push([
      "Summary",
      "Account summary",
      null,
      null,
      null,
      null,
      "not loaded — the gateway returned no portfolio summary for this account",
    ]);
  } else {
    rows.push([
      "Summary",
      "Equity",
      null,
      null,
      null,
      input.summary.equity,
      input.summary.equity === null
        ? "not reported: the account-level aggregate is withheld for multi-currency or missing-balance accounts (ADR-013)"
        : "account-level aggregate; the API reports no currency for it",
    ]);
    rows.push([
      "Summary",
      "Gross exposure",
      null,
      null,
      null,
      input.summary.exposure,
      input.summary.exposure === null
        ? "not reported (same condition as equity)"
        : "gross exposure of open positions",
    ]);
    for (const currency of summaryCurrencies(input.summary)) {
      const realized = input.summary.realized_pnl[currency];
      const unrealized = input.summary.unrealized_pnl[currency];
      const marketValue = input.summary.market_value[currency];
      if (realized !== undefined) {
        rows.push([
          "P&L",
          "Realized P&L",
          currency,
          null,
          null,
          realized,
          "cumulative since engine start — not a daily figure",
        ]);
      }
      if (unrealized !== undefined) {
        rows.push([
          "P&L",
          "Unrealized P&L",
          currency,
          null,
          null,
          unrealized,
          "as last marked by the backend (marks may be stale)",
        ]);
      }
      if (marketValue !== undefined) {
        rows.push([
          "P&L",
          "Market value",
          currency,
          null,
          null,
          marketValue,
          "backend per-currency total across open positions",
        ]);
      }
    }
  }

  if (input.balance === null) {
    rows.push([
      "Cash",
      "Balances",
      null,
      null,
      null,
      null,
      "not reported — GET /balance returns 404 until a broker reports balances",
    ]);
  } else {
    for (const entry of input.balance.cash) {
      rows.push([
        "Cash",
        "Total",
        entry.currency,
        null,
        null,
        entry.total,
        "broker-reported cash total",
      ]);
      rows.push([
        "Cash",
        "Available",
        entry.currency,
        null,
        null,
        entry.available,
        "cash available to trade",
      ]);
      rows.push([
        "Cash",
        "Buying power",
        entry.currency,
        null,
        null,
        entry.buying_power,
        entry.buying_power === null ? "not reported by the broker" : "broker-reported buying power",
      ]);
    }
  }

  for (const position of input.positions) {
    rows.push([
      "Position",
      `${position.symbol} (${position.exchange})`,
      position.currency,
      position.quantity,
      position.market_price,
      positionMarketValue(position),
      positionNote(position),
    ]);
  }

  return { headers: [...ACCOUNT_STATEMENT_HEADERS], rows };
}

function positionNote(position: PositionOut): string {
  return [
    `average price ${position.average_price ?? "not reported"}`,
    `realized ${position.realized_pnl ?? "not reported"}`,
    `unrealized ${position.unrealized_pnl ?? "not reported"}`,
    position.stale ? "market marks are STALE" : "market marks fresh",
  ].join("; ");
}

// --- Trade history ---------------------------------------------------------------

export const TRADE_HISTORY_HEADERS: readonly string[] = [
  "Submitted (UTC)",
  "Order id",
  "Account",
  "Broker",
  "Symbol",
  "Exchange",
  "Currency",
  "Side",
  "Type",
  "Time in force",
  "Status",
  "Quantity",
  "Filled",
  "Remaining",
  "Limit price",
  "Stop price",
  "Broker order id",
  "Rejection reason",
];

/**
 * One row per ORDER — the OMS record, exactly as the read model reports it.
 * A partially filled order is one row; it is not expanded into executions,
 * because `OrderOut` carries no per-fill records (M5 gap, backend ask B5).
 */
export function buildTradeHistory(
  orders: readonly OrderOut[],
  brokerName: string | null,
): CsvTable {
  const rows = orders.map<CsvCell[]>((order) => [
    order.created_at,
    order.client_order_id,
    order.account_id,
    brokerName,
    order.symbol,
    order.exchange,
    order.currency,
    order.side,
    order.order_type,
    order.time_in_force,
    order.status,
    order.quantity,
    order.filled_quantity,
    order.remaining_quantity,
    order.limit_price,
    order.stop_price,
    order.broker_order_id,
    order.rejection_reason,
  ]);
  return { headers: [...TRADE_HISTORY_HEADERS], rows };
}

// --- P&L report ------------------------------------------------------------------

export const PNL_REPORT_HEADERS: readonly string[] = [
  "Level",
  "Item",
  "Currency",
  "Realized P&L",
  "Unrealized P&L",
  "Market value",
];

export const PNL_LIMITATION_NOTE =
  "No FX conversion, no cross-currency total, no fees or commissions, and no realized/unrealized netting: none of those exist in the current read models";

/**
 * Realized and unrealized stay in separate columns and per currency. A blank
 * cell means the backend did not report that figure for that row — not zero.
 */
export function buildPnlReport(
  summary: AccountSummaryOut | null,
  positions: readonly PositionOut[],
): CsvTable {
  const rows: CsvCell[][] = [];

  if (summary === null) {
    rows.push(["Account total", "Summary not loaded", null, null, null, null]);
  } else {
    for (const currency of summaryCurrencies(summary)) {
      rows.push([
        "Account total",
        "Portfolio summary",
        currency,
        summary.realized_pnl[currency] ?? null,
        summary.unrealized_pnl[currency] ?? null,
        summary.market_value[currency] ?? null,
      ]);
    }
  }

  for (const position of positions) {
    rows.push([
      "Position",
      `${position.symbol} (${position.exchange})`,
      position.currency,
      position.realized_pnl,
      position.unrealized_pnl,
      positionMarketValue(position),
    ]);
  }

  rows.push(["Note", PNL_LIMITATION_NOTE, null, null, null, null]);
  return { headers: [...PNL_REPORT_HEADERS], rows };
}

// --- Risk report -----------------------------------------------------------------

export const RISK_REPORT_HEADERS: readonly string[] = [
  "Section",
  "Item",
  "Currency",
  "Value",
  "Detail",
];

export interface RiskReportInput {
  accountId: string;
  /** `null` = the kill-switch read did not answer (never assumed false). */
  killSwitchActive: boolean | null;
  exposure: string | null;
  positions: readonly PositionOut[];
  /** Session-memory violations only — the backend persists none (ask B6). */
  violations: readonly RiskViolationItem[];
}

/**
 * Risk state + the risk-relevant session records. When there are no captured
 * violations the violation section is simply ABSENT — no placeholder row is
 * fabricated to make the report look populated.
 */
export function buildRiskReport(input: RiskReportInput): CsvTable {
  const rows: CsvCell[][] = [
    ["State", "Account", null, input.accountId, ""],
    [
      "State",
      "Kill switch",
      null,
      input.killSwitchActive === null ? null : input.killSwitchActive ? "ACTIVE" : "INACTIVE",
      input.killSwitchActive === null
        ? "not reported — the risk engine did not answer; the state is unknown"
        : "engine-enforced server-side: while active, new orders are rejected",
    ],
    [
      "State",
      "Gross exposure",
      null,
      input.exposure,
      input.exposure === null
        ? "not reported for this account (multi-currency or missing balances)"
        : "the API reports no currency for this aggregate",
    ],
  ];

  for (const position of input.positions) {
    rows.push([
      "Position",
      `${position.symbol} (${position.exchange})`,
      position.currency,
      position.quantity,
      `unrealized ${position.unrealized_pnl ?? "not reported"}; ${
        position.stale ? "market marks are STALE" : "market marks fresh"
      }`,
    ]);
  }

  for (const violation of input.violations) {
    rows.push([
      "Risk violation (session only)",
      violation.rule,
      null,
      violation.message,
      `${violation.symbol ?? "no symbol"} · ${violation.timestamp}`,
    ]);
  }

  return { headers: [...RISK_REPORT_HEADERS], rows };
}

// --- Custom report ---------------------------------------------------------------

export interface CustomColumn<T> {
  key: string;
  label: string;
  value: (row: T) => CsvCell;
}

export const ORDER_COLUMNS: readonly CustomColumn<OrderOut>[] = [
  { key: "created_at", label: "Submitted (UTC)", value: (o) => o.created_at },
  { key: "client_order_id", label: "Order id", value: (o) => o.client_order_id },
  { key: "account_id", label: "Account", value: (o) => o.account_id },
  { key: "symbol", label: "Symbol", value: (o) => o.symbol },
  { key: "exchange", label: "Exchange", value: (o) => o.exchange },
  { key: "currency", label: "Currency", value: (o) => o.currency },
  { key: "side", label: "Side", value: (o) => o.side },
  { key: "order_type", label: "Type", value: (o) => o.order_type },
  { key: "time_in_force", label: "Time in force", value: (o) => o.time_in_force },
  { key: "status", label: "Status", value: (o) => o.status },
  { key: "quantity", label: "Quantity", value: (o) => o.quantity },
  { key: "filled_quantity", label: "Filled", value: (o) => o.filled_quantity },
  { key: "remaining_quantity", label: "Remaining", value: (o) => o.remaining_quantity },
  { key: "limit_price", label: "Limit price", value: (o) => o.limit_price },
  { key: "stop_price", label: "Stop price", value: (o) => o.stop_price },
  { key: "broker_order_id", label: "Broker order id", value: (o) => o.broker_order_id },
  { key: "rejection_reason", label: "Rejection reason", value: (o) => o.rejection_reason },
];

export const POSITION_COLUMNS: readonly CustomColumn<PositionOut>[] = [
  { key: "symbol", label: "Symbol", value: (p) => p.symbol },
  { key: "exchange", label: "Exchange", value: (p) => p.exchange },
  { key: "currency", label: "Currency", value: (p) => p.currency },
  { key: "quantity", label: "Quantity", value: (p) => p.quantity },
  { key: "average_price", label: "Average price", value: (p) => p.average_price },
  { key: "market_price", label: "Market price", value: (p) => p.market_price },
  { key: "realized_pnl", label: "Realized P&L", value: (p) => p.realized_pnl },
  { key: "unrealized_pnl", label: "Unrealized P&L", value: (p) => p.unrealized_pnl },
];

export const DEFAULT_ORDER_COLUMN_KEYS: readonly string[] = [
  "created_at",
  "symbol",
  "side",
  "order_type",
  "status",
  "quantity",
  "filled_quantity",
  "limit_price",
];

export const DEFAULT_POSITION_COLUMN_KEYS: readonly string[] = [
  "symbol",
  "quantity",
  "average_price",
  "market_price",
  "unrealized_pnl",
];

/**
 * Narrow a column set to the user's selection, keeping the CANONICAL column
 * order (the order columns are declared in), not the order they were clicked —
 * a CSV whose column order depends on click history is not reviewable.
 */
export function selectColumns<T>(
  all: readonly CustomColumn<T>[],
  keys: readonly string[],
): CustomColumn<T>[] {
  return all.filter((column) => keys.includes(column.key));
}

/** Selected columns only; no hidden always-on fields. */
export function buildCustomReport<T>(
  rows: readonly T[],
  columns: readonly CustomColumn<T>[],
): CsvTable {
  return {
    headers: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => column.value(row))),
  };
}
