import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";
import { requiredAdminRole } from "@orbit/config/admin-auth";
import { adminAuthorizationAction } from "@/lib/admin-action-authorization";
import type { ProtocolAction } from "@orbit/protocol/transactions";
import { formatUnits } from "viem";

import { applicationCopy, identity } from "@/lib/identity";

/**
 * A privileged admin action is reviewed against a pinned snapshot before the
 * wallet is asked to sign. Everything the review shows is derived here so the
 * dialog cannot disagree with what is submitted.
 */
export interface PrivilegedActionReview {
  readonly actor: string;
  readonly roles: readonly AdminConsoleRoleId[];
  readonly requiredRole: AdminConsoleRoleId;
  readonly network: string;
  readonly observedBlock: string;
  readonly subject: string;
  readonly currentState: string;
  readonly intendedState: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly consequences: readonly string[];
  /** Present when the action cannot safely be submitted from this review. */
  readonly blocker: string | undefined;
}

export interface PrivilegedActionReviewInput {
  readonly action: ProtocolAction;
  readonly actor: string | undefined;
  readonly chainLabel: string;
  readonly currentState: string;
  readonly expectedOutput?:
    | {
        readonly quotedOutput: bigint;
        readonly minimumOutput: bigint;
        readonly minimumOutputBps: number;
        readonly quoteBlock: bigint;
      }
    | undefined;
  readonly feeAmount?: string | undefined;
  readonly intendedState: string;
  readonly observedBlock: bigint | undefined;
  readonly quoteStale?: boolean;
  readonly roles: readonly AdminConsoleRoleId[];
  readonly subject: string;
}

const weth = (value: bigint): string => `${formatUnits(value, 18)} WETH`;

const stockUnits = (value: bigint): string =>
  `${formatUnits(value, 18)} ${identity.terms.stockReward}`;

const deadlineRow = (
  action: ProtocolAction,
): readonly (readonly [string, string])[] => {
  if (!("deadline" in action)) return [];
  const at = new Date(Number(action.deadline) * 1_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  return [[applicationCopy.operations.reviewDeadline, `${at} UTC`]];
};

/**
 * Pause blast radius, named per module. Generic pause copy left an operator
 * guessing which collector and operator actions actually stop.
 */
const pauseConsequences = (
  module: "liquidToken" | "rewards" | "converter" | "liquidity",
  paused: boolean,
): readonly string[] => {
  const copy = applicationCopy.operations.pauseBlastRadius[module];
  return paused ? [copy.stops, copy.remains] : [copy.resumes, copy.remains];
};

const actionConsequences = (action: ProtocolAction): readonly string[] => {
  if (action.type === "set-pause") {
    return pauseConsequences(action.module, action.paused);
  }
  if (action.type === "execute-track" || action.type === "retry-track") {
    return [applicationCopy.operations.reviewTrackConsequence];
  }
  if (action.type === "open-reward-epoch") {
    return [applicationCopy.operations.reviewEpochConsequence];
  }
  if (action.type === "execute-pol") {
    return [applicationCopy.operations.reviewPolConsequence];
  }
  if (action.type === "withdraw-creator-fees") {
    return [applicationCopy.operations.reviewCreatorConsequence];
  }
  if (action.type === "set-claim-policy") {
    return [
      action.allowed
        ? applicationCopy.operations.claimPolicyApproveConsequence
        : applicationCopy.operations.claimPolicyRevokeConsequence,
    ];
  }
  return [];
};

const outputRows = (
  input: PrivilegedActionReviewInput,
): readonly (readonly [string, string])[] => {
  const output = input.expectedOutput;
  if (output === undefined) return [];
  return [
    [
      applicationCopy.operations.reviewExpectedOutput,
      stockUnits(output.quotedOutput),
    ],
    [
      applicationCopy.operations.reviewMinimumOutput,
      `${stockUnits(output.minimumOutput)} (${output.minimumOutputBps / 100}%)`,
    ],
    [applicationCopy.operations.reviewQuoteBlock, output.quoteBlock.toString()],
  ];
};

const amountRows = (
  action: ProtocolAction,
): readonly (readonly [string, string])[] => {
  if (action.type === "withdraw-creator-fees") {
    return [[applicationCopy.operations.reviewAmount, weth(action.amount)]];
  }
  if (action.type === "set-claim-policy") {
    return [
      [applicationCopy.operations.claimPolicyAccountLabel, action.account],
    ];
  }
  if (action.type === "execute-pol") {
    return [
      [
        applicationCopy.operations.reviewRange,
        `${action.tickLower} → ${action.tickUpper}`,
      ],
      [applicationCopy.operations.reviewBudget, weth(action.maximumWeth)],
    ];
  }
  return [];
};

/**
 * A quote pinned to an older block than the current snapshot, or a protected
 * minimum that rounds to zero, must not reach the wallet.
 */
const reviewBlocker = (
  input: PrivilegedActionReviewInput,
): string | undefined => {
  if (input.actor === undefined) {
    return applicationCopy.operations.reviewNoActor;
  }
  const output = input.expectedOutput;
  if (output === undefined) return undefined;
  if (output.minimumOutput <= 0n) {
    return applicationCopy.operations.reviewMinimumRoundsToZero;
  }
  if (input.quoteStale === true) {
    return applicationCopy.operations.reviewQuoteStale;
  }
  if (
    input.observedBlock !== undefined &&
    output.quoteBlock < input.observedBlock
  ) {
    return applicationCopy.operations.reviewQuoteStale;
  }
  return undefined;
};

export const derivePrivilegedActionReview = (
  input: PrivilegedActionReviewInput,
): PrivilegedActionReview => ({
  actor: input.actor ?? applicationCopy.common.notObserved,
  roles: input.roles,
  requiredRole: requiredAdminRole(adminAuthorizationAction(input.action)),
  network: input.chainLabel,
  observedBlock:
    input.observedBlock?.toString() ?? applicationCopy.common.notObserved,
  subject: input.subject,
  currentState: input.currentState,
  intendedState: input.intendedState,
  rows: [
    ...amountRows(input.action),
    ...outputRows(input),
    ...(input.feeAmount === undefined
      ? []
      : ([[applicationCopy.operations.reviewFee, input.feeAmount]] as const)),
    ...deadlineRow(input.action),
  ],
  consequences: actionConsequences(input.action),
  blocker: reviewBlocker(input),
});
