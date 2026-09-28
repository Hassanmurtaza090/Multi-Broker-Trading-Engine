/**
 * Risk event feed store (M11): a bounded, newest-first log of M6
 * `risk.violation` events — the terminal's risk visibility surface (TS-009).
 */

import type { RiskViolationPayload } from "../types/events";
import { createStore, type Store } from "./store";

export interface RiskViolationItem {
  eventId: string;
  accountId: string;
  rule: string;
  message: string;
  symbol: string | null;
  timestamp: string;
}

export interface RiskViewState {
  violations: RiskViolationItem[];
}

export const VIOLATIONS_LIMIT = 200;

const initialState: RiskViewState = { violations: [] };

export function createRiskStore(): Store<RiskViewState> {
  return createStore(initialState);
}

export function pushViolation(
  state: RiskViewState,
  envelopeId: string,
  timestamp: string,
  payload: RiskViolationPayload,
): RiskViewState {
  const item: RiskViolationItem = {
    eventId: envelopeId,
    accountId: payload.account_id,
    rule: payload.rule,
    message: payload.message,
    symbol: payload.instrument ? payload.instrument.symbol : null,
    timestamp,
  };
  return { violations: [item, ...state.violations].slice(0, VIOLATIONS_LIMIT) };
}

export const riskStore = createRiskStore();
