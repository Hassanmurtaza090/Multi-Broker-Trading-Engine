/**
 * Account store (M11): balance, portfolio summary, and the M6 kill switch.
 *
 * `GET /balance` returns 404 until a broker reports balances — a legitimate
 * "no data yet" state (`balanceState: "missing"`), not an error.
 */

import type { AccountSummaryOut, BalanceOut } from "../types/api";
import { createStore, type Store } from "./store";

export type ResourceState = "idle" | "loading" | "ready" | "missing" | "error";

export interface AccountViewState {
  balance: BalanceOut | null;
  balanceState: ResourceState;
  summary: AccountSummaryOut | null;
  summaryState: ResourceState;
  killSwitchActive: boolean | null;
  killSwitchState: ResourceState;
  errorMessage: string | null;
}

const initialState: AccountViewState = {
  balance: null,
  balanceState: "idle",
  summary: null,
  summaryState: "idle",
  killSwitchActive: null,
  killSwitchState: "idle",
  errorMessage: null,
};

export function createAccountStore(): Store<AccountViewState> {
  return createStore(initialState);
}

export const accountStore = createAccountStore();
