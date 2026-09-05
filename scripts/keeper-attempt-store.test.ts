import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openKeeperAttemptStore,
  type KeeperAttemptStoreIdentity,
} from "./history-indexer/keeper-attempt-store.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-keeper-attempts-"));
  temporaryDirectories.push(directory);
  return join(directory, "attempts.sqlite");
};

const identity: KeeperAttemptStoreIdentity = {
  chainId: 84_532,
  manifestFingerprint: `0x${"1".repeat(64)}`,
};

const transactionHash = `0x${"2".repeat(64)}` as const;
const blockHash = `0x${"3".repeat(64)}` as const;

describe("keeper attempt store", () => {
  it("distinguishes missing, incomplete, and stale runs without inventing track outcomes", () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    expect(
      store.readEvidence({ currentTime: 10n, maximumAgeSeconds: 30n }),
    ).toMatchObject({
      state: "unavailable",
      tracks: { 1: { state: "unknown" }, 4: { state: "unknown" } },
    });

    store.startRun({
      runId: "fresh-run",
      observedBlock: 10n,
      observedAt: 100n,
      recordedAt: 10n,
    });
    expect(
      store.readEvidence({ currentTime: 11n, maximumAgeSeconds: 30n }),
    ).toMatchObject({ state: "incomplete", coverage: { 1: "partial" } });

    for (const track of [1, 2, 3, 4] as const) {
      store.recordAttempt({
        attemptId: `stale-${track}`,
        runId: "fresh-run",
        actionKind: "reward-track",
        track,
        observedBlock: 10n,
        observedAt: 100n,
        recordedAt: 11n,
        outcome: "not-required",
      });
    }
    store.completeRun({
      runId: "fresh-run",
      observedBlock: 10n,
      observedAt: 100n,
      recordedAt: 12n,
    });
    expect(
      store.readEvidence({ currentTime: 43n, maximumAgeSeconds: 30n }),
    ).toMatchObject({
      state: "stale",
      coverage: { 1: "partial", 2: "partial", 3: "partial", 4: "partial" },
      tracks: {
        1: { state: "unknown" },
        2: { state: "unknown" },
        3: { state: "unknown" },
        4: { state: "unknown" },
      },
    });
    store.close();
  });

  it("accepts at-least-once lifecycle delivery without duplicating a run", () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    const started = {
      runId: "retried-run",
      observedBlock: 10n,
      observedAt: 100n,
      recordedAt: 10n,
    } as const;
    store.startRun(started);
    store.startRun({ ...started, recordedAt: 11n });
    for (const track of [1, 2, 3, 4] as const) {
      store.recordAttempt({
        attemptId: `retried-${track}`,
        runId: started.runId,
        actionKind: "reward-track",
        track,
        observedBlock: 10n,
        observedAt: 100n,
        recordedAt: 12n,
        outcome: "not-required",
      });
    }
    const completed = {
      runId: started.runId,
      observedBlock: 11n,
      observedAt: 101n,
      recordedAt: 13n,
    } as const;
    store.completeRun(completed);
    store.completeRun({ ...completed, recordedAt: 14n });

    expect(
      store.readEvidence({ currentTime: 15n, maximumAgeSeconds: 30n }).state,
    ).toBe("fresh");
    store.close();
  });

  it("uses the older of chain observation and ingestion time for freshness", () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    store.startRun({
      runId: "delayed-run",
      observedBlock: 40n,
      observedAt: 10n,
      recordedAt: 990n,
    });
    for (const track of [1, 2, 3, 4] as const) {
      store.recordAttempt({
        attemptId: `delayed-${track}`,
        runId: "delayed-run",
        actionKind: "reward-track",
        track,
        observedBlock: 40n,
        observedAt: 10n,
        recordedAt: 991n,
        outcome: "not-required",
      });
    }
    store.completeRun({
      runId: "delayed-run",
      observedBlock: 40n,
      observedAt: 10n,
      recordedAt: 995n,
    });

    expect(
      store.readEvidence({ currentTime: 1_000n, maximumAgeSeconds: 30n }),
    ).toMatchObject({
      state: "stale",
      freshness: {
        observedAt: 10n,
        recordedAt: 995n,
        ageSeconds: 990n,
      },
    });
    store.close();
  });

  it("rejects impossible action and outcome evidence", () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    store.startRun({
      runId: "invalid-run",
      observedBlock: 20n,
      observedAt: 200n,
      recordedAt: 20n,
    });

    expect(() =>
      store.recordAttempt({
        attemptId: "missing-hash",
        runId: "invalid-run",
        actionKind: "reward-track",
        track: 1,
        observedBlock: 20n,
        observedAt: 200n,
        recordedAt: 21n,
        outcome: "pending",
      }),
    ).toThrow("invalid transaction evidence");
    expect(() =>
      store.recordAttempt({
        attemptId: "missing-failure",
        runId: "invalid-run",
        actionKind: "reward-track",
        track: 1,
        observedBlock: 20n,
        observedAt: 200n,
        recordedAt: 21n,
        outcome: "failed-before-submission",
      }),
    ).toThrow("requires a failure class");
    expect(() =>
      store.recordAttempt({
        attemptId: "wrong-track-kind",
        runId: "invalid-run",
        actionKind: "protocol-liquidity",
        track: 1,
        observedBlock: 20n,
        observedAt: 200n,
        recordedAt: 21n,
        outcome: "not-required",
      }),
    ).toThrow("Only Reward Track attempts");
    store.close();
  });

  it("bounds each run to one idempotent attempt per action slot", () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    store.startRun({
      runId: "multiple-attempts",
      observedBlock: 30n,
      observedAt: 300n,
      recordedAt: 30n,
    });
    store.recordAttempt({
      attemptId: "first-track-1",
      runId: "multiple-attempts",
      actionKind: "reward-track",
      track: 1,
      observedBlock: 30n,
      observedAt: 300n,
      recordedAt: 31n,
      outcome: "not-required",
    });

    expect(() =>
      store.recordAttempt({
        attemptId: "second-track-1",
        runId: "multiple-attempts",
        actionKind: "reward-track",
        track: 1,
        observedBlock: 30n,
        observedAt: 300n,
        recordedAt: 32n,
        outcome: "failed-before-submission",
        failureClass: "quote-unavailable",
      }),
    ).toThrow("action slot already has an attempt");
    store.close();
  });

  it("persists one complete run across restart and rotates its served generation", () => {
    const path = temporaryDatabasePath();
    let store = openKeeperAttemptStore(path, identity);
    const firstGeneration = store.readEvidence({
      currentTime: 100n,
      maximumAgeSeconds: 30n,
    }).generation;

    store.startRun({
      runId: "run-1",
      observedBlock: 100n,
      observedAt: 1_000n,
      recordedAt: 100n,
    });
    store.recordAttempt({
      attemptId: "track-1",
      runId: "run-1",
      actionKind: "reward-track",
      track: 1,
      observedBlock: 100n,
      observedAt: 1_000n,
      recordedAt: 101n,
      outcome: "not-required",
    });
    store.recordAttempt({
      attemptId: "track-2",
      runId: "run-1",
      actionKind: "reward-track",
      track: 2,
      observedBlock: 100n,
      observedAt: 1_000n,
      recordedAt: 102n,
      outcome: "failed-before-submission",
      failureClass: "quote-unavailable",
    });
    store.recordAttempt({
      attemptId: "track-3",
      runId: "run-1",
      actionKind: "reward-track",
      track: 3,
      observedBlock: 100n,
      observedAt: 1_000n,
      recordedAt: 103n,
      outcome: "simulated",
    });
    store.recordAttempt({
      attemptId: "track-4",
      runId: "run-1",
      actionKind: "reward-track",
      track: 4,
      observedBlock: 100n,
      observedAt: 1_000n,
      recordedAt: 104n,
      outcome: "succeeded",
      transactionHash,
      receipt: {
        blockNumber: 101n,
        blockHash,
        blockTimestamp: 1_001n,
      },
    });
    store.completeRun({
      runId: "run-1",
      observedBlock: 101n,
      observedAt: 1_001n,
      recordedAt: 105n,
    });

    const beforeRestart = store.readEvidence({
      currentTime: 120n,
      maximumAgeSeconds: 30n,
    });
    expect(beforeRestart).toMatchObject({
      source: "keeper-attempt-journal",
      state: "fresh",
      freshness: {
        observedAt: 1_001n,
        recordedAt: 105n,
        ageSeconds: 15n,
        maximumAgeSeconds: 30n,
      },
      coverage: { 1: "complete", 2: "complete", 3: "partial", 4: "complete" },
      tracks: {
        1: { state: "fresh", latest: { outcome: "not-required" } },
        2: {
          state: "retryable",
          latest: {
            outcome: "failed-before-submission",
            failureClass: "quote-unavailable",
          },
        },
        3: { state: "unknown", latest: { outcome: "simulated" } },
        4: {
          state: "fresh",
          latest: {
            outcome: "succeeded",
            transactionHash,
            receipt: { blockNumber: 101n, blockHash },
          },
        },
      },
    });
    store.close();

    store = openKeeperAttemptStore(path, identity);
    const afterRestart = store.readEvidence({
      currentTime: 120n,
      maximumAgeSeconds: 30n,
    });
    expect(afterRestart.generation).not.toBe(firstGeneration);
    expect(afterRestart).toMatchObject({
      state: "fresh",
      coverage: beforeRestart.coverage,
      tracks: beforeRestart.tracks,
    });
    store.close();
  });

  it("keeps a submitted transaction unknown while its receipt is pending", async () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    store.startRun({
      runId: "pending-run",
      observedBlock: 200n,
      observedAt: 2_000n,
      recordedAt: 200n,
    });
    for (const track of [2, 3, 4] as const) {
      store.recordAttempt({
        attemptId: `track-${track}`,
        runId: "pending-run",
        actionKind: "reward-track",
        track,
        observedBlock: 200n,
        observedAt: 2_000n,
        recordedAt: 201n,
        outcome: "not-required",
      });
    }
    store.recordAttempt({
      attemptId: "pending-track",
      runId: "pending-run",
      actionKind: "reward-track",
      track: 1,
      observedBlock: 200n,
      observedAt: 2_000n,
      recordedAt: 201n,
      outcome: "pending",
      transactionHash,
    });
    store.completeRun({
      runId: "pending-run",
      observedBlock: 200n,
      observedAt: 2_000n,
      recordedAt: 202n,
    });

    await store.reconcileReceipts({
      confirmationBlocks: 12n,
      concurrency: 2,
      source: {
        getReceipt: async () => undefined,
        getHeader: async () => {
          throw new Error("A pending receipt has no block to inspect");
        },
      },
      observedBlock: 210n,
      recordedAt: 210n,
    });

    expect(
      store.readEvidence({
        currentTime: 211n,
        maximumAgeSeconds: 30n,
      }),
    ).toMatchObject({
      state: "fresh",
      coverage: { 1: "partial", 2: "complete", 3: "complete", 4: "complete" },
      tracks: {
        1: {
          state: "unknown",
          latest: {
            outcome: "pending",
            transactionHash,
            failureClass: "receipt-unavailable",
          },
        },
      },
    });
    store.close();
  });

  it("moves a receipt through reverted, reorged, and recovered canonical states", async () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    store.startRun({
      runId: "canonical-run",
      observedBlock: 300n,
      observedAt: 3_000n,
      recordedAt: 300n,
    });
    for (const track of [2, 3, 4] as const) {
      store.recordAttempt({
        attemptId: `canonical-${track}`,
        runId: "canonical-run",
        actionKind: "reward-track",
        track,
        observedBlock: 300n,
        observedAt: 3_000n,
        recordedAt: 301n,
        outcome: "not-required",
      });
    }
    store.recordAttempt({
      attemptId: "canonical-track-1",
      runId: "canonical-run",
      actionKind: "reward-track",
      track: 1,
      observedBlock: 300n,
      observedAt: 3_000n,
      recordedAt: 301n,
      outcome: "pending",
      transactionHash,
    });
    store.completeRun({
      runId: "canonical-run",
      observedBlock: 300n,
      observedAt: 3_000n,
      recordedAt: 302n,
    });

    let receiptStatus: "success" | "reverted" = "reverted";
    let canonicalHash = blockHash;
    let receiptReads = 0;
    const receiptSource = {
      getReceipt: async () => {
        receiptReads += 1;
        return {
          status: receiptStatus,
          blockNumber: 301n,
          blockHash,
        };
      },
      getHeader: async () => ({
        blockNumber: 301n,
        blockHash: canonicalHash,
        blockTimestamp: 3_001n,
      }),
    } as const;

    await store.reconcileReceipts({
      confirmationBlocks: 12n,
      concurrency: 2,
      source: receiptSource,
      observedBlock: 310n,
      recordedAt: 303n,
    });
    expect(
      store.readEvidence({ currentTime: 304n, maximumAgeSeconds: 30n })
        .tracks[1],
    ).toMatchObject({
      state: "retryable",
      latest: {
        outcome: "reverted",
        failureClass: "execution-reverted",
        receipt: { blockNumber: 301n, blockHash },
      },
    });

    canonicalHash = `0x${"4".repeat(64)}`;
    await store.reconcileReceipts({
      confirmationBlocks: 12n,
      concurrency: 2,
      source: receiptSource,
      observedBlock: 311n,
      recordedAt: 305n,
    });
    expect(
      store.readEvidence({ currentTime: 306n, maximumAgeSeconds: 30n })
        .tracks[1],
    ).toMatchObject({
      state: "unknown",
      latest: {
        outcome: "reorged",
        failureClass: "canonicality-uncertain",
      },
    });

    receiptStatus = "success";
    canonicalHash = blockHash;
    await store.reconcileReceipts({
      confirmationBlocks: 12n,
      concurrency: 2,
      source: receiptSource,
      observedBlock: 312n,
      recordedAt: 307n,
    });
    const recovered = store.readEvidence({
      currentTime: 308n,
      maximumAgeSeconds: 30n,
    }).tracks[1];
    expect(recovered).toMatchObject({
      state: "fresh",
      latest: { outcome: "succeeded" },
    });
    expect(recovered.latest).not.toHaveProperty("failureClass");

    store.recordAttempt({
      attemptId: "canonical-track-1",
      runId: "canonical-run",
      actionKind: "reward-track",
      track: 1,
      observedBlock: 300n,
      observedAt: 3_000n,
      recordedAt: 308n,
      outcome: "pending",
      transactionHash,
    });
    expect(
      store.readEvidence({ currentTime: 308n, maximumAgeSeconds: 30n })
        .tracks[1],
    ).toMatchObject({ state: "fresh", latest: { outcome: "succeeded" } });

    await store.reconcileReceipts({
      confirmationBlocks: 12n,
      concurrency: 2,
      source: receiptSource,
      observedBlock: 313n,
      recordedAt: 309n,
    });
    expect(receiptReads).toBe(3);
    store.close();
  });

  // Every attempt and reconciliation is a durable commit, and the journal runs
  // `synchronous = FULL` because a signed transaction hash must survive a crash.
  // Two full 100-hash batches are therefore ~400 fsyncs, which fits the 5s
  // default on a local SSD and does not on a shared CI disk.
  it(
    "rotates failed receipt checks so a full batch cannot starve newer hashes",
    { timeout: 60_000 },
    async () => {
      const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
      const hashes: `0x${string}`[] = [];
      for (let index = 1; index <= 101; index += 1) {
        const hash =
          `0x${BigInt(index).toString(16).padStart(64, "0")}` as const;
        hashes.push(hash);
        store.startRun({
          runId: `fair-run-${index}`,
          observedBlock: 500n,
          observedAt: 5_000n,
          recordedAt: BigInt(index),
        });
        store.recordAttempt({
          attemptId: `fair-attempt-${index}`,
          runId: `fair-run-${index}`,
          actionKind: "reward-track",
          track: 1,
          observedBlock: 500n,
          observedAt: 5_000n,
          recordedAt: BigInt(index),
          outcome: "pending",
          transactionHash: hash,
        });
      }
      const observed = new Set<string>();
      const input = {
        confirmationBlocks: 12n,
        concurrency: 8,
        source: {
          getReceipt: async (hash: `0x${string}`) => {
            observed.add(hash);
            throw new Error("RPC unavailable");
          },
          getHeader: async () => {
            throw new Error("No receipt header is available");
          },
        },
        observedBlock: 510n,
        recordedAt: 1_000n,
      } as const;

      await expect(store.reconcileReceipts(input)).rejects.toThrow(
        "100 keeper receipt reconciliation(s) failed",
      );
      expect(observed.has(hashes[100]!)).toBe(false);
      await expect(
        store.reconcileReceipts({ ...input, recordedAt: 1_001n }),
      ).rejects.toThrow("100 keeper receipt reconciliation(s) failed");
      expect(observed.has(hashes[100]!)).toBe(true);
      store.close();
    },
  );

  it("persists successful reconciliations when another receipt source fails", async () => {
    const store = openKeeperAttemptStore(temporaryDatabasePath(), identity);
    const secondTransactionHash = `0x${"5".repeat(64)}` as const;
    store.startRun({
      runId: "partial-reconciliation",
      observedBlock: 400n,
      observedAt: 4_000n,
      recordedAt: 400n,
    });
    for (const [track, hash] of [
      [1, transactionHash],
      [2, secondTransactionHash],
    ] as const) {
      store.recordAttempt({
        attemptId: `pending-${track}`,
        runId: "partial-reconciliation",
        actionKind: "reward-track",
        track,
        observedBlock: 400n,
        observedAt: 4_000n,
        recordedAt: 401n,
        outcome: "pending",
        transactionHash: hash,
      });
    }
    for (const track of [3, 4] as const) {
      store.recordAttempt({
        attemptId: `clear-${track}`,
        runId: "partial-reconciliation",
        actionKind: "reward-track",
        track,
        observedBlock: 400n,
        observedAt: 4_000n,
        recordedAt: 401n,
        outcome: "not-required",
      });
    }
    store.completeRun({
      runId: "partial-reconciliation",
      observedBlock: 400n,
      observedAt: 4_000n,
      recordedAt: 402n,
    });

    await expect(
      store.reconcileReceipts({
        confirmationBlocks: 12n,
        concurrency: 2,
        source: {
          getReceipt: async (hash) => {
            if (hash === transactionHash) throw new Error("RPC unavailable");
            return {
              status: "success",
              blockNumber: 401n,
              blockHash,
            };
          },
          getHeader: async () => ({
            blockNumber: 401n,
            blockHash,
            blockTimestamp: 4_001n,
          }),
        },
        observedBlock: 410n,
        recordedAt: 403n,
      }),
    ).rejects.toThrow("1 keeper receipt reconciliation(s) failed");

    const evidence = store.readEvidence({
      currentTime: 404n,
      maximumAgeSeconds: 30n,
    });
    expect(evidence.tracks[1]).toMatchObject({
      state: "unknown",
      latest: { outcome: "pending" },
    });
    expect(evidence.tracks[2]).toMatchObject({
      state: "fresh",
      latest: { outcome: "succeeded" },
    });
    store.close();
  });
});
