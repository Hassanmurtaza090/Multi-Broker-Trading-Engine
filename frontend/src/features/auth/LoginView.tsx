/**
 * Login view (M12) — the only place credentials are entered.
 *
 * - Errors are GENERIC ("invalid username or password") — the server's
 *   identical-401 policy is mirrored here (no user enumeration in the UI).
 * - The password input is `type="password"` and its value is never logged
 *   or stored beyond the login request itself.
 */

import { useState } from "react";

import { isApiError } from "../../services/api";
import { authService } from "../../services/auth";
import { authStore } from "../../stores/authStore";

export function LoginView() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    authStore.update((s) => ({ ...s, status: "logging_in" }));
    try {
      await authService.login({ username: username.trim(), password });
      // Success: the auth store flips to logged_in via the authService
      // subscription and <App> mounts the terminal.
    } catch (err) {
      authStore.update((s) => ({ ...s, status: "logged_out" }));
      setError(
        isApiError(err)
          ? err.kind === "unauthenticated"
            ? "Invalid username or password."
            : err.userMessage
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="login-title">Multi-Broker Trading Engine</h1>
        <p className="login-subtitle">Sign in to the trading terminal</p>

        <label className="field">
          <span>Username</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={128}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={256}
          />
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary login-submit"
          disabled={pending || username.trim() === "" || password === ""}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="login-note">
          Sessions are short-lived and in-memory; the browser never stores
          credentials.
        </p>
      </form>
    </div>
  );
}
