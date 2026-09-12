import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StateFeedbackTone =
  | "loading"
  | "empty"
  | "blocked"
  | "partial"
  | "stale"
  | "error"
  | "success"
  | "notice";

const semantics = (tone: StateFeedbackTone) =>
  tone === "error"
    ? ({ live: "assertive", role: "alert" } as const)
    : ({ live: "polite", role: "status" } as const);

/** The marker colour carries the severity. */
const markerTone: Record<StateFeedbackTone, string> = {
  loading: "bg-[var(--status-info-text)]",
  empty: "bg-[var(--text-secondary)]",
  notice: "bg-[var(--text-secondary)]",
  blocked: "bg-[var(--status-warning-text)]",
  partial: "bg-[var(--status-warning-text)]",
  stale: "bg-[var(--status-warning-text)]",
  success: "bg-[var(--status-success-text)]",
  error: "bg-[var(--status-danger-text)]",
};

const inverseMarkerTone: Record<StateFeedbackTone, string> = {
  loading: "bg-[var(--inverse-status-info-text)]",
  empty: "bg-[var(--inverse-text-muted)]",
  notice: "bg-[var(--inverse-text-muted)]",
  blocked: "bg-[var(--inverse-status-warning-text)]",
  partial: "bg-[var(--inverse-status-warning-text)]",
  stale: "bg-[var(--inverse-status-warning-text)]",
  success: "bg-[var(--inverse-status-success-text)]",
  error: "bg-[var(--inverse-status-danger-text)]",
};

/** Surface-dependent chrome, resolved once so the view stays a plain render. */
const frameFor = (inverse: boolean) =>
  inverse
    ? {
        chrome:
          "border-[var(--inverse-border)] bg-[var(--inverse-surface-raised)] text-[var(--inverse-text)] [--ring:var(--inverse-focus-ring)]",
        body: "text-[var(--inverse-text-muted)]",
        marker: inverseMarkerTone,
      }
    : {
        chrome: "border-line bg-surface-2 text-ink",
        body: "text-ink-soft",
        marker: markerTone,
      };

/**
 * One voice for every non-happy state: loading, empty, blocked, partial,
 * stale, error. A marker carries the severity, the title says what is true,
 * the description says what to do, and an action does it when one exists.
 */
export function StateFeedback({
  action,
  className,
  compact = false,
  description,
  surface = "default",
  title,
  tone,
}: {
  readonly action?: ReactNode | undefined;
  readonly className?: string | undefined;
  readonly compact?: boolean | undefined;
  readonly description: string;
  readonly surface?: "default" | "inverse" | undefined;
  readonly title: string;
  readonly tone: StateFeedbackTone;
}) {
  const semantic = semantics(tone);
  const frame = frameFor(surface === "inverse");

  return (
    <section
      aria-atomic="true"
      aria-busy={tone === "loading" || undefined}
      aria-live={semantic.live}
      className={cn(
        "grid grid-cols-[0.1875rem_minmax(0,1fr)] items-start gap-3 rounded-[var(--radius-control)] border p-3.5",
        // No enter animation: these mount and unmount as reads resolve, on the
        // trade route several times a minute.
        frame.chrome,
        compact && "py-2.5",
        `state-feedback${className === undefined ? "" : ` ${className}`}`,
      )}
      data-compact={compact || undefined}
      data-state={tone}
      data-surface={surface}
      role={semantic.role}
    >
      <span
        aria-hidden="true"
        className={cn(
          "min-h-8 w-[0.1875rem] self-stretch rounded-[var(--radius-control)]",
          frame.marker[tone],
          tone === "loading" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0">
        <strong className="block font-sans text-body-sm font-semibold leading-snug">
          {title}
        </strong>
        <p className={cn("mt-0.5 max-w-[65ch] text-body-sm", frame.body)}>
          {description}
        </p>
        {action === undefined ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div>
        )}
      </div>
    </section>
  );
}

export function DisabledReason({
  children,
  id,
  surface = "default",
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly surface?: "default" | "inverse" | undefined;
}) {
  return (
    <p
      className={cn(
        "mt-2 text-body-sm disabled-reason",
        surface === "inverse"
          ? "text-[var(--inverse-text-muted)]"
          : "text-ink-faint",
      )}
      data-surface={surface}
      id={id}
      role="note"
    >
      {children}
    </p>
  );
}
