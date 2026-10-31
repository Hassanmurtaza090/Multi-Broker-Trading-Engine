/**
 * Administration & Settings tests (FE-M11).
 *
 * Covers the two honest surfaces this milestone adds:
 * - browser-local preferences (validation, persistence, real storage health)
 * - the Administration screen's READ-ONLY principal data + gap report
 *
 * No fixture here is presented as backend data: the pages are asserted to show
 * only what the session really carries, and to render a gap (never a fake user,
 * role, setting or audit record) for everything the API does not provide.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdministrationPage } from "../../pages/AdministrationPage";
import { SettingsPage } from "../../pages/SettingsPage";
import { authService } from "../../services/auth";
import { resetAllStores, uiStore } from "../../stores";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  hydrateUiPreferences,
  loadPreferences,
  parsePreferences,
  savePreferences,
  serializePreferences,
  type StoredPreferences,
} from "../../stores/uiStore";
import { loginForTests, TEST_ADMIN, TEST_TRADER } from "../../test/mocks";

const PREFS: StoredPreferences = { defaultView: "reports", defaultAccountId: "ACC-009" };

beforeEach(() => {
  // Unstub FIRST: a storage stub from the previous test must not leak into the
  // reset below (a stubbed localStorage has no clear/reset).
  vi.unstubAllGlobals();
  resetAllStores();
  localStorage.clear();
});

describe("preferences persistence", () => {
  it("defaults when nothing has been stored", () => {
    expect(loadPreferences()).toEqual({ prefs: DEFAULT_PREFERENCES, health: "ok" });
  });

  it("round-trips the saved view and account", () => {
    expect(savePreferences(PREFS)).toEqual({ ok: true });
    expect(loadPreferences().prefs).toEqual(PREFS);
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(serializePreferences(PREFS));
  });

  it("parses only its own version and a known destination", () => {
    const payload = JSON.parse(serializePreferences(PREFS)) as Record<string, unknown>;
    expect(parsePreferences(JSON.stringify({ ...payload, version: 2 }))).toBeNull();
    expect(parsePreferences(JSON.stringify({ ...payload, defaultView: "not-a-view" }))).toBeNull();
    expect(parsePreferences("{}")).toBeNull();
    expect(parsePreferences("not json")).toBeNull();
    expect(parsePreferences(null)).toBeNull();
  });

  it("keeps a valid view but drops an unusable account id", () => {
    const payload = JSON.parse(serializePreferences(PREFS)) as Record<string, unknown>;
    expect(
      parsePreferences(JSON.stringify({ ...payload, defaultAccountId: "x".repeat(129) })),
    ).toEqual({ defaultView: "reports", defaultAccountId: null });
    expect(parsePreferences(JSON.stringify({ ...payload, defaultAccountId: "   " }))).toEqual({
      defaultView: "reports",
      defaultAccountId: null,
    });
    expect(parsePreferences(JSON.stringify({ ...payload, defaultAccountId: 42 }))).toEqual({
      defaultView: "reports",
      defaultAccountId: null,
    });
  });

  it("trims a stored account id", () => {
    const payload = JSON.parse(serializePreferences(PREFS)) as Record<string, unknown>;
    expect(parsePreferences(JSON.stringify({ ...payload, defaultAccountId: "  ACC-7  " }))).toEqual(
      { defaultView: "reports", defaultAccountId: "ACC-7" },
    );
  });

  it("reports unavailable storage instead of assuming a save worked", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPreferences()).toEqual({ prefs: DEFAULT_PREFERENCES, health: "unavailable" });
    expect(savePreferences(PREFS)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports a blocked read as unavailable and a rejected write as an error", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadPreferences().health).toBe("unavailable");
    expect(savePreferences(PREFS)).toEqual({ ok: false, reason: "error" });
  });

  it("applies the stored preferences to the ui store when hydrating", () => {
    savePreferences(PREFS);
    hydrateUiPreferences();
    expect(uiStore.getSnapshot().view).toBe("reports");
    expect(uiStore.getSnapshot().accountId).toBe("ACC-009");
  });

  it("leaves the configured account default when none was stored", () => {
    const before = uiStore.getSnapshot().accountId;
    savePreferences({ defaultView: "overview", defaultAccountId: null });
    hydrateUiPreferences();
    expect(uiStore.getSnapshot().view).toBe("overview");
    expect(uiStore.getSnapshot().accountId).toBe(before);
  });
});

describe("SettingsPage", () => {
  it("offers the implemented destinations and states where they are stored", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);

    const workspace = screen.getByLabelText("Default workspace");
    expect(workspace).toHaveValue("dashboard");
    // Every real destination is offered, including the two new ones.
    expect(within(workspace).getByRole("option", { name: "Administration" })).toBeInTheDocument();
    expect(within(workspace).getByRole("option", { name: "Settings" })).toBeInTheDocument();
    expect(within(workspace).getByRole("option", { name: "Trade" })).toBeInTheDocument();

    expect(screen.getByText(/mbt\.preferences\.v1/)).toBeInTheDocument();
    expect(screen.getByText(/belong to this browser and this terminal/)).toBeInTheDocument();
    expect(screen.getByText(/preferences are saved in this browser only/)).toBeInTheDocument();
  });

  it("keeps Save and Cancel disabled until the form is dirty", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("warns about unsaved changes, then persists the chosen workspace", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Default workspace"), "overview");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(screen.getByText(/Preferences saved in this browser/)).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}") as {
      defaultView?: string;
    };
    expect(stored.defaultView).toBe("overview");
    // The running view is NOT hijacked mid-session — the preference is for next load.
    expect(uiStore.getSnapshot().view).toBe("dashboard");
  });

  it("reverts the draft on Cancel and clears the warning", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Default workspace"), "activity");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Default workspace")).toHaveValue("dashboard");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it("reports a rejected write as an error and never claims success", async () => {
    await loginForTests(TEST_TRADER);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Default workspace"), "markets");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was saved/);
    expect(screen.queryByText(/Preferences saved/)).not.toBeInTheDocument();
    expect(screen.getByText(/the last write failed/)).toBeInTheDocument();
  });

  it("rejects an over-long account id without writing", async () => {
    await loginForTests(TEST_ADMIN);
    render(<SettingsPage />);
    const user = userEvent.setup();
    const account = screen.getByLabelText("Default account");

    fireEvent.change(account, { target: { value: "x".repeat(129) } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/1–128 characters/);
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
  });

  it("limits scoped users to their own accounts and lets admins enter any id", async () => {
    await loginForTests(TEST_TRADER);
    const { unmount } = render(<SettingsPage />);
    const scoped = screen.getByLabelText("Default account");
    expect(scoped.tagName).toBe("SELECT");
    expect(
      within(scoped)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["ACC-001"]);
    unmount();

    resetAllStores();
    await loginForTests(TEST_ADMIN);
    render(<SettingsPage />);
    const freeEntry = screen.getByLabelText("Default account");
    expect(freeEntry.tagName).toBe("INPUT");
    expect(screen.getByText(/unrestricted account scope/)).toBeInTheDocument();
  });

  it("states that notification settings do not exist instead of showing dead toggles", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    expect(screen.getByText(/No notification settings exist/)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
  });

  it("states the single implemented appearance instead of offering a theme switch", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByText(/One appearance is implemented/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument();
  });

  it("documents every unsupported setting with the work it needs", async () => {
    await loginForTests(TEST_TRADER);
    render(<SettingsPage />);
    const gaps = screen.getByRole("region", { name: "Not available in this build" });
    for (const setting of [
      "Server-side preferences",
      "Language",
      "Time zone",
      "Theme (Dark / System)",
      "Chart style (Candlesticks / Line)",
      "Compact market data",
      "Notifications",
      "Application-level configuration & feature flags",
    ]) {
      expect(within(gaps).getByText(setting)).toBeInTheDocument();
    }
    expect(within(gaps).getByText(/GET \/api\/v1\/users\/me\/preferences/)).toBeInTheDocument();
  });
});

describe("AdministrationPage", () => {
  it("renders the caller's real principal, permissions and scope", async () => {
    await loginForTests(TEST_TRADER);
    render(<AdministrationPage />);

    const principal = screen.getByRole("region", { name: "Current principal" });
    // "trader" is both the subject and the role here — match each explicitly.
    expect(within(principal).getByText("trader", { selector: "code" })).toBeInTheDocument();
    expect(within(principal).getByText("trader", { selector: ".badge" })).toBeInTheDocument();
    expect(within(principal).getByText("ACC-001")).toBeInTheDocument();
    // Permission rows come from /auth/me, labels from the route map.
    expect(within(principal).getByText("orders:write")).toBeInTheDocument();
    expect(within(principal).getByText(/always through the risk gate/)).toBeInTheDocument();
    // risk:admin is not granted to a trader — and the page says so.
    expect(within(principal).queryByText("risk:admin")).not.toBeInTheDocument();
    expect(
      within(principal).getByText(/risk:admin is not in your permission set/),
    ).toBeInTheDocument();
  });

  it("gates the administrative workspace for non-admins and names their roles", async () => {
    await loginForTests(TEST_TRADER);
    render(<AdministrationPage />);

    const workspace = screen.getByRole("region", { name: "Administrative workspace" });
    expect(
      within(workspace).getByText(/Administrator access required.*role\(s\): trader/),
    ).toBeInTheDocument();
    expect(within(workspace).queryByText(/No administrative operation is available/)).toBeNull();
  });

  it("shows an admin the honest empty administrative workspace and the wildcard scope", async () => {
    await loginForTests(TEST_ADMIN);
    render(<AdministrationPage />);

    expect(screen.getByText(/All accounts — the wildcard/)).toBeInTheDocument();
    expect(screen.getByText("risk:admin")).toBeInTheDocument();
    const workspace = screen.getByRole("region", { name: "Administrative workspace" });
    expect(
      within(workspace).getByText(/No administrative operation is available in this build/),
    ).toBeInTheDocument();
  });

  it("reports the session's token expiry (never the token itself)", async () => {
    await loginForTests(TEST_TRADER);
    render(<AdministrationPage />);

    const session = screen.getByRole("region", { name: "Session" });
    expect(within(session).getByText("Access token expires")).toBeInTheDocument();
    expect(within(session).queryByText("unknown")).toBeNull();
    expect(document.body.textContent).not.toMatch(/eyJ|rt_|wst_|password_hash/);
    const expiry = authService.getSessionExpiry();
    expect(expiry).not.toBeNull();
  });

  it("invents no user directory, role editor or activity feed", async () => {
    await loginForTests(TEST_ADMIN);
    render(<AdministrationPage />);

    expect(screen.queryByRole("columnheader", { name: /email/i })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /last login/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add user/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    const gaps = screen.getByRole("region", { name: "Not supported by this backend" });
    for (const capability of [
      "User directory (list / search / filter / paginate)",
      "Activate / deactivate / suspend accounts",
      "Roles & permissions administration",
      "Password change / reset / MFA",
      "Session listing & revocation",
      "Audit log / administrative activity",
      "Administrative statistics",
      "Application-level settings & feature flags",
    ]) {
      expect(within(gaps).getByText(capability)).toBeInTheDocument();
    }
    // The /metrics finding is stated rather than dressed up as admin data.
    expect(within(gaps).getByText(/NOT admin-gated/)).toBeInTheDocument();
  });
});
