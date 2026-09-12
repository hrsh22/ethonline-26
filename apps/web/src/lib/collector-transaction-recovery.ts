import {
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbiItem,
  type Address,
  type Hash,
  type Hex,
} from "viem";
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

const approvalEvent = parseAbiItem(
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
);

export interface CollectorActionRecoveryReader extends CollectorRecoveryReader {
  readonly getBlockNumber: () => Promise<bigint>;
  readonly getCandidateLogs: (args: {
    addresses: readonly Address[];
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<readonly { transactionHash: Hash | null; removed: boolean }[]>;
}

/** Event hashes are candidates, never proof. Every recovered action must match
 * the original sender, destination, calldata, value, time and canonical receipt. */
export async function findCollectorTransactionHash(input: {
  metadata: CollectorTransactionMetadata;
  address: Address;
  chainId: number;
  canonicalTargets: readonly string[];
  reader: CollectorActionRecoveryReader;
}): Promise<Hash | undefined> {
  const call = input.metadata.preparedCall;
  if (call === undefined) return;
  validateRecoveryScope(
    call,
    input.address,
    input.chainId,
    input.canonicalTargets,
  );
  const [chain, head] = await Promise.all([
    input.reader.getChainId(),
    input.reader.getBlockNumber(),
  ]);
  if (chain !== input.chainId)
    throw new Error("The transaction reader is on a different network.");
  const start = BigInt(call.afterBlock) + 1n;
  // Bound automatic recovery to the first hour. Older/no-log/reverted calls can
  // still be verified by their exact hash through the manual recovery control.
  const end = head < start + 1_799n ? head : start + 1_799n;
  if (end < start) return;
  const logs = await input.reader.getCandidateLogs({
    addresses: input.canonicalTargets as readonly Address[],
    fromBlock: start,
    toBlock: end,
  });
  const candidates = [
    ...new Set(
      logs
        .filter((log) => !log.removed && log.transactionHash !== null)
        .map((log) => log.transactionHash!),
    ),
  ]
    .reverse()
    .slice(0, 64);
  for (const hash of candidates) {
    try {
      const transaction = await input.reader.getTransaction({ hash });
      if (!matchesCall(transaction, hash, call)) continue;
      return await recoverCollectorTransactionHash({ ...input, hash });
    } catch {
      // Unrelated transactions and temporary/reorged evidence cannot unlock a send.
    }
  }
}
export interface CollectorApprovalRecoveryReader extends CollectorRecoveryReader {
  readonly getBlockNumber: () => Promise<bigint>;
  readonly getLogs: (args: {
    readonly address: Address;
    readonly event: typeof approvalEvent;
    readonly args: { readonly owner: Address; readonly spender: Address };
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
  }) => Promise<
    readonly {
      readonly args: {
        readonly owner?: Address | undefined;
        readonly spender?: Address | undefined;
        readonly value?: bigint | undefined;
      };
      readonly transactionHash: Hash | null;
      readonly removed: boolean;
    }[]
  >;
  readonly readContract: (args: {
    readonly address: Address;
    readonly abi: typeof erc20Abi;
    readonly functionName: "allowance";
    readonly args: readonly [Address, Address];
    readonly blockNumber: bigint;
  }) => Promise<bigint>;
}

interface CollectorApprovalRecoveryInput {
  readonly metadata: CollectorTransactionMetadata;
  readonly address: Address;
  readonly chainId: number;
  readonly tokens: readonly string[];
  readonly spender: Address;
  readonly reader: CollectorApprovalRecoveryReader;
}

/** Legacy approval bookmarks can return to review after fresh network evidence.
 * The next explicit trade attempt rechecks its exact allowance before any send. */
export async function readCollectorApprovalReview(
  input: CollectorApprovalRecoveryInput,
): Promise<{ readonly blockNumber: bigint }> {
  if (input.metadata.preparedCall !== undefined)
    return readCollectorApprovalPrerequisite(input);
  const [chainId, blockNumber] = await Promise.all([
    input.reader.getChainId(),
    input.reader.getBlockNumber(),
  ]);
  if (chainId !== input.chainId)
    throw new Error("The approval reader is on a different network.");
  await Promise.all(
    input.tokens.map((token) =>
      input.reader.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [input.address, input.spender],
        blockNumber,
      }),
    ),
  );
  return { blockNumber };
}

function matchesApprovalLog(
  log: Awaited<ReturnType<CollectorApprovalRecoveryReader["getLogs"]>>[number],
  input: CollectorApprovalRecoveryInput,
): boolean {
  return (
    !log.removed &&
    log.transactionHash !== null &&
    log.args.value !== undefined &&
    log.args.owner?.toLowerCase() === input.address.toLowerCase() &&
    log.args.spender?.toLowerCase() === input.spender.toLowerCase() &&
    keccak256(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [input.spender, log.args.value],
      }),
    ) === input.metadata.preparedCall?.dataHash
  );
}

/** A scoped allowance check is also enough to offer a fresh approval review. */
export async function readCollectorApprovalPrerequisite(
  input: CollectorApprovalRecoveryInput,
): Promise<{
  readonly blockNumber: bigint;
  readonly satisfied: boolean;
}> {
  const { metadata, address, chainId, tokens, spender, reader } = input;
  const call = metadata.preparedCall;
  if (call === undefined)
    throw new Error("This approval has no saved network evidence.");
  validateRecoveryScope(call, address, chainId, tokens);
  if (call.value !== "0") throw new Error("This call is not a token approval.");
  const [observedChain, blockNumber] = await Promise.all([
    reader.getChainId(),
    reader.getBlockNumber(),
  ]);
  if (observedChain !== chainId)
    throw new Error("The approval reader is on a different network.");
  if (blockNumber < BigInt(call.afterBlock))
    throw new Error("Waiting for the network to catch up with this approval.");
  const amount = await reader.readContract({
    address: call.to,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, spender],
    blockNumber,
  });
  const approval = call.approval;
  const savedApprovalMatches =
    approval !== undefined &&
    approval.spender.toLowerCase() === spender.toLowerCase() &&
    keccak256(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, BigInt(approval.amount)],
      }),
    ) === call.dataHash;
  return {
    blockNumber,
    satisfied: savedApprovalMatches && amount >= BigInt(approval.amount),
  };
}

/** Find a lost approval by exact call evidence; never sends or repeats a trade. */
export async function recoverCollectorApproval(
  input: CollectorApprovalRecoveryInput,
): Promise<
  | { readonly status: "mined"; readonly hash: Hash }
  | { readonly status: "satisfied"; readonly blockNumber: bigint }
  | { readonly status: "unresolved" }
> {
  if (input.metadata.preparedCall === undefined)
    return { status: "unresolved" };
  const prerequisite = await readCollectorApprovalPrerequisite(input);
  if (prerequisite.satisfied)
    return { status: "satisfied", blockNumber: prerequisite.blockNumber };
  const { metadata, address, chainId, tokens, spender, reader } = input;
  const call = metadata.preparedCall!;
  // Pin the search to the first day after preflight (43,200 Base blocks), in
  // provider-friendly ranges. This bounds old bookmarks without scanning the chain.
  const lastBlock = BigInt(call.afterBlock) + 43_200n;
  const toBlock =
    prerequisite.blockNumber < lastBlock ? prerequisite.blockNumber : lastBlock;
  for (
    let fromBlock = BigInt(call.afterBlock) + 1n;
    fromBlock <= toBlock;
    fromBlock += 5_000n
  ) {
    const rangeEnd = fromBlock + 4_999n;
    const logs = await reader.getLogs({
      address: call.to,
      event: approvalEvent,
      args: { owner: address, spender },
      fromBlock,
      toBlock: rangeEnd < toBlock ? rangeEnd : toBlock,
    });
    for (const log of logs.slice(0, 128)) {
      if (!matchesApprovalLog(log, input)) continue;
      try {
        const hash = await recoverCollectorTransactionHash({
          hash: log.transactionHash!,
          metadata,
          address,
          chainId,
          canonicalTargets: tokens,
          reader,
        });
        return { status: "mined", hash };
      } catch {
        // Reorgs and unrelated event emitters are not proof of this exact call.
      }
    }
  }
  return { status: "unresolved" };
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
