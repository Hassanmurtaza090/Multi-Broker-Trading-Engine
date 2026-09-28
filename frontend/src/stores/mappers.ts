/**
 * Serialization-boundary mappers (M11): WS domain payloads (nested domain
 * models per backend/events + backend/domain) → the flat UI record types that
 * stores hold (mirrors of the M10 REST DTOs). Both directions of the M10 API
 * are consumed here so stores see ONE canonical shape regardless of origin.
 */

import type {
  BalanceOut,
  CashBalanceOut,
  OrderOut,
  OrderStatusValue,
  PositionOut,
} from "../types/api";
import type { BalanceJ, OrderJ, PositionJ } from "../types/events";

export function orderFromJ(order: OrderJ): OrderOut {
  return {
    client_order_id: order.client_order_id,
    account_id: order.account_id,
    symbol: order.instrument.symbol,
    exchange: order.instrument.exchange,
    currency: order.instrument.currency.code,
    side: order.side,
    order_type: order.order_type,
    status: order.status as OrderStatusValue,
    quantity: order.quantity.value,
    filled_quantity: order.filled_quantity.value,
    remaining_quantity: String(
      // remaining = quantity - filled, computed exactly via string decimals.
      decimalSubtract(order.quantity.value, order.filled_quantity.value),
    ),
    limit_price: order.limit_price ? order.limit_price.value : null,
    stop_price: order.stop_price ? order.stop_price.value : null,
    time_in_force: order.time_in_force,
    broker_order_id: order.broker_order_id,
    rejection_reason: order.rejection_reason,
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

export function positionFromJ(position: PositionJ, previous?: PositionOut): PositionOut {
  return {
    account_id: position.account_id,
    symbol: position.instrument.symbol,
    exchange: position.instrument.exchange,
    currency: position.instrument.currency.code,
    quantity: position.quantity.value,
    average_price: position.average_price ? position.average_price.value : null,
    realized_pnl: position.realized_pnl ? position.realized_pnl.amount : null,
    // WS payloads carry the portfolio's P&L snapshot at fill time; market
    // price / server-side staleness only exist on REST reads — preserve any
    // previously REST-loaded values instead of blanking them.
    unrealized_pnl: position.unrealized_pnl
      ? position.unrealized_pnl.amount
      : (previous?.unrealized_pnl ?? null),
    market_price: previous?.market_price ?? null,
    stale: previous?.stale ?? true,
  };
}

export function balanceFromJ(balance: BalanceJ): BalanceOut {
  const cash: CashBalanceOut[] = Object.values(balance.cash)
    .map((entry) => ({
      currency: entry.currency.code,
      total: entry.total.amount,
      available: entry.available.amount,
      buying_power: entry.buying_power ? entry.buying_power.amount : null,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { account_id: balance.account_id, cash };
}

/** Exact string-decimal subtraction (no floats). Only valid decimals expected. */
function decimalSubtract(a: string, b: string): string {
  // Both values originate from the backend's fixed-point serialization and are
  // non-negative quantities; normalize and subtract with bigint integer math.
  const toScaled = (v: string): { scaled: bigint; decimals: number } => {
    const [intPart = "0", fracPart = ""] = v.split(".");
    return {
      scaled: BigInt(intPart + fracPart || "0"),
      decimals: fracPart.length,
    };
  };
  const x = toScaled(a.trim());
  const y = toScaled(b.trim());
  const scale = Math.max(x.decimals, y.decimals);
  const xs = x.scaled * 10n ** BigInt(scale - x.decimals);
  const ys = y.scaled * 10n ** BigInt(scale - y.decimals);
  const diff = xs - ys;
  const negative = diff < 0n;
  const digits = (negative ? -diff : diff).toString().padStart(scale + 1, "0");
  const intOut = digits.slice(0, digits.length - scale) || "0";
  const fracOut = scale > 0 ? digits.slice(digits.length - scale).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${intOut}${fracOut ? `.${fracOut}` : ""}`;
}
