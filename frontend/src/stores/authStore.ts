/**
 * Auth store (M12) — reactive mirror of the authService session.
 *
 * The authService (services/auth.ts) owns the in-memory credentials; this
 * store projects them into React state. On session expiry/logout the store
 * flips to `logged_out`, which unmounts the terminal and shows LoginView.
 *
 * RBAC helpers here drive UX-only gating (hidden controls); the SERVER
 * enforces every rule regardless (see tests/security on the backend).
 */

import type { UserOut } from "../types/api";
import { allowedAccounts, authService, canAdminRisk, canTrade } from "../services/auth";
import { uiStore } from "./uiStore";
import { createStore, type Store } from "./store";

export type AuthStatus = "logged_out" | "logging_in" | "logged_in";

export interface AuthViewState {
  status: AuthStatus;
  user: UserOut | null;
}

const initialState: AuthViewState = {
  status: "logged_out",
  user: null,
};

export function createAuthStore(): Store<AuthViewState> {
  return createStore(initialState);
}

export const authStore = createAuthStore();

function syncFromService(): void {
  const user = authService.getUser();
  const status = user !== null ? "logged_in" : "logged_out";
  const previous = authStore.getSnapshot().status;
  authStore.update((s) => ({ ...s, status, user }));
  // On login: default the active account to one the user can actually see.
  if (status === "logged_in" && user !== null && previous !== "logged_in") {
    const allowed = allowedAccounts(user);
    if (allowed !== null && allowed.length > 0) {
      const current = uiStore.getSnapshot().accountId;
      if (!allowed.includes(current)) {
        uiStore.update((s) => ({ ...s, accountId: allowed[0] }));
      }
    }
  }
}

// Project authService transitions into the store (login/refresh/expire/logout).
authService.subscribe(syncFromService);

/** UX gates (the server re-checks everything). */
export function userCanTrade(): boolean {
  return canTrade(authStore.getSnapshot().user);
}

export function userCanAdminRisk(): boolean {
  return canAdminRisk(authStore.getSnapshot().user);
}

export function userAllowedAccounts(): string[] | null {
  return allowedAccounts(authStore.getSnapshot().user);
}
