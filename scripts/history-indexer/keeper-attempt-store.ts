import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { Effect, Scope } from "effect";
import type { Hex } from "viem";

import { HistoryPersistenceError } from "./errors.ts";
import { configureSqliteForWal, verifySqliteIntegrity } from "./sqlite-wal.ts";

const SCHEMA_VERSION = "2";
const TRACKS = [1, 2, 3, 4] as const;
const MAXIMUM_RECEIPTS_PER_CYCLE = 100;

export type KeeperTrack = (typeof TRACKS)[number];
export type KeeperActionKind =
  "reward-epoch" | "reward-track" | "protocol-liquidity";
export type KeeperAttemptOutcome =
  | "preparing"
  | "not-required"
  | "simulated"
  | "failed-before-submission"
  | "pending"
  | "succeeded"
  | "reverted"
  | "reorged";
export type KeeperAttemptFailureClass =
  | "quote-unavailable"
  | "preflight-rejected"
  | "submission-rejected"
  | "receipt-unavailable"
  | "execution-reverted"
  | "canonicality-uncertain";

export interface KeeperAttemptStoreIdentity {
  readonly chainId: number;
  readonly manifestFingerprint: Hex;
}

export interface KeeperRunInput {
  readonly runId: string;
  readonly observedBlock: bigint;
  readonly observedAt: bigint;
  readonly recordedAt: bigint;
}

export interface KeeperAttemptReceipt {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly blockTimestamp: bigint;
}

export interface KeeperAttemptInput {
  readonly attemptId: string;
  readonly runId: string;
  readonly actionKind: KeeperActionKind;
  readonly track?: KeeperTrack;
  readonly observedBlock: bigint;
  readonly observedAt: bigint;
  readonly recordedAt: bigint;
  readonly outcome: KeeperAttemptOutcome;
  readonly failureClass?: KeeperAttemptFailureClass;
  readonly transactionHash?: Hex;
  readonly receipt?: KeeperAttemptReceipt;
}

export interface KeeperCanonicalReceipt {
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

export interface KeeperReceiptSource {
  readonly getReceipt: (
    transactionHash: Hex,
  ) => Promise<KeeperCanonicalReceipt | undefined>;
  readonly getHeader: (blockNumber: bigint) => Promise<KeeperAttemptReceipt>;
}

export interface PublicKeeperAttempt {
  readonly actionKind: KeeperActionKind;
  readonly track?: KeeperTrack;
  readonly observedBlock: bigint;
  readonly observedAt: bigint;
  readonly outcome: KeeperAttemptOutcome;
  readonly failureClass?: KeeperAttemptFailureClass;
  readonly transactionHash?: Hex;
  readonly receipt?: KeeperAttemptReceipt;
}

interface StoredKeeperAttempt extends PublicKeeperAttempt {
  readonly attemptId: string;
  readonly runId: string;
}

type TrackAttemptState = "fresh" | "retryable" | "unknown";
type TrackAttemptCoverage = "complete" | "partial";

export interface KeeperAttemptEvidence {
  readonly source: "keeper-attempt-journal";
  readonly generation: string;
  readonly state: "fresh" | "stale" | "incomplete" | "unavailable";
  readonly freshness: {
    readonly observedAt?: bigint;
    readonly recordedAt?: bigint;
    readonly ageSeconds?: bigint;
    readonly maximumAgeSeconds: bigint;
  };
  readonly coverage: Readonly<Record<KeeperTrack, TrackAttemptCoverage>>;
  readonly tracks: Readonly<
    Record<
      KeeperTrack,
      {
        readonly state: TrackAttemptState;
        readonly latest?: PublicKeeperAttempt;
      }
    >
  >;
}

export interface KeeperAttemptStore {
  readonly startRun: (input: KeeperRunInput) => void;
  readonly recordAttempt: (input: KeeperAttemptInput) => void;
  readonly completeRun: (input: KeeperRunInput) => void;
  readonly reconcileReceipts: (input: {
    readonly confirmationBlocks: bigint;
    readonly concurrency: number;
    readonly source: KeeperReceiptSource;
    readonly observedBlock: bigint;
    readonly recordedAt: bigint;
  }) => Promise<void>;
  readonly readEvidence: (input: {
    readonly currentTime: bigint;
    readonly maximumAgeSeconds: bigint;
  }) => KeeperAttemptEvidence;
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

const isHex = (value: string): value is Hex =>
  /^0x[0-9a-fA-F]{64}$/u.test(value);

const requireHex = (value: string, label: string): Hex => {
  if (!isHex(value)) throw new TypeError(`${label} is not a 32-byte hash`);
  return value;
};

type AttemptStateRule = Readonly<{
  failureClasses: readonly KeeperAttemptFailureClass[];
  failureRequired?: boolean;
  receipt: "forbidden" | "required";
  transaction: "forbidden" | "required";
}>;

const ATTEMPT_STATE_RULES: Readonly<
  Record<KeeperAttemptOutcome, AttemptStateRule>
> = {
  preparing: {
    transaction: "forbidden",
    receipt: "forbidden",
    failureClasses: [],
  },
  "not-required": {
    transaction: "forbidden",
    receipt: "forbidden",
    failureClasses: [],
  },
  simulated: {
    transaction: "forbidden",
    receipt: "forbidden",
    failureClasses: [],
  },
  "failed-before-submission": {
    transaction: "forbidden",
    receipt: "forbidden",
    failureRequired: true,
    failureClasses: [
      "quote-unavailable",
      "preflight-rejected",
      "submission-rejected",
    ],
  },
  pending: {
    transaction: "required",
    receipt: "forbidden",
    failureClasses: ["receipt-unavailable"],
  },
  succeeded: {
    transaction: "required",
    receipt: "required",
    failureClasses: [],
  },
  reverted: {
    transaction: "required",
    receipt: "required",
    failureRequired: true,
    failureClasses: ["execution-reverted"],
  },
  reorged: {
    transaction: "required",
    receipt: "forbidden",
    failureRequired: true,
    failureClasses: ["canonicality-uncertain"],
  },
};

const validateAttemptState = (input: KeeperAttemptInput): void => {
  const rule = ATTEMPT_STATE_RULES[input.outcome];
  if (
    (rule.transaction === "required") !==
    (input.transactionHash !== undefined)
  ) {
    throw new TypeError(
      `${input.outcome} keeper attempt has invalid transaction evidence`,
    );
  }
  if ((rule.receipt === "required") !== (input.receipt !== undefined)) {
    throw new TypeError(
      `${input.outcome} keeper attempt has invalid receipt evidence`,
    );
  }
  if (rule.failureRequired === true && input.failureClass === undefined) {
    throw new TypeError(
      `${input.outcome} keeper attempt requires a failure class`,
    );
  }
  if (
    input.failureClass !== undefined &&
    !rule.failureClasses.includes(input.failureClass)
  ) {
    throw new TypeError(
      `${input.outcome} keeper attempt has an invalid failure class`,
    );
  }
};

const validateAttempt = (input: KeeperAttemptInput): void => {
  boundedIdentifier(input.attemptId, "attemptId");
  boundedIdentifier(input.runId, "runId");
  validateAttemptState(input);
  if (input.actionKind === "reward-track" && input.track === undefined) {
    throw new TypeError("Reward Track attempt requires a track");
  }
  if (input.actionKind !== "reward-track" && input.track !== undefined) {
    throw new TypeError("Only Reward Track attempts may identify a track");
  }
  if (input.transactionHash !== undefined) {
    requireHex(input.transactionHash, "transactionHash");
  }
  if (input.receipt !== undefined) {
    databaseInteger(input.receipt.blockNumber, "receipt.blockNumber");
    databaseInteger(input.receipt.blockTimestamp, "receipt.blockTimestamp");
    requireHex(input.receipt.blockHash, "receipt.blockHash");
  }
  databaseInteger(input.observedBlock, "observedBlock");
  databaseInteger(input.observedAt, "observedAt");
  databaseInteger(input.recordedAt, "recordedAt");
};

const assertAttemptIdentity = (
  prior: SqliteRow | undefined,
  input: KeeperAttemptInput,
): void => {
  if (prior === undefined) return;
  const changed =
    text(prior.run_id, "run_id") !== input.runId ||
    text(prior.action_kind, "action_kind") !== input.actionKind ||
    trackFrom(prior.track) !== input.track ||
    integer(prior.observed_block, "observed_block") !== input.observedBlock ||
    integer(prior.observed_at, "observed_at") !== input.observedAt;
  if (changed) throw new Error("Keeper attempt identity fields cannot change");
};

const assertAttemptTransaction = (
  prior: SqliteRow | undefined,
  input: KeeperAttemptInput,
): void => {
  if (prior === undefined) return;
  const priorTransactionHash = optionalText(
    prior.transaction_hash,
    "transaction_hash",
  );
  if (
    priorTransactionHash !== undefined &&
    priorTransactionHash !== input.transactionHash
  ) {
    throw new Error("Keeper attempt transaction hash cannot change");
  }
};

const attemptProgress = (outcome: KeeperAttemptOutcome): number => {
  if (outcome === "preparing") return 0;
  if (outcome === "pending") return 1;
  return 2;
};

const attemptUpdateIsStale = (
  prior: SqliteRow | undefined,
  input: KeeperAttemptInput,
): boolean =>
  prior !== undefined &&
  attemptProgress(outcomeFrom(text(prior.outcome, "outcome"))) >
    attemptProgress(input.outcome);

const attemptDatabaseValues = (input: KeeperAttemptInput) => ({
  track: input.track ?? null,
  failureClass: input.failureClass ?? null,
  transactionHash: input.transactionHash ?? null,
  receiptBlock:
    input.receipt === undefined
      ? null
      : databaseInteger(input.receipt.blockNumber, "receipt.blockNumber"),
  receiptHash: input.receipt?.blockHash ?? null,
  receiptTimestamp:
    input.receipt === undefined
      ? null
      : databaseInteger(input.receipt.blockTimestamp, "receipt.blockTimestamp"),
});

const initializeDatabase = (database: DatabaseSync): void => {
  configureSqliteForWal(database, "Keeper attempt journal");
  database.exec(`
    CREATE TABLE IF NOT EXISTS keeper_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS keeper_runs (
      run_id TEXT PRIMARY KEY,
      observed_block INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      completed_block INTEGER,
      completed_observed_at INTEGER,
      completed_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS keeper_attempts (
      attempt_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES keeper_runs(run_id),
      action_kind TEXT NOT NULL,
      track INTEGER,
      observed_block INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      failure_class TEXT,
      transaction_hash TEXT,
      receipt_block INTEGER,
      receipt_hash TEXT,
      receipt_timestamp INTEGER,
      last_reconciled_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS keeper_attempts_recent
      ON keeper_attempts (recorded_at DESC, attempt_id DESC);
    CREATE INDEX IF NOT EXISTS keeper_attempts_reconciliation
      ON keeper_attempts (
        COALESCE(last_reconciled_at, recorded_at), attempt_id
      ) WHERE transaction_hash IS NOT NULL;
  `);
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
    database.prepare("SELECT COUNT(*) AS count FROM keeper_metadata").get()
      ?.count ?? 0,
  );
  const select = database.prepare(
    "SELECT value FROM keeper_metadata WHERE key = ?",
  );
  const insert = database.prepare(
    "INSERT INTO keeper_metadata (key, value) VALUES (?, ?)",
  );
  if (count === 0) {
    for (const [key, value] of Object.entries(expected)) insert.run(key, value);
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    const actual = optionalText(select.get(key)?.value, key);
    if (actual !== value) {
      throw new Error(
        `Keeper attempt database ${key} mismatch: expected ${value}, observed ${actual ?? "missing"}`,
      );
    }
  }
};

const rotateGeneration = (database: DatabaseSync): string => {
  const generation = randomUUID();
  database
    .prepare(
      `
      INSERT INTO keeper_metadata (key, value) VALUES ('served_generation', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `,
    )
    .run(generation);
  return generation;
};

const outcomeFrom = (value: string): KeeperAttemptOutcome => {
  const outcomes: readonly string[] = [
    "preparing",
    "not-required",
    "simulated",
    "failed-before-submission",
    "pending",
    "succeeded",
    "reverted",
    "reorged",
  ];
  if (!outcomes.includes(value)) throw new TypeError("Unknown attempt outcome");
  return value as KeeperAttemptOutcome;
};

const actionKindFrom = (value: string): KeeperActionKind => {
  if (
    value !== "reward-epoch" &&
    value !== "reward-track" &&
    value !== "protocol-liquidity"
  ) {
    throw new TypeError("Unknown keeper action kind");
  }
  return value;
};

const failureClassFrom = (
  value: string | undefined,
): KeeperAttemptFailureClass | undefined => {
  if (value === undefined) return undefined;
  const classes: readonly string[] = [
    "quote-unavailable",
    "preflight-rejected",
    "submission-rejected",
    "receipt-unavailable",
    "execution-reverted",
    "canonicality-uncertain",
  ];
  if (!classes.includes(value)) {
    throw new TypeError("Unknown attempt failure class");
  }
  return value as KeeperAttemptFailureClass;
};

const trackFrom = (
  value: SQLOutputValue | undefined,
): KeeperTrack | undefined => {
  if (value === null || value === undefined) return undefined;
  const track = Number(value);
  if (!TRACKS.includes(track as KeeperTrack)) {
    throw new TypeError("Keeper attempt track is out of range");
  }
  return track as KeeperTrack;
};

const attemptFromRow = (row: SqliteRow): StoredKeeperAttempt => {
  const receiptBlock = row.receipt_block;
  const receiptHash = optionalText(row.receipt_hash, "receipt_hash");
  const receiptTimestamp = row.receipt_timestamp;
  const track = trackFrom(row.track);
  const failureClass = failureClassFrom(
    optionalText(row.failure_class, "failure_class"),
  );
  const transactionHash = optionalText(
    row.transaction_hash,
    "transaction_hash",
  );
  return {
    attemptId: text(row.attempt_id, "attempt_id"),
    runId: text(row.run_id, "run_id"),
    actionKind: actionKindFrom(text(row.action_kind, "action_kind")),
    ...(track === undefined ? {} : { track }),
    observedBlock: integer(row.observed_block, "observed_block"),
    observedAt: integer(row.observed_at, "observed_at"),
    outcome: outcomeFrom(text(row.outcome, "outcome")),
    ...(failureClass === undefined ? {} : { failureClass }),
    ...(transactionHash === undefined
      ? {}
      : { transactionHash: requireHex(transactionHash, "transaction_hash") }),
    ...(receiptBlock === null ||
    receiptBlock === undefined ||
    receiptHash === undefined ||
    receiptTimestamp === null ||
    receiptTimestamp === undefined
      ? {}
      : {
          receipt: {
            blockNumber: integer(receiptBlock, "receipt_block"),
            blockHash: requireHex(receiptHash, "receipt_hash"),
            blockTimestamp: integer(receiptTimestamp, "receipt_timestamp"),
          },
        }),
  };
};

const publicAttemptFrom = (
  attempt: StoredKeeperAttempt,
): PublicKeeperAttempt => ({
  actionKind: attempt.actionKind,
  ...(attempt.track === undefined ? {} : { track: attempt.track }),
  observedBlock: attempt.observedBlock,
  observedAt: attempt.observedAt,
  outcome: attempt.outcome,
  ...(attempt.failureClass === undefined
    ? {}
    : { failureClass: attempt.failureClass }),
  ...(attempt.transactionHash === undefined
    ? {}
    : { transactionHash: attempt.transactionHash }),
  ...(attempt.receipt === undefined ? {} : { receipt: attempt.receipt }),
});

const partialCoverage = (): Record<KeeperTrack, TrackAttemptCoverage> => ({
  1: "partial",
  2: "partial",
  3: "partial",
  4: "partial",
});

const unknownTracks = (): KeeperAttemptEvidence["tracks"] => ({
  1: { state: "unknown" },
  2: { state: "unknown" },
  3: { state: "unknown" },
  4: { state: "unknown" },
});

const attemptState = (outcome: KeeperAttemptOutcome): TrackAttemptState => {
  if (outcome === "failed-before-submission" || outcome === "reverted") {
    return "retryable";
  }
  if (outcome === "not-required" || outcome === "succeeded") {
    return "fresh";
  }
  return "unknown";
};

const trackEvidence = (
  attempts: readonly StoredKeeperAttempt[],
): Pick<KeeperAttemptEvidence, "coverage" | "tracks"> => {
  const byTrack = new Map<KeeperTrack, StoredKeeperAttempt>();
  for (const attempt of attempts) {
    if (attempt.track !== undefined && !byTrack.has(attempt.track)) {
      byTrack.set(attempt.track, attempt);
    }
  }
  const coverage = partialCoverage();
  const tracks = { ...unknownTracks() };
  for (const track of TRACKS) {
    const latest = byTrack.get(track);
    if (latest === undefined) continue;
    const state = attemptState(latest.outcome);
    coverage[track] = state === "unknown" ? "partial" : "complete";
    tracks[track] = { state, latest: publicAttemptFrom(latest) };
  }
  return { coverage, tracks };
};

type KeeperReceiptUpdate = Pick<
  KeeperAttemptInput,
  "outcome" | "failureClass" | "receipt"
>;

const receiptUpdate = async (
  attempt: StoredKeeperAttempt & { readonly transactionHash: Hex },
  source: KeeperReceiptSource,
): Promise<KeeperReceiptUpdate> => {
  const receipt = await source.getReceipt(attempt.transactionHash);
  if (receipt === undefined) {
    return attempt.outcome === "succeeded" ||
      attempt.outcome === "reverted" ||
      attempt.outcome === "reorged"
      ? {
          outcome: "reorged",
          failureClass: "canonicality-uncertain",
        }
      : { outcome: "pending", failureClass: "receipt-unavailable" };
  }
  const header = await source.getHeader(receipt.blockNumber);
  if (
    header.blockNumber !== receipt.blockNumber ||
    header.blockHash !== receipt.blockHash
  ) {
    return {
      outcome: "reorged",
      failureClass: "canonicality-uncertain",
    };
  }
  return receipt.status === "success"
    ? { outcome: "succeeded", receipt: header }
    : {
        outcome: "reverted",
        failureClass: "execution-reverted",
        receipt: header,
      };
};

const reconcileOneReceipt = async (
  item: StoredKeeperAttempt & { readonly transactionHash: Hex },
  source: KeeperReceiptSource,
): Promise<
  | { readonly item: typeof item; readonly update: KeeperReceiptUpdate }
  | { readonly item: typeof item; readonly failure: unknown }
> => {
  try {
    return { item, update: await receiptUpdate(item, source) };
  } catch (failure) {
    return { item, failure };
  }
};

export const openKeeperAttemptStore = (
  path: string,
  identity: KeeperAttemptStoreIdentity,
): KeeperAttemptStore => {
  const database = new DatabaseSync(path);
  let generation: string;
  try {
    initializeDatabase(database);
    verifyMetadata(database, identity);
    verifySqliteIntegrity(database, "Keeper attempt journal");
    generation = rotateGeneration(database);
  } catch (cause) {
    database.close();
    throw cause;
  }
  const run = database.prepare(`
    INSERT INTO keeper_runs (
      run_id, observed_block, observed_at, started_at
    ) VALUES (?, ?, ?, ?)
  `);
  const existingRun = database.prepare(
    "SELECT * FROM keeper_runs WHERE run_id = ?",
  );
  const existingAttempt = database.prepare(
    `SELECT run_id, action_kind, track, observed_block, observed_at,
            transaction_hash, outcome
     FROM keeper_attempts WHERE attempt_id = ?`,
  );
  const existingActionSlot = database.prepare(
    `SELECT attempt_id FROM keeper_attempts
     WHERE run_id = ? AND action_kind = ? AND track IS ?`,
  );
  const attempt = database.prepare(`
    INSERT INTO keeper_attempts (
      attempt_id, run_id, action_kind, track, observed_block, observed_at,
      recorded_at, outcome, failure_class, transaction_hash, receipt_block,
      receipt_hash, receipt_timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (attempt_id) DO UPDATE SET
      observed_block = excluded.observed_block,
      observed_at = excluded.observed_at,
      recorded_at = excluded.recorded_at,
      outcome = excluded.outcome,
      failure_class = excluded.failure_class,
      transaction_hash = excluded.transaction_hash,
      receipt_block = excluded.receipt_block,
      receipt_hash = excluded.receipt_hash,
      receipt_timestamp = excluded.receipt_timestamp
  `);
  const complete = database.prepare(`
    UPDATE keeper_runs SET
      completed_block = ?, completed_observed_at = ?, completed_at = ?
    WHERE run_id = ? AND completed_at IS NULL
  `);
  const touchReconciliation = database.prepare(
    "UPDATE keeper_attempts SET last_reconciled_at = ? WHERE attempt_id = ?",
  );

  const startRun = (input: KeeperRunInput): void => {
    boundedIdentifier(input.runId, "runId");
    const observedBlock = databaseInteger(input.observedBlock, "observedBlock");
    const observedAt = databaseInteger(input.observedAt, "observedAt");
    const recordedAt = databaseInteger(input.recordedAt, "recordedAt");
    const prior = existingRun.get(input.runId);
    if (prior !== undefined) {
      if (
        integer(prior.observed_block, "observed_block") !==
          input.observedBlock ||
        integer(prior.observed_at, "observed_at") !== input.observedAt
      ) {
        throw new Error("Keeper run identity fields cannot change");
      }
      return;
    }
    run.run(input.runId, observedBlock, observedAt, recordedAt);
  };

  const recordAttempt = (input: KeeperAttemptInput): void => {
    validateAttempt(input);
    const prior = existingAttempt.get(input.attemptId);
    assertAttemptIdentity(prior, input);
    if (attemptUpdateIsStale(prior, input)) return;
    assertAttemptTransaction(prior, input);
    const values = attemptDatabaseValues(input);
    const occupiedAttemptId = optionalText(
      existingActionSlot.get(input.runId, input.actionKind, values.track)
        ?.attempt_id,
      "attempt_id",
    );
    if (
      occupiedAttemptId !== undefined &&
      occupiedAttemptId !== input.attemptId
    ) {
      throw new Error("Keeper run action slot already has an attempt");
    }
    attempt.run(
      input.attemptId,
      input.runId,
      input.actionKind,
      values.track,
      databaseInteger(input.observedBlock, "observedBlock"),
      databaseInteger(input.observedAt, "observedAt"),
      databaseInteger(input.recordedAt, "recordedAt"),
      input.outcome,
      values.failureClass,
      values.transactionHash,
      values.receiptBlock,
      values.receiptHash,
      values.receiptTimestamp,
    );
  };

  const completeRun = (input: KeeperRunInput): void => {
    boundedIdentifier(input.runId, "runId");
    const prior = existingRun.get(input.runId);
    if (prior === undefined) throw new Error("Keeper run is missing");
    if (prior.completed_at !== null && prior.completed_at !== undefined) {
      if (
        integer(prior.completed_block, "completed_block") !==
          input.observedBlock ||
        integer(prior.completed_observed_at, "completed_observed_at") !==
          input.observedAt
      ) {
        throw new Error("Completed keeper run identity fields cannot change");
      }
      return;
    }
    const count = Number(
      database
        .prepare(
          "SELECT COUNT(DISTINCT track) AS count FROM keeper_attempts WHERE run_id = ? AND action_kind = 'reward-track'",
        )
        .get(input.runId)?.count ?? 0,
    );
    if (count !== TRACKS.length) {
      throw new Error("Keeper run cannot complete without all Reward Tracks");
    }
    const result = complete.run(
      databaseInteger(input.observedBlock, "observedBlock"),
      databaseInteger(input.observedAt, "observedAt"),
      databaseInteger(input.recordedAt, "recordedAt"),
      input.runId,
    );
    if (result.changes !== 1)
      throw new Error("Keeper run is missing or complete");
  };

  const reconcileReceipts: KeeperAttemptStore["reconcileReceipts"] = async ({
    confirmationBlocks,
    concurrency,
    source,
    observedBlock,
    recordedAt,
  }) => {
    if (confirmationBlocks < 0n) {
      throw new RangeError("confirmationBlocks must be non-negative");
    }
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 32
    ) {
      throw new RangeError("concurrency must be a safe integer from 1 to 32");
    }
    const finalizedThrough =
      observedBlock > confirmationBlocks
        ? observedBlock - confirmationBlocks
        : 0n;
    const submitted = database
      .prepare(
        `SELECT * FROM keeper_attempts
         WHERE transaction_hash IS NOT NULL
           AND (
             receipt_block IS NULL OR
             outcome IN ('pending', 'reorged') OR
             receipt_block > ?
           )
         ORDER BY COALESCE(last_reconciled_at, recorded_at) ASC,
                  attempt_id ASC
         LIMIT ?`,
      )
      .all(
        databaseInteger(finalizedThrough, "finalizedThrough"),
        MAXIMUM_RECEIPTS_PER_CYCLE,
      )
      .map(attemptFromRow)
      .filter(
        (
          item,
        ): item is StoredKeeperAttempt & { readonly transactionHash: Hex } =>
          item.transactionHash !== undefined,
      );
    const updates = await Effect.runPromise(
      Effect.forEach(
        submitted,
        (item) => Effect.promise(() => reconcileOneReceipt(item, source)),
        { concurrency },
      ),
    );
    let failures = 0;
    for (const result of updates) {
      touchReconciliation.run(
        databaseInteger(recordedAt, "recordedAt"),
        result.item.attemptId,
      );
      if ("failure" in result) {
        failures += 1;
        continue;
      }
      const { item, update } = result;
      recordAttempt({
        attemptId: item.attemptId,
        runId: item.runId,
        actionKind: item.actionKind,
        ...(item.track === undefined ? {} : { track: item.track }),
        observedBlock: item.observedBlock,
        observedAt: item.observedAt,
        recordedAt,
        transactionHash: item.transactionHash,
        ...update,
      });
    }
    if (failures > 0) {
      throw new Error(`${failures} keeper receipt reconciliation(s) failed`);
    }
  };

  const readEvidence: KeeperAttemptStore["readEvidence"] = ({
    currentTime,
    maximumAgeSeconds,
  }) => {
    if (maximumAgeSeconds <= 0n) {
      throw new RangeError("maximumAgeSeconds must be positive");
    }
    const latestRun = database
      .prepare("SELECT * FROM keeper_runs ORDER BY rowid DESC LIMIT 1")
      .get();
    const base = {
      source: "keeper-attempt-journal" as const,
      generation,
      freshness: { maximumAgeSeconds },
      coverage: partialCoverage(),
      tracks: unknownTracks(),
    };
    if (latestRun === undefined)
      return { ...base, state: "unavailable" as const };
    const completedAtValue = latestRun.completed_at;
    if (completedAtValue === null || completedAtValue === undefined) {
      return { ...base, state: "incomplete" as const };
    }
    const recordedAt = integer(completedAtValue, "completed_at");
    const observedAt = integer(
      latestRun.completed_observed_at,
      "completed_observed_at",
    );
    const recordedAge =
      currentTime > recordedAt ? currentTime - recordedAt : 0n;
    const observedAge =
      currentTime > observedAt ? currentTime - observedAt : 0n;
    const ageSeconds = recordedAge > observedAge ? recordedAge : observedAge;
    const freshness = {
      observedAt,
      recordedAt,
      ageSeconds,
      maximumAgeSeconds,
    };
    if (ageSeconds > maximumAgeSeconds) {
      return {
        ...base,
        state: "stale" as const,
        freshness,
      };
    }
    const attempts = database
      .prepare(
        "SELECT * FROM keeper_attempts WHERE run_id = ? ORDER BY recorded_at DESC, attempt_id DESC",
      )
      .all(text(latestRun.run_id, "run_id"))
      .map(attemptFromRow);
    return {
      ...base,
      state: "fresh" as const,
      freshness,
      ...trackEvidence(attempts),
    };
  };

  return {
    startRun,
    recordAttempt,
    completeRun,
    reconcileReceipts,
    readEvidence,
    close: () => database.close(),
  };
};

export const acquireKeeperAttemptStore = (
  path: string,
  identity: KeeperAttemptStoreIdentity,
): Effect.Effect<KeeperAttemptStore, HistoryPersistenceError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => openKeeperAttemptStore(path, identity),
      catch: (cause) =>
        new HistoryPersistenceError({
          message: "Could not open keeper-attempt database",
          cause,
        }),
    }),
    (store) => Effect.sync(store.close),
  );
