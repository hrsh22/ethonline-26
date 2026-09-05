import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import type { Address, Hex } from "viem";

import type { ReplenishAmounts } from "./configuration.ts";

const SCHEMA_VERSION = "1";

export const REPLENISH_WINDOW_MILLISECONDS = 86_400_000;

type SqliteRow = Readonly<Record<string, SQLOutputValue>>;

export type ReplenishmentAsset = "weth" | "eth";
/**
 * `failed` exists so a reverted transfer stops counting against the window
 * ceiling. Its nonce was consumed but nothing moved, so charging the treasury
 * for it would shrink the day's real allowance.
 */
export type ReplenishmentState =
  "prepared" | "broadcast" | "confirmed" | "failed";

export interface StoredReplenishment {
  readonly id: string;
  readonly asset: ReplenishmentAsset;
  readonly amountWei: bigint;
  readonly hash: Hex;
  readonly rawTransaction: Hex;
  readonly state: ReplenishmentState;
  readonly windowStart: number;
}

export interface ReplenishLedgerIdentity {
  readonly chainId: number;
  readonly signer: Address;
  readonly treasury: Address;
}

export interface ReplenishLedger {
  /**
   * Spend already committed in this window. Counts prepared and broadcast rows
   * as well as confirmed ones: a signed transaction can still land, so treating
   * it as unspent would let a restart loop walk straight past the ceiling.
   */
  readonly readWindowUsage: (windowStart: number) => ReplenishAmounts;
  /** Signed transfers that have not been observed on chain yet. */
  readonly readUnsettled: () => readonly StoredReplenishment[];
  readonly recordPrepared: (
    replenishment: StoredReplenishment,
    createdAt: number,
  ) => void;
  readonly updateState: (
    id: string,
    state: ReplenishmentState,
    atMilliseconds: number,
  ) => void;
  readonly close: () => void;
}

export const replenishWindowStart = (nowMilliseconds: number): number =>
  Math.floor(nowMilliseconds / REPLENISH_WINDOW_MILLISECONDS) *
  REPLENISH_WINDOW_MILLISECONDS;

const text = (value: SQLOutputValue | undefined): string => {
  if (typeof value !== "string") throw new TypeError("Expected text");
  return value;
};

const numeric = (value: SQLOutputValue | undefined): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError("Expected a number");
};

const initialize = (database: DatabaseSync, inMemory: boolean): void => {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (!inMemory) {
    database.prepare("PRAGMA journal_mode = WAL").get();
    // A signed transfer must survive a crash between persistence and
    // broadcast, or the ledger under-counts a spend that still lands.
    database.exec("PRAGMA synchronous = FULL;");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS replenish_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS replenishments (
      id TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      asset TEXT NOT NULL,
      amount_wei TEXT NOT NULL,
      hash TEXT NOT NULL,
      raw_transaction TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS replenishments_window
      ON replenishments (window_start);
  `);
};

const expectedMetadata = (
  identity: ReplenishLedgerIdentity,
): Readonly<Record<string, string>> => ({
  chain_id: identity.chainId.toString(),
  schema_version: SCHEMA_VERSION,
  signer: identity.signer.toLowerCase(),
  treasury: identity.treasury.toLowerCase(),
});

/**
 * Binds the ledger to one treasury and one destination. Pointing a configured
 * pair at another pair's history would silently inherit its window ceiling.
 */
const verifyMetadata = (
  database: DatabaseSync,
  identity: ReplenishLedgerIdentity,
): void => {
  const select = database.prepare(
    "SELECT value FROM replenish_metadata WHERE key = ?",
  );
  const insert = database.prepare(
    "INSERT INTO replenish_metadata (key, value) VALUES (?, ?)",
  );
  for (const [key, expected] of Object.entries(expectedMetadata(identity))) {
    const row = select.get(key);
    if (row === undefined) {
      insert.run(key, expected);
      continue;
    }
    if (text(row.value) !== expected) {
      throw new Error(`Replenish ledger ${key} does not match configuration`);
    }
  }
};

const secureDatabaseFiles = (path: string): void => {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
};

const replenishmentFromRow = (row: SqliteRow): StoredReplenishment => ({
  amountWei: BigInt(text(row.amount_wei)),
  asset: text(row.asset) as ReplenishmentAsset,
  hash: text(row.hash) as Hex,
  id: text(row.id),
  rawTransaction: text(row.raw_transaction) as Hex,
  state: text(row.state) as ReplenishmentState,
  windowStart: numeric(row.window_start),
});

export const openReplenishLedger = (
  path: string,
  identity: ReplenishLedgerIdentity,
): ReplenishLedger => {
  const inMemory = path === ":memory:";
  const database = new DatabaseSync(path);
  try {
    initialize(database, inMemory);
    verifyMetadata(database, identity);
  } catch (cause) {
    database.close();
    throw cause;
  }
  if (!inMemory) secureDatabaseFiles(path);

  const selectUsage = database.prepare(`
    SELECT asset, amount_wei FROM replenishments
    WHERE window_start = ? AND state IN ('prepared', 'broadcast', 'confirmed')
  `);
  const selectUnsettled = database.prepare(
    "SELECT * FROM replenishments WHERE state IN ('prepared', 'broadcast') ORDER BY created_at",
  );
  const insert = database.prepare(`
    INSERT INTO replenishments (
      id, window_start, asset, amount_wei, hash, raw_transaction, state,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = database.prepare(
    "UPDATE replenishments SET state = ?, confirmed_at = ? WHERE id = ?",
  );

  return {
    close: () => database.close(),
    readUnsettled: () => selectUnsettled.all().map(replenishmentFromRow),
    readWindowUsage: (windowStart) =>
      selectUsage.all(windowStart).reduce<ReplenishAmounts>(
        (usage, row) => {
          const amount = BigInt(text(row.amount_wei));
          return text(row.asset) === "eth"
            ? { ethWei: usage.ethWei + amount, wethWei: usage.wethWei }
            : { ethWei: usage.ethWei, wethWei: usage.wethWei + amount };
        },
        { ethWei: 0n, wethWei: 0n },
      ),
    recordPrepared: (replenishment, createdAt) => {
      insert.run(
        replenishment.id,
        replenishment.windowStart,
        replenishment.asset,
        replenishment.amountWei.toString(),
        replenishment.hash,
        replenishment.rawTransaction,
        "prepared",
        createdAt,
      );
      if (!inMemory) secureDatabaseFiles(path);
    },
    updateState: (id, state, atMilliseconds) => {
      update.run(state, state === "confirmed" ? atMilliseconds : null, id);
    },
  };
};
