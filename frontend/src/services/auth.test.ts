/**
 * M12 frontend auth tests: session lifecycle, single-flight refresh, the
 * 401→refresh→retry interceptor, and RBAC helpers. Tokens are asserted to
 * stay in memory only (never localStorage).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClient, ApiError, isApiError } from "../services/api";
import { allowedAccounts, authService, canAdminRisk, canTrade } from "../services/auth";
import { authStore, resetAllStores } from "../stores";
import { loginForTests, TEST_ADMIN, TEST_TRADER, TEST_VIEWER, tokenPairFor } from "../test/mocks";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetAllStores();
});

describe("authService session lifecycle", () => {
  it("login stores the session in memory and syncs the auth store", async () => {
    await loginForTests(TEST_TRADER);
    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.getUser()?.subject).toBe("trader");
    expect(authService.getAccessToken()).toContain("test-access-trader");
    expect(authStore.getSnapshot().status).toBe("logged_in");

    // Security property: credentials never persist to storage.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("refresh rotates tokens through the server (single round trip)", async () => {
    await loginForTests(TEST_TRADER);
    const rotated = tokenPairFor(TEST_ADMIN); // new pair for the same login path
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, rotated)));
    const ok = await authService.refresh();
    expect(ok).toBe(true);
    expect(authService.getAccessToken()).toContain("test-access-admin");
    expect(authService.getUser()?.subject).toBe("admin");
  });

  it("a failed refresh clears the session and flips the store to logged_out", async () => {
    await loginForTests(TEST_TRADER);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "invalid" } }),
        ),
    );
    const ok = await authService.refresh();
    expect(ok).toBe(false);
    expect(authService.isAuthenticated()).toBe(false);
    expect(authStore.getSnapshot().status).toBe("logged_out");
  });

  it("concurrent refreshes are collapsed into ONE server call (single-flight)", async () => {
    await loginForTests(TEST_TRADER);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => jsonResponse(200, tokenPairFor(TEST_TRADER))),
    );
    const [a, b, c] = await Promise.all([
      authService.refresh(),
      authService.refresh(),
      authService.refresh(),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // ONE network call
  });

  it("logout clears the session locally even when the server is unreachable", async () => {
    await loginForTests(TEST_TRADER);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await authService.logout();
    expect(authService.isAuthenticated()).toBe(false);
    expect(authStore.getSnapshot().status).toBe("logged_out");
  });
});

describe("ApiClient auth interceptor", () => {
  it("attaches the bearer token to protected requests", async () => {
    await loginForTests(TEST_TRADER);
    const provider = {
      getAccessToken: () => authService.getAccessToken(),
      refresh: () => authService.refresh(),
    };
    const client = new ApiClient("", provider);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await client.listOrders();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${authService.getAccessToken()}`);
  });

  it("on 401: refreshes once and retries the original request", async () => {
    await loginForTests(TEST_TRADER);
    const refreshSpy = vi.fn().mockResolvedValue(true);
    const provider = {
      getAccessToken: vi.fn().mockReturnValueOnce("stale-token").mockReturnValue("fresh-token"), // every call after the first
      refresh: refreshSpy,
    };
    const client = new ApiClient("", provider);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "expired" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, [{ hello: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.listOrders();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer fresh-token");
    expect(result).toEqual([{ hello: 1 }]);
  });

  it("on 401 with a dead session: surfaces the 401, no retry loop", async () => {
    await loginForTests(TEST_TRADER);
    const provider = {
      getAccessToken: () => "stale-token",
      refresh: vi.fn().mockResolvedValue(false), // session unrestorable
    };
    const client = new ApiClient("", provider);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "expired" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const error = await client.listOrders().catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).kind).toBe("unauthenticated");
    expect(fetchMock).toHaveBeenCalledTimes(1); // NO retry
  });

  it("login/refresh endpoints never attach tokens nor retry (no loops)", async () => {
    const provider = {
      getAccessToken: () => "some-token",
      refresh: vi.fn(),
    };
    const client = new ApiClient("", provider);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "bad credentials" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await client.login({ username: "u", password: "p" }).catch(() => null);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.refresh).not.toHaveBeenCalled();
  });

  it("maps 403 to a forbidden kind with a permission message", async () => {
    const client = new ApiClient();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(403, { error: { code: "FORBIDDEN", message: "no access to account X" } }),
        ),
    );
    const error = await client.listPositions("X").catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe("forbidden");
    expect((error as ApiError).userMessage).toContain("permission");
  });
});

describe("RBAC helpers (UX gates; server is the boundary)", () => {
  it("viewer vs trader vs admin permissions derive from the role model", () => {
    expect(canTrade(TEST_TRADER)).toBe(true);
    expect(canTrade(TEST_VIEWER)).toBe(false);
    expect(canTrade(TEST_ADMIN)).toBe(true);
    expect(canAdminRisk(TEST_TRADER)).toBe(false);
    expect(canAdminRisk(TEST_ADMIN)).toBe(true);
    expect(canAdminRisk(TEST_VIEWER)).toBe(false);
  });

  it("account scoping: wildcard is unrestricted; scoped users list their accounts", () => {
    expect(allowedAccounts(TEST_ADMIN)).toBeNull();
    expect(allowedAccounts(TEST_TRADER)).toEqual(["ACC-001"]);
    expect(allowedAccounts(null)).toBeNull();
  });
});
