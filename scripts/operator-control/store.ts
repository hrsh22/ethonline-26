import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import type {
  OperatorCommandName,
  OperatorExecutionMode,
  OperatorOneShot,
} from "@orbit/config/operator-control";

import { CLOSED_POLICY, type OperatorExecutionPolicy } from "./policy.ts";

type SqliteRow = Readonly<Record<string, SQLOutputValue>>;

const text = (value: SQLOutputValue | undefined): string => {
  if (typeof value !== "string") throw new TypeError("Expected SQLite text");
  return value;
};

const numeric = (value: SQLOutputValue | undefined): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError("Expected a SQLite number");
};

export interface OperatorCommandRecord {
  readonly actor: string;
  readonly appliedAt: number;
  readonly command: OperatorCommandName;
  readonly commandId: string;
  readonly nextMode: OperatorExecutionMode;
  readonly nextOneShot: OperatorOneShot;
  readonly previousMode: OperatorExecutionMode;
  readonly previousOneShot: OperatorOneShot;
  readonly result: string;
  readonly role: string;
  readonly transactionHash: string | undefined;
}

export interface OperatorRunRecord {
  readonly authority: string;
  readonly finishedAt: number | undefined;
  readonly outcome: string;
  readonly runId: string;
  readonly sanitizedFailure: string | undefined;
  readonly startedAt: number;
  readonly transactionHash: string | undefined;
}

export interface OperatorPolicyRevision {
  readonly policy: OperatorExecutionPolicy;
  /** Monotonic marker of the last policy write, used to detect a later stop. */
  readonly updatedAt: number;
}

export interface OperatorControlStore {
  readonly readPolicy: () => OperatorExecutionPolicy;
  readonly readPolicyRevision: () => OperatorPolicyRevision;
  /** Records a policy change and its audit row in one transaction. */
  readonly applyCommand: (record: OperatorCommandRecord) => void;
  /** Returns the stored result when a command id was already applied. */
  readonly findCommand: (
    commandId: string,
  ) => OperatorCommandRecord | undefined;
  readonly recentCommands: (limit: number) => readonly OperatorCommandRecord[];
  readonly consumeOneShot: (at: number) => OperatorExecutionPolicy;
  readonly recordHeartbeat: (input: {
    readonly at: number;
    readonly supervisor: string;
    readonly observedMode: OperatorExecutionMode;
  }) => void;
  readonly readHeartbeat: () =>
    | {
        readonly at: number;
        readonly observedMode: OperatorExecutionMode;
        readonly supervisor: string;
      }
    | undefined;
  readonly startRun: (input: {
    readonly authority: string;
    readonly runId: string;
    readonly startedAt: number;
  }) => void;
  readonly finishRun: (input: {
    readonly finishedAt: number;
    readonly outcome: string;
    readonly runId: string;
    readonly sanitizedFailure?: string | undefined;
    readonly transactionHash?: string | undefined;
  }) => void;
  readonly readLatestRun: () => OperatorRunRecord | undefined;
  /**
   * Acquires the durable single-writer lease. Only the holder may cross a
   * signing boundary, so two supervisors cannot broadcast concurrently.
   */
  readonly acquireWriterLease: (input: {
    readonly holder: string;
    readonly now: number;
    readonly leaseMilliseconds: number;
  }) => boolean;
  readonly releaseWriterLease: (holder: string) => void;
  readonly readWriterLease: () =>
    { readonly expiresAt: number; readonly holder: string } | undefined;
  readonly close: () => void;
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS operator_policy (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    mode TEXT NOT NULL CHECK (mode IN ('stopped', 'dry-run', 'live')),
    one_shot TEXT NOT NULL CHECK (one_shot IN ('none', 'dry-run', 'live')),
    updated_at INTEGER NOT NULL
  ) STRICT;
  -- Append-only. Rows are never updated or deleted, so the audit trail is
  -- durable evidence of who changed what and what happened.
  CREATE TABLE IF NOT EXISTS operator_commands (
    command_id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    command TEXT NOT NULL,
    previous_mode TEXT NOT NULL,
    previous_one_shot TEXT NOT NULL,
    next_mode TEXT NOT NULL,
    next_one_shot TEXT NOT NULL,
    result TEXT NOT NULL,
    transaction_hash TEXT,
    applied_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS operator_commands_applied
    ON operator_commands (applied_at DESC);
  CREATE TABLE IF NOT EXISTS operator_heartbeat (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    observed_at INTEGER NOT NULL,
    observed_mode TEXT NOT NULL,
    supervisor TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS operator_runs (
    run_id TEXT PRIMARY KEY,
    authority TEXT NOT NULL,
    outcome TEXT NOT NULL,
    sanitized_failure TEXT,
    transaction_hash TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS operator_runs_started
    ON operator_runs (started_at DESC);
  CREATE TABLE IF NOT EXISTS operator_writer_lease (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    holder TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
`;

const commandRecord = (row: SqliteRow): OperatorCommandRecord => ({
  actor: text(row.actor),
  appliedAt: numeric(row.applied_at),
  command: text(row.command) as OperatorCommandName,
  commandId: text(row.command_id),
  nextMode: text(row.next_mode) as OperatorExecutionMode,
  nextOneShot: text(row.next_one_shot) as OperatorOneShot,
  previousMode: text(row.previous_mode) as OperatorExecutionMode,
  previousOneShot: text(row.previous_one_shot) as OperatorOneShot,
  result: text(row.result),
  role: text(row.role),
  transactionHash:
    typeof row.transaction_hash === "string" ? row.transaction_hash : undefined,
});

export const openOperatorControlStore = (
  path: string,
): OperatorControlStore => {
  const database = new DatabaseSync(path);
  database.exec(SCHEMA);
  if (path !== ":memory:") {
    const row = database.prepare("PRAGMA journal_mode = WAL").get();
    if (text(row?.journal_mode).toLowerCase() !== "wal") {
      throw new Error("Operator control database did not enter WAL mode");
    }
  }

  const writePolicy = (
    policy: OperatorExecutionPolicy,
    updatedAt: number,
  ): void => {
    database
      .prepare(
        `INSERT INTO operator_policy (singleton, mode, one_shot, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           mode = excluded.mode,
           one_shot = excluded.one_shot,
           updated_at = excluded.updated_at`,
      )
      .run(policy.mode, policy.oneShot, updatedAt);
  };

  const readPolicy = (): OperatorExecutionPolicy => {
    const row = database
      .prepare("SELECT mode, one_shot FROM operator_policy WHERE singleton = 1")
      .get();
    // An absent row is a fresh or wiped store, which must fail closed.
    if (row === undefined) return CLOSED_POLICY;
    return {
      mode: text(row.mode) as OperatorExecutionMode,
      oneShot: text(row.one_shot) as OperatorOneShot,
    };
  };

  const readPolicyRevision = (): OperatorPolicyRevision => {
    const row = database
      .prepare(
        "SELECT mode, one_shot, updated_at FROM operator_policy WHERE singleton = 1",
      )
      .get();
    if (row === undefined) return { policy: CLOSED_POLICY, updatedAt: 0 };
    return {
      policy: {
        mode: text(row.mode) as OperatorExecutionMode,
        oneShot: text(row.one_shot) as OperatorOneShot,
      },
      updatedAt: numeric(row.updated_at),
    };
  };

  return {
    readPolicy,
    readPolicyRevision,
    applyCommand: (record) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            `INSERT INTO operator_commands (
               command_id, actor, role, command,
               previous_mode, previous_one_shot, next_mode, next_one_shot,
               result, transaction_hash, applied_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.commandId,
            record.actor.toLowerCase(),
            record.role,
            record.command,
            record.previousMode,
            record.previousOneShot,
            record.nextMode,
            record.nextOneShot,
            record.result,
            record.transactionHash ?? null,
            record.appliedAt,
          );
        if (record.result === "applied") {
          writePolicy(
            { mode: record.nextMode, oneShot: record.nextOneShot },
            record.appliedAt,
          );
        }
        database.exec("COMMIT");
      } catch (cause) {
        database.exec("ROLLBACK");
        throw cause;
      }
    },
    findCommand: (commandId) => {
      const row = database
        .prepare("SELECT * FROM operator_commands WHERE command_id = ?")
        .get(commandId);
      return row === undefined ? undefined : commandRecord(row);
    },
    recentCommands: (limit) =>
      database
        .prepare(
          `SELECT * FROM operator_commands
             ORDER BY applied_at DESC, rowid DESC LIMIT ?`,
        )
        .all(limit)
        .map(commandRecord),
    consumeOneShot: (at) => {
      const current = readPolicy();
      if (current.oneShot === "none") return current;
      const next = { mode: current.mode, oneShot: "none" as const };
      writePolicy(next, at);
      return next;
    },
    recordHeartbeat: ({ at, observedMode, supervisor }) => {
      database
        .prepare(
          `INSERT INTO operator_heartbeat
             (singleton, observed_at, observed_mode, supervisor)
           VALUES (1, ?, ?, ?)
           ON CONFLICT(singleton) DO UPDATE SET
             observed_at = excluded.observed_at,
             observed_mode = excluded.observed_mode,
             supervisor = excluded.supervisor`,
        )
        .run(at, observedMode, supervisor);
    },
    readHeartbeat: () => {
      const row = database
        .prepare("SELECT * FROM operator_heartbeat WHERE singleton = 1")
        .get();
      if (row === undefined) return undefined;
      return {
        at: numeric(row.observed_at),
        observedMode: text(row.observed_mode) as OperatorExecutionMode,
        supervisor: text(row.supervisor),
      };
    },
    startRun: ({ authority, runId, startedAt }) => {
      database
        .prepare(
          `INSERT INTO operator_runs (run_id, authority, outcome, started_at)
           VALUES (?, ?, 'running', ?)
           ON CONFLICT(run_id) DO NOTHING`,
        )
        .run(runId, authority, startedAt);
    },
    finishRun: ({
      finishedAt,
      outcome,
      runId,
      sanitizedFailure,
      transactionHash,
    }) => {
      database
        .prepare(
          `UPDATE operator_runs
           SET outcome = ?, finished_at = ?,
               sanitized_failure = ?, transaction_hash = ?
           WHERE run_id = ?`,
        )
        .run(
          outcome,
          finishedAt,
          sanitizedFailure ?? null,
          transactionHash ?? null,
          runId,
        );
    },
    readLatestRun: () => {
      const row = database
        .prepare(
          "SELECT * FROM operator_runs ORDER BY started_at DESC, rowid DESC LIMIT 1",
        )
        .get();
      if (row === undefined) return undefined;
      return {
        authority: text(row.authority),
        finishedAt:
          typeof row.finished_at === "number" ? row.finished_at : undefined,
        outcome: text(row.outcome),
        runId: text(row.run_id),
        sanitizedFailure:
          typeof row.sanitized_failure === "string"
            ? row.sanitized_failure
            : undefined,
        startedAt: numeric(row.started_at),
        transactionHash:
          typeof row.transaction_hash === "string"
            ? row.transaction_hash
            : undefined,
      };
    },
    acquireWriterLease: ({ holder, leaseMilliseconds, now }) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const row = database
          .prepare(
            "SELECT holder, expires_at FROM operator_writer_lease WHERE singleton = 1",
          )
          .get();
        const held =
          row !== undefined &&
          numeric(row.expires_at) > now &&
          text(row.holder) !== holder;
        if (held) {
          database.exec("ROLLBACK");
          return false;
        }
        database
          .prepare(
            `INSERT INTO operator_writer_lease (singleton, holder, expires_at)
             VALUES (1, ?, ?)
             ON CONFLICT(singleton) DO UPDATE SET
               holder = excluded.holder,
               expires_at = excluded.expires_at`,
          )
          .run(holder, now + leaseMilliseconds);
        database.exec("COMMIT");
        return true;
      } catch (cause) {
        database.exec("ROLLBACK");
        throw cause;
      }
    },
    releaseWriterLease: (holder) => {
      database
        .prepare(
          "DELETE FROM operator_writer_lease WHERE singleton = 1 AND holder = ?",
        )
        .run(holder);
    },
    readWriterLease: () => {
      const row = database
        .prepare(
          "SELECT holder, expires_at FROM operator_writer_lease WHERE singleton = 1",
        )
        .get();
      return row === undefined
        ? undefined
        : { expiresAt: numeric(row.expires_at), holder: text(row.holder) };
    },
    close: () => database.close(),
  };
};
