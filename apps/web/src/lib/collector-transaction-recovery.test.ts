/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import { keccak256, type Hash } from "viem";
import {
  readCollectorTransaction,
  writeCollectorTransaction,
  type CollectorTransactionMetadata,
} from "./collector-transaction-record";
import {
  recoverCollectorTransactionHash,
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
