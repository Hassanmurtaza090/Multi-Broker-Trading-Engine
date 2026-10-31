/**
 * Authentication service (M12) — the frontend half of the JWT session model
 * (ADR-018).
 *
 * Security posture:
 * - Tokens live in MEMORY ONLY (never localStorage/cookies): an XSS payload
 *   cannot read persisted credentials, and nothing survives a page reload.
 *   The tradeoff (re-login on reload) is documented in ADR-018.
 * - The refresh token is never sent anywhere except POST /auth/refresh and
 *   /auth/logout; it is never logged, rendered, or attached to WS URLs.
 * - A single-flight refresh guarantees that N concurrent 401s trigger exactly
 *   ONE refresh; a failed refresh emits `sessionExpired` (the app shows the
 *   login view).
 *
 * The backend remains the security boundary: every role/scope check is
 * server-side. This service only holds the session the server issued.
 */

import type { LoginIn, UserOut } from "../types/api";
import { ApiClient, isApiError } from "./api";

type SessionListener = () => void;

interface Session {
  accessToken: string;
  refreshToken: string;
  user: UserOut;
  expiresAt: number;
}

let session: Session | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<SessionListener>();

/** A dedicated client for the auth endpoints themselves (no interceptor:
 *  login/refresh must never trigger the 401-retry loop). */
const authApi = new ApiClient();

function notify(): void {
  for (const listener of listeners) listener();
}

export const authService = {
  /** Current authenticated user, or null when logged out. */
  getUser(): UserOut | null {
    return session ? session.user : null;
  },

  getAccessToken(): string | null {
    return session ? session.accessToken : null;
  },

  isAuthenticated(): boolean {
    return session !== null;
  },

  /** Access-token expiry (epoch ms) for the current session, or null when
   *  signed out. Read-only session fact shown on the Administration screen;
   *  the token itself is never exposed. */
  getSessionExpiry(): number | null {
    return session ? session.expiresAt : null;
  },

  subscribe(listener: SessionListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async login(body: LoginIn): Promise<UserOut> {
    const pair = await authApi.login(body);
    session = {
      accessToken: pair.access_token,
      refreshToken: pair.refresh_token,
      user: {
        subject: pair.user.subject,
        roles: pair.user.roles,
        accounts: pair.user.accounts,
        permissions: pair.user.permissions,
      },
      expiresAt: Date.now() + pair.expires_in * 1000,
    };
    notify();
    return session.user;
  },

  /** Rotate the refresh token into a fresh pair. Single-flight: concurrent
   *  callers await the same request. Returns false when no session exists or
   *  the refresh failed (in which case the session is cleared). */
  async refresh(): Promise<boolean> {
    if (session === null) return false;
    if (refreshInFlight !== null) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const pair = await authApi.refresh({ refresh_token: session!.refreshToken });
        session = {
          accessToken: pair.access_token,
          refreshToken: pair.refresh_token,
          user: pair.user,
          expiresAt: Date.now() + pair.expires_in * 1000,
        };
        notify();
        return true;
      } catch {
        clearSession();
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  /** Best-effort logout: revokes the server session, then clears locally
   *  regardless (a failed logout must never leave a zombie session). */
  async logout(): Promise<void> {
    const current = session;
    if (current !== null) {
      try {
        await authApi.logoutWith(current.accessToken, { refresh_token: current.refreshToken });
      } catch {
        // Server-side revocation failed (e.g. already expired) — clear anyway.
      }
    }
    clearSession();
  },

  /** Local-only teardown used when the server says the session is dead. */
  expire(): void {
    clearSession();
  },
};

function clearSession(): void {
  session = null;
  notify();
}

// --- RBAC helpers (UX only — the server enforces everything) -------------------

export function canTrade(user: UserOut | null): boolean {
  return user?.permissions.includes("orders:write") ?? false;
}

export function canAdminRisk(user: UserOut | null): boolean {
  return user?.permissions.includes("risk:admin") ?? false;
}

export function allowedAccounts(user: UserOut | null): string[] | null {
  if (user === null) return null;
  if (user.accounts.includes("*")) return null; // unrestricted
  return user.accounts;
}

export function isAuthExpiredError(error: unknown): boolean {
  return isApiError(error) && error.kind === "unauthenticated";
}
