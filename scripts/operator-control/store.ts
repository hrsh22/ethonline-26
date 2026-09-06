import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { configureSqlite, verifySqliteIntegrity } from "@orbit/config/sqlite";

import type {
  OperatorCommandName,
  OperatorExecutionMode,
  OperatorOneShot,
} from "@orbit/config/operator-control";

import {
  CLOSED_POLICY,
  cycleAuthority,
  type CycleAuthority,
  type OperatorExecutionPolicy,
} from "./policy.ts";

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
  /** Only supervisor startup sets this, atomically with a fail-closed reset. */
  readonly deploymentFingerprint?: string;
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
  readonly deploymentFingerprint?: string;
  readonly policy: OperatorExecutionPolicy;
  readonly revision: number;
  readonly stopRevision: number;
  readonly updatedAt: number;
}

export interface OperatorControlStore {
  readonly claimRun: (input: {
    readonly runId: string;
    readonly supervisor: string;
    readonly at: number;
  }) => {
    readonly policy: OperatorExecutionPolicy;
    readonly authority: CycleAuthority;
  };
  readonly maySign: (runId: string, now: number) => boolean;
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
  readonly renewWriterLease: (input: {
    readonly holder: string;
    readonly now: number;
    readonly leaseMilliseconds: number;
  }) => boolean;
  readonly readWriterLease: () =>
    { readonly expiresAt: number; readonly holder: string } | undefined;
  readonly close: () => void;
}

const SCHEMA = `
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
  try {
    configureSqlite(database, "Operator control", { wal: path !== ":memory:" });
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(SCHEMA);
      const policyColumns = database
        .prepare("PRAGMA table_info(operator_policy)")
        .all();
      if (!policyColumns.some((column) => column.name === "revision")) {
        database.exec(`ALTER TABLE operator_policy ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE operator_policy ADD COLUMN stop_revision INTEGER NOT NULL DEFAULT 0;`);
      }
      if (
        !policyColumns.some(
          (column) => column.name === "deployment_fingerprint",
        )
      ) {
        database.exec(
          "ALTER TABLE operator_policy ADD COLUMN deployment_fingerprint TEXT",
        );
      }
      const runColumns = database
        .prepare("PRAGMA table_info(operator_runs)")
        .all();
      if (!runColumns.some((column) => column.name === "supervisor")) {
        database.exec(`ALTER TABLE operator_runs ADD COLUMN supervisor TEXT;
          ALTER TABLE operator_runs ADD COLUMN policy_revision INTEGER;`);
      }
      verifySqliteIntegrity(database, "Operator control");
      database.exec("COMMIT");
    } catch (cause) {
      database.exec("ROLLBACK");
      throw cause;
    }
  } catch (cause) {
    database.close();
    throw cause;
  }

  const writePolicy = (
    policy: OperatorExecutionPolicy,
    updatedAt: number,
    revoke = false,
  ): void => {
    database
      .prepare(
        `INSERT INTO operator_policy (singleton, mode, one_shot, updated_at, revision, stop_revision)
         VALUES (1, ?, ?, ?, 1, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           mode = excluded.mode,
           one_shot = excluded.one_shot,
           updated_at = excluded.updated_at,
           revision = operator_policy.revision + 1,
           stop_revision = CASE WHEN ? THEN operator_policy.revision + 1 ELSE operator_policy.stop_revision END`,
      )
      .run(
        policy.mode,
        policy.oneShot,
        updatedAt,
        Number(revoke),
        Number(revoke),
      );
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
      .prepare("SELECT * FROM operator_policy WHERE singleton = 1")
      .get();
    if (row === undefined)
      return {
        policy: CLOSED_POLICY,
        revision: 0,
        stopRevision: 0,
        updatedAt: 0,
      };
    return {
      ...(typeof row.deployment_fingerprint === "string"
        ? { deploymentFingerprint: row.deployment_fingerprint }
        : {}),
      policy: {
        mode: text(row.mode) as OperatorExecutionMode,
        oneShot: text(row.one_shot) as OperatorOneShot,
      },
      updatedAt: numeric(row.updated_at),
      revision: numeric(row.revision),
      stopRevision: numeric(row.stop_revision),
    };
  };

  const store: OperatorControlStore = {
    claimRun: ({ runId, supervisor, at }) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const lease = store.readWriterLease();
        if (lease?.holder !== supervisor || lease.expiresAt <= at)
          throw new Error("Operator writer lease is unavailable");
        const policy = readPolicy();
        const authority = cycleAuthority(policy);
        store.consumeOneShot(at);
        if (authority !== "skip")
          database
            .prepare(
              `INSERT INTO operator_runs
          (run_id, authority, outcome, started_at, supervisor, policy_revision)
          VALUES (?, ?, 'running', ?, ?, ?)`,
            )
            .run(
              runId,
              authority,
              at,
              supervisor,
              readPolicyRevision().revision,
            );
        store.recordHeartbeat({ at, observedMode: policy.mode, supervisor });
        database.exec("COMMIT");
        return { policy, authority };
      } catch (cause) {
        database.exec("ROLLBACK");
        throw cause;
      }
    },
    maySign: (runId, now) =>
      database
        .prepare(
          `SELECT 1 FROM operator_runs AS run
      JOIN operator_writer_lease AS lease ON lease.holder = run.supervisor AND lease.singleton = 1
      JOIN operator_policy AS policy ON policy.singleton = 1
      WHERE run.run_id = ? AND run.authority = 'execute' AND run.outcome = 'running'
        AND lease.expires_at > ? AND policy.stop_revision <= run.policy_revision`,
        )
        .get(runId, now) !== undefined,
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
        if (record.result === "applied" || record.command === "stop") {
          writePolicy(
            { mode: record.nextMode, oneShot: record.nextOneShot },
            record.appliedAt,
            record.command === "stop" || record.command === "enable-dry-run",
          );
        }
        if (record.deploymentFingerprint !== undefined) {
          database
            .prepare(
              "UPDATE operator_policy SET deployment_fingerprint = ? WHERE singleton = 1",
            )
            .run(record.deploymentFingerprint);
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
    renewWriterLease: ({ holder, leaseMilliseconds, now }) =>
      database
        .prepare(
          `UPDATE operator_writer_lease SET expires_at = ?
        WHERE singleton = 1 AND holder = ? AND expires_at > ?`,
        )
        .run(now + leaseMilliseconds, holder, now).changes === 1,
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
  return store;
};
