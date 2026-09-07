import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { KeeperAttemptRecorder } from "./keeper-attempt-client.ts";
import {
  deliverSubmittedKeeperAttempt,
  openKeeperAttemptOutbox,
  replayKeeperAttemptOutbox,
  type PendingKeeperAttemptMilestone,
} from "./keeper-attempt-outbox.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-keeper-outbox-"));
  temporaryDirectories.push(directory);
  return join(directory, "outbox.sqlite");
};

const identity = {
  chainId: 84_532,
  manifestFingerprint: `0x${"1".repeat(64)}`,
} as const;

const milestone: PendingKeeperAttemptMilestone = {
  type: "attempt-observed",
  attemptId: "run-1:reward-track-2",
  runId: "run-1",
  actionKind: "reward-track",
  track: 2,
  observedBlock: 100n,
  observedAt: 1_000n,
  outcome: "pending",
  transactionHash: `0x${"2".repeat(64)}`,
};

const runStarted = {
  type: "run-started",
  runId: "run-1",
  observedBlock: 90n,
  observedAt: 900n,
} as const;

const delivery = { runStarted, attempt: milestone } as const;

const recorder = (
  observeAttempt: KeeperAttemptRecorder["observeAttempt"],
): KeeperAttemptRecorder => ({
  startRun: vi.fn(async () => undefined),
  observeAttempt,
  completeRun: vi.fn(async () => undefined),
});

describe("keeper-attempt durable outbox", () => {
  it("bounds retained replacement evidence to the latest twenty proofs", () => {
    const outbox = openKeeperAttemptOutbox(temporaryDatabasePath(), identity);
    for (let id = 1; id <= 21; id += 1)
      outbox.recordReplacement({
        transactionHash: `0x${id.toString(16).padStart(64, "0")}`,
        replacementHash: `0x${"7".repeat(64)}`,
        blockNumber: BigInt(id),
      });
    expect(outbox.replacements()).toHaveLength(20);
    expect(outbox.replacements()[0]?.blockNumber).toBe(2n);
    outbox.close();
  });

  it("retains canonical replacement proof across row resolution and restart", () => {
    const path = temporaryDatabasePath();
    const proof = {
      transactionHash: milestone.transactionHash,
      replacementHash: `0x${"7".repeat(64)}` as const,
      blockNumber: 120n,
    };
    const outbox = openKeeperAttemptOutbox(path, identity);
    outbox.enqueue(delivery, 1000n);
    outbox.recordReplacement(proof);
    outbox.resolve(milestone.attemptId, milestone.transactionHash);
    outbox.close();
    const restarted = openKeeperAttemptOutbox(path, identity);
    expect(restarted.unresolved()).toEqual([]);
    expect(restarted.replacements()).toEqual([proof]);
    restarted.close();
  });

  it("recovers the exact signed transaction after a crash before broadcast", async () => {
    const path = temporaryDatabasePath();
    const rawTransaction = await privateKeyToAccount(
      `0x${"44".repeat(32)}`,
    ).signTransaction({
      chainId: 84532,
      nonce: 7,
      to: "0x0000000000000000000000000000000000000001",
      gas: 21_000n,
      gasPrice: 1n,
      value: 0n,
    });
    const prepared = {
      ...delivery,
      rawTransaction,
      attempt: { ...milestone, transactionHash: keccak256(rawTransaction) },
    };
    const first = openKeeperAttemptOutbox(path, identity);
    first.enqueue(prepared, 10n);
    first.close();
    const restarted = openKeeperAttemptOutbox(path, identity);
    try {
      expect(restarted.unresolved()).toEqual([prepared]);
    } finally {
      restarted.close();
    }
  });

  it("retains discovery transactions in the same signing gate without publishing Keeper milestones", async () => {
    const path = temporaryDatabasePath();
    const raw = await privateKeyToAccount(
      `0x${"44".repeat(32)}`,
    ).signTransaction({
      chainId: 84532,
      nonce: 8,
      to: "0x0000000000000000000000000000000000000001",
      gas: 21_000n,
      gasPrice: 1n,
    });
    const first = openKeeperAttemptOutbox(path, identity);
    first.enqueueLocalSubmission(raw);
    first.close();
    const restarted = openKeeperAttemptOutbox(path, identity);
    try {
      expect(restarted.localSubmissions()).toEqual([
        { transactionHash: keccak256(raw), rawTransaction: raw },
      ]);
      expect(restarted.pendingDeliveries()).toEqual([]);
      restarted.resolveLocalSubmission(keccak256(raw));
      expect(restarted.localSubmissions()).toEqual([]);
    } finally {
      restarted.close();
    }
  });
  it("persists an unacknowledged hash across restart and replays it idempotently", async () => {
    const path = temporaryDatabasePath();
    let outbox = openKeeperAttemptOutbox(path, identity);
    const unavailable = recorder(async () => {
      throw new Error("history ingestion unavailable");
    });

    await expect(
      deliverSubmittedKeeperAttempt(outbox, unavailable, delivery, 10n),
    ).rejects.toThrow("history ingestion unavailable");
    expect(outbox.pendingDeliveries()).toEqual([delivery]);
    outbox.close();

    outbox = openKeeperAttemptOutbox(path, identity);
    outbox.enqueue(delivery, 11n);
    expect(outbox.pendingDeliveries()).toHaveLength(1);
    const recovered = recorder(vi.fn(async () => undefined));
    await replayKeeperAttemptOutbox(outbox, recovered);

    expect(recovered.startRun).toHaveBeenCalledWith(runStarted);
    expect(recovered.observeAttempt).toHaveBeenCalledWith(milestone);
    expect(outbox.pendingDeliveries()).toEqual([]);
    expect(outbox.unresolved()).toEqual([delivery]);
    outbox.close();
  });

  it("retains an acknowledged delivery until the exact attempt and hash are resolved", async () => {
    const outbox = openKeeperAttemptOutbox(temporaryDatabasePath(), identity);
    const available = recorder(async () => undefined);

    await deliverSubmittedKeeperAttempt(outbox, available, delivery, 10n);

    expect(outbox.pendingDeliveries()).toEqual([]);
    expect(outbox.unresolved()).toEqual([delivery]);
    outbox.resolve(delivery.attempt.attemptId, `0x${"3".repeat(64)}`);
    expect(outbox.unresolved()).toEqual([delivery]);
    outbox.resolve(
      delivery.attempt.attemptId,
      delivery.attempt.transactionHash,
    );
    expect(outbox.unresolved()).toEqual([]);
    outbox.close();
  });

  it("rejects a second attempt for the same logical action slot", () => {
    const outbox = openKeeperAttemptOutbox(temporaryDatabasePath(), identity);
    outbox.enqueue(delivery, 10n);

    expect(() =>
      outbox.enqueue(
        {
          ...delivery,
          attempt: { ...milestone, attemptId: "run-1:reward-track-2-retry" },
        },
        11n,
      ),
    ).toThrow("action slot already has an attempt");
    outbox.close();
  });

  it("migrates v2 rows without dropping the durable attempt", () => {
    const path = temporaryDatabasePath();
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE outbox_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE submitted_attempts (
        attempt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        action_kind TEXT NOT NULL,
        track INTEGER,
        run_observed_block INTEGER NOT NULL,
        run_observed_at INTEGER NOT NULL,
        observed_block INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      INSERT INTO outbox_metadata VALUES ('schema_version', '2');
      INSERT INTO outbox_metadata VALUES ('chain_id', '84532');
      INSERT INTO outbox_metadata VALUES ('manifest_fingerprint', '0x${"1".repeat(64)}');
    `);
    database
      .prepare(
        `
      INSERT INTO submitted_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        milestone.attemptId,
        milestone.runId,
        milestone.actionKind,
        milestone.track as number,
        runStarted.observedBlock,
        runStarted.observedAt,
        milestone.observedBlock,
        milestone.observedAt,
        milestone.transactionHash,
        10n,
      );
    database.close();

    const outbox = openKeeperAttemptOutbox(path, identity);
    expect(outbox.unresolved()).toEqual([delivery]);
    expect(outbox.pendingDeliveries()).toEqual([delivery]);
    outbox.close();
  });

  it("rejects identity changes for the same durable attempt", () => {
    const outbox = openKeeperAttemptOutbox(temporaryDatabasePath(), identity);
    outbox.enqueue(delivery, 10n);

    expect(() =>
      outbox.enqueue(
        {
          ...delivery,
          attempt: {
            ...milestone,
            transactionHash: `0x${"3".repeat(64)}`,
          },
        },
        11n,
      ),
    ).toThrow("identity cannot change");
    outbox.close();
  });
});
