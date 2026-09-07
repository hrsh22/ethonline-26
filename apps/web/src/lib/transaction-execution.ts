import type { Hash } from "viem";

import { advanceTransaction, type TransactionState } from "./transaction-state";

export class ReplacedProtocolTransactionError extends Error {
  override readonly name = "ReplacedProtocolTransactionError";
  constructor(
    readonly hash: Hash,
    readonly reason: "cancelled" | "replaced",
  ) {
    super(
      `Your wallet ${reason} this transaction. The original action did not complete.`,
    );
  }
}

const GAS_SAFETY_NUMERATOR = 125n;
const GAS_SAFETY_DENOMINATOR = 100n;
const MAX_CONFIRMED_BLOCK_READS = 4;

const addGasSafetyMargin = (estimate: bigint): bigint =>
  (estimate * GAS_SAFETY_NUMERATOR + GAS_SAFETY_DENOMINATOR - 1n) /
  GAS_SAFETY_DENOMINATOR;

export class RevertedProtocolTransactionError extends Error {
  readonly hash: Hash;

  constructor(hash: Hash) {
    super("Protocol transaction reverted after it was mined");
    this.name = "RevertedProtocolTransactionError";
    this.hash = hash;
  }
}

export class UnknownProtocolTransactionOutcomeError extends Error {
  override readonly cause: unknown;
  readonly hash: Hash;

  constructor(hash: Hash, cause: unknown) {
    super("Submitted transaction receipt could not be observed");
    this.name = "UnknownProtocolTransactionOutcomeError";
    this.hash = hash;
    this.cause = cause;
  }
}

export interface ExecutedProtocolTransaction {
  readonly blockNumber: bigint;
  readonly state: TransactionState;
}

const pauseBeforeBlockRetry = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const refetchUntilObservedBlock = async <
  Snapshot extends { readonly observedBlock: bigint },
>({
  minimumBlock,
  pause = pauseBeforeBlockRetry,
  refetch,
}: {
  readonly minimumBlock: bigint;
  readonly pause?: (milliseconds: number) => Promise<void>;
  readonly refetch: () => Promise<Snapshot | undefined>;
}): Promise<
  | { readonly status: "caught-up"; readonly snapshot: Snapshot }
  | { readonly status: "stale"; readonly snapshot: Snapshot | undefined }
> => {
  let snapshot: Snapshot | undefined;
  for (let attempt = 0; attempt < MAX_CONFIRMED_BLOCK_READS; attempt += 1) {
    snapshot = await refetch();
    if (snapshot !== undefined && snapshot.observedBlock >= minimumBlock) {
      return { status: "caught-up", snapshot };
    }
    if (attempt < MAX_CONFIRMED_BLOCK_READS - 1) {
      await pause(250 * 2 ** attempt);
    }
  }
  return { status: "stale", snapshot };
};

export const executeProtocolTransaction = async ({
  estimateGas,
  failureStep,
  label,
  onState,
  outcomeUnknownMessage,
  simulate,
  submit,
  waitForReceipt,
}: {
  readonly estimateGas: () => Promise<bigint>;
  readonly failureStep: { current: string };
  readonly label: string;
  readonly onState: (state: TransactionState) => void;
  readonly outcomeUnknownMessage: string;
  readonly simulate: () => Promise<void>;
  readonly submit: (gas: bigint) => Promise<Hash>;
  readonly waitForReceipt: (
    hash: Hash,
    onReplacement: (
      hash: Hash,
      reason: "repriced" | "cancelled" | "replaced",
    ) => void,
  ) => Promise<{
    readonly blockNumber: bigint;
    readonly status: "success" | "reverted";
  }>;
}): Promise<ExecutedProtocolTransaction> => {
  let next: TransactionState = { status: "pending", label };
  onState(next);

  failureStep.current = `${label} simulation`;
  await simulate();
  failureStep.current = `${label} gas estimate`;
  const gas = addGasSafetyMargin(await estimateGas());
  next = advanceTransaction(next, { type: "simulate" });
  onState(next);

  failureStep.current = `${label} wallet submission`;
  let hash = await submit(gas);
  next = advanceTransaction(next, { type: "submit", hash });
  onState(next);

  failureStep.current = `${label} confirmation`;
  let receipt: {
    readonly blockNumber: bigint;
    readonly status: "success" | "reverted";
  };
  try {
    const observedReceipt = await waitForReceipt(
      hash,
      (replacementHash, reason) => {
        hash = replacementHash;
        next = advanceTransaction(next, { type: "replace", hash, reason });
        onState(next);
      },
    );
    const blockNumber = observedReceipt.blockNumber;
    const status = observedReceipt.status;
    if (typeof blockNumber !== "bigint" || blockNumber < 0n) {
      throw new TypeError("Transaction receipt block number is invalid");
    }
    if (status !== "success" && status !== "reverted") {
      throw new TypeError("Transaction receipt status is invalid");
    }
    receipt = { blockNumber, status };
  } catch (cause) {
    next = advanceTransaction(next, {
      type: "fail",
      message: outcomeUnknownMessage,
      retriable: true,
    });
    onState(next);
    throw new UnknownProtocolTransactionOutcomeError(hash, cause);
  }
  if (
    (next.status === "submitted" || next.status === "outcome-unknown") &&
    next.replacement !== undefined
  ) {
    throw new ReplacedProtocolTransactionError(hash, next.replacement);
  }
  if (receipt.status === "reverted") {
    throw new RevertedProtocolTransactionError(hash);
  }
  next = advanceTransaction(next, { type: "confirm" });
  onState(next);
  return { blockNumber: receipt.blockNumber, state: next };
};
