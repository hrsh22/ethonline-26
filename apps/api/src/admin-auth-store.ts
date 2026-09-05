import { createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { configureSqlite, verifySqliteIntegrity } from "@orbit/config/sqlite";
import type { Address, Hex } from "viem";

const SCHEMA_VERSION = "1";
const PRUNE_BATCH_SIZE = 256;

export interface StoredAdminChallenge {
  readonly address: Address;
  readonly deploymentFingerprint: Hex;
  readonly expiresAt: number;
  readonly issuedAt: number;
}

export interface StoredAdminSession {
  readonly address: Address;
  readonly bindingsFingerprint: Hex;
  readonly createdAt: number;
  readonly deploymentFingerprint: Hex;
  readonly expiresAt: number;
}

export interface CreateAdminSessionInput extends Omit<
  StoredAdminSession,
  "deploymentFingerprint"
> {
  readonly csrfToken: string;
  readonly nonce: string;
  readonly now: number;
  readonly sessionHandle: string;
}

export interface AdminAuthStore {
  readonly consumeChallenge: (input: {
    readonly address: Address;
    readonly nonce: string;
    readonly now: number;
  }) => boolean;
  readonly createChallenge: (
    input: StoredAdminChallenge & {
      readonly nonce: string;
    },
  ) => void;
  readonly readChallenge: (
    nonce: string,
    now: number,
  ) => StoredAdminChallenge | undefined;
  readonly consumeChallengeAndCreateSession: (
    input: CreateAdminSessionInput,
  ) => boolean;
  readonly readSession: (
    sessionHandle: string,
    now: number,
  ) => StoredAdminSession | undefined;
  readonly matchesCsrf: (
    sessionHandle: string,
    csrfToken: string,
    now: number,
  ) => boolean;
  readonly revokeSession: (sessionHandle: string, revokedAt: number) => boolean;
  readonly close: () => void;
}

export interface AdminAuthStoreIdentity {
  readonly deploymentFingerprint: Hex;
}

const digest = (domain: string, secret: string): Uint8Array =>
  createHash("sha256")
    .update(`orbit-admin-auth:${domain}\0`, "utf8")
    .update(secret, "utf8")
    .digest();

const text = (value: SQLOutputValue | undefined): string => {
  if (typeof value !== "string") throw new TypeError("Expected SQLite text");
  return value;
};

const numeric = (value: SQLOutputValue | undefined): number => {
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError("Expected SQLite number");
  }
  return Number(value);
};

const bytes = (value: SQLOutputValue | undefined): Uint8Array => {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("Expected SQLite bytes");
  }
  return value;
};

const runTransaction = <Value>(
  database: DatabaseSync,
  operation: () => Value,
): Value => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
};

export const openAdminAuthStore = (
  path: string,
  identity: AdminAuthStoreIdentity,
): AdminAuthStore => {
  const database = new DatabaseSync(path);
  const secureDatabaseFiles = (): void => {
    if (path === ":memory:") return;
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) chmodSync(candidate, 0o600);
    }
  };
  const initialize = (): void => {
    configureSqlite(database, "Admin auth", { wal: path !== ":memory:" });
    database.exec(`
    CREATE TABLE IF NOT EXISTS admin_auth_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS admin_auth_challenges (
      nonce_hash BLOB PRIMARY KEY,
      address TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      deployment_fingerprint TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS admin_auth_sessions (
      handle_hash BLOB PRIMARY KEY,
      address TEXT NOT NULL,
      csrf_hash BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      deployment_fingerprint TEXT NOT NULL,
      bindings_fingerprint TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS admin_auth_challenges_expiry
      ON admin_auth_challenges (expires_at);
    CREATE INDEX IF NOT EXISTS admin_auth_sessions_expiry
      ON admin_auth_sessions (expires_at);
    `);
    verifySqliteIntegrity(database, "Admin auth");
    secureDatabaseFiles();
    runTransaction(database, () => {
      const select = database.prepare(
        "SELECT value FROM admin_auth_metadata WHERE key = ?",
      );
      const insert = database.prepare(
        "INSERT INTO admin_auth_metadata (key, value) VALUES (?, ?)",
      );
      const schema = select.get("schema_version");
      if (schema === undefined) insert.run("schema_version", SCHEMA_VERSION);
      else if (text(schema.value) !== SCHEMA_VERSION) {
        throw new Error("Admin auth database schema version is unsupported");
      }
      const fingerprint = select.get("deployment_fingerprint");
      if (fingerprint === undefined) {
        insert.run("deployment_fingerprint", identity.deploymentFingerprint);
        return;
      }
      if (text(fingerprint.value) === identity.deploymentFingerprint) return;
      database.exec(
        "DELETE FROM admin_auth_challenges; DELETE FROM admin_auth_sessions;",
      );
      database
        .prepare(
          "UPDATE admin_auth_metadata SET value = ? WHERE key = 'deployment_fingerprint'",
        )
        .run(identity.deploymentFingerprint);
    });
  };
  try {
    initialize();
  } catch (cause) {
    try {
      secureDatabaseFiles();
    } finally {
      database.close();
    }
    throw cause;
  }

  return {
    consumeChallenge: (input) => {
      const consumed = database
        .prepare(
          `UPDATE admin_auth_challenges
           SET consumed_at = ?
           WHERE nonce_hash = ?
             AND address = ?
             AND consumed_at IS NULL
             AND expires_at > ?
             AND deployment_fingerprint = ?`,
        )
        .run(
          input.now,
          digest("challenge", input.nonce),
          input.address,
          input.now,
          identity.deploymentFingerprint,
        );
      return Number(consumed.changes) === 1;
    },
    consumeChallengeAndCreateSession: (input) =>
      runTransaction(database, () => {
        const consumed = database
          .prepare(
            `UPDATE admin_auth_challenges
             SET consumed_at = ?
             WHERE nonce_hash = ?
               AND address = ?
               AND consumed_at IS NULL
               AND expires_at > ?
               AND deployment_fingerprint = ?`,
          )
          .run(
            input.now,
            digest("challenge", input.nonce),
            input.address,
            input.now,
            identity.deploymentFingerprint,
          );
        if (Number(consumed.changes) !== 1) return false;
        database
          .prepare(
            `INSERT INTO admin_auth_sessions (
               handle_hash, address, csrf_hash, created_at, expires_at,
               revoked_at, deployment_fingerprint, bindings_fingerprint
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            digest("session", input.sessionHandle),
            input.address,
            digest("csrf", input.csrfToken),
            input.createdAt,
            input.expiresAt,
            identity.deploymentFingerprint,
            input.bindingsFingerprint,
          );
        return true;
      }),
    createChallenge: (input) => {
      runTransaction(database, () => {
        database
          .prepare(
            `DELETE FROM admin_auth_challenges
             WHERE rowid IN (
               SELECT rowid
               FROM admin_auth_challenges
               WHERE expires_at <= ?
               ORDER BY expires_at
               LIMIT ?
             )`,
          )
          .run(input.issuedAt, PRUNE_BATCH_SIZE);
        database
          .prepare(
            `DELETE FROM admin_auth_sessions
             WHERE rowid IN (
               SELECT rowid
               FROM admin_auth_sessions
               WHERE expires_at <= ?
               ORDER BY expires_at
               LIMIT ?
             )`,
          )
          .run(input.issuedAt, PRUNE_BATCH_SIZE);
        database
          .prepare(
            `INSERT INTO admin_auth_challenges (
               nonce_hash, address, issued_at, expires_at, consumed_at,
               deployment_fingerprint
             ) VALUES (?, ?, ?, ?, NULL, ?)`,
          )
          .run(
            digest("challenge", input.nonce),
            input.address,
            input.issuedAt,
            input.expiresAt,
            input.deploymentFingerprint,
          );
      });
    },
    matchesCsrf: (sessionHandle, csrfToken, now) => {
      const row = database
        .prepare(
          `SELECT csrf_hash
             FROM admin_auth_sessions
             WHERE handle_hash = ?
               AND revoked_at IS NULL
               AND expires_at > ?
               AND deployment_fingerprint = ?`,
        )
        .get(
          digest("session", sessionHandle),
          now,
          identity.deploymentFingerprint,
        );
      if (row === undefined) return false;
      const actual = Buffer.from(bytes(row.csrf_hash));
      const expected = Buffer.from(digest("csrf", csrfToken));
      return (
        actual.byteLength === expected.byteLength &&
        timingSafeEqual(actual, expected)
      );
    },
    readChallenge: (nonce, now) => {
      const row = database
        .prepare(
          `SELECT address, issued_at, expires_at, deployment_fingerprint
             FROM admin_auth_challenges
             WHERE nonce_hash = ?
               AND consumed_at IS NULL
               AND expires_at > ?
               AND deployment_fingerprint = ?`,
        )
        .get(digest("challenge", nonce), now, identity.deploymentFingerprint);
      if (row === undefined) return undefined;
      return {
        address: text(row.address) as Address,
        deploymentFingerprint: text(row.deployment_fingerprint) as Hex,
        expiresAt: numeric(row.expires_at),
        issuedAt: numeric(row.issued_at),
      };
    },
    revokeSession: (sessionHandle, revokedAt) => {
      const result = database
        .prepare(
          `UPDATE admin_auth_sessions
           SET revoked_at = ?
           WHERE handle_hash = ?
             AND revoked_at IS NULL
             AND deployment_fingerprint = ?`,
        )
        .run(
          revokedAt,
          digest("session", sessionHandle),
          identity.deploymentFingerprint,
        );
      return Number(result.changes) === 1;
    },
    readSession: (sessionHandle, now) => {
      const row = database
        .prepare(
          `SELECT address, created_at, expires_at, deployment_fingerprint,
                    bindings_fingerprint
             FROM admin_auth_sessions
             WHERE handle_hash = ?
               AND revoked_at IS NULL
               AND expires_at > ?
               AND deployment_fingerprint = ?`,
        )
        .get(
          digest("session", sessionHandle),
          now,
          identity.deploymentFingerprint,
        );
      if (row === undefined) return undefined;
      return {
        address: text(row.address) as Address,
        bindingsFingerprint: text(row.bindings_fingerprint) as Hex,
        createdAt: numeric(row.created_at),
        deploymentFingerprint: text(row.deployment_fingerprint) as Hex,
        expiresAt: numeric(row.expires_at),
      };
    },
    close: () => {
      secureDatabaseFiles();
      database.close();
    },
  };
};
