import { Schema } from "effect";
import { getAddress, type Address } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

/**
 * The operator control plane. It is deliberately a fixed command vocabulary,
 * not a process interface: nothing here can name an executable, a path, an
 * environment override, an RPC URL, or a key. A generic process or shell
 * endpoint would be unacceptable, so the only thing a caller can express is
 * one of these five intents.
 */
export const OPERATOR_COMMANDS = [
  /** Stop starting new runs. The current run finishes at a safe boundary. */
  "stop",
  /** Recurring runs that plan and simulate but never sign. */
  "enable-dry-run",
  /** Recurring runs that may sign eligible transactions. */
  "enable-live",
  /** One planning-and-simulation pass, then return to the standing policy. */
  "request-dry-run",
  /** One bounded pass that may sign, then return to the standing policy. */
  "request-live-run",
] as const;

export type OperatorCommandName = (typeof OPERATOR_COMMANDS)[number];

/** Commands that can lead to a signed transaction need a wallet signature. */
export const OPERATOR_SIGNED_COMMANDS: readonly OperatorCommandName[] = [
  "enable-live",
  "request-live-run",
];

export const operatorCommandRequiresSignature = (
  command: OperatorCommandName,
): boolean => OPERATOR_SIGNED_COMMANDS.includes(command);

/** The standing execution policy, separate from whether the service is alive. */
export type OperatorExecutionMode = "stopped" | "dry-run" | "live";

/** A single queued pass, separate from the standing policy. */
export type OperatorOneShot = "none" | "dry-run" | "live";

export const OPERATOR_CONTROL_PATHS = {
  command: "/v1/admin/operator/command",
  state: "/v1/admin/operator/state",
} as const;

export const OPERATOR_COMMAND_STATEMENT =
  "Authorize one ORBIT operator control command. This signature authorizes no transfer, approval, or protocol action.";

export const OPERATOR_COMMAND_RESOURCE = "orbit:operator-control";
export const OPERATOR_COMMAND_TTL_SECONDS = 120;

const OperatorCommandRequestInput = Schema.Struct({
  command: Schema.Literal(...OPERATOR_COMMANDS),
  /** Client-generated, so a retried request cannot apply twice. */
  commandId: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{32}$/u)),
  signedCommand: Schema.optional(
    Schema.Struct({
      message: Schema.String.pipe(Schema.maxLength(2_000)),
      signature: Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]+$/u)),
    }),
  ),
});

export interface OperatorCommandRequest {
  readonly command: OperatorCommandName;
  readonly commandId: string;
  readonly signedCommand?:
    { readonly message: string; readonly signature: `0x${string}` } | undefined;
}

const exactKeys = (
  value: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Operator command request must be an object");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((name) => !allowed.includes(name))) {
    throw new TypeError("Operator command request has an unsupported field");
  }
  return record;
};

export const decodeOperatorCommandRequest = (
  value: unknown,
): OperatorCommandRequest => {
  const record = exactKeys(value, ["command", "commandId", "signedCommand"]);
  const decoded = Schema.decodeUnknownSync(OperatorCommandRequestInput)(record);
  return {
    command: decoded.command,
    commandId: decoded.commandId,
    ...(decoded.signedCommand === undefined
      ? {}
      : {
          signedCommand: {
            message: decoded.signedCommand.message,
            signature: decoded.signedCommand.signature as `0x${string}`,
          },
        }),
  };
};

export interface OperatorCommandChallengeInput {
  readonly actor: Address;
  readonly chainId: number;
  readonly command: OperatorCommandName;
  readonly commandId: string;
  readonly deploymentFingerprint: string;
  readonly domain: string;
  readonly issuedAtMilliseconds: number;
  readonly uri: string;
}

/**
 * The message an operator signs for a command that can lead to a signature.
 * It is bound to actor, command, chain, deployment, nonce, and expiry, so it
 * cannot be replayed for another command, chain, or deployment.
 */
export const createOperatorCommandMessage = ({
  actor,
  chainId,
  command,
  commandId,
  deploymentFingerprint,
  domain,
  issuedAtMilliseconds,
  uri,
}: OperatorCommandChallengeInput): string =>
  createSiweMessage({
    address: getAddress(actor),
    chainId,
    domain,
    expirationTime: new Date(
      issuedAtMilliseconds + OPERATOR_COMMAND_TTL_SECONDS * 1_000,
    ),
    issuedAt: new Date(issuedAtMilliseconds),
    nonce: commandId,
    resources: [
      OPERATOR_COMMAND_RESOURCE,
      `orbit:operator-command:${command}`,
      `orbit:deployment:${deploymentFingerprint}`,
    ],
    statement: OPERATOR_COMMAND_STATEMENT,
    uri,
    version: "1",
  });

export type OperatorCommandRejection =
  | "malformed"
  | "domain-mismatch"
  | "chain-mismatch"
  | "actor-mismatch"
  | "command-mismatch"
  | "deployment-mismatch"
  | "nonce-mismatch"
  | "purpose-mismatch"
  | "expired";

export interface OperatorCommandExpectation {
  readonly actor: Address;
  readonly chainId: number;
  readonly command: OperatorCommandName;
  readonly commandId: string;
  readonly deploymentFingerprint: string;
  readonly domain: string;
  readonly nowMilliseconds: number;
}

const sameAddress = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

const parsed = (message: string) => {
  try {
    return parseSiweMessage(message);
  } catch {
    return undefined;
  }
};

/** Who signed, for which site, on which chain, for which request. */
const identityRejection = (
  fields: NonNullable<ReturnType<typeof parsed>>,
  expectation: OperatorCommandExpectation,
): OperatorCommandRejection | undefined => {
  if (fields.domain !== expectation.domain) return "domain-mismatch";
  if (fields.chainId !== expectation.chainId) return "chain-mismatch";
  if (
    fields.address === undefined ||
    !sameAddress(fields.address, expectation.actor)
  ) {
    return "actor-mismatch";
  }
  return fields.nonce === expectation.commandId ? undefined : "nonce-mismatch";
};

/** Which command, on which deployment, for which purpose. */
const scopeRejection = (
  fields: NonNullable<ReturnType<typeof parsed>>,
  expectation: OperatorCommandExpectation,
): OperatorCommandRejection | undefined => {
  const resources = fields.resources ?? [];
  if (
    resources[0] !== OPERATOR_COMMAND_RESOURCE ||
    fields.statement !== OPERATOR_COMMAND_STATEMENT
  ) {
    return "purpose-mismatch";
  }
  if (!resources.includes(`orbit:operator-command:${expectation.command}`)) {
    return "command-mismatch";
  }
  return resources.includes(
    `orbit:deployment:${expectation.deploymentFingerprint}`,
  )
    ? undefined
    : "deployment-mismatch";
};

const bindingRejection = (
  fields: NonNullable<ReturnType<typeof parsed>>,
  expectation: OperatorCommandExpectation,
): OperatorCommandRejection | undefined =>
  identityRejection(fields, expectation) ?? scopeRejection(fields, expectation);

/**
 * Validates every deployment-bound field before any signature work, so a
 * tampered or replayed command is rejected without spending verification.
 */
export const verifyOperatorCommandMessage = (
  message: string,
  expectation: OperatorCommandExpectation,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: OperatorCommandRejection;
    } => {
  const fields = parsed(message);
  if (fields === undefined) return { ok: false, reason: "malformed" };
  const rejection = bindingRejection(fields, expectation);
  if (rejection !== undefined) return { ok: false, reason: rejection };
  if (
    fields.expirationTime === undefined ||
    fields.expirationTime.getTime() <= expectation.nowMilliseconds
  ) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
};

export const operatorCommandRejectionMessage: Readonly<
  Record<OperatorCommandRejection, string>
> = {
  malformed: "The signed command could not be read. Request a new one.",
  "domain-mismatch": "The signed command was issued for a different site.",
  "chain-mismatch": "The signed command was issued for a different network.",
  "actor-mismatch": "The signed command does not match the signed-in operator.",
  "command-mismatch": "The signature authorizes a different command.",
  "deployment-mismatch":
    "The signed command was issued for a different deployment.",
  "nonce-mismatch": "The signature does not match this command request.",
  "purpose-mismatch": "The signed message is not an operator control command.",
  expired: "The signed command expired. Request a new one and sign again.",
};

/**
 * The control-plane state as it crosses process boundaries: operator control
 * surface -> public API proxy -> web relay -> browser. Every hop decodes it
 * with this schema instead of trusting the upstream shape -- a malformed
 * payload must become a handled error, not a TypeError deep inside a panel
 * whose crash takes the whole admin console with it.
 */
const OperatorControlStateSchema = Schema.Struct({
  audit: Schema.Array(
    Schema.Struct({
      actor: Schema.String,
      appliedAt: Schema.Number,
      command: Schema.Literal(...OPERATOR_COMMANDS),
      next: Schema.String,
      previous: Schema.String,
      result: Schema.String,
      role: Schema.String,
    }),
  ),
  desired: Schema.Struct({
    mode: Schema.Literal("stopped", "dry-run", "live"),
    oneShot: Schema.Literal("none", "dry-run", "live"),
  }),
  heartbeat: Schema.optional(
    Schema.Struct({
      at: Schema.Number,
      observedMode: Schema.String,
      supervisor: Schema.String,
    }),
  ),
  latestRun: Schema.optional(
    Schema.Struct({
      authority: Schema.String,
      finishedAt: Schema.optional(Schema.Number),
      outcome: Schema.String,
      sanitizedFailure: Schema.optional(Schema.String),
      startedAt: Schema.Number,
      transactionHash: Schema.optional(Schema.String),
    }),
  ),
  nextRunAt: Schema.optional(Schema.Number),
  service: Schema.Literal("offline", "degraded", "online"),
  writerLease: Schema.optional(
    Schema.Struct({
      expiresAt: Schema.Number,
      holder: Schema.String,
    }),
  ),
});

export type OperatorControlState = typeof OperatorControlStateSchema.Type;

export const decodeOperatorControlState = Schema.decodeUnknownSync(
  OperatorControlStateSchema,
);
