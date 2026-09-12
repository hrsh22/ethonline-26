/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, keccak256, type Hash } from "viem";
import {
  readCollectorTransaction,
  writeCollectorTransaction,
  type CollectorTransactionMetadata,
} from "./collector-transaction-record";
import {
  recoverCollectorTransactionHash,
  recoverCollectorApproval,
  readCollectorApprovalPrerequisite,
  type CollectorRecoveryReader,
} from "./collector-transaction-recovery";

const address = `0x${"11".repeat(20)}` as const;
const target = `0x${"22".repeat(20)}` as const;
const hash = `0x${"33".repeat(32)}` as Hash;
const data = "0x12345678";
const metadata: CollectorTransactionMetadata = {
  operationId: "operation-1",
  actionType: "commit-collectible",
  identityIds: [42],
  affectedIdentityIds: [42],
  createdAt: 200_000,
  preparedCall: {
    chainId: 84532,
    from: address,
    to: target,
    dataHash: keccak256(data),
    value: "12",
    afterBlock: "100",
  },
};
const transaction = {
  hash,
  from: address,
  to: target,
  input: data,
  value: 12n,
  blockNumber: 101n,
  blockHash: hash,
} as const;
const reader = (): CollectorRecoveryReader => ({
  getChainId: vi.fn(async () => 84532),
  getTransaction: vi.fn(async () => transaction),
  getTransactionReceipt: vi.fn(async () => ({
    transactionHash: hash,
    blockNumber: 101n,
    blockHash: hash,
    status: "success" as const,
  })),
  getBlock: vi.fn(async () => ({ timestamp: 201n, hash })),
});
const input = (rpc = reader()) => ({
  hash,
  metadata,
  address,
  chainId: 84532,
  canonicalTargets: [target],
  reader: rpc,
});
beforeEach(() => localStorage.clear());

const approvalRecoveryInput = (withPrerequisite = true) => {
  const approvalData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [address, 1_000n],
  });
  return {
    metadata: {
      ...metadata,
      actionType: "swap-exact-input",
      preparedCall: {
        ...metadata.preparedCall!,
        value: "0",
        dataHash: keccak256(approvalData),
        ...(withPrerequisite
          ? { approval: { spender: address, amount: "1000" } }
          : {}),
      },
    },
    address,
    chainId: 84532,
    tokens: [target],
    spender: address,
    reader: {
      ...reader(),
      getBlockNumber: vi.fn(async () => 110n),
      getLogs: vi.fn(async () => []),
      readContract: vi.fn(async () => 1_000n),
    },
  };
};

it("releases only a proven allowance prerequisite without inventing a transaction receipt", async () => {
  const input = approvalRecoveryInput();
  expect(await recoverCollectorApproval(input)).toEqual({
    status: "satisfied",
    blockNumber: 110n,
  });
  expect(input.reader.getTransactionReceipt).not.toHaveBeenCalled();
  expect(input.reader.getLogs).not.toHaveBeenCalled();
  expect(input.reader.readContract).toHaveBeenCalledWith(
    expect.objectContaining({
      address: target,
      args: [address, address],
      blockNumber: 110n,
    }),
  );
});

it("does not accept a different amount, spender, chain, wallet or token as approval evidence", async () => {
  const differentAmount = approvalRecoveryInput();
  differentAmount.metadata.preparedCall.approval = {
    spender: address,
    amount: "999",
  };
  expect(await recoverCollectorApproval(differentAmount)).toEqual({
    status: "unresolved",
  });
  const lowAllowance = approvalRecoveryInput();
  lowAllowance.reader.readContract.mockResolvedValue(999n);
  expect(await recoverCollectorApproval(lowAllowance)).toEqual({
    status: "unresolved",
  });
  const wrongSpender = approvalRecoveryInput();
  wrongSpender.metadata.preparedCall.approval = {
    spender: target,
    amount: "1000",
  };
  expect(await recoverCollectorApproval(wrongSpender)).toEqual({
    status: "unresolved",
  });
  const wrongChain = approvalRecoveryInput();
  vi.mocked(wrongChain.reader.getChainId).mockResolvedValue(1);
  await expect(recoverCollectorApproval(wrongChain)).rejects.toThrow(
    "different network",
  );
  await expect(
    recoverCollectorApproval({ ...approvalRecoveryInput(), address: target }),
  ).rejects.toThrow("wallet and deployment");
  await expect(
    recoverCollectorApproval({ ...approvalRecoveryInput(), tokens: [] }),
  ).rejects.toThrow("wallet and deployment");
});

it("offers a fresh review for a legacy approval without claiming its transaction succeeded", async () => {
  const input = approvalRecoveryInput(false);
  input.reader.readContract.mockResolvedValue(0n);
  expect(await readCollectorApprovalPrerequisite(input)).toEqual({
    blockNumber: 110n,
    satisfied: false,
  });
  expect(await recoverCollectorApproval(input)).toEqual({
    status: "unresolved",
  });
});

it("bounds old approval searches and uses only owner/spender-filtered log ranges", async () => {
  const input = approvalRecoveryInput(false);
  input.reader.getBlockNumber.mockResolvedValue(100_000n);
  await recoverCollectorApproval(input);
  expect(input.reader.getLogs).toHaveBeenCalledTimes(9);
  expect(input.reader.getLogs).toHaveBeenLastCalledWith(
    expect.objectContaining({
      address: target,
      args: { owner: address, spender: address },
      fromBlock: 40_101n,
      toBlock: 43_300n,
    }),
  );
});

it("ignores late callbacks after an approval returns to a fresh review", () => {
  const resolved = { ...metadata, approvalResolvedAtBlock: "110" };
  writeCollectorTransaction(
    "scope",
    { status: "idle" },
    { kind: "approval" },
    resolved,
    true,
  );
  writeCollectorTransaction(
    "scope",
    { status: "submitted", hash, label: "Old approval" },
    { kind: "approval" },
    metadata,
  );
  expect(readCollectorTransaction("scope")).toMatchObject({
    state: { status: "idle" },
    approvalResolvedAtBlock: "110",
  });
});

it("automatically recovers a mined WETH approval after reload without asking for its lost hash", async () => {
  const approvalData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [address, 1_000n],
  });
  const approvalMetadata = {
    ...metadata,
    actionType: "swap-exact-input",
    preparedCall: {
      ...metadata.preparedCall!,
      value: "0",
      dataHash: keccak256(approvalData),
    },
  };
  writeCollectorTransaction(
    "scope",
    { status: "simulated", label: "Approve WETH" },
    { kind: "approval" },
    approvalMetadata,
    true,
  );
  const rpc = {
    ...reader(),
    getBlockNumber: vi.fn(async () => 110n),
    getLogs: vi.fn(async () => [
      {
        args: { owner: address, spender: address, value: 1_000n },
        transactionHash: hash,
        removed: false,
      },
    ]),
    readContract: vi.fn(async () => 1_000n),
  };
  vi.mocked(rpc.getTransaction).mockResolvedValue({
    ...transaction,
    input: approvalData,
    value: 0n,
  });
  expect(
    await recoverCollectorApproval({
      metadata: readCollectorTransaction("scope")!,
      address,
      chainId: 84532,
      tokens: [target],
      spender: address,
      reader: rpc,
    }),
  ).toEqual({ status: "mined", hash });
});

it("restores an interrupted prompt and recovers only its exact mined call without a submit capability", async () => {
  writeCollectorTransaction(
    "scope",
    { status: "simulated", label: "Launch #42" },
    { kind: "action" },
    metadata,
    true,
  );
  const restored = readCollectorTransaction("scope");
  expect(restored?.state.status).toBe("submission-unknown");
  expect(restored?.preparedCall).toEqual(metadata.preparedCall);
  expect(
    await recoverCollectorTransactionHash({ ...input(), metadata: restored! }),
  ).toBe(hash);
});

it.each([
  { from: target },
  { to: address },
  { input: "0x12345679" },
  { value: 13n },
  { hash: `0x${"44".repeat(32)}` },
  { blockNumber: null },
])(
  "rejects another transaction even when it was mined successfully",
  async (override) => {
    const rpc = reader();
    vi.mocked(rpc.getTransaction).mockResolvedValue({
      ...transaction,
      ...override,
    } as typeof transaction);
    await expect(recoverCollectorTransactionHash(input(rpc))).rejects.toThrow();
  },
);

it("rejects another chain, unknown targets, old identical calls, and unmined hashes", async () => {
  const wrongChain = reader();
  vi.mocked(wrongChain.getChainId).mockResolvedValue(1);
  await expect(
    recoverCollectorTransactionHash(input(wrongChain)),
  ).rejects.toThrow("different network");
  await expect(
    recoverCollectorTransactionHash({
      ...input(),
      canonicalTargets: [address],
    }),
  ).rejects.toThrow("deployment");
  const old = reader();
  vi.mocked(old.getTransactionReceipt).mockResolvedValue({
    transactionHash: hash,
    blockHash: hash,
    blockNumber: 100n,
    status: "success",
  });
  vi.mocked(old.getTransaction).mockResolvedValue({
    ...transaction,
    blockNumber: 100n,
  });
  await expect(recoverCollectorTransactionHash(input(old))).rejects.toThrow(
    "preflight block",
  );
  const clock = reader();
  vi.mocked(clock.getBlock).mockResolvedValue({ timestamp: 139n, hash });
  await expect(recoverCollectorTransactionHash(input(clock))).rejects.toThrow(
    "predates",
  );
  const pending = reader();
  vi.mocked(pending.getTransactionReceipt).mockRejectedValue(
    new Error("receipt not found"),
  );
  await expect(
    recoverCollectorTransactionHash(input(pending)),
  ).rejects.toThrow();
});

it("leaves legacy records blocked rather than accepting an arbitrary confirmed hash", async () => {
  const legacy = {
    operationId: metadata.operationId,
    actionType: metadata.actionType,
    identityIds: metadata.identityIds,
    affectedIdentityIds: metadata.affectedIdentityIds,
    createdAt: metadata.createdAt,
  };
  const rpc = reader();
  await expect(
    recoverCollectorTransactionHash({ ...input(rpc), metadata: legacy }),
  ).rejects.toThrow("older attempt");
  expect(rpc.getTransaction).not.toHaveBeenCalled();
});

it("rejects an orphan receipt even when its old block remains queryable", async () => {
  const rpc = reader();
  vi.mocked(rpc.getBlock).mockResolvedValue({
    timestamp: 201n,
    hash: `0x${"44".repeat(32)}`,
  } as Awaited<ReturnType<CollectorRecoveryReader["getBlock"]>>);
  await expect(recoverCollectorTransactionHash(input(rpc))).rejects.toThrow(
    "canonical",
  );
});

it("keeps the manual proof marker when an old wallet callback arrives", () => {
  const recovered = { ...metadata, recoveredHash: hash };
  writeCollectorTransaction(
    "scope",
    { status: "outcome-unknown", hash, label: "Launch", message: "Checking" },
    { kind: "action" },
    recovered,
    true,
  );
  writeCollectorTransaction(
    "scope",
    { status: "confirmed", hash, label: "Launch" },
    { kind: "action" },
    metadata,
  );
  expect(readCollectorTransaction("scope")).toMatchObject({
    recoveredHash: hash,
    state: { status: "outcome-unknown" },
  });
});
