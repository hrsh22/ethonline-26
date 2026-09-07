// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  readCollectorTransaction,
  readCompletedCollectorTransactions,
  writeCollectorTransaction,
} from "./collector-transaction-record";

const hash = `0x${"12".repeat(32)}` as const;
const metadata = {
  operationId: "operation-1",
  identityIds: [42],
  affectedIdentityIds: [42],
  actionType: "commit-collectible",
  createdAt: 1,
};
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("restores only receipt evidence in its wallet and deployment scope", () => {
  writeCollectorTransaction(
    "deployment:wallet-a",
    { status: "submitted", label: "Launch #42", hash },
    { kind: "action" },
    metadata,
    true,
  );
  expect(readCollectorTransaction("deployment:wallet-a")).toMatchObject({
    state: { status: "outcome-unknown", hash },
    identityIds: [42],
  });
  expect(readCollectorTransaction("deployment:wallet-b")).toBeUndefined();
  expect(readCollectorTransaction("other-deployment:wallet-a")).toBeUndefined();
  writeCollectorTransaction(
    "deployment:wallet-a",
    { status: "idle" },
    undefined,
    metadata,
  );
  expect(readCollectorTransaction("deployment:wallet-a")).toMatchObject({
    state: { status: "idle" },
    identityIds: [42],
  });
});

it("keeps an interrupted wallet prompt locked and an approval separate from a purchase", () => {
  writeCollectorTransaction(
    "scope",
    { status: "simulated", label: "Approve WETH" },
    { kind: "approval" },
    metadata,
    true,
  );
  expect(readCollectorTransaction("scope")).toMatchObject({
    state: { status: "submission-unknown" },
    phase: { kind: "approval" },
  });
  writeCollectorTransaction(
    "scope",
    {
      status: "submitted",
      label: "Approve WETH",
      hash,
      replacement: "cancelled",
    },
    { kind: "approval" },
    metadata,
  );
  expect(readCollectorTransaction("scope")).toMatchObject({
    state: { status: "outcome-unknown", hash, replacement: "cancelled" },
    phase: { kind: "approval" },
  });
});

it("does not let a late old operation replace a newer authorized record", () => {
  const next = { ...metadata, operationId: "operation-2" };
  writeCollectorTransaction(
    "scope",
    { status: "simulated", label: "New review" },
    undefined,
    next,
    true,
  );
  writeCollectorTransaction(
    "scope",
    { status: "confirmed", label: "Old review", hash },
    undefined,
    metadata,
  );
  expect(readCollectorTransaction("scope")).toMatchObject({
    operationId: "operation-2",
    state: { status: "submission-unknown", label: "New review" },
  });
});

it("ignores malformed evidence and reports unavailable storage without throwing", () => {
  writeCollectorTransaction(
    "scope",
    { status: "submitted", label: "Launch", hash },
    undefined,
    metadata,
    true,
  );
  const key = localStorage.key(0)!;
  localStorage.setItem(key, "{broken");
  expect(readCollectorTransaction("scope")).toBeUndefined();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      state: { status: "submitted", label: "Launch", hash: "0x12" },
      phase: { kind: "action" },
      savedAt: 1,
      ...metadata,
    }),
  );
  expect(readCollectorTransaction("scope")).toBeUndefined();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  expect(
    writeCollectorTransaction(
      "scope",
      { status: "submitted", label: "Launch", hash },
      undefined,
      metadata,
      true,
    ),
  ).toBe(false);
});

it("retains one completed entry after another operation and dismissal, scoped to the same wallet", () => {
  writeCollectorTransaction(
    "scope",
    { status: "confirmed", label: "Launch #42", hash },
    { kind: "action" },
    metadata,
    true,
  );
  writeCollectorTransaction(
    "scope",
    { status: "confirmed", label: "Launch #42", hash },
    { kind: "action" },
    metadata,
  );
  const next = { ...metadata, operationId: "operation-2", actionType: "claim" };
  writeCollectorTransaction(
    "scope",
    { status: "pending", label: "Claim" },
    undefined,
    next,
    true,
  );
  writeCollectorTransaction("scope", { status: "idle" }, undefined, next);
  expect(readCompletedCollectorTransactions("scope")).toHaveLength(1);
  expect(readCompletedCollectorTransactions("scope")[0]).toMatchObject({
    operationId: "operation-1",
    state: { hash, label: "Launch #42" },
  });
  expect(readCompletedCollectorTransactions("other-wallet")).toEqual([]);
});

it("saves the newly observed outcome when restored record metadata also contains its old envelope", () => {
  writeCollectorTransaction(
    "scope",
    { status: "submitted", label: "Launch #42", hash },
    { kind: "action" },
    metadata,
    true,
  );
  const restored = readCollectorTransaction("scope")!;
  writeCollectorTransaction(
    "scope",
    { status: "confirmed", label: "Launch #42", hash },
    { kind: "action" },
    restored,
  );
  expect(readCollectorTransaction("scope")?.state.status).toBe("confirmed");
  expect(readCompletedCollectorTransactions("scope")).toHaveLength(1);
});
