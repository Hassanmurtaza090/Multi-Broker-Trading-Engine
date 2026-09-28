/**
 * Loading / error / empty state primitives (M11). Every panel in the terminal
 * composes these so that no view renders blank or silently stale data.
 */

interface EmptyStateProps {
  message: string;
  detail?: string;
}

export function EmptyState({ message, detail }: EmptyStateProps) {
  return (
    <div className="state state-empty" role="note">
      <p>{message}</p>
      {detail ? <p className="state-detail">{detail}</p> : null}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
