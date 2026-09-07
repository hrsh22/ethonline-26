import type {
  OperatorCommandName,
  OperatorExecutionMode,
  OperatorOneShot,
} from "@orbit/config/operator-control";

/**
 * The control plane separates four things the previous fixed
 * `OPERATOR_EXECUTE` variable conflated:
 *
 * - **execution policy** — what the operator is allowed to do (this file);
 * - **service state** — whether a supervised process is actually alive;
 * - **dependency readiness** — whether its inputs can be read;
 * - **work eligibility** — whether the protocol currently has work.
 *
 * A green data plane never implied a running operator, and it still does not.
 */
export interface OperatorExecutionPolicy {
  readonly mode: OperatorExecutionMode;
  readonly oneShot: OperatorOneShot;
}

/**
 * A fresh or wiped store starts stopped. Restarts preserve the last authorized
 * policy for the same deployment; an explicit Stop remains stopped.
 */
export const CLOSED_POLICY: OperatorExecutionPolicy = {
  mode: "stopped",
  oneShot: "none",
};

export type PolicyTransitionRejection =
  /** The command would not change anything. */
  | "no-change"
  /** A one-shot is already queued; queueing another would be ambiguous. */
  | "one-shot-pending";

export type PolicyTransition =
  | { readonly ok: true; readonly next: OperatorExecutionPolicy }
  | { readonly ok: false; readonly reason: PolicyTransitionRejection };

const samePolicy = (
  left: OperatorExecutionPolicy,
  right: OperatorExecutionPolicy,
): boolean => left.mode === right.mode && left.oneShot === right.oneShot;

/**
 * Applies one command to the standing policy. Stop always wins and also
 * discards any queued one-shot, so a stop cannot be defeated by a pass that
 * was requested a moment earlier.
 */
export const applyOperatorCommand = (
  current: OperatorExecutionPolicy,
  command: OperatorCommandName,
): PolicyTransition => {
  if (command === "stop") {
    const next: OperatorExecutionPolicy = { mode: "stopped", oneShot: "none" };
    return samePolicy(current, next)
      ? { ok: false, reason: "no-change" }
      : { ok: true, next };
  }
  if (command === "enable-dry-run" || command === "enable-live") {
    const next: OperatorExecutionPolicy = {
      mode: command === "enable-live" ? "live" : "dry-run",
      oneShot: current.oneShot,
    };
    return samePolicy(current, next)
      ? { ok: false, reason: "no-change" }
      : { ok: true, next };
  }
  if (current.oneShot !== "none") {
    return { ok: false, reason: "one-shot-pending" };
  }
  return {
    ok: true,
    next: {
      mode: current.mode,
      oneShot: command === "request-live-run" ? "live" : "dry-run",
    },
  };
};

/** What a single cycle is permitted to do under the current policy. */
export type CycleAuthority = "skip" | "dry-run" | "execute";

/**
 * A queued one-shot outranks the standing policy for exactly one cycle, which
 * is how a stopped operator can be asked for a single pass without leaving it
 * running afterwards.
 */
export const cycleAuthority = (
  policy: OperatorExecutionPolicy,
): CycleAuthority => {
  if (policy.oneShot === "live") return "execute";
  if (policy.oneShot === "dry-run") return "dry-run";
  if (policy.mode === "live") return "execute";
  return policy.mode === "dry-run" ? "dry-run" : "skip";
};

/** A one-shot is consumed whether the cycle succeeded or failed. */
export const consumeOneShot = (
  policy: OperatorExecutionPolicy,
): OperatorExecutionPolicy =>
  policy.oneShot === "none" ? policy : { mode: policy.mode, oneShot: "none" };

export interface OperatorServiceObservation {
  readonly heartbeatAtMilliseconds: number | undefined;
  readonly nowMilliseconds: number;
  readonly staleAfterMilliseconds: number;
}

export type OperatorServiceState = "offline" | "degraded" | "online";

/**
 * Service liveness is an observation, never an inference from policy. A
 * desired mode of `live` with no heartbeat is an offline service, and the
 * console must say so rather than implying work is happening.
 */
export const operatorServiceState = ({
  heartbeatAtMilliseconds,
  nowMilliseconds,
  staleAfterMilliseconds,
}: OperatorServiceObservation): OperatorServiceState => {
  if (heartbeatAtMilliseconds === undefined) return "offline";
  const age = nowMilliseconds - heartbeatAtMilliseconds;
  if (age <= staleAfterMilliseconds) return "online";
  return age <= staleAfterMilliseconds * 3 ? "degraded" : "offline";
};
