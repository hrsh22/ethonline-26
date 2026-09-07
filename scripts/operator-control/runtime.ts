import { randomUUID } from "node:crypto";

import { type CycleAuthority, type OperatorExecutionPolicy } from "./policy.ts";
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
  readonly renew: () => boolean;
  readonly finish: (outcome: {
    readonly outcome: "completed" | "failed" | "skipped";
    readonly sanitizedFailure?: string | undefined;
    readonly transactionHash?: string | undefined;
  }) => void;
}

export interface OperatorSupervisor {
  readonly id: string;
  /** Called once at process startup, before serving commands or scheduling work. */
  readonly initialize: (deploymentFingerprint: string) => boolean;
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
  renew: () => false,
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
  initialize: (deploymentFingerprint) => {
    const at = now();
    if (
      !store.acquireWriterLease({
        holder: supervisorId,
        leaseMilliseconds,
        now: at,
      })
    )
      return false;
    try {
      // A restart preserves authorization only for the same deployment.
      // Legacy/unbound ledgers and a changed deployment require a new command.
      if (
        store.readPolicyRevision().deploymentFingerprint ===
        deploymentFingerprint
      )
        return true;
      const previous = store.readPolicy();
      store.applyCommand({
        deploymentFingerprint,
        actor: supervisorId,
        role: "supervisor",
        command: "stop",
        commandId: randomUUID(),
        appliedAt: at,
        previousMode: previous.mode,
        previousOneShot: previous.oneShot,
        nextMode: "stopped",
        nextOneShot: "none",
        result: "deployment-binding-changed",
        transactionHash: undefined,
      });
      return true;
    } finally {
      store.releaseWriterLease(supervisorId);
    }
  },
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
    const runId = randomUUID();
    const { policy: granted, authority } = store.claimRun({
      runId,
      supervisor: supervisorId,
      at: startedAt,
    });

    if (authority === "skip") return skippedGrant(authority, granted, runId);

    return {
      authority,
      renew: () => {
        const at = now();
        if (
          !store.renewWriterLease({
            holder: supervisorId,
            leaseMilliseconds,
            now: at,
          })
        )
          return false;
        store.recordHeartbeat({
          at,
          observedMode: store.readPolicy().mode,
          supervisor: supervisorId,
        });
        return true;
      },
      finish: ({ outcome, sanitizedFailure, transactionHash }) => {
        const finishedAt = now();
        store.finishRun({
          finishedAt,
          outcome,
          runId,
          sanitizedFailure,
          transactionHash,
        });
        if (store.readWriterLease()?.holder === supervisorId) {
          store.recordHeartbeat({
            at: finishedAt,
            observedMode: store.readPolicy().mode,
            supervisor: supervisorId,
          });
        }
      },
      maySignNow: () => store.maySign(runId, now()),
      policy: granted,
      runId,
    };
  },
  release: () => store.releaseWriterLease(supervisorId),
});
