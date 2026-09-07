import {
  decodeDeliveryStatus,
  type DeliveryStatus,
} from "@orbit/config/public-api";
import type { Address, Hex } from "viem";
import { recoverMessageAddress } from "viem";

import {
  operatorCommandRejectionMessage,
  operatorCommandRequiresSignature,
  verifyOperatorCommandMessage,
  type OperatorCommandName,
  type OperatorCommandRequest,
} from "@orbit/config/operator-control";

import {
  applyOperatorCommand,
  operatorServiceState,
  type OperatorExecutionPolicy,
  type OperatorServiceState,
} from "./policy.ts";
import type { OperatorControlStore } from "./store.ts";

export interface OperatorControlActor {
  readonly address: Address;
  readonly role: string;
}

export interface OperatorControlConfiguration {
  readonly chainId: number;
  readonly deploymentFingerprint: string;
  readonly domain: string;
  readonly heartbeatStaleAfterMilliseconds: number;
  readonly intervalMilliseconds: number;
}

export interface OperatorControlDependencies {
  readonly configuration: OperatorControlConfiguration;
  readonly now: () => number;
  readonly store: OperatorControlStore;
  /** Injected so the boundary is testable without a wallet. */
  readonly verifySignature?: (input: {
    readonly address: Address;
    readonly message: string;
    readonly signature: Hex;
  }) => Promise<boolean>;
}

export type OperatorCommandOutcome =
  | {
      readonly ok: true;
      readonly applied: boolean;
      readonly policy: OperatorExecutionPolicy;
      readonly result: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly status: number;
    };

export interface OperatorControlState {
  readonly audit: readonly {
    readonly actor: string;
    readonly appliedAt: number;
    readonly command: OperatorCommandName;
    readonly previous: string;
    readonly next: string;
    readonly result: string;
    readonly role: string;
  }[];
  readonly desired: OperatorExecutionPolicy;
  readonly heartbeat:
    | {
        readonly at: number;
        readonly observedMode: string;
        readonly supervisor: string;
      }
    | undefined;
  readonly latestRun:
    | {
        readonly authority: string;
        readonly finishedAt: number | undefined;
        readonly outcome: string;
        readonly sanitizedFailure: string | undefined;
        readonly startedAt: number;
        readonly transactionHash: string | undefined;
      }
    | undefined;
  readonly nextRunAt: number | undefined;
  readonly service: OperatorServiceState;
  readonly writerLease:
    { readonly expiresAt: number; readonly holder: string } | undefined;
}

const verify = async (
  dependencies: OperatorControlDependencies,
  input: {
    readonly address: Address;
    readonly message: string;
    readonly signature: Hex;
  },
): Promise<boolean> => {
  if (dependencies.verifySignature !== undefined) {
    return dependencies.verifySignature(input);
  }
  try {
    const recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature,
    });
    return recovered.toLowerCase() === input.address.toLowerCase();
  } catch {
    return false;
  }
};

/**
 * A command that can lead to a signed transaction additionally requires a
 * short-lived wallet signature bound to actor, command, chain, deployment,
 * nonce, and expiry. Session authentication alone is not enough to start
 * signing on Base Sepolia.
 */
const authorizeSignedCommand = async (
  dependencies: OperatorControlDependencies,
  actor: OperatorControlActor,
  request: OperatorCommandRequest,
): Promise<OperatorCommandOutcome | undefined> => {
  if (!operatorCommandRequiresSignature(request.command)) return undefined;
  const signed = request.signedCommand;
  if (signed === undefined) {
    return {
      code: "operator-signature-required",
      message:
        "Enabling or requesting a live run requires a wallet-signed command.",
      ok: false,
      status: 400,
    };
  }
  const fields = verifyOperatorCommandMessage(signed.message, {
    actor: actor.address,
    chainId: dependencies.configuration.chainId,
    command: request.command,
    commandId: request.commandId,
    deploymentFingerprint: dependencies.configuration.deploymentFingerprint,
    domain: dependencies.configuration.domain,
    nowMilliseconds: dependencies.now(),
  });
  if (!fields.ok) {
    return {
      code: "operator-signature-invalid",
      message: operatorCommandRejectionMessage[fields.reason],
      ok: false,
      status: 400,
    };
  }
  const verified = await verify(dependencies, {
    address: actor.address,
    message: signed.message,
    signature: signed.signature,
  });
  return verified
    ? undefined
    : {
        code: "operator-signature-invalid",
        message:
          "The signed command does not match the signed-in operator wallet.",
        ok: false,
        status: 401,
      };
};

/**
 * Applies one authenticated command. Idempotent by command id: a retried
 * request returns the stored result rather than applying twice, which is what
 * makes a client retry safe.
 */
export const applyOperatorControlCommand = async (
  dependencies: OperatorControlDependencies,
  actor: OperatorControlActor,
  request: OperatorCommandRequest,
): Promise<OperatorCommandOutcome> => {
  const existing = dependencies.store.findCommand(request.commandId);
  if (existing !== undefined) {
    if (existing.command !== request.command) {
      return {
        code: "operator-command-conflict",
        message:
          "This command id was already used for a different command. Use a new id.",
        ok: false,
        status: 409,
      };
    }
    return {
      applied: false,
      ok: true,
      policy: {
        mode: existing.nextMode,
        oneShot: existing.nextOneShot,
      },
      result: existing.result,
    };
  }

  const rejection = await authorizeSignedCommand(dependencies, actor, request);
  if (rejection !== undefined) return rejection;

  const previous = dependencies.store.readPolicy();
  const transition = applyOperatorCommand(previous, request.command);
  const appliedAt = dependencies.now();
  const next = transition.ok ? transition.next : previous;
  dependencies.store.applyCommand({
    actor: actor.address,
    appliedAt,
    command: request.command,
    commandId: request.commandId,
    nextMode: next.mode,
    nextOneShot: next.oneShot,
    previousMode: previous.mode,
    previousOneShot: previous.oneShot,
    result: transition.ok ? "applied" : transition.reason,
    role: actor.role,
    transactionHash: undefined,
  });
  return {
    applied: transition.ok,
    ok: true,
    policy: next,
    result: transition.ok ? "applied" : transition.reason,
  };
};

const policyLabel = (mode: string, oneShot: string): string =>
  oneShot === "none" ? mode : `${mode} (+1 ${oneShot} pass)`;

/**
 * The state the console renders. Service liveness, execution policy, and the
 * latest run are separate facts here, so a live policy with no heartbeat
 * reports an offline service rather than implying work is happening.
 */
export const readOperatorControlState = (
  dependencies: OperatorControlDependencies,
): OperatorControlState => {
  const heartbeat = dependencies.store.readHeartbeat();
  const latestRun = dependencies.store.readLatestRun();
  return {
    audit: dependencies.store.recentCommands(20).map((record) => ({
      actor: record.actor,
      appliedAt: record.appliedAt,
      command: record.command,
      next: policyLabel(record.nextMode, record.nextOneShot),
      previous: policyLabel(record.previousMode, record.previousOneShot),
      result: record.result,
      role: record.role,
    })),
    desired: dependencies.store.readPolicy(),
    heartbeat,
    latestRun:
      latestRun === undefined
        ? undefined
        : {
            authority: latestRun.authority,
            finishedAt: latestRun.finishedAt,
            outcome: latestRun.outcome,
            sanitizedFailure: latestRun.sanitizedFailure,
            startedAt: latestRun.startedAt,
            transactionHash: latestRun.transactionHash,
          },
    nextRunAt:
      heartbeat === undefined
        ? undefined
        : heartbeat.at + dependencies.configuration.intervalMilliseconds,
    service: operatorServiceState({
      heartbeatAtMilliseconds: heartbeat?.at,
      nowMilliseconds: dependencies.now(),
      staleAfterMilliseconds:
        dependencies.configuration.heartbeatStaleAfterMilliseconds,
    }),
    writerLease: dependencies.store.readWriterLease(),
  };
};

/** Public evidence never includes command audit, actor, lease, or diagnostics. */
export const readPublicDeliveryStatus = (
  dependencies: OperatorControlDependencies,
): DeliveryStatus => {
  const state = readOperatorControlState(dependencies);
  const observedAt = dependencies.now();
  return decodeDeliveryStatus({
    apiVersion: 1,
    chainId: dependencies.configuration.chainId,
    deploymentFingerprint: dependencies.configuration.deploymentFingerprint,
    observedAt,
    expiresAt: observedAt + 30_000,
    policy: { mode: state.desired.mode, oneShot: state.desired.oneShot },
    liveness: {
      state: state.service,
      ...(state.heartbeat === undefined
        ? {}
        : {
            heartbeatAt: state.heartbeat.at,
            expiresAt:
              state.heartbeat.at +
              dependencies.configuration.heartbeatStaleAfterMilliseconds,
          }),
    },
    dependencyReadiness: "unknown",
    workEligibility: "unknown",
    ...(state.latestRun === undefined
      ? {}
      : {
          latestRun: {
            outcome: ["running", "completed", "failed", "skipped"].includes(
              state.latestRun.outcome,
            )
              ? state.latestRun.outcome
              : "unknown",
            startedAt: state.latestRun.startedAt,
            ...(state.latestRun.finishedAt === undefined
              ? {}
              : { finishedAt: state.latestRun.finishedAt }),
          },
        }),
  });
};
