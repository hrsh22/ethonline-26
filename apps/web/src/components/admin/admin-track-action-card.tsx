"use client";

import type { ProtocolAction } from "@orbit/protocol/transactions";
import { MAX_UINT256 } from "@orbit/protocol/transactions";

import { AdminActionControl } from "@/components/admin/admin-action-control";
import {
  formatObservedWeth,
  type ProtocolClient,
  type ReviewContext,
  type TrackQueue,
} from "@/components/admin/admin-console-context";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { Well } from "@/components/ui/panel";
import { useRewardTrackQuote } from "@/hooks/use-reward-track-quote";
import { applicationCopy } from "@/lib/identity";

const rawMinimumStockOutput = (value: string): bigint => {
  if (!/^[1-9][0-9]*$/.test(value)) return 0n;
  const parsed = BigInt(value);
  return parsed <= MAX_UINT256 ? parsed : 0n;
};

/**
 * The policy minimum from the live route quote is authoritative. A raw
 * override only applies when the operator deliberately supplies one.
 */
const effectiveMinimumStockOutput = (
  policyMinimum: bigint | undefined,
  overrideText: string,
): bigint => {
  const override = rawMinimumStockOutput(overrideText);
  if (override > 0n) return override;
  return policyMinimum ?? 0n;
};

const queueTone = (status: TrackQueue["status"]) =>
  status === "retryable"
    ? "danger"
    : status === "paused"
      ? "warning"
      : status === "ready"
        ? "live"
        : "neutral";

/**
 * A raw minimum removes the policy protection, so it lives behind a deliberate
 * disclosure rather than an open text field.
 */
function MinimumOverride({
  belowPolicy,
  onChange,
  trackId,
  value,
}: {
  readonly belowPolicy: boolean;
  readonly onChange: (value: string) => void;
  readonly trackId: 1 | 2 | 3 | 4;
  readonly value: string;
}) {
  return (
    <Disclosure title={applicationCopy.operations.advancedOverride}>
      <Well className="border-[var(--status-warning-text)]">
        <p className="text-body-sm text-ink-soft" role="note">
          {applicationCopy.operations.advancedOverrideWarning}
        </p>
        <label
          className="mt-3 flex min-h-11 flex-col justify-center gap-1 font-mono text-label tracking-[0.1em] text-ink-faint uppercase"
          data-track-action-control
          htmlFor={`minimum-output-${trackId}`}
        >
          {applicationCopy.operations.advancedOverrideLabel}
          <input
            className="min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-canvas px-3 font-mono text-lede tracking-normal text-ink normal-case tabular-nums outline-none focus:border-[var(--accent-fill)]"
            id={`minimum-output-${trackId}`}
            inputMode="numeric"
            maxLength={MAX_UINT256.toString().length}
            onChange={(event) =>
              onChange(event.currentTarget.value.replace(/[^0-9]/g, ""))
            }
            pattern="[0-9]*"
            size={1}
            type="text"
            value={value}
          />
        </label>
        {belowPolicy ? (
          <p
            className="mt-2 text-body-sm text-[var(--status-danger-text)]"
            role="alert"
          >
            {applicationCopy.operations.advancedOverrideBelowPolicy}
          </p>
        ) : null}
      </Well>
    </Disclosure>
  );
}

export function AdminTrackActionCard({
  context,
  deadline,
  minimumOutputText,
  onMinimumOutput,
  protocol,
  track,
}: {
  readonly context: ReviewContext;
  readonly deadline: bigint;
  readonly minimumOutputText: string;
  readonly onMinimumOutput: (track: 1 | 2 | 3 | 4, value: string) => void;
  readonly protocol: ProtocolClient;
  readonly track: TrackQueue;
}) {
  const routeQuote = useRewardTrackQuote(protocol, track.trackId, track.weth);
  const action = {
    type: track.status === "retryable" ? "retry-track" : "execute-track",
    track: track.trackId,
    minimumStockOutput: effectiveMinimumStockOutput(
      routeQuote.quote?.minimumOutput,
      minimumOutputText,
    ),
    deadline,
  } as const satisfies ProtocolAction;
  const state = protocol.getActionState(action);
  const label =
    action.type === "retry-track"
      ? applicationCopy.operations.retryTrack(track.track)
      : applicationCopy.operations.executeTrack(track.track);
  const override = rawMinimumStockOutput(minimumOutputText);
  return (
    <Well className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase">
          {track.track}
        </h3>
        <span data-queue-status={track.status}>
          <Badge dot tone={queueTone(track.status)}>
            {applicationCopy.status.queue[track.status]}
          </Badge>
        </span>
      </div>
      <p className="font-mono text-title font-medium text-signal tabular-nums">
        {formatObservedWeth(track.weth)} WETH
      </p>
      <AdminActionControl
        action={action}
        enabled={state.enabled}
        label={label}
        onExecute={protocol.execute}
        pending={context.pending}
        reason={state.reason}
        review={{
          ...context,
          currentState: applicationCopy.status.queue[track.status],
          intendedState: applicationCopy.operations.reviewTrackConverted,
          subject: track.track,
          ...(routeQuote.quote === undefined
            ? {}
            : { expectedOutput: routeQuote.quote }),
          quoteStale: routeQuote.failed,
        }}
        variant="outline"
      />
      <MinimumOverride
        belowPolicy={
          override > 0n &&
          routeQuote.quote !== undefined &&
          override < routeQuote.quote.minimumOutput
        }
        onChange={(value) => onMinimumOutput(track.trackId, value)}
        trackId={track.trackId}
        value={minimumOutputText}
      />
    </Well>
  );
}
