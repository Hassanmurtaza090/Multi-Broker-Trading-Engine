/**
 * Broker capability metadata (FE-M9).
 *
 * This describes what each simulated adapter ACTUALLY implements.
 * Real transports are deferred (ADR-014/015) — these reflect the
 * simulated/paper environments used in development and CI.
 */

import type { OrderTypeValue, TimeInForceValue, AssetClassValue } from "../../types/api";

export interface BrokerCapability {
  name: string;
  transport: "simulated" | "real";
  /** The adapter class name in backend/brokers/<name>/adapter.py */
  adapterClass: string;
  /** Supported connection methods. */
  authMethods: readonly ("none" | "api_key" | "oauth" | "certificate")[];
  /** Asset classes the adapter can trade (simulated). */
  assetClasses: readonly AssetClassValue[];
  /** Order types the adapter accepts (simulated). */
  orderTypes: readonly OrderTypeValue[];
  /** Time-in-force values the adapter respects (simulated). */
  timeInForce: readonly TimeInForceValue[];
  /** Market data capabilities. */
  marketData: {
    realtimeQuotes: boolean;
    streamingBars: boolean;
    historicalBars: boolean;
    level2: boolean;
  };
  /** Account data capabilities. */
  accountData: {
    balance: boolean;
    positions: boolean;
    equity: boolean;
    margin: boolean;
  };
  /** Execution features. */
  execution: {
    partialFills: boolean;
    orderModification: boolean;
    orderCancellation: boolean;
    reconciliation: boolean;
  };
  /** Environment support. */
  environments: readonly ("paper" | "live")[];
  /** Known limitations of the SIMULATED adapter. */
  simulatedLimitations: readonly string[];
}

/** Capabilities for the IBKR simulated adapter (backend/brokers/ibkr). */
export const IBKR_CAPABILITIES: BrokerCapability = {
  name: "IBKR",
  transport: "simulated",
  adapterClass: "IbkrAdapter",
  authMethods: ["none"], // Simulated: no auth required in paper mode
  assetClasses: ["EQUITY", "OPTION", "FUTURE", "FOREX", "BOND", "CFD"],
  orderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
  timeInForce: ["DAY", "GTC", "IOC", "FOK"],
  marketData: {
    realtimeQuotes: true,
    streamingBars: true,
    historicalBars: true,
    level2: false,
  },
  accountData: {
    balance: true,
    positions: true,
    equity: true,
    margin: false, // Not implemented in simulated adapter
  },
  execution: {
    partialFills: true,
    orderModification: true,
    orderCancellation: true,
    reconciliation: true,
  },
  environments: ["paper"],
  simulatedLimitations: [
    "No real authentication — connects without credentials in simulation mode",
    "No margin reporting — `buying_power` and margin fields are null",
    "Historical bars require IBKR bar-size strings (e.g. '1 day')",
    "Real TWS/Gateway transport deferred (ADR-014)",
  ],
};

/** Capabilities for the Saxo simulated adapter (backend/brokers/saxo). */
export const SAXO_CAPABILITIES: BrokerCapability = {
  name: "SAXO",
  transport: "simulated",
  adapterClass: "SaxoAdapter",
  authMethods: ["oauth"], // Real adapter uses OAuth; simulated accepts any credentials
  assetClasses: ["EQUITY", "OPTION", "FUTURE", "FOREX", "BOND", "CFD"],
  orderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
  timeInForce: ["DAY", "GTC", "IOC", "FOK"],
  marketData: {
    realtimeQuotes: true,
    streamingBars: true,
    historicalBars: true,
    level2: false,
  },
  accountData: {
    balance: true,
    positions: true,
    equity: true,
    margin: false,
  },
  execution: {
    partialFills: true,
    orderModification: true,
    orderCancellation: true,
    reconciliation: true,
  },
  environments: ["paper"],
  simulatedLimitations: [
    "OAuth flow simulated — no real token exchange in simulation mode",
    "Instruments identified by UIC + AssetType (requires SAXO_UIC identifier)",
    "No margin reporting — `buying_power` and margin fields are null",
    "Real OpenAPI transport deferred (ADR-015)",
  ],
};

/** Registry of all known broker capabilities. */
export const BROKER_CAPABILITIES: ReadonlyMap<string, BrokerCapability> = new Map([
  ["IBKR", IBKR_CAPABILITIES],
  ["SAXO", SAXO_CAPABILITIES],
]);

/** Get capabilities for a broker by name, or undefined if unknown. */
export function getBrokerCapabilities(name: string): BrokerCapability | undefined {
  return BROKER_CAPABILITIES.get(name.toUpperCase());
}

/** All known broker names. */
export const KNOWN_BROKERS = Array.from(BROKER_CAPABILITIES.keys());
