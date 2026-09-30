/**
 * API DTO types (M11) — mirror of `backend/api/schemas.py` (M10).
 *
 * Every financial value is an exact-decimal JSON string (ADR-016). The
 * frontend NEVER converts them to floats for logic; display formatting only.
 */

export type DecimalString = string;

// --- enums (StrEnum values on the wire) --------------------------------------

export const ORDER_SIDES = ["BUY", "SELL"] as const;
export type OrderSideValue = (typeof ORDER_SIDES)[number];

export const ORDER_TYPES = ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] as const;
export type OrderTypeValue = (typeof ORDER_TYPES)[number];

export const TIME_IN_FORCE = ["DAY", "GTC", "IOC", "FOK", "GTD"] as const;
export type TimeInForceValue = (typeof TIME_IN_FORCE)[number];

export const ASSET_CLASSES = [
  "EQUITY",
  "OPTION",
  "FUTURE",
  "FOREX",
  "CFD",
  "BOND",
  "FUND",
  "CRYPTO",
] as const;
export type AssetClassValue = (typeof ASSET_CLASSES)[number];

export const EXCHANGES = [
  "UNKNOWN",
  "NYSE",
  "NASDAQ",
  "AMEX",
  "ARCA",
  "CBOE",
  "CME",
  "ICE",
  "LSE",
  "EURONEXT",
  "OTC",
] as const;
export type ExchangeValue = (typeof EXCHANGES)[number];

/** Order lifecycle states (mirror of backend OrderStatus). */
export const ORDER_STATUSES = [
  "NEW",
  "PENDING_SUBMIT",
  "SUBMITTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "PENDING_CANCEL",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/** Statuses in which an order can no longer be acted on (mirror of backend TERMINAL_STATUSES). */
export const TERMINAL_STATUSES: ReadonlySet<OrderStatusValue> = new Set([
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
]);

// --- requests ------------------------------------------------------------------

export interface InstrumentIn {
  symbol: string;
  asset_class: string;
  currency: string;
  exchange?: string;
}

export interface OrderCreateIn {
  account_id: string;
  instrument: InstrumentIn;
  side: string;
  order_type: string;
  quantity: string;
  limit_price?: string | null;
  stop_price?: string | null;
  time_in_force?: string;
  idempotency_key?: string | null;
}

export interface OrderModifyIn {
  limit_price?: string | null;
  stop_price?: string | null;
}

// --- responses -----------------------------------------------------------------

export interface OrderOut {
  client_order_id: string;
  account_id: string;
  symbol: string;
  exchange: string;
  currency: string;
  side: string;
  order_type: string;
  status: OrderStatusValue;
  quantity: DecimalString;
  filled_quantity: DecimalString;
  remaining_quantity: DecimalString;
  limit_price: DecimalString | null;
  stop_price: DecimalString | null;
  time_in_force: string;
  broker_order_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PositionOut {
  account_id: string;
  symbol: string;
  exchange: string;
  currency: string;
  quantity: DecimalString;
  average_price: DecimalString | null;
  realized_pnl: DecimalString | null;
  unrealized_pnl: DecimalString | null;
  market_price: DecimalString | null;
  stale: boolean;
}

export interface CashBalanceOut {
  currency: string;
  total: DecimalString;
  available: DecimalString;
  buying_power: DecimalString | null;
}

export interface BalanceOut {
  account_id: string;
  cash: CashBalanceOut[];
}

export interface AccountSummaryOut {
  account_id: string;
  equity: DecimalString | null;
  exposure: DecimalString | null;
  realized_pnl: Record<string, DecimalString>;
  unrealized_pnl: Record<string, DecimalString>;
  market_value: Record<string, DecimalString>;
}

export interface QuoteOut {
  symbol: string;
  exchange: string;
  currency: string;
  bid: DecimalString | null;
  ask: DecimalString | null;
  last: DecimalString | null;
  mid: DecimalString | null;
  timestamp: string;
  stale: boolean;
}

export interface BrokerStatusOut {
  name: string;
  connected: boolean;
}

export interface KillSwitchOut {
  account_id: string;
  active: boolean;
}

export interface HealthOut {
  status: string;
  broker: string;
  broker_connected: boolean;
}

export interface RuleResultOut {
  rule: string;
  reason: string | null;
  data_unavailable: boolean;
}

export interface RiskDecisionOut {
  approved: boolean;
  violations: RuleResultOut[];
}

export interface ErrorOut {
  code: string;
  message: string;
  detail?: string | null;
}

export interface ErrorResponseOut {
  error: ErrorOut;
}

// --- auth (M12) -----------------------------------------------------------------

export interface LoginIn {
  username: string;
  password: string;
}

export interface TokenPairOut {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

export interface UserOut {
  subject: string;
  roles: string[];
  accounts: string[];
  permissions: string[];
}

export interface WsTicketOut {
  ticket: string;
  expires_in: number;
}
