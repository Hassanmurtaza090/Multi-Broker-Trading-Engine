/**
 * Panel primitives (M11): the terminal's section container.
 */

import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  /** Optional design-style card-heading subtitle (M1). */
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, subtitle, actions, children, className }: PanelProps) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`} aria-label={title}>
      <header className="panel-header">
        <div className="panel-heading-text">
          <h2 className="panel-title">{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
