/**
 * Settings (FE-M11) — the Figma Make "Application settings" screen.
 *
 * The prototype offers General / Notifications / Appearance tabs. This build
 * can only HONESTLY implement the General tab's two values that map onto state
 * the terminal really owns: the default workspace (landing view) and the
 * default account. Both are stored in THIS BROWSER (localStorage) — the API has
 * no user-preferences resource, so nothing here syncs, and nothing here is
 * application-level configuration.
 *
 * Everything else the prototype shows (language, time zone, theme, chart
 * style, density, notification toggles, global/feature-flag configuration) is
 * listed in the gap table with the exact reason instead of being rendered as a
 * control that would pretend to work.
 *
 * Design source: Figma Make `App.tsx` (§ "Settings": tabs General /
 * Notifications / Appearance, a `.settings-form` grid, "Save changes" in
 * `.detail-actions"). Screen exists in the prototype; the values do not.
 */

import { useState, type FormEvent } from "react";

import { Panel } from "../components/Panel";
import { EmptyState } from "../components/Status";
import { VIEWS } from "../layouts/views";
import { allowedAccounts } from "../services/auth";
import { authStore } from "../stores/authStore";
import { useStoreState } from "../stores/store";
import {
  MAX_ACCOUNT_ID_LENGTH,
  loadPreferences,
  savePreferences,
  type StoredPreferences,
} from "../stores/uiStore";
import type { StorageHealth } from "../stores/watchlistsStore";

const TABS = [
  { id: "general", label: "General" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];

interface SettingsGap {
  setting: string;
  effect: string;
  requiredWork: string;
}

/** Prototype rows that cannot be applied honestly in this build. */
const UNSUPPORTED: readonly SettingsGap[] = [
  {
    setting: "Server-side preferences",
    effect:
      "Both saved values live in this browser only. Nothing on this page is written to the backend, and nothing follows the user to another device or browser.",
    requiredWork:
      "GET /api/v1/users/me/preferences + PUT (same document back, validated server-side), stored per user in a real persistence layer, plus GET/PUT /api/v1/admin/settings for application-level values with an audit entry per change.",
  },
  {
    setting: "Language",
    effect:
      "No language select. Every label in the terminal is an English literal; there is no translation catalogue and no locale on the user record.",
    requiredWork:
      "An i18n catalogue for the UI, a locale field on the user record, and a formatter contract shared by every screen (prices, quantities, timestamps).",
  },
  {
    setting: "Time zone",
    effect:
      "No time-zone select. Timestamps render in the browser's local zone via `toLocaleString`; the server always sends ISO-8601 with an offset.",
    requiredWork:
      "A display-timezone setting plus one shared formatter (`utils/time.ts`) that every screen uses, and tests proving no screen bypasses it.",
  },
  {
    setting: "Theme (Dark / System)",
    effect:
      "No theme switch. The terminal ships one dark token set in `styles.css`; there is no second theme to select.",
    requiredWork:
      "A full light/system token set and a `prefers-color-scheme` path — a frontend design task, not a backend one.",
  },
  {
    setting: "Chart style (Candlesticks / Line)",
    effect:
      "No chart-style select. The API exposes quotes, not bars, so the terminal draws sparklines and simple series only.",
    requiredWork:
      "A bars/candles endpoint (FE-M10's documented gap). Until it exists there is no candlestick chart to style.",
  },
  {
    setting: "Compact market data",
    effect:
      "No density toggle. Table and row spacing are fixed by the design tokens; a compact mode would change every workspace's layout.",
    requiredWork:
      "Spacing tokens with a density dimension applied across the terminal, plus visual and keyboard checks on every table.",
  },
  {
    setting: "Notifications",
    effect:
      "No notification toggles. The backend has no notification service, no delivery channel (email/webhook/push) and no notification endpoints; WebSocket events are not addressed to a user.",
    requiredWork:
      "A notification model with per-user preferences, delivery channels and a `GET/PUT /api/v1/users/me/notifications` resource — then toggles that reflect stored values.",
  },
  {
    setting: "Application-level configuration & feature flags",
    effect:
      "Not offered. Configuration is environment/startup (`backend/config/settings.py`, `VITE_*`) and requires a restart; there is no settings API and no feature-flag system.",
    requiredWork:
      "An authenticated, audited admin settings resource with validation and change history, and an explicit list of flags the runtime reads at request time.",
  },
];

export function SettingsPage() {
  const { user } = useStoreState(authStore);
  const scopedAccounts = allowedAccounts(user);
  const [initial] = useState(() => loadPreferences());
  const [saved, setSaved] = useState<StoredPreferences>(initial.prefs);
  const [draft, setDraft] = useState<StoredPreferences>(initial.prefs);
  const [health, setHealth] = useState<StorageHealth>(initial.health);
  const [result, setResult] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [tab, setTab] = useState<SettingsTab>("general");

  const dirty =
    draft.defaultView !== saved.defaultView || draft.defaultAccountId !== saved.defaultAccountId;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountId = (draft.defaultAccountId ?? "").trim();
    if (accountId !== "" && accountId.length > MAX_ACCOUNT_ID_LENGTH) {
      setResult({
        kind: "error",
        message: `Account id must be 1–${MAX_ACCOUNT_ID_LENGTH} characters. Nothing was saved.`,
      });
      return;
    }
    const next: StoredPreferences = {
      defaultView: draft.defaultView,
      defaultAccountId: accountId === "" ? null : accountId,
    };
    const outcome = savePreferences(next);
    if (outcome.ok) {
      setSaved(next);
      setDraft(next);
      setHealth("ok");
      setResult({
        kind: "ok",
        message: "Preferences saved in this browser. They apply the next time the terminal loads.",
      });
      return;
    }
    setHealth(outcome.reason);
    setResult({
      kind: "error",
      message:
        outcome.reason === "unavailable"
          ? "Browser storage is unavailable (private mode or policy), so nothing was saved. These preferences only work while storage is available."
          : "The browser rejected the write (quota or blocked storage), so nothing was saved.",
    });
  }

  return (
    <div className="workspace settings-page">
      <section className="page-title">
        <div>
          <p className="page-eyebrow">Platform · personal preferences</p>
          <h1>Settings</h1>
          <p className="page-subtitle">
            Application settings for this browser. Personal preferences are the only settings this
            build can apply — no server-side resource exists.
          </p>
        </div>
      </section>

      <section className="risk-context" aria-label="Data provenance">
        <p className="state-detail">
          <b>Scope and provenance.</b> The values below are read from and written to{" "}
          <code>localStorage</code> under <code>mbt.preferences.v1</code> and are applied when the
          terminal loads. They belong to this browser and this terminal — not to the user account,
          not to the application, and not to any administrator.
        </p>
      </section>

      <Panel title="Application settings" subtitle="Personal preferences — stored in this browser">
        <div className="bottom-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "bt-btn-active" : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "general" ? (
          <form className="settings-form" onSubmit={onSubmit} noValidate>
            <div className="settings-field">
              <label htmlFor="pref-default-view">Default workspace</label>
              <select
                id="pref-default-view"
                className="input"
                value={draft.defaultView}
                aria-describedby="pref-default-view-hint"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    defaultView: event.target.value as StoredPreferences["defaultView"],
                  }))
                }
              >
                {VIEWS.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.label}
                  </option>
                ))}
              </select>
              <p className="settings-hint" id="pref-default-view-hint">
                Destination shown when the terminal next loads.
              </p>
            </div>

            <div className="settings-field">
              <label htmlFor="pref-default-account">Default account</label>
              {scopedAccounts !== null ? (
                <select
                  id="pref-default-account"
                  className="input"
                  value={
                    draft.defaultAccountId !== null &&
                    scopedAccounts.includes(draft.defaultAccountId)
                      ? draft.defaultAccountId
                      : scopedAccounts[0]
                  }
                  aria-describedby="pref-default-account-hint"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultAccountId: event.target.value,
                    }))
                  }
                >
                  {scopedAccounts.map((account) => (
                    <option key={account} value={account}>
                      {account}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="pref-default-account"
                  className="input"
                  value={draft.defaultAccountId ?? ""}
                  maxLength={MAX_ACCOUNT_ID_LENGTH}
                  placeholder="Configured default (VITE_ACCOUNT_ID)"
                  aria-describedby="pref-default-account-hint"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultAccountId:
                        event.target.value.trim() === "" ? null : event.target.value,
                    }))
                  }
                />
              )}
              <p className="settings-hint" id="pref-default-account-hint">
                {scopedAccounts !== null
                  ? "Limited to the accounts in your session scope; the server re-checks every request."
                  : "Your session has unrestricted account scope (the * wildcard), so any account id is accepted."}
              </p>
            </div>

            <div className="settings-actions">
              <button type="submit" className="btn btn-primary" disabled={!dirty}>
                Save changes
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!dirty}
                onClick={() => {
                  setDraft(saved);
                  setResult(null);
                }}
              >
                Cancel
              </button>
              {dirty ? (
                <p className="settings-hint" role="status">
                  Unsaved changes
                </p>
              ) : null}
            </div>

            {result?.kind === "ok" ? (
              <p className="settings-result" role="status">
                {result.message}
              </p>
            ) : null}
            {result?.kind === "error" ? (
              <p className="settings-result settings-result-error" role="alert">
                {result.message}
              </p>
            ) : null}

            <p className="settings-hint" aria-live="polite">
              Storage:{" "}
              {health === "ok"
                ? "available — preferences are saved in this browser only."
                : health === "unavailable"
                  ? "unavailable (private mode or policy) — preferences only hold for this session."
                  : "the last write failed (quota or blocked storage) — the saved value may be stale."}
            </p>
          </form>
        ) : null}

        {tab === "notifications" ? (
          <EmptyState
            message="No notification settings exist in this backend."
            detail="There is no notification service, no delivery channel (email, webhook, push) and no notification endpoint. The WebSocket stream delivers market and order events to the open terminal; it has no per-user notification preferences to configure. Enabling toggles here would claim a delivery path that does not exist."
          />
        ) : null}

        {tab === "appearance" ? (
          <EmptyState
            message="One appearance is implemented: the dark terminal theme."
            detail="The design tokens in styles.css define a single theme. A theme switch, a candlestick chart style and a compact-density variant are not implemented — the API exposes no bar series, and density would change every workspace's layout. They are listed in the gap table below rather than offered as controls that do nothing."
          />
        ) : null}
      </Panel>

      <Panel
        title="Not available in this build"
        subtitle="Every prototype setting this terminal cannot apply, with the reason"
      >
        <div className="table-scroll">
          <table className="data-table gap-table">
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Effect on This Page</th>
                <th scope="col">Required Work</th>
              </tr>
            </thead>
            <tbody>
              {UNSUPPORTED.map((gap) => (
                <tr key={gap.setting}>
                  <td>
                    <span className="cell-primary">{gap.setting}</span>
                  </td>
                  <td>{gap.effect}</td>
                  <td>{gap.requiredWork}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="markets-notes-list risk-notes">
          <li>
            <b>Personal vs application-level.</b> The two saved preferences are personal and
            browser-local. Application-level configuration (broker adapter, account binding,
            thresholds) is set at startup through environment variables and requires a restart —
            this page cannot change it and does not pretend to.
          </li>
          <li>
            <b>No unsaved-change prompt on reload.</b> A dirty form shows an in-page warning; the
            browser cannot prompt before a reload for browser-local preferences, so nothing is
            discarded without the warning above.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

export { SettingsPage as default };
