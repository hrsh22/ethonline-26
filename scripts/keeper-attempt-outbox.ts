import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { chmodSync } from "node:fs";

import { Effect, Scope, Schema } from "effect";
import { keccak256, parseTransaction, type Hex } from "viem";

import type {
  KeeperAttemptMilestone,
  KeeperAttemptRecorder,
  KeeperRunStartedMilestone,
} from "./keeper-attempt-client.ts";
import type {
  KeeperActionKind,
  KeeperAttemptStoreIdentity,
  KeeperTrack,
} from "./history-indexer/keeper-attempt-store.ts";
import { configureSqlite, verifySqliteIntegrity } from "@orbit/config/sqlite";

const SCHEMA_VERSION = "4";

export type PendingKeeperAttemptMilestone = KeeperAttemptMilestone & {
  readonly outcome: "pending";
  readonly transactionHash: Hex;
};

export interface PendingKeeperAttemptDelivery {
  /** Signed transaction retained locally; never sent to the history journal. */
  readonly rawTransaction?: Hex;
  readonly runStarted: KeeperRunStartedMilestone;
  readonly attempt: PendingKeeperAttemptMilestone;
}

export interface KeeperReplacementEvidence {
  readonly transactionHash: Hex;
  readonly replacementHash: Hex;
  readonly blockNumber: bigint;
}
const replacementRecords = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      transactionHash: Schema.String,
      replacementHash: Schema.String,
      blockNumber: Schema.String,
    }),
  ),
);

export interface KeeperAttemptOutbox {
  readonly recordReplacement: (proof: KeeperReplacementEvidence) => void;
  readonly replacements: () => readonly KeeperReplacementEvidence[];
  readonly enqueueLocalSubmission: (rawTransaction: Hex) => void;
  readonly localSubmissions: () => readonly {
    readonly transactionHash: Hex;
    readonly rawTransaction: Hex;
  }[];
  readonly resolveLocalSubmission: (transactionHash: Hex) => void;
  readonly enqueue: (
    delivery: PendingKeeperAttemptDelivery,
    recordedAt: bigint,
  ) => void;
  /** Deliveries that have not yet been accepted by the journal. */
  readonly pendingDeliveries: () => readonly PendingKeeperAttemptDelivery[];
  /** Every broadcast attempt that has not reached a terminal chain outcome. */
  readonly unresolved: () => readonly PendingKeeperAttemptDelivery[];
  readonly acknowledge: (attemptId: string, transactionHash: Hex) => void;
  readonly resolve: (attemptId: string, transactionHash: Hex) => void;
  readonly close: () => void;
}

type SqliteRow = Readonly<Record<string, SQLOutputValue>>;

const text = (value: SQLOutputValue | undefined, label: string): string => {
  if (typeof value !== "string") throw new TypeError(`${label} is not text`);
  return value;
};

const optionalText = (
  value: SQLOutputValue | undefined,
  label: string,
): string | undefined =>
  value === null || value === undefined ? undefined : text(value, label);

const integer = (value: SQLOutputValue | undefined, label: string): bigint => {
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError(`${label} is not an integer`);
  }
  return BigInt(value);
};

const databaseInteger = (value: bigint, label: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} is outside the SQLite integer range`);
  }
  return Number(value);
};

const boundedIdentifier = (value: string, label: string): string => {
  if (value.length === 0 || value.length > 128) {
    throw new RangeError(`${label} must contain from 1 to 128 characters`);
  }
  return value;
};

const requireHash = (value: string, label: string): Hex => {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError(`${label} is not a 32-byte hash`);
  }
  return value as Hex;
};

const trackFrom = (
  value: SQLOutputValue | undefined,
): KeeperTrack | undefined => {
  if (value === null || value === undefined) return undefined;
  const track = Number(value);
  if (track !== 1 && track !== 2 && track !== 3 && track !== 4) {
    throw new TypeError("Outbox track is out of range");
  }
  return track;
};

const actionKindFrom = (value: string): KeeperActionKind => {
  if (
    value !== "reward-epoch" &&
    value !== "reward-track" &&
    value !== "protocol-liquidity"
  ) {
    throw new TypeError("Outbox action kind is unsupported");
  }
  return value;
};

const actionSlotFrom = (
  actionKind: KeeperActionKind,
  track: KeeperTrack | undefined,
): string => {
  if (actionKind === "reward-track") {
    if (track === undefined) throw new TypeError("Outbox track is required");
    return `${actionKind}:${track}`;
  }
  if (track !== undefined) {
    throw new TypeError("Outbox track is only valid for reward-track");
  }
  return actionKind;
};

const validateDelivery = (delivery: PendingKeeperAttemptDelivery): void => {
  const { attempt, runStarted } = delivery;
  boundedIdentifier(attempt.attemptId, "attemptId");
  boundedIdentifier(attempt.runId, "runId");
  boundedIdentifier(runStarted.runId, "runStarted.runId");
  if (attempt.runId !== runStarted.runId) {
    throw new TypeError("Outbox run and attempt identities are inconsistent");
  }
  requireHash(attempt.transactionHash, "transactionHash");
  databaseInteger(runStarted.observedBlock, "runStarted.observedBlock");
  databaseInteger(runStarted.observedAt, "runStarted.observedAt");
  databaseInteger(attempt.observedBlock, "observedBlock");
  databaseInteger(attempt.observedAt, "observedAt");
  if (
    (attempt.actionKind === "reward-track") !==
    (attempt.track !== undefined)
  ) {
    throw new TypeError("Outbox Reward Track identity is inconsistent");
  }
  actionSlotFrom(actionKindFrom(attempt.actionKind), attempt.track);
};

const migrateDatabase = (database: DatabaseSync): void => {
  const metadata = database.prepare(
    "SELECT value FROM outbox_metadata WHERE key = 'schema_version'",
  );
  const schemaVersion = optionalText(metadata.get()?.value, "schema_version");
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(submitted_attempts)")
      .all()
      .map((row) => String((row as Record<string, unknown>).name)),
  );
  if (
    schemaVersion !== undefined &&
    !["2", "3", SCHEMA_VERSION].includes(schemaVersion)
  ) {
    throw new Error(
      `Keeper attempt outbox schema mismatch: expected ${SCHEMA_VERSION}, observed ${schemaVersion}`,
    );
  }
  if (schemaVersion === SCHEMA_VERSION) return;
  for (const [name, definition] of [
    ["action_slot", "TEXT"],
    ["delivery_acknowledged", "INTEGER NOT NULL DEFAULT 0"],
    ["raw_transaction", "TEXT"],
  ] as const) {
    if (!columns.has(name))
      database.exec(
        `ALTER TABLE submitted_attempts ADD COLUMN ${name} ${definition}`,
      );
  }
  const rows = database
    .prepare("SELECT attempt_id, action_kind, track FROM submitted_attempts")
    .all();
  const update = database.prepare(
    "UPDATE submitted_attempts SET action_slot = ? WHERE attempt_id = ?",
  );
  for (const row of rows) {
    const actionKind = actionKindFrom(text(row.action_kind, "action_kind"));
    const track = trackFrom(row.track);
    update.run(
      actionSlotFrom(actionKind, track),
      text(row.attempt_id, "attempt_id"),
    );
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS submitted_attempts_slot_idx
      ON submitted_attempts (run_id, action_slot);
    UPDATE outbox_metadata SET value = '4' WHERE key = 'schema_version';
  `);
};

const initializeDatabase = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS outbox_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS submitted_attempts (
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
    ) STRICT;
    CREATE TABLE IF NOT EXISTS local_submissions (
      transaction_hash TEXT PRIMARY KEY,
      raw_transaction TEXT NOT NULL
    ) STRICT;
  `);
  migrateDatabase(database);
};

const expectedMetadata = (
  identity: KeeperAttemptStoreIdentity,
): Readonly<Record<string, string>> => ({
  schema_version: SCHEMA_VERSION,
  chain_id: identity.chainId.toString(),
  manifest_fingerprint: identity.manifestFingerprint,
});

const verifyMetadata = (
  database: DatabaseSync,
  identity: KeeperAttemptStoreIdentity,
): void => {
  const expected = expectedMetadata(identity);
  const count = Number(
    database.prepare("SELECT COUNT(*) AS count FROM outbox_metadata").get()
      ?.count ?? 0,
  );
  const select = database.prepare(
    "SELECT value FROM outbox_metadata WHERE key = ?",
  );
  const insert = database.prepare(
    "INSERT INTO outbox_metadata (key, value) VALUES (?, ?)",
  );
  if (count === 0) {
    for (const [key, value] of Object.entries(expected)) insert.run(key, value);
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    const actual = optionalText(select.get(key)?.value, key);
    if (actual !== value) {
      throw new Error(
        `Keeper attempt outbox ${key} mismatch: expected ${value}, observed ${actual ?? "missing"}`,
      );
    }
  }
};

const deliveryFromRow = (row: SqliteRow): PendingKeeperAttemptDelivery => {
  const track = trackFrom(row.track);
  return {
    ...(typeof row.raw_transaction === "string"
      ? { rawTransaction: row.raw_transaction as Hex }
      : {}),
    runStarted: {
      type: "run-started",
      runId: text(row.run_id, "run_id"),
      observedBlock: integer(row.run_observed_block, "run_observed_block"),
      observedAt: integer(row.run_observed_at, "run_observed_at"),
    },
    attempt: {
      type: "attempt-observed",
      attemptId: text(row.attempt_id, "attempt_id"),
      runId: text(row.run_id, "run_id"),
      actionKind: actionKindFrom(text(row.action_kind, "action_kind")),
      ...(track === undefined ? {} : { track }),
      observedBlock: integer(row.observed_block, "observed_block"),
      observedAt: integer(row.observed_at, "observed_at"),
      outcome: "pending",
      transactionHash: requireHash(
        text(row.transaction_hash, "transaction_hash"),
        "transaction_hash",
      ),
    },
  };
};

const assertExistingIdentity = (
  prior: SqliteRow | undefined,
  delivery: PendingKeeperAttemptDelivery,
): void => {
  if (prior === undefined) return;
  const { attempt, runStarted } = delivery;
  const changed = [
    [text(prior.run_id, "run_id"), attempt.runId],
    [text(prior.action_kind, "action_kind"), attempt.actionKind],
    [trackFrom(prior.track), attempt.track],
    [
      integer(prior.run_observed_block, "run_observed_block"),
      runStarted.observedBlock,
    ],
    [integer(prior.run_observed_at, "run_observed_at"), runStarted.observedAt],
    [integer(prior.observed_block, "observed_block"), attempt.observedBlock],
    [integer(prior.observed_at, "observed_at"), attempt.observedAt],
    [text(prior.transaction_hash, "transaction_hash"), attempt.transactionHash],
    [
      optionalText(prior.raw_transaction, "raw_transaction"),
      delivery.rawTransaction,
    ],
  ].some(([stored, received]) => stored !== received);
  if (changed) throw new Error("Keeper attempt outbox identity cannot change");
};

export const openKeeperAttemptOutbox = (
  path: string,
  identity: KeeperAttemptStoreIdentity,
): KeeperAttemptOutbox => {
  const database = new DatabaseSync(path);
  try {
    if (path !== ":memory:") chmodSync(path, 0o600);
    configureSqlite(database, "Keeper attempt outbox", {
      wal: path !== ":memory:",
    });
    database.exec("BEGIN IMMEDIATE");
    try {
      initializeDatabase(database);
      verifyMetadata(database, identity);
      verifySqliteIntegrity(database, "Keeper attempt outbox");
      database.exec("COMMIT");
    } catch (cause) {
      database.exec("ROLLBACK");
      throw cause;
    }
  } catch (cause) {
    database.close();
    throw cause;
  }
  const existing = database.prepare(
    "SELECT * FROM submitted_attempts WHERE attempt_id = ?",
  );
  const insert = database.prepare(`
    INSERT INTO submitted_attempts (
      attempt_id, run_id, action_kind, track, run_observed_block,
      run_observed_at, observed_block, observed_at, transaction_hash,
      recorded_at, action_slot, raw_transaction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (attempt_id) DO NOTHING
  `);
  const acknowledge = database.prepare(
    `UPDATE submitted_attempts SET delivery_acknowledged = 1
     WHERE attempt_id = ? AND transaction_hash = ?`,
  );
  const remove = database.prepare(
    "DELETE FROM submitted_attempts WHERE attempt_id = ? AND transaction_hash = ?",
  );
  const slot = database.prepare(
    `SELECT attempt_id FROM submitted_attempts
     WHERE run_id = ? AND action_slot = ? AND attempt_id <> ? LIMIT 1`,
  );
  const pendingDeliveries = database.prepare(
    "SELECT * FROM submitted_attempts WHERE delivery_acknowledged = 0 ORDER BY rowid ASC",
  );
  const unresolved = database.prepare(
    "SELECT * FROM submitted_attempts ORDER BY rowid ASC",
  );
  const validateTransaction = (rawTransaction: Hex, hash: Hex) => {
    if (
      keccak256(rawTransaction) !== hash ||
      parseTransaction(rawTransaction).chainId !== identity.chainId
    ) {
      throw new Error(
        "Prepared operator transaction identity does not match the outbox",
      );
    }
  };
  const replacements = (): readonly KeeperReplacementEvidence[] => {
    const row = database
      .prepare(
        "SELECT value FROM outbox_metadata WHERE key = 'canonical_replacements'",
      )
      .get();
    if (row === undefined) return [];
    const records = replacementRecords(
      JSON.parse(text(row.value, "canonical_replacements")),
    );
    if (records.length > 20)
      throw new Error("Replacement evidence exceeds its bound");
    return records.map((record) => {
      const blockNumber = BigInt(record.blockNumber);
      databaseInteger(blockNumber, "replacement block");
      return {
        transactionHash: requireHash(record.transactionHash, "original hash"),
        replacementHash: requireHash(
          record.replacementHash,
          "replacement hash",
        ),
        blockNumber,
      };
    });
  };
  return {
    replacements,
    recordReplacement: (proof) => {
      const record = {
        transactionHash: requireHash(proof.transactionHash, "original hash"),
        replacementHash: requireHash(proof.replacementHash, "replacement hash"),
        blockNumber: BigInt(
          databaseInteger(proof.blockNumber, "replacement block"),
        ),
      };
      if (record.transactionHash === record.replacementHash)
        throw new Error("Replacement must be a different transaction");
      const records = [
        ...replacements().filter(
          (item) => item.transactionHash !== record.transactionHash,
        ),
        record,
      ].slice(-20);
      database
        .prepare(
          "INSERT INTO outbox_metadata(key,value) VALUES ('canonical_replacements',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(
          JSON.stringify(records, (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        );
    },
    enqueueLocalSubmission: (rawTransaction) => {
      const hash = keccak256(rawTransaction);
      validateTransaction(rawTransaction, hash);
      database
        .prepare(
          "INSERT INTO local_submissions VALUES (?, ?) ON CONFLICT(transaction_hash) DO NOTHING",
        )
        .run(hash, rawTransaction);
    },
    localSubmissions: () =>
      database
        .prepare("SELECT * FROM local_submissions ORDER BY rowid")
        .all()
        .map((row) => {
          const transactionHash = requireHash(
            text(row.transaction_hash, "transaction_hash"),
            "transaction_hash",
          );
          const rawTransaction = text(
            row.raw_transaction,
            "raw_transaction",
          ) as Hex;
          validateTransaction(rawTransaction, transactionHash);
          return { transactionHash, rawTransaction };
        }),
    resolveLocalSubmission: (transactionHash) => {
      database
        .prepare("DELETE FROM local_submissions WHERE transaction_hash = ?")
        .run(transactionHash);
    },
    enqueue: (delivery, recordedAt) => {
      validateDelivery(delivery);
      if (delivery.rawTransaction !== undefined)
        validateTransaction(
          delivery.rawTransaction,
          delivery.attempt.transactionHash,
        );
      databaseInteger(recordedAt, "recordedAt");
      const { attempt, runStarted } = delivery;
      assertExistingIdentity(existing.get(attempt.attemptId), delivery);
      const actionSlot = actionSlotFrom(attempt.actionKind, attempt.track);
      if (
        slot.get(attempt.runId, actionSlot, attempt.attemptId) !== undefined
      ) {
        throw new Error(
          "Keeper attempt outbox action slot already has an attempt",
        );
      }
      insert.run(
        attempt.attemptId,
        attempt.runId,
        attempt.actionKind,
        attempt.track ?? null,
        databaseInteger(runStarted.observedBlock, "runStarted.observedBlock"),
        databaseInteger(runStarted.observedAt, "runStarted.observedAt"),
        databaseInteger(attempt.observedBlock, "observedBlock"),
        databaseInteger(attempt.observedAt, "observedAt"),
        attempt.transactionHash,
        databaseInteger(recordedAt, "recordedAt"),
        actionSlot,
        delivery.rawTransaction ?? null,
      );
    },
    pendingDeliveries: () => pendingDeliveries.all().map(deliveryFromRow),
    unresolved: () => unresolved.all().map(deliveryFromRow),
    acknowledge: (attemptId, transactionHash) => {
      boundedIdentifier(attemptId, "attemptId");
      requireHash(transactionHash, "transactionHash");
      acknowledge.run(attemptId, transactionHash);
    },
    resolve: (attemptId, transactionHash) => {
      boundedIdentifier(attemptId, "attemptId");
      requireHash(transactionHash, "transactionHash");
      remove.run(attemptId, transactionHash);
    },
    close: () => database.close(),
  };
};

export const acquireKeeperAttemptOutbox = (
  path: string,
  identity: KeeperAttemptStoreIdentity,
): Effect.Effect<KeeperAttemptOutbox, Error, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => openKeeperAttemptOutbox(path, identity),
      catch: (cause) =>
        new Error("Could not open keeper-attempt outbox", { cause }),
    }),
    (outbox) => Effect.sync(outbox.close),
  );

const deliverPendingDelivery = async (
  outbox: KeeperAttemptOutbox,
  recorder: KeeperAttemptRecorder,
  delivery: PendingKeeperAttemptDelivery,
): Promise<void> => {
  await recorder.startRun(delivery.runStarted);
  await recorder.observeAttempt(delivery.attempt);
  outbox.acknowledge(
    delivery.attempt.attemptId,
    delivery.attempt.transactionHash,
  );
};

export const deliverSubmittedKeeperAttempt = async (
  outbox: KeeperAttemptOutbox,
  recorder: KeeperAttemptRecorder,
  delivery: PendingKeeperAttemptDelivery,
  recordedAt: bigint,
): Promise<void> => {
  outbox.enqueue(delivery, recordedAt);
  await deliverPendingDelivery(outbox, recorder, delivery);
};

export const replayKeeperAttemptOutbox = async (
  outbox: KeeperAttemptOutbox,
  recorder: KeeperAttemptRecorder,
): Promise<void> => {
  for (const delivery of outbox.pendingDeliveries()) {
    await deliverPendingDelivery(outbox, recorder, delivery);
  }
};
