import { cn } from "@/lib/utils";

export type BadgeTone =
  "neutral" | "live" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "border-line text-ink-soft",
  live: "border-[var(--accent-border)] bg-signal-soft text-signal",
  success:
    "border-transparent bg-[var(--status-success-surface)] text-[var(--status-success-text)]",
  warning:
    "border-transparent bg-[var(--status-warning-surface)] text-[var(--status-warning-text)]",
  danger:
    "border-transparent bg-[var(--status-danger-surface)] text-[var(--status-danger-text)]",
  info: "border-transparent bg-[var(--status-info-surface)] text-[var(--status-info-text)]",
};

/**
 * A short state label: LIT, GROUNDED, HEALTHY, PENDING.
 *
 * States are read across a whole board at a glance, so the treatment is a
 * caps token with an optional dot rather than a sentence.
 */
export function Badge({
  children,
  className,
  dot = false,
  tone = "neutral",
}: {
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
  readonly dot?: boolean;
  readonly tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-1.5 py-0.5 font-mono text-label font-semibold tracking-[0.08em] whitespace-nowrap uppercase",
        tones[tone],
        className,
      )}
      data-tone={tone}
    >
      {dot ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}
