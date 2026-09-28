/**
 * Instrument identity helpers (M11).
 *
 * A stable `instrumentKey` identifies an instrument across REST payloads and
 * WS event payloads so quotes/positions merge correctly regardless of origin.
 */

import type { InstrumentIn } from "../types/api";
import type { InstrumentJ } from "../types/events";

export interface InstrumentDescriptor {
  symbol: string;
  asset_class: string;
  currency: string;
  exchange: string;
}

export function instrumentKey(instrument: InstrumentDescriptor): string {
  return [
    instrument.symbol.toUpperCase(),
    instrument.asset_class.toUpperCase(),
    instrument.currency.toUpperCase(),
    instrument.exchange.toUpperCase(),
  ].join("|");
}

export function instrumentLabel(instrument: InstrumentDescriptor): string {
  const venue = instrument.exchange.toUpperCase();
  return venue && venue !== "UNKNOWN"
    ? `${instrument.symbol.toUpperCase()} · ${venue}`
    : instrument.symbol.toUpperCase();
}

export function descriptorFromJ(instrument: InstrumentJ): InstrumentDescriptor {
  return {
    symbol: instrument.symbol,
    asset_class: instrument.asset_class,
    currency: instrument.currency.code,
    exchange: instrument.exchange,
  };
}

export function descriptorToIn(instrument: InstrumentDescriptor): InstrumentIn {
  return {
    symbol: instrument.symbol,
    asset_class: instrument.asset_class,
    currency: instrument.currency,
    exchange: instrument.exchange,
  };
}
