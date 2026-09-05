import { randomUUID } from "node:crypto";

import {
  cycleAuthority,
  type CycleAuthority,
  type OperatorExecutionPolicy,
} from "./policy.ts";
import type { OperatorControlStore } from "./store.ts";

/**
 * The operator side of the control plane. The supervisor reads the desired
 * policy at the start of every cycle and re-checks for a stop immediately
 * before the signing boundary, so a stop issued mid-cycle prevents the next
 * signature rather than arriving after a broadcast.
 */
export interface OperatorSupervisorOptions {
  readonly leaseMilliseconds: number;
  readonly now: () => number;
  readonly store: OperatorControlStore;
  readonly supervisorId?: string;
}

export interface OperatorCycleGrant {
  readonly authority: CycleAuthority;
  readonly policy: OperatorExecutionPolicy;
  readonly runId: string;
  /**
   * Re-evaluated immediately before signing. False when a stop arrived after
   * the cycle began, or this supervisor no longer holds the writer lease.
   */
  readonly maySignNow: () => boolean;
  readonly finish: (outcome: {
    readonly outcome: "completed" | "failed" | "skipped";
    readonly sanitizedFailure?: string | undefined;
    readonly transactionHash?: string | undefined;
  }) => void;
}

export interface OperatorSupervisor {
  readonly id: string;
  /** Returns undefined when another supervisor holds the writer lease. */
  readonly beginCycle: () => OperatorCycleGrant | undefined;
  readonly release: () => void;
}

const skippedGrant = (
  authority: CycleAuthority,
  policy: OperatorExecutionPolicy,
  runId: string,
): OperatorCycleGrant => ({
  authority,
  finish: () => undefined,
  maySignNow: () => false,
  policy,
  runId,
});

export const createOperatorSupervisor = ({
  leaseMilliseconds,
  now,
  store,
  supervisorId = randomUUID(),
}: OperatorSupervisorOptions): OperatorSupervisor => ({
  id: supervisorId,
  beginCycle: () => {
    const startedAt = now();
    // A durable lease, not an in-process flag, so two supervisors sharing a
    // ledger cannot both reach a signing boundary.
    if (
      !store.acquireWriterLease({
        holder: supervisorId,
        leaseMilliseconds,
        now: startedAt,
      })
    ) {
      return undefined;
    }
    const granted = store.readPolicy();
    const authority = cycleAuthority(granted);
    const runId = `${startedAt.toString(36)}-${supervisorId.slice(0, 8)}`;

    // The queued pass is consumed now, so a crash mid-cycle cannot replay it
    // on restart. The revision is captured afterwards so this consumption is
    // not mistaken for an operator's later stop.
    if (granted.oneShot !== "none") store.consumeOneShot(startedAt);
    const grantRevision = store.readPolicyRevision().updatedAt;

    store.recordHeartbeat({
      at: startedAt,
      observedMode: granted.mode,
      supervisor: supervisorId,
    });

    if (authority === "skip") return skippedGrant(authority, granted, runId);

    store.startRun({ authority, runId, startedAt });
    return {
      authority,
      finish: ({ outcome, sanitizedFailure, transactionHash }) => {
        const finishedAt = now();
        store.finishRun({
          finishedAt,
          outcome,
          runId,
          sanitizedFailure,
          transactionHash,
        });
        store.recordHeartbeat({
          at: finishedAt,
          observedMode: store.readPolicy().mode,
          supervisor: supervisorId,
        });
      },
      maySignNow: () => {
        if (authority !== "execute") return false;
        const lease = store.readWriterLease();
        if (lease === undefined || lease.holder !== supervisorId) return false;
        const current = store.readPolicyRevision();
        // A stop written after this grant blocks the boundary, including for a
        // one-shot live pass that was already claimed.
        return !(
          current.updatedAt > grantRevision && current.policy.mode === "stopped"
        );
      },
      policy: granted,
      runId,
    };
  },
  release: () => store.releaseWriterLease(supervisorId),
});
