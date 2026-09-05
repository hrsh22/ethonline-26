import { randomUUID } from "node:crypto";
import {
  DatabaseSync,
  type StatementSync,
  type SQLOutputValue,
} from "node:sqlite";

import { configureSqlite, verifySqliteIntegrity } from "@orbit/config/sqlite";
import { Effect, Scope } from "effect";
import type { Hex } from "viem";

import type { HistoryIndexConfiguration } from "./configuration.ts";
import { HistoryPersistenceError } from "./errors.ts";
import type {
  CanonicalHeader,
  CanonicalRangeReplacement,
  HistoryCheckpoint,
  HistoryEventName,
  HistoryIndexSnapshot,
  HistoryPage,
  HistoryQuery,
  IndexedHistoryEvent,
} from "./model.ts";

const SCHEMA_VERSION = "3";

type SqliteRow = Readonly<Record<string, SQLOutputValue>>;

interface HistoryCursor {
  readonly blockNumber: bigint;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly blockHash: Hex;
  readonly snapshot: HistoryCheckpoint;
  readonly revision: number;
  readonly generation: string;
  readonly queryKey: string;
}

export interface HistoryStore {
  readonly readCheckpoint: () => HistoryCheckpoint | undefined;
  readonly readRetainedHeaders: () => readonly CanonicalHeader[];
  readonly readCanonicalRevision: () => number;
  readonly readIndexSnapshot: () => HistoryIndexSnapshot;
  readonly replaceCanonicalRange: (
    replacement: CanonicalRangeReplacement,
  ) => void;
  readonly rewindCanonicalHistory: (
    through: CanonicalHeader,
    observedHead: CanonicalHeader,
  ) => void;
  readonly queryEvents: (query: HistoryQuery) => HistoryPage;
  readonly close: () => void;
}

const causeMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const persistenceFailure = (message: string, cause: unknown) =>
  new HistoryPersistenceError({
    message: `${message}: ${causeMessage(cause)}`,
    cause,
  });

const numeric = (value: SQLOutputValue | undefined): number => {
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError("Expected a numeric SQLite value");
  }
  return Number(value);
};

const text = (value: SQLOutputValue | undefined): string => {
  if (typeof value !== "string") {
    throw new TypeError("Expected a text SQLite value");
  }
  return value;
};

const initializeDatabase = (database: DatabaseSync): void => {
  configureSqlite(database, "History index");
  database.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS index_checkpoint (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      block_number INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      parent_hash TEXT NOT NULL,
      block_timestamp INTEGER NOT NULL,
      observed_head_block INTEGER NOT NULL,
      observed_head_timestamp INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS canonical_headers (
      block_number INTEGER PRIMARY KEY,
      block_hash TEXT NOT NULL,
      parent_hash TEXT NOT NULL,
      block_timestamp INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS canonical_revision (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL CHECK (revision >= 0)
    ) STRICT;
    INSERT OR IGNORE INTO canonical_revision (singleton, revision) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS query_snapshots (
      revision INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      parent_hash TEXT NOT NULL,
      block_timestamp INTEGER NOT NULL,
      observed_head_block INTEGER NOT NULL,
      observed_head_timestamp INTEGER NOT NULL,
      PRIMARY KEY (revision, block_number, block_hash)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS history_events (
      chain_id INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      parent_hash TEXT NOT NULL,
      transaction_hash TEXT NOT NULL,
      transaction_index INTEGER NOT NULL,
      source_address TEXT NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (chain_id, block_hash, log_index)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS history_events_order
      ON history_events (
        event_name,
        block_number,
        transaction_index,
        log_index,
        block_hash
      );
  `);
};

const metadata = (
  configuration: HistoryIndexConfiguration,
): Readonly<Record<string, string>> => ({
  schema_version: SCHEMA_VERSION,
  chain_id: configuration.chainId.toString(),
  manifest_fingerprint: configuration.manifestFingerprint,
  launch_block: configuration.launchBlock.toString(),
});

const verifyMetadata = (
  database: DatabaseSync,
  configuration: HistoryIndexConfiguration,
): void => {
  const select = database.prepare(
    "SELECT value FROM index_metadata WHERE key = ?",
  );
  const insert = database.prepare(
    "INSERT INTO index_metadata (key, value) VALUES (?, ?)",
  );
  const expectedMetadata = metadata(configuration);
  const metadataCount = numeric(
    database.prepare("SELECT COUNT(*) AS count FROM index_metadata").get()
      ?.count,
  );
  const indexedDataCount = numeric(
    database
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM index_checkpoint) +
            (SELECT COUNT(*) FROM canonical_headers) +
            (SELECT COUNT(*) FROM history_events) +
            (SELECT COUNT(*) FROM query_snapshots) AS count
        `,
      )
      .get()?.count,
  );
  if (metadataCount === 0) {
    if (indexedDataCount !== 0) {
      throw new Error(
        "History database metadata is missing from populated data",
      );
    }
    for (const [key, value] of Object.entries(expectedMetadata)) {
      insert.run(key, value);
    }
    return;
  }
  for (const [key, expected] of Object.entries(expectedMetadata)) {
    const row = select.get(key);
    if (row === undefined) {
      throw new Error(`History database metadata key ${key} is missing`);
    }
    const actual = text(row.value);
    if (actual !== expected) {
      throw new Error(
        `History database ${key} mismatch: expected ${expected}, observed ${actual}`,
      );
    }
  }
};

const rotateIndexGeneration = (database: DatabaseSync): string => {
  const key = "index_generation";
  const generation = randomUUID();
  database
    .prepare(
      `
      INSERT INTO index_metadata (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `,
    )
    .run(key, generation);
  return generation;
};

const headerFromRow = (row: SqliteRow): CanonicalHeader => ({
  blockNumber: BigInt(numeric(row.block_number)),
  blockHash: text(row.block_hash) as Hex,
  parentHash: text(row.parent_hash) as Hex,
  blockTimestamp: BigInt(numeric(row.block_timestamp)),
});

const checkpointFromRow = (row: SqliteRow): HistoryCheckpoint => ({
  ...headerFromRow(row),
  observedHeadBlock: BigInt(numeric(row.observed_head_block)),
  observedHeadTimestamp: BigInt(numeric(row.observed_head_timestamp)),
});

const eventFromRow = (row: SqliteRow): IndexedHistoryEvent => ({
  ...headerFromRow(row),
  transactionHash: text(row.transaction_hash) as Hex,
  transactionIndex: numeric(row.transaction_index),
  logIndex: numeric(row.log_index),
  sourceAddress: text(row.source_address) as `0x${string}`,
  eventName: text(row.event_name) as HistoryEventName,
  payload: JSON.parse(text(row.payload)) as IndexedHistoryEvent["payload"],
  removed: false,
});

const queryKey = (query: HistoryQuery, order: "asc" | "desc"): string =>
  JSON.stringify([
    [...query.eventNames].sort(),
    query.fromBlock.toString(),
    query.toBlock.toString(),
    order,
  ]);

const encodeCursor = (
  event: IndexedHistoryEvent,
  snapshot: HistoryCheckpoint,
  revision: number,
  generation: string,
  key: string,
): string =>
  Buffer.from(
    JSON.stringify([
      event.blockNumber.toString(),
      event.transactionIndex,
      event.logIndex,
      event.blockHash,
      snapshot.blockNumber.toString(),
      snapshot.blockHash,
      snapshot.parentHash,
      snapshot.blockTimestamp.toString(),
      snapshot.observedHeadBlock.toString(),
      snapshot.observedHeadTimestamp.toString(),
      revision,
      generation,
      key,
    ]),
  ).toString("base64url");

const cursorDecimal = (value: unknown): string => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("History cursor has an invalid decimal value");
  }
  return value;
};

const cursorInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("History cursor has an invalid integer value");
  }
  return Number(value);
};

const cursorHash = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError("History cursor has an invalid hash value");
  }
  return value as Hex;
};

const cursorText = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("History cursor has an invalid text value");
  }
  return value;
};

const decodeCursor = (encoded: string): HistoryCursor => {
  const value = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as unknown;
  if (!Array.isArray(value) || value.length !== 13) {
    throw new TypeError("History cursor has an invalid shape");
  }
  const [
    blockNumber,
    transactionIndex,
    logIndex,
    blockHash,
    snapshotBlockNumber,
    snapshotBlockHash,
    snapshotParentHash,
    snapshotBlockTimestamp,
    observedHeadBlock,
    observedHeadTimestamp,
    revision,
    generation,
    storedQueryKey,
  ] = value;
  return {
    blockNumber: BigInt(cursorDecimal(blockNumber)),
    transactionIndex: cursorInteger(transactionIndex),
    logIndex: cursorInteger(logIndex),
    blockHash: cursorHash(blockHash),
    snapshot: {
      blockNumber: BigInt(cursorDecimal(snapshotBlockNumber)),
      blockHash: cursorHash(snapshotBlockHash),
      parentHash: cursorHash(snapshotParentHash),
      blockTimestamp: BigInt(cursorDecimal(snapshotBlockTimestamp)),
      observedHeadBlock: BigInt(cursorDecimal(observedHeadBlock)),
      observedHeadTimestamp: BigInt(cursorDecimal(observedHeadTimestamp)),
    },
    revision: cursorInteger(revision),
    generation: cursorText(generation),
    queryKey: cursorText(storedQueryKey),
  };
};

const cursorFrom = (encoded: string | undefined): HistoryCursor | undefined => {
  if (encoded === undefined) return undefined;
  try {
    return decodeCursor(encoded);
  } catch (cause) {
    throw new RangeError("History cursor is invalid", { cause });
  }
};

const cursorPredicate = (
  cursor: HistoryCursor | undefined,
  order: "asc" | "desc",
) =>
  cursor === undefined
    ? { sql: "", parameters: [] as readonly SQLOutputValue[] }
    : {
        sql: `AND (
          block_number ${order === "asc" ? ">" : "<"} ? OR
          (block_number = ? AND transaction_index ${order === "asc" ? ">" : "<"} ?) OR
          (block_number = ? AND transaction_index = ? AND log_index ${order === "asc" ? ">" : "<"} ?) OR
          (block_number = ? AND transaction_index = ? AND log_index = ? AND block_hash ${order === "asc" ? ">" : "<"} ?)
        )`,
        parameters: [
          Number(cursor.blockNumber),
          Number(cursor.blockNumber),
          cursor.transactionIndex,
          Number(cursor.blockNumber),
          cursor.transactionIndex,
          cursor.logIndex,
          Number(cursor.blockNumber),
          cursor.transactionIndex,
          cursor.logIndex,
          cursor.blockHash,
        ],
      };

const runTransaction = (
  database: DatabaseSync,
  operation: () => void,
): void => {
  database.exec("BEGIN IMMEDIATE");
  try {
    operation();
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
};

const insertHeader = (
  statement: StatementSync,
  item: CanonicalHeader,
): void => {
  statement.run(
    Number(item.blockNumber),
    item.blockHash,
    item.parentHash,
    Number(item.blockTimestamp),
  );
};

const insertEvent = (
  statement: StatementSync,
  chainId: number,
  item: IndexedHistoryEvent,
): void => {
  if (item.removed) return;
  statement.run(
    chainId,
    item.blockHash,
    item.logIndex,
    Number(item.blockNumber),
    Number(item.blockTimestamp),
    item.parentHash,
    item.transactionHash,
    item.transactionIndex,
    item.sourceAddress,
    item.eventName,
    JSON.stringify(item.payload),
  );
};

const writeCheckpoint = (
  statement: StatementSync,
  through: CanonicalHeader,
  observedHead: CanonicalHeader,
): void => {
  statement.run(
    Number(through.blockNumber),
    through.blockHash,
    through.parentHash,
    Number(through.blockTimestamp),
    Number(observedHead.blockNumber),
    Number(observedHead.blockTimestamp),
  );
};

const canonicalRevision = (database: DatabaseSync): number =>
  numeric(
    database
      .prepare("SELECT revision FROM canonical_revision WHERE singleton = 1")
      .get()?.revision,
  );

const writeSnapshot = (
  statement: StatementSync,
  revision: number,
  checkpoint: HistoryCheckpoint,
): void => {
  statement.run(
    revision,
    Number(checkpoint.blockNumber),
    checkpoint.blockHash,
    checkpoint.parentHash,
    Number(checkpoint.blockTimestamp),
    Number(checkpoint.observedHeadBlock),
    Number(checkpoint.observedHeadTimestamp),
  );
};

const checkpointFromHeaders = (
  through: CanonicalHeader,
  observedHead: CanonicalHeader,
): HistoryCheckpoint => ({
  ...through,
  observedHeadBlock: observedHead.blockNumber,
  observedHeadTimestamp: observedHead.blockTimestamp,
});

const queryStatus = (
  checkpoint: HistoryCheckpoint | undefined,
  configuration: HistoryIndexConfiguration,
  query: HistoryQuery,
): HistoryPage["status"] => {
  const indexedThrough = checkpoint?.blockNumber;
  return {
    state:
      indexedThrough !== undefined && indexedThrough >= query.toBlock
        ? "complete"
        : "partial",
    requested: { fromBlock: query.fromBlock, toBlock: query.toBlock },
    coverage: {
      fromBlock: configuration.launchBlock,
      indexedThroughBlock: indexedThrough,
      indexedThroughTime: checkpoint?.blockTimestamp,
    },
    head: {
      observedBlock: checkpoint?.observedHeadBlock,
      lagBlocks:
        checkpoint === undefined
          ? undefined
          : checkpoint.observedHeadBlock - checkpoint.blockNumber,
    },
  };
};

const prepareStatements = (database: DatabaseSync) => ({
  deleteEvents: database.prepare(
    "DELETE FROM history_events WHERE block_number >= ?",
  ),
  deleteHeaders: database.prepare(
    "DELETE FROM canonical_headers WHERE block_number >= ?",
  ),
  deleteEventsAfter: database.prepare(
    "DELETE FROM history_events WHERE block_number > ?",
  ),
  deleteHeadersAfter: database.prepare(
    "DELETE FROM canonical_headers WHERE block_number > ?",
  ),
  clearSnapshots: database.prepare("DELETE FROM query_snapshots"),
  incrementRevision: database.prepare(
    "UPDATE canonical_revision SET revision = revision + 1 WHERE singleton = 1",
  ),
  insertHeader: database.prepare(`
    INSERT OR REPLACE INTO canonical_headers
      (block_number, block_hash, parent_hash, block_timestamp)
    VALUES (?, ?, ?, ?)
  `),
  insertEvent: database.prepare(`
    INSERT OR REPLACE INTO history_events (
      chain_id, block_hash, log_index, block_number, block_timestamp,
      parent_hash, transaction_hash, transaction_index, source_address,
      event_name, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  checkpoint: database.prepare(`
    INSERT OR REPLACE INTO index_checkpoint (
      singleton, block_number, block_hash, parent_hash, block_timestamp,
      observed_head_block, observed_head_timestamp
    ) VALUES (1, ?, ?, ?, ?, ?, ?)
  `),
  snapshot: database.prepare(`
    INSERT OR REPLACE INTO query_snapshots (
      revision, block_number, block_hash, parent_hash, block_timestamp,
      observed_head_block, observed_head_timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  pruneSnapshots: database.prepare(`
    DELETE FROM query_snapshots
    WHERE rowid <= (
      SELECT rowid FROM query_snapshots
      ORDER BY rowid DESC
      LIMIT 1 OFFSET ?
    )
  `),
  pruneHeaders: database.prepare(
    "DELETE FROM canonical_headers WHERE block_number < ?",
  ),
});

const validateQuery = (
  query: HistoryQuery,
  configuration: HistoryIndexConfiguration,
): void => {
  if (query.eventNames.length === 0) {
    throw new RangeError("At least one history event name is required");
  }
  if (query.fromBlock < configuration.launchBlock) {
    throw new RangeError(
      "History query begins before the manifest launch block",
    );
  }
  if (query.fromBlock > query.toBlock) {
    throw new RangeError("History query fromBlock is greater than toBlock");
  }
  if (query.limit < 1 || query.limit > configuration.maximumPageSize) {
    throw new RangeError(
      `History page limit must be from 1 to ${configuration.maximumPageSize}`,
    );
  }
};

const validateCanonicalHeaders = (
  headers: readonly CanonicalHeader[],
): void => {
  const ordered = [...headers].sort((left, right) =>
    Number(left.blockNumber - right.blockNumber),
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (
      current.blockNumber !== previous.blockNumber + 1n ||
      current.parentHash !== previous.blockHash
    ) {
      throw new Error(
        `Retained canonical header ${current.blockNumber} does not follow ${previous.blockNumber}`,
      );
    }
  }
};

const validateReplacement = (replacement: CanonicalRangeReplacement): void => {
  if (replacement.through.blockNumber < replacement.fromBlock) {
    throw new RangeError("Canonical replacement ends before it begins");
  }
  if (replacement.observedHead.blockNumber < replacement.through.blockNumber) {
    throw new RangeError("Observed head is behind the replacement checkpoint");
  }
  if (
    replacement.events.some(
      (item) =>
        item.blockNumber < replacement.fromBlock ||
        item.blockNumber > replacement.through.blockNumber,
    )
  ) {
    throw new RangeError(
      "Canonical replacement contains an out-of-range event",
    );
  }
  validateCanonicalHeaders(replacement.retainedHeaders);
};

interface DatabaseIntegrityState {
  readonly checkpoint: HistoryCheckpoint | undefined;
  readonly headers: readonly CanonicalHeader[];
  readonly eventCount: number;
  readonly snapshotCount: number;
}

const tableCount = (
  database: DatabaseSync,
  table: "history_events" | "query_snapshots",
): number =>
  numeric(
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count,
  );

const readDatabaseIntegrityState = (
  database: DatabaseSync,
): DatabaseIntegrityState => {
  const checkpointRow = database
    .prepare("SELECT * FROM index_checkpoint WHERE singleton = 1")
    .get();
  return {
    checkpoint:
      checkpointRow === undefined
        ? undefined
        : checkpointFromRow(checkpointRow),
    headers: database
      .prepare("SELECT * FROM canonical_headers ORDER BY block_number ASC")
      .all()
      .map(headerFromRow),
    eventCount: tableCount(database, "history_events"),
    snapshotCount: tableCount(database, "query_snapshots"),
  };
};

const verifyEmptyIntegrityState = (state: DatabaseIntegrityState): void => {
  if (
    state.headers.length > 0 ||
    state.eventCount > 0 ||
    state.snapshotCount > 0
  ) {
    throw new Error("Indexed history exists without a history checkpoint");
  }
};

const verifyRetainedCheckpoint = (
  checkpoint: HistoryCheckpoint,
  headers: readonly CanonicalHeader[],
): void => {
  const retainedCheckpoint = headers.at(-1);
  if (
    retainedCheckpoint === undefined ||
    retainedCheckpoint.blockNumber !== checkpoint.blockNumber ||
    retainedCheckpoint.blockHash !== checkpoint.blockHash ||
    retainedCheckpoint.parentHash !== checkpoint.parentHash ||
    retainedCheckpoint.blockTimestamp !== checkpoint.blockTimestamp
  ) {
    throw new Error(
      `History checkpoint canonical header ${checkpoint.blockNumber} is missing or inconsistent`,
    );
  }
};

const readCheckpointSnapshot = (
  database: DatabaseSync,
  checkpoint: HistoryCheckpoint,
): HistoryCheckpoint => {
  const revision = canonicalRevision(database);
  const snapshotRow = database
    .prepare(
      `
        SELECT * FROM query_snapshots
        WHERE revision = ? AND block_number = ? AND block_hash = ?
      `,
    )
    .get(revision, Number(checkpoint.blockNumber), checkpoint.blockHash);
  if (snapshotRow === undefined) {
    throw new Error(
      `History checkpoint query snapshot ${checkpoint.blockNumber} is missing`,
    );
  }
  return checkpointFromRow(snapshotRow);
};

const verifyCheckpointSnapshot = (
  checkpoint: HistoryCheckpoint,
  snapshot: HistoryCheckpoint,
): void => {
  if (
    snapshot.parentHash !== checkpoint.parentHash ||
    snapshot.blockTimestamp !== checkpoint.blockTimestamp ||
    snapshot.observedHeadBlock !== checkpoint.observedHeadBlock ||
    snapshot.observedHeadTimestamp !== checkpoint.observedHeadTimestamp
  ) {
    throw new Error(
      `History checkpoint query snapshot ${checkpoint.blockNumber} is inconsistent`,
    );
  }
};

const verifyDatabaseIntegrity = (database: DatabaseSync): void => {
  verifySqliteIntegrity(database, "History index");
  const state = readDatabaseIntegrityState(database);
  if (state.checkpoint === undefined) {
    verifyEmptyIntegrityState(state);
    return;
  }
  validateCanonicalHeaders(state.headers);
  verifyRetainedCheckpoint(state.checkpoint, state.headers);
  verifyCheckpointSnapshot(
    state.checkpoint,
    readCheckpointSnapshot(database, state.checkpoint),
  );
};

const effectiveQueryToBlock = (
  query: HistoryQuery,
  snapshot: HistoryCheckpoint | undefined,
): bigint => {
  if (snapshot === undefined) return query.toBlock;
  return snapshot.blockNumber < query.toBlock
    ? snapshot.blockNumber
    : query.toBlock;
};

const readQueryRows = (
  database: DatabaseSync,
  query: HistoryQuery,
  cursor: HistoryCursor | undefined,
  order: "asc" | "desc",
  toBlock: bigint,
): readonly IndexedHistoryEvent[] => {
  const predicate = cursorPredicate(cursor, order);
  const placeholders = query.eventNames.map(() => "?").join(", ");
  return database
    .prepare(
      `
        SELECT * FROM history_events
        WHERE event_name IN (${placeholders})
          AND block_number >= ?
          AND block_number <= ?
          ${predicate.sql}
        ORDER BY block_number ${order}, transaction_index ${order},
          log_index ${order}, block_hash ${order}
        LIMIT ?
      `,
    )
    .all(
      ...query.eventNames,
      Number(query.fromBlock),
      Number(toBlock),
      ...predicate.parameters,
      query.limit + 1,
    )
    .map(eventFromRow);
};

const continuationCursor = (
  hasMore: boolean,
  last: IndexedHistoryEvent | undefined,
  snapshot: HistoryCheckpoint | undefined,
  revision: number,
  generation: string,
  key: string,
): string | undefined => {
  if (!hasMore || last === undefined || snapshot === undefined)
    return undefined;
  return encodeCursor(last, snapshot, revision, generation, key);
};

const indexSnapshotFrom = (
  generation: string,
  canonicalRevision: number,
  checkpoint: HistoryCheckpoint | undefined,
): HistoryIndexSnapshot => ({
  generation,
  canonicalRevision,
  blockNumber: checkpoint?.blockNumber,
  blockHash: checkpoint?.blockHash,
});

const historyPageFromRows = (
  rows: readonly IndexedHistoryEvent[],
  query: HistoryQuery,
  snapshot: HistoryCheckpoint | undefined,
  configuration: HistoryIndexConfiguration,
  revision: number,
  generation: string,
  key: string,
): HistoryPage => {
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  return {
    snapshot: indexSnapshotFrom(generation, revision, snapshot),
    items,
    page: {
      hasMore,
      nextCursor: continuationCursor(
        hasMore,
        items.at(-1),
        snapshot,
        revision,
        generation,
        key,
      ),
    },
    status: queryStatus(snapshot, configuration, query),
  };
};

function assertCursorSnapshot(
  snapshot: HistoryCheckpoint | undefined,
  cursor: HistoryCursor,
): asserts snapshot is HistoryCheckpoint {
  if (
    snapshot === undefined ||
    snapshot.parentHash !== cursor.snapshot.parentHash ||
    snapshot.blockTimestamp !== cursor.snapshot.blockTimestamp ||
    snapshot.observedHeadBlock !== cursor.snapshot.observedHeadBlock ||
    snapshot.observedHeadTimestamp !== cursor.snapshot.observedHeadTimestamp
  ) {
    throw new RangeError(
      "History cursor snapshot is no longer canonical; restart pagination",
    );
  }
}

export const openHistoryStore = (
  path: string,
  configuration: HistoryIndexConfiguration,
): HistoryStore => {
  const database = new DatabaseSync(path);
  let indexGeneration: string;
  try {
    initializeDatabase(database);
    verifyMetadata(database, configuration);
    verifyDatabaseIntegrity(database);
    indexGeneration = rotateIndexGeneration(database);
  } catch (cause) {
    database.close();
    throw persistenceFailure("Could not initialize history database", cause);
  }
  const statements = prepareStatements(database);

  const readCheckpoint = (): HistoryCheckpoint | undefined => {
    const row = database
      .prepare("SELECT * FROM index_checkpoint WHERE singleton = 1")
      .get();
    return row === undefined ? undefined : checkpointFromRow(row);
  };

  const readRetainedHeaders = (): readonly CanonicalHeader[] =>
    database
      .prepare("SELECT * FROM canonical_headers ORDER BY block_number ASC")
      .all()
      .map(headerFromRow);

  const readCanonicalRevision = (): number => canonicalRevision(database);

  const readIndexSnapshot = (): HistoryIndexSnapshot =>
    indexSnapshotFrom(
      indexGeneration,
      readCanonicalRevision(),
      readCheckpoint(),
    );

  const replaceCanonicalRange = (
    replacement: CanonicalRangeReplacement,
  ): void => {
    try {
      validateReplacement(replacement);
      runTransaction(database, () => {
        statements.deleteEvents.run(Number(replacement.fromBlock));
        statements.deleteHeaders.run(Number(replacement.fromBlock));
        const headers = new Map(
          [...replacement.retainedHeaders, replacement.through].map((item) => [
            item.blockNumber,
            item,
          ]),
        );
        for (const item of headers.values()) {
          insertHeader(statements.insertHeader, item);
        }
        for (const item of replacement.events) {
          insertEvent(statements.insertEvent, configuration.chainId, item);
        }
        const checkpoint = checkpointFromHeaders(
          replacement.through,
          replacement.observedHead,
        );
        writeCheckpoint(
          statements.checkpoint,
          replacement.through,
          replacement.observedHead,
        );
        writeSnapshot(statements.snapshot, readCanonicalRevision(), checkpoint);
        statements.pruneSnapshots.run(configuration.cursorSnapshotRetention);
        const retainedFrom =
          replacement.through.blockNumber - configuration.overlapBlocks + 1n;
        statements.pruneHeaders.run(
          Number(
            retainedFrom > configuration.launchBlock
              ? retainedFrom
              : configuration.launchBlock,
          ),
        );
      });
    } catch (cause) {
      throw persistenceFailure("Could not replace canonical history", cause);
    }
  };

  const rewindCanonicalHistory = (
    through: CanonicalHeader,
    observedHead: CanonicalHeader,
  ): void => {
    try {
      if (observedHead.blockNumber < through.blockNumber) {
        throw new RangeError("Observed head is behind the rewind checkpoint");
      }
      runTransaction(database, () => {
        statements.deleteEventsAfter.run(Number(through.blockNumber));
        statements.deleteHeadersAfter.run(Number(through.blockNumber));
        insertHeader(statements.insertHeader, through);
        writeCheckpoint(statements.checkpoint, through, observedHead);
        statements.incrementRevision.run();
        statements.clearSnapshots.run();
        writeSnapshot(
          statements.snapshot,
          readCanonicalRevision(),
          checkpointFromHeaders(through, observedHead),
        );
      });
    } catch (cause) {
      throw persistenceFailure("Could not rewind canonical history", cause);
    }
  };

  const cursorSnapshot = (
    cursor: HistoryCursor | undefined,
    key: string,
    eventNames: readonly HistoryEventName[],
  ): HistoryCheckpoint | undefined => {
    if (cursor === undefined) return readCheckpoint();
    if (cursor.generation !== indexGeneration) {
      throw new RangeError(
        "History cursor belongs to a different index generation; restart pagination",
      );
    }
    if (cursor.queryKey !== key) {
      throw new RangeError("History cursor belongs to a different query");
    }
    const row = database
      .prepare(
        `
          SELECT * FROM query_snapshots
          WHERE revision = ? AND block_number = ? AND block_hash = ?
        `,
      )
      .get(
        cursor.revision,
        Number(cursor.snapshot.blockNumber),
        cursor.snapshot.blockHash,
      );
    const snapshot = row === undefined ? undefined : checkpointFromRow(row);
    assertCursorSnapshot(snapshot, cursor);
    const placeholders = eventNames.map(() => "?").join(", ");
    const cursorFact = database
      .prepare(
        `
        SELECT 1 FROM history_events
        WHERE event_name IN (${placeholders})
          AND block_number = ?
          AND transaction_index = ?
          AND log_index = ?
          AND block_hash = ?
        LIMIT 1
      `,
      )
      .get(
        ...eventNames,
        Number(cursor.blockNumber),
        cursor.transactionIndex,
        cursor.logIndex,
        cursor.blockHash,
      );
    if (cursorFact === undefined) {
      throw new RangeError(
        "History cursor fact is no longer canonical; restart pagination",
      );
    }
    return snapshot;
  };

  const queryEvents = (query: HistoryQuery): HistoryPage => {
    validateQuery(query, configuration);
    const cursor = cursorFrom(query.cursor);
    try {
      const order = query.order ?? "asc";
      const key = queryKey(query, order);
      const snapshot = cursorSnapshot(cursor, key, query.eventNames);
      const rows = readQueryRows(
        database,
        query,
        cursor,
        order,
        effectiveQueryToBlock(query, snapshot),
      );
      return historyPageFromRows(
        rows,
        query,
        snapshot,
        configuration,
        cursor?.revision ?? readCanonicalRevision(),
        indexGeneration,
        key,
      );
    } catch (cause) {
      if (cause instanceof RangeError) throw cause;
      throw persistenceFailure("Could not query indexed history", cause);
    }
  };

  return {
    readCheckpoint,
    readRetainedHeaders,
    readCanonicalRevision,
    readIndexSnapshot,
    replaceCanonicalRange,
    rewindCanonicalHistory,
    queryEvents,
    close: () => database.close(),
  };
};

export const acquireHistoryStore = (
  path: string,
  configuration: HistoryIndexConfiguration,
): Effect.Effect<HistoryStore, HistoryPersistenceError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => openHistoryStore(path, configuration),
      catch: (cause) =>
        cause instanceof HistoryPersistenceError
          ? cause
          : persistenceFailure("Could not open history database", cause),
    }),
    (store) => Effect.sync(store.close),
  );
