/**
 * Segmented control (M1) — the Figma quick-order card's segmented toggle,
 * generalized as a reusable, accessible primitive (radiogroup semantics,
 * mirroring the M11 side-toggle pattern the ticket already used).
 *
 * Used for the order side (BUY/SELL, green/red active tints) and the order
 * type (MARKET/LIMIT/STOP/STOP_LIMIT).
 */

interface SegmentedControlProps<T extends string> {
  /** Accessible name for the whole group (e.g. "Order side"). */
  "aria-label": string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** "side" renders the design's green (BUY) / red (SELL) active tints. */
  tone?: "default" | "side";
  disabled?: boolean;
  name?: string;
}

export function SegmentedControl<T extends string>({
  "aria-label": ariaLabel,
  options,
  value,
  onChange,
  tone = "default",
  disabled = false,
  name,
}: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        const toneClass =
          tone === "side"
            ? option.value === "BUY"
              ? " seg-buy"
              : option.value === "SELL"
                ? " seg-sell"
                : ""
            : "";
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={disabled || undefined}
            name={name}
            disabled={disabled}
            data-testid={`segmented-${name ?? ariaLabel}-${option.value}`}
            className={active ? `seg-active${toneClass}` : toneClass || undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
