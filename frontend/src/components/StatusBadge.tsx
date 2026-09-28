/**
 * Status badge primitive (M11).
 */

import type { StatusTone } from "../utils/statusTone";

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  title?: string;
}

export function StatusBadge({ tone, label, title }: StatusBadgeProps) {
  return (
    <span className={`badge badge-${tone}`} title={title} role="status">
      {label}
    </span>
  );
}
