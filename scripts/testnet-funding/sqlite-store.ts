import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import type { Address, Hex } from "viem";

import type {
  PreparedTestnetFundingTransfer,
  TestnetFundingLedgerIdentity,
} from "./types.ts";

/**
 * Kept at "1" deliberately. The abuse-control tables and the disabled-at
 * metadata row are purely additive and created with IF NOT EXISTS, so an
 * existing ledger opens unchanged. Bumping this would fail closed on every
 * existing database with no migration path.
 */
const SCHEMA_VERSION = "1";

type SqliteRow = Readonly<Record<string, SQLOutputValue>>;

export type FundingTransferState = "prepared" | "broadcast" | "confirmed";

export interface StoredFundingTransfer extends PreparedTestnetFundingTransfer {
  readonly state: FundingTransferState;
  readonly confirmedAt?: number;
}

export interface RecipientFundingPolicy {
  readonly confirmedWethWei: bigint;
  readonly confirmedEthWei: bigint;
  readonly lastConfirmedAt: number | undefined;
}

export interface StoredFundingRequest {
  readonly id: string;
  readonly recipient: Address;
  readonly state: "prepared" | "executing" | "funded" | "failed";
  readonly transfers: readonly StoredFundingTransfer[];
  readonly createdAt: number;
  readonly completedAt: number | undefined;
}

export interface TestnetFundingMetrics {
  readonly successful: number;
  readonly pending: number;
  readonly failed: number;
  readonly rateLimited: number;
}

export type FundingNonceRejection = "unknown" | "consumed" | "expired";

export interface FundingBudgetUsage {
  readonly windowStart: number;
  readonly wethWei: bigint;
  readonly ethWei: bigint;
  readonly grants: number;
}

export interface TestnetFundingStore {
  /** Records an issued challenge so its nonce can only fund once. */
  readonly recordNonce: (input: {
    readonly nonce: string;
    readonly recipient: Address;
    readonly issuedAt: number;
    readonly expiresAt: number;
  }) => void;
  /**
   * Atomically consumes a nonce for one recipient. Returns a rejection rather
   * than throwing so a replay is a deterministic client error.
   */
  readonly consumeNonce: (input: {
    readonly nonce: string;
    readonly recipient: Address;
    readonly nowMilliseconds: number;
  }) =>
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: FundingNonceRejection };
  readonly pruneNonces: (nowMilliseconds: number) => void;
  readonly readBudgetUsage: (windowStart: number) => FundingBudgetUsage;
  readonly recordBudgetSpend: (input: {
    readonly windowStart: number;
    readonly wethWei: bigint;
    readonly ethWei: bigint;
  }) => void;
  /** Counts one funding attempt for a client key inside its window. */
  readonly recordClientAttempt: (input: {
    readonly clientKey: string;
    readonly windowStart: number;
  }) => number;
  readonly readServiceDisabledAt: () => number | undefined;
  readonly setServiceDisabled: (disabledAt: number | undefined) => void;
  readonly createPreparedRequest: (input: {
    readonly id: string;
    readonly recipient: Address;
    readonly transfers: readonly PreparedTestnetFundingTransfer[];
    readonly createdAt: number;
  }) => StoredFundingRequest;
  readonly updateTransferState: (
    requestId: string,
    kind: PreparedTestnetFundingTransfer["kind"],
    state: FundingTransferState,
    updatedAt: number,
  ) => StoredFundingRequest;
  readonly completeRequest: (
    requestId: string,
    completedAt: number,
  ) => StoredFundingRequest;
  readonly failRequest: (requestId: string, completedAt: number) => void;
  readonly readActiveRequest: () => StoredFundingRequest | undefined;
  readonly tryAcquireLease: (input: {
    readonly requestId: string;
    readonly recipient: Address;
    readonly acquiredAt: number;
    readonly expiresAt: number;
  }) => boolean;
  readonly releaseLease: (requestId: string) => void;
  readonly readRecipientPolicy: (recipient: Address) => RecipientFundingPolicy;
  readonly recordDenial: (
    recipient: Address,
    code: "funding-rate-limited" | "funding-lifetime-limit",
    createdAt: number,
  ) => void;
  readonly readMetrics: () => TestnetFundingMetrics;
  readonly close: () => void;
}

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

const initialize = (database: DatabaseSync, inMemory: boolean): void => {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (!inMemory) {
    const row = database.prepare("PRAGMA journal_mode = WAL").get();
    if (text(row?.journal_mode).toLowerCase() !== "wal") {
      throw new Error("Funding database did not enter WAL journal mode");
    }
  }
  database.exec(`
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS funding_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS funding_requests (
      request_id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'executing', 'funded', 'failed')),
      transfers_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS funding_requests_recipient
      ON funding_requests (recipient, created_at DESC);
    CREATE TABLE IF NOT EXISTS funding_denials (
      denial_id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS funding_lease (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      request_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
    -- Single-use wallet-control proofs. A consumed nonce can never fund again.
    CREATE TABLE IF NOT EXISTS funding_nonces (
      nonce TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS funding_nonces_expiry
      ON funding_nonces (expires_at);
    -- Service-wide spend per window, so a restart cannot reset the budget.
    CREATE TABLE IF NOT EXISTS funding_budget (
      window_start INTEGER PRIMARY KEY,
      weth_wei TEXT NOT NULL,
      eth_wei TEXT NOT NULL,
      grants INTEGER NOT NULL
    ) STRICT;
    -- Funding-specific per-client throttling, durable across restarts.
    CREATE TABLE IF NOT EXISTS funding_client_attempts (
      client_key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      PRIMARY KEY (client_key, window_start)
    ) STRICT;
  `);
};

const expectedMetadata = (
  identity: TestnetFundingLedgerIdentity,
): Readonly<Record<string, string>> => ({
  schema_version: SCHEMA_VERSION,
  chain_id: identity.chainId.toString(),
  signer: identity.signer.toLowerCase(),
});

const verifyMetadata = (
  database: DatabaseSync,
  identity: TestnetFundingLedgerIdentity,
): void => {
  const select = database.prepare(
    "SELECT value FROM funding_metadata WHERE key = ?",
  );
  const insert = database.prepare(
    "INSERT INTO funding_metadata (key, value) VALUES (?, ?)",
  );
  for (const [key, expected] of Object.entries(expectedMetadata(identity))) {
    const row = select.get(key);
    if (row === undefined) {
      insert.run(key, expected);
      continue;
    }
    if (text(row.value) !== expected) {
      throw new Error(`Funding database ${key} does not match configuration`);
    }
  }
};

const serializeTransfers = (
  transfers: readonly StoredFundingTransfer[],
): string =>
  JSON.stringify(
    transfers.map((transfer) => ({
      ...transfer,
      amountWei: transfer.amountWei.toString(),
    })),
  );

const parseTransfers = (value: string): readonly StoredFundingTransfer[] => {
  const parsed = JSON.parse(value) as Array<{
    readonly amountWei: string;
    readonly hash: Hex;
    readonly kind: PreparedTestnetFundingTransfer["kind"];
    readonly rawTransaction: Hex;
    readonly state: FundingTransferState;
    readonly confirmedAt?: number;
  }>;
  return parsed.map((transfer) => ({
    ...transfer,
    amountWei: BigInt(transfer.amountWei),
  }));
};

const requestFromRow = (row: SqliteRow): StoredFundingRequest => ({
  id: text(row.request_id),
  recipient: text(row.recipient) as Address,
  state: text(row.state) as StoredFundingRequest["state"],
  transfers: parseTransfers(text(row.transfers_json)),
  createdAt: numeric(row.created_at),
  completedAt:
    row.completed_at === null ? undefined : numeric(row.completed_at),
});

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

const secureDatabaseFiles = (path: string): void => {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
};

export const openTestnetFundingStore = (
  path: string,
  identity: TestnetFundingLedgerIdentity,
): TestnetFundingStore => {
  const inMemory = path === ":memory:";
  const database = new DatabaseSync(path);
  initialize(database, inMemory);
  verifyMetadata(database, identity);
  if (!inMemory) secureDatabaseFiles(path);
  const selectRequest = database.prepare(
    "SELECT * FROM funding_requests WHERE request_id = ?",
  );
  const readRequest = (requestId: string): StoredFundingRequest => {
    const row = selectRequest.get(requestId);
    if (row === undefined) throw new Error("Funding request is missing");
    return requestFromRow(row);
  };
  const writeRequest = (
    request: StoredFundingRequest,
    updatedAt: number,
  ): void => {
    database
      .prepare(
        `UPDATE funding_requests
         SET state = ?, transfers_json = ?, updated_at = ?, completed_at = ?
         WHERE request_id = ?`,
      )
      .run(
        request.state,
        serializeTransfers(request.transfers),
        updatedAt,
        request.completedAt ?? null,
        request.id,
      );
  };
  return {
    createPreparedRequest: ({ id, recipient, transfers, createdAt }) =>
      runTransaction(database, () => {
        const stored = transfers.map((transfer) => ({
          ...transfer,
          state: "prepared" as const,
        }));
        database
          .prepare(
            `INSERT INTO funding_requests (
               request_id, recipient, state, transfers_json,
               created_at, updated_at, completed_at
             ) VALUES (?, ?, 'prepared', ?, ?, ?, NULL)`,
          )
          .run(
            id,
            recipient.toLowerCase(),
            serializeTransfers(stored),
            createdAt,
            createdAt,
          );
        return readRequest(id);
      }),
    updateTransferState: (requestId, kind, state, updatedAt) =>
      runTransaction(database, () => {
        const request = readRequest(requestId);
        const transfers = request.transfers.map((transfer) =>
          transfer.kind === kind
            ? {
                ...transfer,
                state,
                ...(state === "confirmed" ? { confirmedAt: updatedAt } : {}),
              }
            : transfer,
        );
        const updated: StoredFundingRequest = {
          ...request,
          state: state === "prepared" ? request.state : "executing",
          transfers,
        };
        writeRequest(updated, updatedAt);
        return readRequest(requestId);
      }),
    completeRequest: (requestId, completedAt) =>
      runTransaction(database, () => {
        const request = readRequest(requestId);
        if (
          request.transfers.some((transfer) => transfer.state !== "confirmed")
        ) {
          throw new Error(
            "Funding request cannot complete before confirmation",
          );
        }
        const completed: StoredFundingRequest = {
          ...request,
          state: "funded",
          completedAt,
        };
        writeRequest(completed, completedAt);
        return readRequest(requestId);
      }),
    failRequest: (requestId, completedAt) =>
      runTransaction(database, () => {
        const request: StoredFundingRequest = {
          ...readRequest(requestId),
          state: "failed",
          completedAt,
        };
        writeRequest(request, completedAt);
      }),
    readActiveRequest: () => {
      const row = database
        .prepare(
          `SELECT * FROM funding_requests
             WHERE state IN ('prepared', 'executing')
             ORDER BY created_at ASC LIMIT 1`,
        )
        .get();
      return row === undefined ? undefined : requestFromRow(row);
    },
    tryAcquireLease: ({ requestId, recipient, acquiredAt, expiresAt }) =>
      runTransaction(database, () => {
        const lease = database
          .prepare("SELECT * FROM funding_lease WHERE singleton = 1")
          .get();
        if (
          lease !== undefined &&
          text(lease.request_id) !== requestId &&
          numeric(lease.expires_at) > acquiredAt
        ) {
          return false;
        }
        database
          .prepare(
            `INSERT INTO funding_lease (
               singleton, request_id, recipient, acquired_at, expires_at
             ) VALUES (1, ?, ?, ?, ?)
             ON CONFLICT(singleton) DO UPDATE SET
               request_id = excluded.request_id,
               recipient = excluded.recipient,
               acquired_at = excluded.acquired_at,
               expires_at = excluded.expires_at`,
          )
          .run(requestId, recipient.toLowerCase(), acquiredAt, expiresAt);
        return true;
      }),
    releaseLease: (requestId) => {
      database
        .prepare(
          "DELETE FROM funding_lease WHERE singleton = 1 AND request_id = ?",
        )
        .run(requestId);
    },
    readRecipientPolicy: (recipient) => {
      let confirmedWethWei = 0n;
      let confirmedEthWei = 0n;
      let lastConfirmedAt: number | undefined;
      for (const row of database
        .prepare(
          "SELECT transfers_json FROM funding_requests WHERE recipient = ?",
        )
        .all(recipient.toLowerCase())) {
        for (const transfer of parseTransfers(text(row.transfers_json))) {
          if (transfer.state !== "confirmed") continue;
          if (transfer.kind === "weth") confirmedWethWei += transfer.amountWei;
          if (transfer.kind === "eth") confirmedEthWei += transfer.amountWei;
          if (
            transfer.confirmedAt !== undefined &&
            (lastConfirmedAt === undefined ||
              transfer.confirmedAt > lastConfirmedAt)
          ) {
            lastConfirmedAt = transfer.confirmedAt;
          }
        }
      }
      return { confirmedWethWei, confirmedEthWei, lastConfirmedAt };
    },
    recordDenial: (recipient, code, createdAt) => {
      database
        .prepare(
          "INSERT INTO funding_denials (recipient, code, created_at) VALUES (?, ?, ?)",
        )
        .run(recipient.toLowerCase(), code, createdAt);
    },
    readMetrics: () => {
      const counts = new Map<string, number>();
      for (const row of database
        .prepare(
          "SELECT state, COUNT(*) AS count FROM funding_requests GROUP BY state",
        )
        .all()) {
        counts.set(text(row.state), numeric(row.count));
      }
      const rateLimited = numeric(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM funding_denials
               WHERE code IN ('funding-rate-limited', 'funding-lifetime-limit')`,
          )
          .get()?.count,
      );
      return {
        successful: counts.get("funded") ?? 0,
        pending: (counts.get("prepared") ?? 0) + (counts.get("executing") ?? 0),
        failed: counts.get("failed") ?? 0,
        rateLimited,
      };
    },
    recordNonce: ({ nonce, recipient, issuedAt, expiresAt }) => {
      database
        .prepare(
          `INSERT INTO funding_nonces
             (nonce, recipient, issued_at, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(nonce) DO NOTHING`,
        )
        .run(nonce, recipient.toLowerCase(), issuedAt, expiresAt);
    },
    consumeNonce: ({ nonce, recipient, nowMilliseconds }) => {
      const row = database
        .prepare(
          `SELECT recipient, expires_at, consumed_at
             FROM funding_nonces WHERE nonce = ?`,
        )
        .get(nonce);
      if (row === undefined) return { ok: false, reason: "unknown" } as const;
      if (row.consumed_at !== null && row.consumed_at !== undefined) {
        return { ok: false, reason: "consumed" } as const;
      }
      if (
        text(row.recipient) !== recipient.toLowerCase() ||
        numeric(row.expires_at) <= nowMilliseconds
      ) {
        return { ok: false, reason: "expired" } as const;
      }
      // A conditional update makes the consumption atomic under concurrency.
      const consumed = database
        .prepare(
          `UPDATE funding_nonces SET consumed_at = ?
           WHERE nonce = ? AND consumed_at IS NULL`,
        )
        .run(nowMilliseconds, nonce);
      return consumed.changes === 1
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "consumed" } as const);
    },
    pruneNonces: (nowMilliseconds) => {
      database
        .prepare("DELETE FROM funding_nonces WHERE expires_at <= ?")
        .run(nowMilliseconds);
    },
    readBudgetUsage: (windowStart) => {
      const row = database
        .prepare(
          `SELECT weth_wei, eth_wei, grants FROM funding_budget
             WHERE window_start = ?`,
        )
        .get(windowStart);
      if (row === undefined) {
        return { windowStart, wethWei: 0n, ethWei: 0n, grants: 0 };
      }
      return {
        windowStart,
        wethWei: BigInt(text(row.weth_wei)),
        ethWei: BigInt(text(row.eth_wei)),
        grants: numeric(row.grants),
      };
    },
    recordBudgetSpend: ({ windowStart, wethWei, ethWei }) => {
      database
        .prepare(
          `INSERT INTO funding_budget (window_start, weth_wei, eth_wei, grants)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(window_start) DO UPDATE SET
             weth_wei = CAST(
               CAST(funding_budget.weth_wei AS INTEGER) + CAST(excluded.weth_wei AS INTEGER)
               AS TEXT
             ),
             eth_wei = CAST(
               CAST(funding_budget.eth_wei AS INTEGER) + CAST(excluded.eth_wei AS INTEGER)
               AS TEXT
             ),
             grants = funding_budget.grants + 1`,
        )
        .run(windowStart, wethWei.toString(), ethWei.toString());
    },
    recordClientAttempt: ({ clientKey, windowStart }) => {
      database
        .prepare(
          `INSERT INTO funding_client_attempts (client_key, window_start, attempts)
           VALUES (?, ?, 1)
           ON CONFLICT(client_key, window_start) DO UPDATE SET
             attempts = funding_client_attempts.attempts + 1`,
        )
        .run(clientKey, windowStart);
      return numeric(
        database
          .prepare(
            `SELECT attempts FROM funding_client_attempts
               WHERE client_key = ? AND window_start = ?`,
          )
          .get(clientKey, windowStart)?.attempts,
      );
    },
    readServiceDisabledAt: () => {
      const row = database
        .prepare("SELECT value FROM funding_metadata WHERE key = ?")
        .get("service_disabled_at");
      if (row === undefined) return undefined;
      const parsed = Number(text(row.value));
      return Number.isFinite(parsed) ? parsed : undefined;
    },
    setServiceDisabled: (disabledAt) => {
      if (disabledAt === undefined) {
        database
          .prepare("DELETE FROM funding_metadata WHERE key = ?")
          .run("service_disabled_at");
        return;
      }
      database
        .prepare(
          `INSERT INTO funding_metadata (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run("service_disabled_at", String(disabledAt));
    },
    close: () => database.close(),
  };
};
