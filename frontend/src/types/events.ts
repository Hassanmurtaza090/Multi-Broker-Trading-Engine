/**
 * WebSocket event types (M11) — mirror of the M2 envelope + domain payloads
 * serialized by `backend/events/serialization.py` (pydantic JSON mode):
 * decimals are strings, UUIDs are strings, datetimes are ISO strings, and
 * StrEnums are their values.
 *
 * Delivery is at-least-once (ADR-016): consumers dedupe by `event_id` and can
 * resync from REST at any time. Cross-topic ordering is NOT guaranteed; stores
 * must merge events idempotently.
 */

/** Currency value object: { code: "USD" } */
export interface CurrencyJ {
  code: string;
}

export interface PriceJ {
  value: string;
  currency: CurrencyJ;
}

export interface QuantityJ {
  value: string;
}

export interface MoneyJ {
  amount: string;
  currency: CurrencyJ;
}

export interface InstrumentJ {
  symbol: string;
  asset_class: string;
  currency: CurrencyJ;
  instrument_type: string | null;
  exchange: string;
  description: string | null;
  identifiers: Record<string, string>;
}

export interface OrderJ {
  client_order_id: string;
  account_id: string;
  instrument: InstrumentJ;
  side: string;
  order_type: string;
  quantity: QuantityJ;
  status: string;
  time_in_force: string;
  limit_price: PriceJ | null;
  stop_price: PriceJ | null;
  broker_order_id: string | null;
  rejection_reason: string | null;
  filled_quantity: QuantityJ;
  created_at: string;
  updated_at: string;
}

export interface FillJ {
  fill_id: string;
  order_client_id: string;
  broker_order_id: string | null;
  account_id: string;
  instrument: InstrumentJ;
  side: string;
  quantity: QuantityJ;
  price: PriceJ;
  commission: MoneyJ | null;
  fees: MoneyJ | null;
  executed_at: string;
}

export interface PositionJ {
  account_id: string;
  instrument: InstrumentJ;
  quantity: QuantityJ;
  average_price: PriceJ | null;
  realized_pnl: MoneyJ | null;
  unrealized_pnl: MoneyJ | null;
  updated_at: string;
}

export interface QuoteJ {
  instrument: InstrumentJ;
  bid: PriceJ | null;
  ask: PriceJ | null;
  last: PriceJ | null;
  bid_size: QuantityJ | null;
  ask_size: QuantityJ | null;
  timestamp: string;
}

export interface CashBalanceJ {
  currency: CurrencyJ;
  total: MoneyJ;
  available: MoneyJ;
  buying_power: MoneyJ | null;
}

export interface BalanceJ {
  account_id: string;
  cash: Record<string, CashBalanceJ>;
  equity: MoneyJ | null;
  margin_used: MoneyJ | null;
  realized_pnl: MoneyJ | null;
  unrealized_pnl: MoneyJ | null;
}

// --- per-event payload shapes (backend/events/types.py) -----------------------

export interface OrderEventPayload {
  order: OrderJ;
  request?: unknown;
  reason?: string;
  fill?: FillJ;
}

export interface PositionEventPayload {
  position: PositionJ;
  fill?: FillJ | null;
}

export interface BalanceEventPayload {
  balance: BalanceJ;
}

export interface QuoteEventPayload {
  quote: QuoteJ;
}

export interface BrokerEventPayload {
  broker: string;
  account_id: string | null;
  reason?: string;
}

export interface AccountEventPayload {
  account_id: string;
}

export interface RiskViolationPayload {
  account_id: string;
  instrument: InstrumentJ | null;
  rule: string;
  message: string;
}

export type EventPayload =
  | OrderEventPayload
  | PositionEventPayload
  | BalanceEventPayload
  | QuoteEventPayload
  | BrokerEventPayload
  | AccountEventPayload
  | RiskViolationPayload;

/** Serialized M2 EventEnvelope as streamed by backend/api/ws.py. */
export interface EventEnvelopeJ {
  event_id: string;
  event_type: string;
  event_version: number;
  timestamp: string;
  source?: string;
  correlation_id?: string | null;
  causation_id?: string | null;
  payload: EventPayload;
}

/** Control frames sent by the hub on connect / ping. */
export interface ControlMessage {
  control: "hello" | "pong";
  client_id?: string;
  topics?: string[];
  delivery?: string;
  dedupe_key?: string;
}

export const ORDER_EVENT_TYPES = [
  "order.submitted",
  "order.accepted",
  "order.rejected",
  "order.cancelled",
  "order.modified",
  "order.partially_filled",
  "order.filled",
  "order.expired",
] as const;

export const POSITION_EVENT_TYPES = [
  "position.opened",
  "position.updated",
  "position.closed",
] as const;

export function isOrderEvent(eventType: string): boolean {
  return (ORDER_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function isPositionEvent(eventType: string): boolean {
  return (POSITION_EVENT_TYPES as readonly string[]).includes(eventType);
}
