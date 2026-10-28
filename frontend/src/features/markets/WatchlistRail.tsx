/**
 * Watchlist rail (M6) — the list of the user's named watchlists.
 *
 * Create/select only; rename and delete live on the active list's panel header
 * so there is exactly one control per operation. No drag-and-drop, no
 * decorative affordances: every button performs a real store mutation.
 *
 * The persistence note is not decoration — the backend has no watchlist API
 * (see `stores/watchlistsStore.ts`), so the user is told exactly where these
 * lists live and what happens when storage is unavailable.
 */

import { useState } from "react";

import { Panel } from "../../components/Panel";
import {
  MAX_LIST_NAME_LENGTH,
  MAX_WATCHLISTS,
  watchlistActions,
  type WatchlistsState,
} from "../../stores/watchlistsStore";
import { storageNote } from "./storageNote";

export function WatchlistRail({ state }: { state: WatchlistsState }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const atCapacity = state.lists.length >= MAX_WATCHLISTS;

  function openCreate() {
    setCreating(true);
    setError(null);
    setName("");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = watchlistActions.create(name);
    if (result.ok) {
      setCreating(false);
      setName("");
      setError(null);
      return;
    }
    setError(
      result.reason === "blank"
        ? "Enter a name for the watchlist."
        : result.reason === "duplicate"
          ? "A watchlist with that name already exists."
          : `You can keep at most ${MAX_WATCHLISTS} watchlists.`,
    );
  }

  return (
    <Panel
      title="Watchlists"
      subtitle={`${state.lists.length} of ${MAX_WATCHLISTS} lists`}
      className="markets-rail"
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={openCreate}
          disabled={atCapacity}
          title={atCapacity ? `At the ${MAX_WATCHLISTS}-list limit` : "Create a watchlist"}
        >
          + New list
        </button>
      }
    >
      {creating ? (
        <form className="rail-create" onSubmit={submit}>
          <input
            className="input input-sm"
            aria-label="New watchlist name"
            placeholder="Watchlist name"
            value={name}
            maxLength={MAX_LIST_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <div className="rail-create-actions">
            <button type="submit" className="btn btn-primary btn-xs">
              Create
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {error !== null ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {state.lists.length === 0 ? (
        <p className="state state-empty" role="note">
          No watchlists yet. Create one to start collecting instruments.
        </p>
      ) : (
        <ul className="rail-list" aria-label="Saved watchlists">
          {state.lists.map((list) => {
            const active = list.id === state.activeId;
            return (
              <li key={list.id}>
                <button
                  type="button"
                  className={`rail-item${active ? " rail-item-active" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => watchlistActions.select(list.id)}
                  title={`${list.name} — ${list.instruments.length} instrument(s)`}
                >
                  <span className="rail-item-name">{list.name}</span>
                  <span className="rail-item-count num">{list.instruments.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rail-note">{storageNote(state.storage)}</p>
    </Panel>
  );
}
