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
  /**
   * Display name, only when a payload actually carries one (the WS
   * `InstrumentJ.description`). REST quotes (`QuoteOut`) and the instrument
   * identity itself never include it, so it is OPTIONAL and must never be
   * synthesized from the symbol — the UI shows “—” when it is absent.
   */
  name?: string | null;
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
    name: instrument.description,
  };
}

/**
 * Upper-case the identity fields so a descriptor typed by a user and the same
 * instrument arriving from the engine produce the same display and the same
 * quote query. Names are kept verbatim (never derived from the symbol).
 */
export function normalizeDescriptor(instrument: InstrumentDescriptor): InstrumentDescriptor {
  return {
    symbol: instrument.symbol.trim().toUpperCase(),
    asset_class: instrument.asset_class.trim().toUpperCase(),
    currency: instrument.currency.trim().toUpperCase(),
    exchange: instrument.exchange.trim().toUpperCase() || "UNKNOWN",
    name: instrument.name ?? null,
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
