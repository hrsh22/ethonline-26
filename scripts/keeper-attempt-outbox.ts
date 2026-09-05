import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { Effect, Scope } from "effect";
import type { Hex } from "viem";

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
import {
  configureSqliteForWal,
  verifySqliteIntegrity,
} from "./history-indexer/sqlite-wal.ts";

const SCHEMA_VERSION = "3";

export type PendingKeeperAttemptMilestone = KeeperAttemptMilestone & {
  readonly outcome: "pending";
  readonly transactionHash: Hex;
};

export interface PendingKeeperAttemptDelivery {
  readonly runStarted: KeeperRunStartedMilestone;
  readonly attempt: PendingKeeperAttemptMilestone;
}

export interface KeeperAttemptOutbox {
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
  if (schemaVersion === undefined) {
    if (!columns.has("action_slot")) {
      database.exec(
        "ALTER TABLE submitted_attempts ADD COLUMN action_slot TEXT",
      );
    }
    if (!columns.has("delivery_acknowledged")) {
      database.exec(
        "ALTER TABLE submitted_attempts ADD COLUMN delivery_acknowledged INTEGER NOT NULL DEFAULT 0",
      );
    }
    return;
  }
  if (schemaVersion === SCHEMA_VERSION) return;
  if (schemaVersion !== "2") {
    throw new Error(
      `Keeper attempt outbox schema mismatch: expected ${SCHEMA_VERSION}, observed ${schemaVersion}`,
    );
  }

  if (!columns.has("action_slot")) {
    database.exec("ALTER TABLE submitted_attempts ADD COLUMN action_slot TEXT");
  }
  if (!columns.has("delivery_acknowledged")) {
    database.exec(
      "ALTER TABLE submitted_attempts ADD COLUMN delivery_acknowledged INTEGER NOT NULL DEFAULT 0",
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
    UPDATE outbox_metadata SET value = '3' WHERE key = 'schema_version';
  `);
};

const initializeDatabase = (database: DatabaseSync): void => {
  configureSqliteForWal(database, "Keeper attempt outbox");
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
  const changed =
    text(prior.run_id, "run_id") !== attempt.runId ||
    text(prior.action_kind, "action_kind") !== attempt.actionKind ||
    trackFrom(prior.track) !== attempt.track ||
    integer(prior.run_observed_block, "run_observed_block") !==
      runStarted.observedBlock ||
    integer(prior.run_observed_at, "run_observed_at") !==
      runStarted.observedAt ||
    integer(prior.observed_block, "observed_block") !== attempt.observedBlock ||
    integer(prior.observed_at, "observed_at") !== attempt.observedAt ||
    text(prior.transaction_hash, "transaction_hash") !==
      attempt.transactionHash;
  if (changed) throw new Error("Keeper attempt outbox identity cannot change");
};

export const openKeeperAttemptOutbox = (
  path: string,
  identity: KeeperAttemptStoreIdentity,
): KeeperAttemptOutbox => {
  const database = new DatabaseSync(path);
  try {
    initializeDatabase(database);
    verifyMetadata(database, identity);
    verifySqliteIntegrity(database, "Keeper attempt outbox");
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
      recorded_at, action_slot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return {
    enqueue: (delivery, recordedAt) => {
      validateDelivery(delivery);
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
