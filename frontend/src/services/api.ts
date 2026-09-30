/**
 * REST API client (M11/M12) — typed surface over the M10/M12 gateway.
 *
 * Contract (backend/api, ADR-016/018):
 * - Errors are `{ error: { code, message, detail? } }` with stable codes.
 * - Risk rejections are HTTP 422 with `{ approved: false, violations, error }`.
 * - 504 = broker timeout (outcome UNKNOWN — never resubmit blindly; the
 *   idempotency key makes a retry safe), 503 = broker connection lost.
 * - 401 = unauthenticated (missing/expired/invalid token); 403 = forbidden
 *   (role or account-scope denial). The API layer is the ONLY security
 *   boundary — this client merely carries the session the server issued.
 *
 * Auth integration (M12): when an `AuthProvider` is attached, the bearer
 * token is attached to every request and a 401 triggers ONE single-flight
 * refresh + retry. Auth endpoints themselves never loop.
 */

import type {
  AccountSummaryOut,
  BalanceOut,
  BrokerStatusOut,
  HealthOut,
  KillSwitchOut,
  LoginIn,
  OrderCreateIn,
  OrderModifyIn,
  OrderOut,
  PositionOut,
  QuoteOut,
  RiskDecisionOut,
  RuleResultOut,
  TokenPairOut,
  UserOut,
  WsTicketOut,
} from "../types/api";

export type ApiErrorKind =
  | "unauthenticated" // 401 — no/invalid/expired session
  | "forbidden" // 403 — role or account-scope denial
  | "risk" // 422 risk-gate rejection (violations attached)
  | "validation" // 400/422 request or domain validation
  | "not_found" // 404
  | "conflict" // 409 (duplicate/state conflict)
  | "timeout" // 504 broker timeout — outcome unknown
  | "connection_lost" // 503 broker disconnected
  | "broker_error" // 502 other broker failure
  | "server" // 5xx unexpected
  | "network" // fetch itself failed (API unreachable)
  | "http"; // anything else

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;
  readonly violations: RuleResultOut[];
  readonly kind: ApiErrorKind;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    detail?: string | null;
    violations?: RuleResultOut[];
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.detail = args.detail ?? null;
    this.violations = args.violations ?? [];
    this.kind = ApiError.kindFor(args.status, args.violations);
  }

  private static kindFor(status: number, violations?: RuleResultOut[]): ApiErrorKind {
    if (status === 422 && violations && violations.length > 0) return "risk";
    if (status === 401) return "unauthenticated";
    if (status === 403) return "forbidden";
    if (status === 504) return "timeout";
    if (status === 503) return "connection_lost";
    if (status === 502) return "broker_error";
    if (status === 404) return "not_found";
    if (status === 409) return "conflict";
    if (status === 400 || status === 422) return "validation";
    if (status >= 500) return "server";
    if (status === 0) return "network";
    return "http";
  }

  /** Human-facing summary; never contains stack traces or internals. */
  get userMessage(): string {
    switch (this.kind) {
      case "unauthenticated":
        return "Your session has expired or is invalid — please sign in again.";
      case "forbidden":
        return "You do not have permission to perform this action.";
      case "risk":
        return "Rejected by risk controls";
      case "timeout":
        return "Broker timed out — the outcome is unknown. Check the order list before retrying (a safe retry reuses the same idempotency key).";
      case "connection_lost":
        return "Broker connection lost — try again after reconnection.";
      case "network":
        return "Cannot reach the trading API. Check the connection.";
      case "server":
        return "Unexpected server error.";
      default:
        return this.message;
    }
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Session provider wired into the client by the composition root (M12). */
export interface ApiAuthProvider {
  getAccessToken(): string | null;
  /** Single-flight refresh; resolves false when no session can be restored. */
  refresh(): Promise<boolean>;
}

function networkError(cause: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: "NETWORK_ERROR",
    message: cause instanceof Error ? cause.message : "network request failed",
  });
}

export class ApiClient {
  /** Endpoints that must never attach a bearer token nor retry on 401. */
  private static AUTH_FREE_PATHS = ["/auth/login", "/auth/refresh"];

  constructor(
    private readonly baseUrl: string = "",
    private readonly auth?: ApiAuthProvider,
  ) {}

  private static isAuthFree(path: string): boolean {
    return ApiClient.AUTH_FREE_PATHS.some((prefix) => path.startsWith(prefix));
  }

  private url(
    path: string,
    query?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}/api/v1${path}`, window.location.origin);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /** Path parameters are untrusted (e.g. the account selector input). */
  private static seg(value: string): string {
    return encodeURIComponent(value);
  }

  // --- transport core ---------------------------------------------------------------

  private async fetchWithRetry<T>(
    url: string,
    path: string,
    method: string,
    body: unknown | undefined,
    isRetry: boolean,
  ): Promise<T> {
    const authFree = ApiClient.isAuthFree(path);
    const token = authFree ? null : (this.auth?.getAccessToken() ?? null);
    const headers: Record<string, string> = {};
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw networkError(error);
    }

    // Exactly one single-flight refresh + retry per request (M12): a 401 with
    // our own token attached means the access token expired — rotate, replay.
    if (
      response.status === 401 &&
      token !== null &&
      !isRetry &&
      this.auth !== undefined &&
      !authFree
    ) {
      const refreshed = await this.auth.refresh();
      if (refreshed && this.auth.getAccessToken() !== null) {
        return this.fetchWithRetry<T>(url, path, method, body, true);
      }
      throw await this.toApiError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    if (response.ok) {
      return (await response.json()) as T;
    }
    throw await this.toApiError(response);
  }

  private get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return this.fetchWithRetry<T>(this.url(path, query), path, "GET", undefined, false);
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.fetchWithRetry<T>(this.url(path), path, method, body, false);
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Non-JSON error body (e.g. proxy HTML) — fall through to generic mapping.
    }
    const record =
      payload !== null && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const errorRecord =
      record.error !== null && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const violations = Array.isArray(record.violations)
      ? (record.violations as RuleResultOut[])
      : undefined;
    return new ApiError({
      status: response.status,
      code: typeof errorRecord?.code === "string" ? errorRecord.code : String(response.status),
      message:
        typeof errorRecord?.message === "string"
          ? errorRecord.message
          : `request failed with status ${response.status}`,
      detail: typeof errorRecord?.detail === "string" ? errorRecord.detail : null,
      violations,
    });
  }

  // --- auth endpoints (M12) ----------------------------------------------------------

  login(body: LoginIn): Promise<TokenPairOut> {
    return this.request("POST", "/auth/login", body);
  }

  refresh(body: { refresh_token: string }): Promise<TokenPairOut> {
    return this.request("POST", "/auth/refresh", body);
  }

  logout(body: { refresh_token: string }): Promise<void> {
    return this.request("POST", "/auth/logout", body);
  }

  /** Raw logout with an EXPLICIT token (used by the auth service itself,
   *  which must not recurse through its own interceptor). */
  async logoutWith(accessToken: string, body: { refresh_token: string }): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.url("/auth/logout"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw networkError(error);
    }
    if (response.ok || response.status === 401) return; // revoked or already dead
    throw await this.toApiError(response);
  }

  me(): Promise<UserOut> {
    return this.get("/auth/me");
  }

  createWsTicket(): Promise<WsTicketOut> {
    return this.request("POST", "/auth/ws-ticket");
  }

  // --- endpoints (mirror of backend/api/rest.py) --------------------------------------

  health(): Promise<HealthOut> {
    return this.get("/health");
  }

  listBrokers(): Promise<BrokerStatusOut[]> {
    return this.get("/brokers");
  }

  listOrders(accountId?: string): Promise<OrderOut[]> {
    return this.get("/orders", { account_id: accountId });
  }

  createOrder(body: OrderCreateIn): Promise<OrderOut> {
    return this.request("POST", "/orders", body);
  }

  cancelOrder(clientOrderId: string): Promise<OrderOut> {
    return this.request("POST", `/orders/${ApiClient.seg(clientOrderId)}/cancel`);
  }

  modifyOrder(clientOrderId: string, body: OrderModifyIn): Promise<OrderOut> {
    return this.request("POST", `/orders/${ApiClient.seg(clientOrderId)}/modify`, body);
  }

  listPositions(accountId: string): Promise<PositionOut[]> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/positions`);
  }

  getBalance(accountId: string): Promise<BalanceOut> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/balance`);
  }

  getAccountSummary(accountId: string): Promise<AccountSummaryOut> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/summary`);
  }

  getQuote(query: {
    symbol: string;
    asset_class: string;
    currency: string;
    exchange?: string;
  }): Promise<QuoteOut> {
    return this.get("/market/quote", {
      symbol: query.symbol,
      asset_class: query.asset_class,
      currency: query.currency,
      exchange: query.exchange === "UNKNOWN" ? undefined : query.exchange,
    });
  }

  getKillSwitch(accountId: string): Promise<KillSwitchOut> {
    return this.get(`/accounts/${ApiClient.seg(accountId)}/risk/kill-switch`);
  }

  setKillSwitch(accountId: string, active: boolean): Promise<KillSwitchOut> {
    return this.request(
      "POST",
      `/accounts/${ApiClient.seg(accountId)}/risk/kill-switch`,
      { active },
    );
  }

  evaluateRisk(accountId: string, body: OrderCreateIn): Promise<RiskDecisionOut> {
    return this.request("POST", `/accounts/${ApiClient.seg(accountId)}/risk/evaluate`, body);
  }
}
