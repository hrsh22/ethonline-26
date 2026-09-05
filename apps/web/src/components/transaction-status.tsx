"use client";

import { applicationCopy } from "@/lib/identity";
import type { TransactionState } from "@/lib/transaction-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const statusLabel = {
  idle: applicationCopy.transaction.idle,
  pending: applicationCopy.transaction.pending,
  simulated: applicationCopy.transaction.simulated,
  submitted: applicationCopy.transaction.submitted,
  "outcome-unknown": applicationCopy.transaction.outcomeUnknown,
  confirmed: applicationCopy.transaction.confirmed,
  failed: applicationCopy.transaction.failed,
  retriable: applicationCopy.transaction.retriable,
} as const;

const statusTone: Record<TransactionState["status"], string> = {
  idle: "bg-[var(--text-secondary)]",
  pending: "bg-[var(--status-info-text)]",
  simulated: "bg-[var(--status-info-text)]",
  submitted: "bg-[var(--status-info-text)]",
  "outcome-unknown": "bg-[var(--status-warning-text)]",
  confirmed: "bg-[var(--status-success-text)]",
  failed: "bg-[var(--status-danger-text)]",
  retriable: "bg-[var(--status-warning-text)]",
};

const transactionMessage = (state: TransactionState) =>
  "message" in state ? (
    <p className="mt-1 text-body-sm text-ink-soft">{state.message}</p>
  ) : null;

const transactionActionLabel = (state: TransactionState): string | undefined =>
  state.status === "outcome-unknown"
    ? state.reconciling
      ? applicationCopy.transaction.reconciling
      : applicationCopy.transaction.reconcile
    : state.status === "retriable"
      ? applicationCopy.transaction.retry
      : undefined;

const inFlight = (state: TransactionState) =>
  state.status === "pending" ||
  state.status === "simulated" ||
  state.status === "submitted";

function TransactionActions({
  actionLabel,
  disabled,
  hash,
  onRetry,
}: {
  readonly actionLabel: string | undefined;
  readonly disabled: boolean;
  readonly hash: string | undefined;
  readonly onRetry: () => void;
}) {
  if (hash === undefined && actionLabel === undefined) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {hash === undefined ? null : (
        <a
          className="flex min-h-11 items-center font-mono text-body-sm text-signal underline decoration-1 underline-offset-4 hover:text-ink"
          href={`https://sepolia.basescan.org/tx/${hash}`}
          rel="noreferrer"
          target="_blank"
        >
          {applicationCopy.transaction.explorer}
        </a>
      )}
      {actionLabel === undefined ? null : (
        <Button
          disabled={disabled}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * A transaction's progress, from simulation through confirmation.
 *
 * The marker breathes while the transaction is in flight and holds still once
 * it has settled; failures are alerts, everything else is a status.
 */
export function TransactionStatus({
  state,
  onRetry,
}: {
  readonly state: TransactionState;
  readonly onRetry: () => void;
}) {
  if (state.status === "idle") return null;
  const hash = "hash" in state ? state.hash : undefined;
  const actionLabel = transactionActionLabel(state);
  const failure = state.status === "failed" || state.status === "retriable";

  return (
    <div
      aria-live={failure ? "assertive" : "polite"}
      className="grid grid-cols-[0.1875rem_minmax(0,1fr)] gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3"
      data-status={state.status}
      role={failure ? "alert" : "status"}
    >
      <span
        aria-hidden="true"
        className={cn(
          "min-h-8 w-[0.1875rem] self-stretch rounded-[var(--radius-control)]",
          statusTone[state.status],
          inFlight(state) && "animate-pulse motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0">
        <strong className="block font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase">
          {statusLabel[state.status]}
        </strong>
        <p className="mt-1 text-body-sm text-ink">{state.label}</p>
        {transactionMessage(state)}
        <TransactionActions
          actionLabel={actionLabel}
          disabled={
            state.status === "outcome-unknown" && state.reconciling === true
          }
          hash={hash}
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}
