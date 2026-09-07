import { describe, expect, it, vi } from "vitest";

import {
  executeProtocolTransaction,
  refetchUntilObservedBlock,
  RevertedProtocolTransactionError,
  UnknownProtocolTransactionOutcomeError,
} from "./transaction-execution";

const hash = `0x${"12".repeat(32)}` as const;

describe("protocol transaction execution", () => {
  it("retains a wallet cancellation hash without confirming the original action", async () => {
    const replacementHash = `0x${"34".repeat(32)}` as const;
    const states: { status: string; hash?: string }[] = [];
    await expect(
      executeProtocolTransaction({
        estimateGas: async () => 100_000n,
        failureStep: { current: "readiness" },
        label: "Launch #1639",
        onState: (state) => states.push(state),
        outcomeUnknownMessage: "Checking receipt",
        simulate: async () => undefined,
        submit: async () => hash,
        waitForReceipt: async (_hash, onReplacement) => {
          onReplacement(replacementHash, "cancelled");
          return { blockNumber: 100n, status: "success" };
        },
      }),
    ).rejects.toMatchObject({
      name: "ReplacedProtocolTransactionError",
      hash: replacementHash,
      reason: "cancelled",
    });
    expect(states.at(-1)).toMatchObject({ hash: replacementHash });
    expect(states.some((state) => state.status === "confirmed")).toBe(false);
  });

  it("submits with a gas safety margin and confirms a successful receipt", async () => {
    const states: string[] = [];
    const failureStep = { current: "client readiness" };
    const submit = vi.fn(async () => hash);

    const result = await executeProtocolTransaction({
      estimateGas: async () => 642_103n,
      failureStep,
      label: "Buy $FUEL",
      onState: (state) => states.push(state.status),
      outcomeUnknownMessage: "Submitted outcome unknown.",
      simulate: async () => undefined,
      submit,
      waitForReceipt: async () => ({
        blockNumber: 4_613_162n,
        status: "success",
      }),
    });

    expect(submit).toHaveBeenCalledWith(802_629n);
    expect(states).toEqual(["pending", "simulated", "submitted", "confirmed"]);
    expect(result).toMatchObject({
      blockNumber: 4_613_162n,
      state: { status: "confirmed", hash },
    });
    expect(failureStep.current).toBe("Buy $FUEL confirmation");
  });

  it("rejects a reverted receipt without emitting a confirmed state", async () => {
    const states: string[] = [];

    await expect(
      executeProtocolTransaction({
        estimateGas: async () => 500_000n,
        failureStep: { current: "client readiness" },
        label: "Buy $FUEL",
        onState: (state) => states.push(state.status),
        outcomeUnknownMessage: "Submitted outcome unknown.",
        simulate: async () => undefined,
        submit: async () => hash,
        waitForReceipt: async () => ({
          blockNumber: 4_613_162n,
          status: "reverted",
        }),
      }),
    ).rejects.toEqual(new RevertedProtocolTransactionError(hash));

    expect(states).toEqual(["pending", "simulated", "submitted"]);
  });

  it("retains a submitted hash for reconciliation when the receipt read fails", async () => {
    const states: string[] = [];
    const receiptFailure = new Error("rpc timed out");

    await expect(
      executeProtocolTransaction({
        estimateGas: async () => 500_000n,
        failureStep: { current: "client readiness" },
        label: "Buy $FUEL",
        onState: (state) => states.push(state.status),
        outcomeUnknownMessage: "Submitted outcome unknown.",
        simulate: async () => undefined,
        submit: async () => hash,
        waitForReceipt: async () => {
          throw receiptFailure;
        },
      }),
    ).rejects.toMatchObject({
      name: "UnknownProtocolTransactionOutcomeError",
      hash,
      cause: receiptFailure,
    } satisfies Partial<UnknownProtocolTransactionOutcomeError>);

    expect(states).toEqual([
      "pending",
      "simulated",
      "submitted",
      "outcome-unknown",
    ]);
  });

  it.each([
    ["unknown status", () => ({ blockNumber: 4_613_162n, status: undefined })],
    ["negative block", () => ({ blockNumber: -1n, status: "success" })],
    [
      "throwing status getter",
      () =>
        new Proxy(
          { blockNumber: 4_613_162n, status: "success" },
          {
            get(target, property, receiver) {
              if (property === "status") throw new Error("hostile getter");
              return Reflect.get(target, property, receiver);
            },
          },
        ),
    ],
  ] as const)(
    "keeps a submitted hash reconcilable for a receipt with %s",
    async (_case, createReceipt) => {
      const states: string[] = [];

      await expect(
        executeProtocolTransaction({
          estimateGas: async () => 500_000n,
          failureStep: { current: "client readiness" },
          label: "Buy $FUEL",
          onState: (state) => states.push(state.status),
          outcomeUnknownMessage: "Submitted outcome unknown.",
          simulate: async () => undefined,
          submit: async () => hash,
          waitForReceipt: async () => createReceipt() as never,
        }),
      ).rejects.toMatchObject({
        name: "UnknownProtocolTransactionOutcomeError",
        hash,
      });

      expect(states).toEqual([
        "pending",
        "simulated",
        "submitted",
        "outcome-unknown",
      ]);
    },
  );

  it("retries a stale wallet read until it includes the confirmed block", async () => {
    const pause = vi.fn(async () => undefined);
    const refetch = vi
      .fn<() => Promise<{ readonly observedBlock: bigint }>>()
      .mockResolvedValueOnce({ observedBlock: 99n })
      .mockResolvedValueOnce({ observedBlock: 100n });

    const result = await refetchUntilObservedBlock({
      minimumBlock: 100n,
      pause,
      refetch,
    });

    expect(result).toEqual({
      status: "caught-up",
      snapshot: { observedBlock: 100n },
    });
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("reports a stale confirmed-block read instead of silently accepting it", async () => {
    const refetch = vi.fn(async () => ({ observedBlock: 99n }));

    const result = await refetchUntilObservedBlock({
      minimumBlock: 100n,
      pause: async () => undefined,
      refetch,
    });

    expect(result).toEqual({
      status: "stale",
      snapshot: { observedBlock: 99n },
    });
    expect(refetch).toHaveBeenCalledTimes(4);
  });
});
