"use client";

import { Field } from "@base-ui/react/field";

import { cn } from "@/lib/utils";

/**
 * An amount a collector types.
 *
 * The amount is the largest thing in the row, the unit is quiet caps pinned to
 * the end, and the whole well takes the focus border so the target is the
 * field rather than a hairline. `readOnly` covers the computed side of a
 * quote: it stays selectable rather than disabled, because a disabled field
 * reads as broken when it is simply derived.
 */
export function AmountField({
  action,
  className,
  describedBy,
  description,
  id,
  invalid = false,
  label,
  onValueChange,
  placeholder = "0.00",
  readOnly = false,
  unit,
  value,
}: {
  readonly action?: React.ReactNode | undefined;
  readonly className?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly description?: string | undefined;
  readonly id: string;
  readonly invalid?: boolean | undefined;
  readonly label: string;
  readonly onValueChange?: (value: string) => void | undefined;
  readonly placeholder?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly unit: string;
  readonly value: string;
}) {
  return (
    <Field.Root className={cn("w-full", className)}>
      <Field.Label
        className="font-mono text-label font-medium tracking-[0.1em] text-ink-faint uppercase"
        htmlFor={id}
      >
        {label}
      </Field.Label>
      <div
        className={cn(
          "mt-1.5 flex items-center gap-3 rounded-[var(--radius-control)] border bg-canvas px-3 py-2 transition-[border-color] duration-[var(--motion-fast)] focus-within:border-[var(--accent-fill)] motion-reduce:transition-none",
          invalid ? "border-[var(--status-danger-text)]" : "border-line-strong",
          readOnly && "border-line",
        )}
      >
        <Field.Control
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className="w-full min-w-0 flex-1 bg-transparent font-mono text-[1.75rem] leading-none font-medium tracking-[-0.02em] text-ink tabular-nums outline-none read-only:text-ink-soft placeholder:text-ink-faint/70"
          id={id}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          /* An input's default `size` of 20 characters is an intrinsic width
           * that floors every ancestor's min-content even with `min-width: 0`.
           * `size={1}` makes it negligible; the real width comes from `w-full`. */
          size={1}
          spellCheck={false}
          value={value}
        />
        {action}
        <span className="flex-none font-mono text-label font-semibold tracking-[0.1em] text-ink-faint uppercase">
          {unit}
        </span>
      </div>
      {description === undefined ? null : (
        <Field.Description className="mt-1.5 text-body-sm text-ink-soft">
          {description}
        </Field.Description>
      )}
    </Field.Root>
  );
}

/** The affordance for spending an entire balance. Small, but a real target. */
export function MaxAction({
  children = "Max",
  label,
  onClick,
}: {
  readonly children?: React.ReactNode | undefined;
  readonly label?: string | undefined;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      data-max-action
      className="flex-none rounded-[var(--radius-control)] border border-[var(--accent-border)] px-2.5 py-1.5 font-mono text-label font-semibold tracking-[0.08em] text-[var(--accent-text)] uppercase transition-colors duration-[var(--motion-fast)] hover:bg-signal-soft motion-reduce:transition-none"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
