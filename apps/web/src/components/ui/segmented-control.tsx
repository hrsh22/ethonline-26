"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { cn } from "@/lib/utils";

export interface SegmentedOption<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly disabled?: boolean;
}

/**
 * A choice between a small number of mutually exclusive modes.
 *
 * The selected segment is the lit one: it lifts to the panel surface and takes
 * a strong hairline, while the others stay recessed in the track. Focus is not
 * styled here; the global `:focus-visible` ring applies.
 *
 * A segmented control always has exactly one selection. `ToggleGroup` will
 * happily unpress its only pressed item, so an empty change is ignored.
 */
export function SegmentedControl<Value extends string>({
  className,
  label,
  onValueChange,
  options,
  size = "default",
  value,
}: {
  readonly className?: string;
  readonly label: string;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly SegmentedOption<Value>[];
  readonly size?: "default" | "compact";
  readonly value: Value;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      className={cn(
        // Equal-width segments share the available width; long labels wrap
        // and grow the row instead of being clipped.
        "grid w-full grid-flow-col auto-cols-[minmax(0,1fr)] gap-0.5 rounded-[var(--radius-control)] border border-line bg-canvas p-0.5",
        className,
      )}
      onValueChange={(next) => {
        const [selected] = next as readonly Value[];
        if (selected === undefined || selected === value) return;
        onValueChange(selected);
      }}
      value={[value]}
    >
      {options.map((option) => (
        <Toggle
          className={cn(
            "flex min-w-0 items-center justify-center rounded-[calc(var(--radius-control)-1px)] px-3 py-2 text-center font-mono font-semibold whitespace-normal [overflow-wrap:anywhere] uppercase text-ink-faint transition-colors duration-[var(--motion-fast)] select-none",
            "hover:not-data-pressed:not-data-disabled:text-ink",
            "data-pressed:bg-surface-3 data-pressed:text-ink data-pressed:shadow-[inset_0_0_0_1px_var(--border-strong)]",
            "data-disabled:opacity-50",
            "motion-reduce:transition-none",
            size === "compact"
              ? "min-h-9 text-label tracking-[0.08em]"
              : "min-h-11 text-body-sm tracking-[0.06em]",
          )}
          disabled={option.disabled ?? false}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
