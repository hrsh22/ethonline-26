import type { ProtocolHealthCheck } from "@orbit/protocol/health";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { applicationCopy } from "@/lib/identity";

type CheckState = "healthy" | "warning" | "failing";

const checkState = (check: ProtocolHealthCheck): CheckState =>
  check.status === "pass"
    ? "healthy"
    : check.status === "unknown" || check.severity === "warning"
      ? "warning"
      : "failing";

const badgeTone: Record<CheckState, BadgeTone> = {
  healthy: "success",
  warning: "warning",
  failing: "danger",
};

const evidenceLabel =
  "font-mono text-label tracking-[0.1em] text-ink-faint uppercase";

function CheckRow({ check }: { readonly check: ProtocolHealthCheck }) {
  const state = checkState(check);
  return (
    <li
      className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0"
      data-check-state={state}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge dot tone={badgeTone[state]}>
          {applicationCopy.status.check[state]}
        </Badge>
        <code className="font-mono text-body-sm font-semibold text-ink [overflow-wrap:anywhere]">
          {check.id}
        </code>
        <span
          className={`${evidenceLabel} ml-auto tabular-nums`}
          data-freshness={check.freshness}
        >
          {applicationCopy.status.check[check.freshness]} ·{" "}
          {applicationCopy.status.check.observedBlock}{" "}
          {check.observedBlock.toString()}
        </span>
      </div>
      <p className="text-body-sm text-ink-soft">{check.explanation}</p>
      <dl className="grid gap-x-6 gap-y-1 compact:grid-cols-2">
        <div className="min-w-0">
          <dt className={evidenceLabel}>
            {applicationCopy.status.check.expected}
          </dt>
          <dd className="font-mono text-body-sm text-ink tabular-nums [overflow-wrap:anywhere]">
            {check.expected ?? applicationCopy.common.notObserved}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={evidenceLabel}>
            {applicationCopy.status.check.observed}
          </dt>
          <dd className="font-mono text-body-sm text-ink tabular-nums [overflow-wrap:anywhere]">
            {check.observed ?? applicationCopy.common.notObserved}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Every bounded health check with its exact expected/observed evidence.
 *
 * Rendered by the admin diagnostics console; it is its own framed box with a
 * level-two heading, so it sits beside panels without nesting inside one.
 */
export function HealthCheckLedger({
  checks,
  id,
  title,
}: {
  readonly checks: readonly ProtocolHealthCheck[];
  readonly id: string;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col rounded-[var(--radius-surface)] border border-line bg-surface-1"
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-surface-2 px-4 py-1.5">
        <h2
          className="font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase"
          id={id}
        >
          {title}
        </h2>
        <span className={evidenceLabel}>
          {applicationCopy.status.check.evidence}
        </span>
      </div>
      <ol>
        {checks.map((check) => (
          <CheckRow check={check} key={check.id} />
        ))}
      </ol>
    </section>
  );
}
