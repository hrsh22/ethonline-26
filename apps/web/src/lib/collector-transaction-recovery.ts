import { keccak256, type Address, type Hash, type Hex } from "viem";
import type { CollectorTransactionMetadata } from "./collector-transaction-record";

export interface CollectorRecoveryReader {
  readonly getChainId: () => Promise<number>;
  readonly getTransaction: (args: { hash: Hash }) => Promise<{
    readonly hash: Hash;
    readonly from: Address;
    readonly to: Address | null;
    readonly input: Hex;
    readonly value: bigint;
    readonly blockNumber: bigint | null;
    readonly blockHash: Hash | null;
  }>;
  readonly getTransactionReceipt: (args: {
    hash: Hash;
  }) => Promise<RecoveredReceipt>;
  readonly getBlock: (args: {
    blockNumber: bigint;
  }) => Promise<{ readonly timestamp: bigint; readonly hash: Hash | null }>;
}

export interface RecoveredReceipt {
  readonly transactionHash: Hash;
  readonly blockNumber: bigint;
  readonly blockHash: Hash;
  readonly status: "success" | "reverted";
}

/** Read-only proof for a lost hash. Never prepares, authorizes or sends a transaction. */
export async function recoverCollectorTransactionHash({
  hash,
  metadata,
  address,
  chainId,
  canonicalTargets,
  reader,
  expectedReceipt,
}: {
  readonly hash: string;
  readonly metadata: CollectorTransactionMetadata;
  readonly address: Address;
  readonly chainId: number;
  readonly canonicalTargets: readonly string[];
  readonly reader: CollectorRecoveryReader;
  readonly expectedReceipt?: RecoveredReceipt;
}): Promise<Hash> {
  const call = metadata.preparedCall;
  if (call === undefined)
    throw new Error(
      "This older attempt has no saved call evidence. Its hash cannot be safely matched here.",
    );
  if (!/^0x[0-9a-fA-F]{64}$/u.test(hash))
    throw new Error(
      "Enter a complete transaction hash (0x and 64 hexadecimal characters).",
    );
  validateRecoveryScope(call, address, chainId, canonicalTargets);
  const checkedHash = hash as Hash;
  const [transaction, receipt, observedChain] = await Promise.all([
    reader.getTransaction({ hash: checkedHash }),
    reader.getTransactionReceipt({ hash: checkedHash }),
    reader.getChainId(),
  ]).catch(() => {
    throw new Error(
      "Unable to read a mined transaction on Base Sepolia. Check the hash and try again.",
    );
  });
  if (observedChain !== chainId)
    throw new Error("The transaction reader is on a different network.");
  if (!matchesCall(transaction, checkedHash, call))
    throw new Error(
      "This transaction does not match the exact call saved for this attempt.",
    );
  if (
    receipt.transactionHash.toLowerCase() !== checkedHash.toLowerCase() ||
    receipt.blockNumber !== transaction.blockNumber ||
    receipt.blockNumber <= BigInt(call.afterBlock)
  ) {
    throw new Error(
      "This transaction was not mined after the saved attempt’s preflight block.",
    );
  }
  const block = await reader
    .getBlock({ blockNumber: receipt.blockNumber })
    .catch(() => {
      throw new Error("Unable to verify the transaction’s block. Try again.");
    });
  verifyCanonicalReceipt(
    receipt,
    transaction.blockHash,
    block.hash,
    expectedReceipt,
  );
  // Base timestamps can slightly trail the browser clock; the preflight block
  // fence additionally excludes previously mined identical calls.
  if (block.timestamp * 1000n < BigInt(metadata.createdAt) - 60_000n) {
    throw new Error("This transaction predates the saved attempt.");
  }
  return checkedHash;
}

function matchesCall(
  transaction: Awaited<ReturnType<CollectorRecoveryReader["getTransaction"]>>,
  hash: Hash,
  call: NonNullable<CollectorTransactionMetadata["preparedCall"]>,
): boolean {
  return (
    transaction.hash.toLowerCase() === hash.toLowerCase() &&
    transaction.from.toLowerCase() === call.from.toLowerCase() &&
    transaction.to?.toLowerCase() === call.to.toLowerCase() &&
    keccak256(transaction.input) === call.dataHash &&
    transaction.value === BigInt(call.value)
  );
}

function validateRecoveryScope(
  call: NonNullable<CollectorTransactionMetadata["preparedCall"]>,
  address: Address,
  chainId: number,
  canonicalTargets: readonly string[],
): void {
  if (
    call.from.toLowerCase() !== address.toLowerCase() ||
    call.chainId !== chainId ||
    !canonicalTargets.some(
      (target) => target.toLowerCase() === call.to.toLowerCase(),
    )
  ) {
    throw new Error(
      "The saved call does not belong to this wallet and deployment.",
    );
  }
}

function verifyCanonicalReceipt(
  receipt: RecoveredReceipt,
  transactionBlockHash: Hash | null,
  canonicalHash: Hash | null,
  expected: RecoveredReceipt | undefined,
): void {
  if (
    receipt.blockHash !== canonicalHash ||
    receipt.blockHash !== transactionBlockHash
  ) {
    throw new Error(
      "The transaction receipt is not in the canonical block at its height. Keep this attempt open and try again.",
    );
  }
  if (
    expected !== undefined &&
    (expected.transactionHash !== receipt.transactionHash ||
      expected.blockHash !== receipt.blockHash ||
      expected.blockNumber !== receipt.blockNumber ||
      expected.status !== receipt.status)
  ) {
    throw new Error(
      "The transaction receipt changed during recovery. Keep this attempt open and try again.",
    );
  }
}
