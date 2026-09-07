import {
  deploymentManifestFingerprint,
  type ProtocolDeploymentManifest,
} from "@orbit/config/deployment-manifest";
import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";
import type { Address, Hex } from "viem";
import * as Schema from "effect/Schema";

import { retainOperationalSummaryEvents } from "./events.js";
import {
  indexedHistoryCoveredThrough,
  indexedHistoryScanStart,
  mergeIndexedHistoryItems,
  type IndexedHistoryItemCache,
} from "./indexed-history-cache.js";
import type {
  OperationalEvent,
  OperationalEventWindow,
  KeeperAttemptEvidence,
  RewardHistoryEvent,
  RewardHistoryWindow,
  RewardTrack,
} from "./reader.js";

const UnsignedDecimal = Schema.String.pipe(
  Schema.pattern(/^(0|[1-9][0-9]*)$/u),
  Schema.compose(Schema.BigInt),
);
const NonnegativeInteger = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
);
const HexString = Schema.TemplateLiteral("0x", Schema.String);
const Bytes32 = HexString.pipe(Schema.pattern(/^0x[0-9a-fA-F]{64}$/u));
const EvmAddress = HexString.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/u));
const OptionalBlock = Schema.UndefinedOr(UnsignedDecimal);
const NullableSnapshotBlock = Schema.transform(
  Schema.NullOr(OptionalBlock),
  Schema.UndefinedOr(Schema.NonNegativeBigIntFromSelf),
  {
    strict: true,
    decode: (value) => value ?? undefined,
    encode: (value) => value,
  },
);
const NullableSnapshotHash = Schema.transform(
  Schema.NullOr(Schema.UndefinedOr(Bytes32)),
  Schema.UndefinedOr(Bytes32),
  {
    strict: true,
    decode: (value) => value ?? undefined,
    encode: (value) => value,
  },
);
const HistoryState = Schema.Literal("complete", "partial");
export type IndexedHistoryState = typeof HistoryState.Type;

const HistoryCoverage = Schema.Struct({
  fromBlock: UnsignedDecimal,
  indexedThroughBlock: OptionalBlock,
  indexedThroughTime: OptionalBlock,
});
const HistoryHead = Schema.Struct({
  observedBlock: OptionalBlock,
  lagBlocks: OptionalBlock,
});
const HistoryPosition = Schema.Struct({
  state: HistoryState,
  coverage: HistoryCoverage,
  head: HistoryHead,
});
export type IndexedHistoryPosition = typeof HistoryPosition.Type;

const HistoryManifest = Schema.Struct({
  chainId: NonnegativeInteger,
  network: Schema.String,
  fingerprint: Bytes32,
  commitment: Bytes32,
  launchBlock: UnsignedDecimal,
  canonicalPool: Schema.Struct({
    poolId: Bytes32,
    currency0: EvmAddress,
    currency1: EvmAddress,
  }),
  sources: Schema.Struct({
    poolManager: EvmAddress,
    canonicalFeeHook: EvmAddress,
    protocolLiquidityVault: EvmAddress,
    epochConverter: EvmAddress,
    fuelCore: EvmAddress,
    rewardLedger: EvmAddress,
  }),
});
export type IndexedHistoryManifest = typeof HistoryManifest.Type;

export interface IndexedHistoryRequest {
  readonly account?: Address;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly limit: number;
  readonly cursor?: string;
  readonly order?: "asc" | "desc";
}

export interface IndexedHistoryItem {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly parentHash: Hex;
  readonly blockTimestamp: bigint;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly sourceAddress: Address;
  readonly eventName: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly removed: boolean;
}

const HistorySnapshot = Schema.Struct({
  generation: Schema.String.pipe(
    Schema.filter((value) => value.trim().length > 0),
  ),
  canonicalRevision: NonnegativeInteger,
  blockNumber: NullableSnapshotBlock,
  blockHash: NullableSnapshotHash,
}).pipe(
  Schema.filter(
    (value) =>
      (value.blockNumber === undefined) === (value.blockHash === undefined),
    {
      message: () =>
        "history snapshot blockNumber and blockHash must be observed together",
    },
  ),
);
export type IndexedHistorySnapshot = typeof HistorySnapshot.Type;

const HistoryPageStatus = Schema.Struct({
  ...HistoryPosition.fields,
  requested: Schema.Struct({
    fromBlock: UnsignedDecimal,
    toBlock: UnsignedDecimal,
  }),
});
const HistoryPage = Schema.Struct({
  manifest: HistoryManifest,
  snapshot: HistorySnapshot,
  items: Schema.Array(Schema.Unknown),
  page: Schema.Struct({
    hasMore: Schema.Boolean,
    nextCursor: Schema.UndefinedOr(Schema.String),
  }).pipe(
    Schema.filter((page) => !page.hasMore || page.nextCursor !== undefined, {
      message: () => "history page with more items requires nextCursor",
    }),
  ),
  status: HistoryPageStatus,
});
export type IndexedHistoryPage = Omit<typeof HistoryPage.Type, "items"> & {
  readonly items: readonly IndexedHistoryItem[];
};

const HistoryServiceStatus = Schema.Struct({
  manifest: HistoryManifest,
  snapshot: HistorySnapshot,
  status: HistoryPosition,
});
export type IndexedHistoryServiceStatus = typeof HistoryServiceStatus.Type;

export interface CanonicalMarketCandleObservation {
  readonly intervalStart: bigint;
  readonly intervalEnd: bigint;
  readonly openWethPerLiquidTokenX18: bigint;
  readonly highWethPerLiquidTokenX18: bigint;
  readonly lowWethPerLiquidTokenX18: bigint;
  readonly closeWethPerLiquidTokenX18: bigint;
  readonly swapCount: number;
}

export type CanonicalMarketCandleFeed =
  | {
      readonly source: "uniswap-v4-subgraph";
      readonly state: "available";
      readonly interval: "1h";
      readonly indexedThroughBlock: bigint | undefined;
      readonly hasIndexingErrors: boolean;
      readonly candles: readonly CanonicalMarketCandleObservation[];
    }
  | {
      readonly source: "uniswap-v4-subgraph";
      readonly state: "unavailable" | "unconfigured";
    };

export interface IndexedHistoryErrorEvidence {
  readonly manifest?: IndexedHistoryManifest;
  readonly snapshot?: IndexedHistorySnapshot;
  readonly requested?: {
    readonly fromBlock: bigint | undefined;
    readonly toBlock: bigint | undefined;
  };
  readonly coverage?: {
    readonly fromBlock: bigint | undefined;
    readonly indexedThroughBlock: bigint | undefined;
    readonly indexedThroughTime: bigint | undefined;
  };
  readonly head?: {
    readonly observedBlock: bigint | undefined;
    readonly lagBlocks: bigint | undefined;
  };
}

export interface MarketHistoryReader {
  readonly candles?: () => Promise<CanonicalMarketCandleFeed>;
  readonly swaps: (
    request: IndexedHistoryRequest,
  ) => Promise<IndexedHistoryPage>;
  readonly fees: (
    request: IndexedHistoryRequest,
  ) => Promise<IndexedHistoryPage>;
}

export interface ProtocolHistoryReader {
  readonly discoveries: (
    account: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<DiscoveryHistoryWindow>;
  readonly liquidityCycles: (
    request: IndexedHistoryRequest,
  ) => Promise<IndexedHistoryPage>;
  readonly operations: (
    request: IndexedHistoryRequest,
  ) => Promise<IndexedHistoryPage>;
  readonly permanentIdentityCandidates: (
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<PermanentIdentityCandidateWindow>;
  readonly recentOperationalEvents: (
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
  ) => Promise<OperationalEventWindow>;
  readonly rewardHistory: (
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<RewardHistoryWindow>;
}

export interface PermanentIdentityCandidateWindow {
  readonly identityIds: readonly number[];
  readonly fromBlock: bigint;
  readonly throughBlock: bigint;
  readonly coverage: IndexedHistoryState;
  readonly indexedThroughTime?: bigint;
}

export interface IndexedHistoryReaders {
  readonly status: () => Promise<IndexedHistoryServiceStatus>;
  readonly market: MarketHistoryReader;
  readonly protocol: ProtocolHistoryReader;
}

export class IndexedHistoryError extends Error {
  override readonly name = "IndexedHistoryError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly evidence: IndexedHistoryErrorEvidence = {},
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface IndexedHistoryReaderOptions {
  readonly fetcher: Fetch;
  readonly identity: IdentityConfiguration;
  readonly manifest: ProtocolDeploymentManifest;
  readonly basePath: string;
}

type JsonRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string`);
  return value;
};

const numberValue = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
  return value;
};

const nonnegativeNumberValue = (value: unknown, label: string): number => {
  const decoded = numberValue(value, label);
  if (decoded < 0) throw new TypeError(`${label} must not be negative`);
  return decoded;
};

const bigintValue = (value: unknown, label: string): bigint => {
  const decoded = stringValue(value, label);
  if (!/^(0|[1-9][0-9]*)$/u.test(decoded)) {
    throw new TypeError(`${label} must be an unsigned decimal integer`);
  }
  return BigInt(decoded);
};

const optionalBigint = (value: unknown, label: string): bigint | undefined =>
  value === undefined ? undefined : bigintValue(value, label);

const nullableBigint = (value: unknown, label: string): bigint | undefined =>
  value === undefined || value === null ? undefined : bigintValue(value, label);

const hexValue = (value: unknown, label: string, digits: number): Hex => {
  const decoded = stringValue(value, label);
  if (!new RegExp(`^0x[0-9a-fA-F]{${digits}}$`, "u").test(decoded)) {
    throw new TypeError(`${label} must be a ${digits / 2}-byte hex value`);
  }
  return decoded as Hex;
};

const nullableHex = (
  value: unknown,
  label: string,
  digits: number,
): Hex | undefined =>
  value === undefined || value === null
    ? undefined
    : hexValue(value, label, digits);

const addressValue = (value: unknown, label: string): Address =>
  hexValue(value, label, 40) as Address;

const snapshotFrom = Schema.decodeUnknownSync(HistorySnapshot);

export const indexedHistoryLineageKey = (
  snapshot: IndexedHistorySnapshot,
): string => `${snapshot.generation}:${snapshot.canonicalRevision}`;

const indexedHistorySnapshotKey = (snapshot: IndexedHistorySnapshot): string =>
  JSON.stringify([
    snapshot.generation,
    snapshot.canonicalRevision,
    snapshot.blockNumber?.toString(),
    snapshot.blockHash?.toLowerCase(),
  ]);

export const assertIndexedHistoryLineage = (
  expected: IndexedHistorySnapshot,
  observed: IndexedHistorySnapshot,
): void => {
  if (indexedHistoryLineageKey(expected) === indexedHistoryLineageKey(observed))
    return;
  throw new IndexedHistoryError(
    "history-snapshot-mismatch",
    "Indexed history changed canonical revision during one logical read",
    502,
    { snapshot: observed },
  );
};

export const assertIndexedHistoryProgress = (
  earlier: IndexedHistorySnapshot,
  later: IndexedHistorySnapshot,
): void => {
  assertIndexedHistoryLineage(earlier, later);
  if (earlier.blockNumber === undefined) return;
  if (
    later.blockNumber === undefined ||
    later.blockNumber < earlier.blockNumber
  ) {
    throw new IndexedHistoryError(
      "history-snapshot-mismatch",
      "Indexed history checkpoint moved backward during one logical read",
      502,
      { snapshot: later },
    );
  }
  if (
    later.blockNumber === earlier.blockNumber &&
    later.blockHash?.toLowerCase() !== earlier.blockHash?.toLowerCase()
  ) {
    throw new IndexedHistoryError(
      "history-snapshot-mismatch",
      "Indexed history checkpoint changed hash at the same block",
      502,
      { snapshot: later },
    );
  }
};

export const assertIndexedHistorySnapshotsCoherent = (
  snapshots: readonly IndexedHistorySnapshot[],
): void => {
  const baseline = snapshots[0];
  if (baseline === undefined) return;
  const hashesByHeight = new Map<bigint, string>();
  snapshots.forEach((snapshot) => {
    assertIndexedHistoryLineage(baseline, snapshot);
    if (snapshot.blockNumber === undefined || snapshot.blockHash === undefined)
      return;
    const normalizedHash = snapshot.blockHash.toLowerCase();
    const knownHash = hashesByHeight.get(snapshot.blockNumber);
    if (knownHash !== undefined && knownHash !== normalizedHash) {
      throw new IndexedHistoryError(
        "history-snapshot-mismatch",
        "Indexed history endpoints disagreed on the hash at one checkpoint",
        502,
        { snapshot },
      );
    }
    hashesByHeight.set(snapshot.blockNumber, normalizedHash);
  });
};

const manifestFrom = Schema.decodeUnknownSync(HistoryManifest);

const requiredContract = (
  manifest: ProtocolDeploymentManifest,
  name: keyof ProtocolDeploymentManifest["contracts"],
): Address => {
  const address = manifest.contracts[name];
  if (address === undefined) {
    throw new TypeError(`Deployment manifest is missing ${name}`);
  }
  return address as Address;
};

const expectedManifestIdentity = (
  manifest: ProtocolDeploymentManifest,
): IndexedHistoryManifest => ({
  chainId: manifest.chainId,
  network: manifest.network,
  fingerprint: deploymentManifestFingerprint(manifest),
  commitment: manifest.identity.manifestHash as Hex,
  launchBlock: BigInt(manifest.launch.blockNumber),
  canonicalPool: {
    poolId: manifest.canonicalPool.poolId as Hex,
    currency0: manifest.canonicalPool.currency0 as Address,
    currency1: manifest.canonicalPool.currency1 as Address,
  },
  sources: {
    poolManager: requiredContract(manifest, "uniswapV4PoolManager"),
    canonicalFeeHook: requiredContract(manifest, "canonicalFeeHook"),
    protocolLiquidityVault: requiredContract(
      manifest,
      "protocolLiquidityVault",
    ),
    epochConverter: requiredContract(manifest, "epochConverter"),
    fuelCore: requiredContract(manifest, "fuelCore"),
    rewardLedger: requiredContract(manifest, "rewardLedger"),
  },
});

const manifestIdentityKey = (manifest: IndexedHistoryManifest): string =>
  JSON.stringify({
    ...manifest,
    launchBlock: manifest.launchBlock.toString(),
    canonicalPool: Object.fromEntries(
      Object.entries(manifest.canonicalPool).map(([key, value]) => [
        key,
        value.toLowerCase(),
      ]),
    ),
    sources: Object.fromEntries(
      Object.entries(manifest.sources).map(([key, value]) => [
        key,
        value.toLowerCase(),
      ]),
    ),
    fingerprint: manifest.fingerprint.toLowerCase(),
    commitment: manifest.commitment.toLowerCase(),
  });

const assertManifestIdentity = (
  observed: IndexedHistoryManifest,
  expected: IndexedHistoryManifest,
): void => {
  if (manifestIdentityKey(observed) !== manifestIdentityKey(expected)) {
    throw new IndexedHistoryError(
      "history-manifest-mismatch",
      "Indexed history does not match the selected deployment manifest",
      502,
    );
  }
};

const payloadFrom = (value: unknown): IndexedHistoryItem["payload"] => {
  const payload = record(value, "history payload");
  for (const [key, item] of Object.entries(payload)) {
    if (
      typeof item !== "string" &&
      typeof item !== "boolean" &&
      item !== null &&
      (typeof item !== "number" || !Number.isSafeInteger(item))
    ) {
      throw new TypeError(`history payload ${key} must be a scalar value`);
    }
  }
  return payload as IndexedHistoryItem["payload"];
};

const historyEventNames = new Set([
  "swap",
  "fee-accrued",
  "protocol-liquidity-added",
  "permanent-commitment",
  "reward-epoch-opened",
  "track-executed",
  "reward-notified",
  "reward-claimed",
]);

const itemFrom = (value: unknown): IndexedHistoryItem => {
  const item = record(value, "history item");
  const eventName = stringValue(item.eventName, "eventName");
  if (!historyEventNames.has(eventName)) {
    throw new TypeError(`Unsupported history event ${eventName}`);
  }
  if (typeof item.removed !== "boolean") {
    throw new TypeError("history item removed must be a boolean");
  }
  if (item.removed) {
    throw new TypeError("history item must belong to the canonical event set");
  }
  return {
    blockNumber: bigintValue(item.blockNumber, "blockNumber"),
    blockHash: hexValue(item.blockHash, "blockHash", 64),
    parentHash: hexValue(item.parentHash, "parentHash", 64),
    blockTimestamp: bigintValue(item.blockTimestamp, "blockTimestamp"),
    transactionHash: hexValue(item.transactionHash, "transactionHash", 64),
    transactionIndex: nonnegativeNumberValue(
      item.transactionIndex,
      "transactionIndex",
    ),
    logIndex: nonnegativeNumberValue(item.logIndex, "logIndex"),
    sourceAddress: addressValue(item.sourceAddress, "sourceAddress"),
    eventName,
    payload: payloadFrom(item.payload),
    removed: item.removed,
  };
};

const serviceStatusFrom = (
  value: unknown,
  expectedManifest: IndexedHistoryManifest,
): IndexedHistoryServiceStatus => {
  const result = Schema.decodeUnknownSync(HistoryServiceStatus)(value);
  assertManifestIdentity(result.manifest, expectedManifest);
  return result;
};

const candlePricesAreConsistent = (prices: {
  readonly open: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly close: bigint;
}): boolean =>
  prices.open > 0n &&
  prices.high > 0n &&
  prices.low > 0n &&
  prices.close > 0n &&
  prices.low <= prices.open &&
  prices.low <= prices.close &&
  prices.high >= prices.open &&
  prices.high >= prices.close;

const candleObservationFrom = (
  value: unknown,
): CanonicalMarketCandleObservation => {
  const candle = record(value, "market candle");
  const intervalStart = bigintValue(
    candle.intervalStart,
    "market candle intervalStart",
  );
  const intervalEnd = bigintValue(
    candle.intervalEnd,
    "market candle intervalEnd",
  );
  if (intervalStart % 3_600n !== 0n || intervalEnd !== intervalStart + 3_600n) {
    throw new TypeError("Market candle must cover one aligned UTC hour");
  }
  const open = bigintValue(
    candle.openWethPerLiquidTokenX18,
    "market candle open",
  );
  const high = bigintValue(
    candle.highWethPerLiquidTokenX18,
    "market candle high",
  );
  const low = bigintValue(candle.lowWethPerLiquidTokenX18, "market candle low");
  const close = bigintValue(
    candle.closeWethPerLiquidTokenX18,
    "market candle close",
  );
  if (!candlePricesAreConsistent({ open, high, low, close })) {
    throw new TypeError("Market candle OHLC values are inconsistent");
  }
  return {
    intervalStart,
    intervalEnd,
    openWethPerLiquidTokenX18: open,
    highWethPerLiquidTokenX18: high,
    lowWethPerLiquidTokenX18: low,
    closeWethPerLiquidTokenX18: close,
    swapCount: nonnegativeNumberValue(
      candle.swapCount,
      "market candle swapCount",
    ),
  };
};

const candleFeedFrom = (
  value: unknown,
  expectedManifest: IndexedHistoryManifest,
): CanonicalMarketCandleFeed => {
  const body = record(value, "market candle response");
  assertManifestIdentity(manifestFrom(body.manifest), expectedManifest);
  const feed = record(body.feed, "market candle feed");
  if (feed.source !== "uniswap-v4-subgraph") {
    throw new TypeError("Market candle feed source is unsupported");
  }
  if (feed.state === "unavailable" || feed.state === "unconfigured") {
    return { source: feed.source, state: feed.state };
  }
  if (feed.state !== "available" || feed.interval !== "1h") {
    throw new TypeError("Market candle feed state is unsupported");
  }
  if (typeof feed.hasIndexingErrors !== "boolean") {
    throw new TypeError("Market candle feed indexing state must be boolean");
  }
  if (!Array.isArray(feed.candles) || feed.candles.length > 1_000) {
    throw new TypeError("Market candle feed exceeds its bounded window");
  }
  const candles = feed.candles.map(candleObservationFrom);
  candles.forEach((candle, index) => {
    const previous = candles[index - 1];
    if (
      previous !== undefined &&
      previous.intervalStart >= candle.intervalStart
    ) {
      throw new TypeError("Market candle feed must be strictly ordered");
    }
  });
  return {
    source: feed.source,
    state: feed.state,
    interval: feed.interval,
    indexedThroughBlock: nullableBigint(
      feed.indexedThroughBlock,
      "market candle indexedThroughBlock",
    ),
    hasIndexingErrors: feed.hasIndexingErrors,
    candles,
  };
};

const pageFrom = (
  value: unknown,
  request: IndexedHistoryRequest,
  expectedManifest: IndexedHistoryManifest,
): IndexedHistoryPage => {
  const envelope = Schema.decodeUnknownSync(HistoryPage)(value);
  assertManifestIdentity(envelope.manifest, expectedManifest);
  const result = { ...envelope, items: envelope.items.map(itemFrom) };
  if (
    result.status.requested.fromBlock !== request.fromBlock ||
    result.status.requested.toBlock !== request.toBlock
  ) {
    throw new IndexedHistoryError(
      "history-coverage-mismatch",
      "Indexed history response coverage does not match the request",
      502,
    );
  }
  return result;
};

const sharedErrorEvidenceFrom = (
  body: JsonRecord,
  expectedManifest: IndexedHistoryManifest,
): {
  readonly status: JsonRecord;
  readonly evidence: IndexedHistoryErrorEvidence;
} => {
  const manifest =
    body.manifest === undefined ? undefined : manifestFrom(body.manifest);
  if (manifest !== undefined)
    assertManifestIdentity(manifest, expectedManifest);
  const status = record(body.status, "history error status");
  const coverage = record(status.coverage, "history error coverage");
  const head = record(status.head, "history error head");
  return {
    status,
    evidence: {
      ...(manifest === undefined ? {} : { manifest }),
      snapshot: snapshotFrom(body.snapshot),
      coverage: {
        fromBlock: nullableBigint(coverage.fromBlock, "coverage fromBlock"),
        indexedThroughBlock: nullableBigint(
          coverage.indexedThroughBlock,
          "indexedThroughBlock",
        ),
        indexedThroughTime: nullableBigint(
          coverage.indexedThroughTime,
          "indexedThroughTime",
        ),
      },
      head: {
        observedBlock: nullableBigint(head.observedBlock, "observedBlock"),
        lagBlocks: nullableBigint(head.lagBlocks, "lagBlocks"),
      },
    },
  };
};

const errorEvidenceFrom = (
  body: JsonRecord,
  expectedManifest: IndexedHistoryManifest,
  request: IndexedHistoryRequest,
): IndexedHistoryErrorEvidence => {
  const shared = sharedErrorEvidenceFrom(body, expectedManifest);
  const requested = record(
    shared.status.requested,
    "history error requested range",
  );
  return {
    ...shared.evidence,
    requested: {
      fromBlock:
        nullableBigint(requested.fromBlock, "requested fromBlock") ??
        request.fromBlock,
      toBlock:
        nullableBigint(requested.toBlock, "requested toBlock") ??
        request.toBlock,
    },
  };
};

const errorFrom = async (
  response: Response,
  expectedManifest: IndexedHistoryManifest,
  request: IndexedHistoryRequest,
): Promise<IndexedHistoryError> => {
  const fallback = new IndexedHistoryError(
    "history-unavailable",
    `History service returned HTTP ${response.status}`,
    response.status,
    {
      requested: {
        fromBlock: request.fromBlock,
        toBlock: request.toBlock,
      },
    },
  );
  try {
    const body = record(await response.json(), "history error response");
    const status = record(body.status, "history error status");
    const error = record(status.error, "history error");
    return new IndexedHistoryError(
      stringValue(error.code, "history error code"),
      stringValue(error.message, "history error message"),
      response.status,
      errorEvidenceFrom(body, expectedManifest, request),
    );
  } catch (cause) {
    if (cause instanceof IndexedHistoryError) return cause;
    return fallback;
  }
};

const serviceErrorEvidenceFrom = (
  body: JsonRecord,
  expectedManifest: IndexedHistoryManifest,
): IndexedHistoryErrorEvidence =>
  sharedErrorEvidenceFrom(body, expectedManifest).evidence;

const serviceErrorFrom = async (
  response: Response,
  expectedManifest: IndexedHistoryManifest,
): Promise<IndexedHistoryError> => {
  const fallback = new IndexedHistoryError(
    "history-unavailable",
    `History service returned HTTP ${response.status}`,
    response.status,
  );
  try {
    const body = record(await response.json(), "history error response");
    const status = record(body.status, "history error status");
    const error = record(status.error, "history error");
    return new IndexedHistoryError(
      stringValue(error.code, "history error code"),
      stringValue(error.message, "history error message"),
      response.status,
      serviceErrorEvidenceFrom(body, expectedManifest),
    );
  } catch (cause) {
    if (cause instanceof IndexedHistoryError) return cause;
    return fallback;
  }
};

const queryString = (request: IndexedHistoryRequest): string => {
  const parameters = new URLSearchParams({
    fromBlock: request.fromBlock.toString(),
    toBlock: request.toBlock.toString(),
    limit: request.limit.toString(),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    ...(request.order === undefined ? {} : { order: request.order }),
    ...(request.account === undefined ? {} : { account: request.account }),
  });
  return parameters.toString();
};

const createPageReader =
  (
    fetcher: Fetch,
    basePath: string,
    endpoint: string,
    expectedManifest: IndexedHistoryManifest,
  ) =>
  async (request: IndexedHistoryRequest): Promise<IndexedHistoryPage> => {
    const response = await fetcher(
      `${basePath}/${endpoint}?${queryString(request)}`,
    );
    if (!response.ok) {
      throw await errorFrom(response, expectedManifest, request);
    }
    return pageFrom(await response.json(), request, expectedManifest);
  };

const payloadBigint = (item: IndexedHistoryItem, key: string): bigint =>
  bigintValue(item.payload[key], `${item.eventName}.${key}`);

const payloadNumber = (item: IndexedHistoryItem, key: string): number =>
  numberValue(item.payload[key], `${item.eventName}.${key}`);

const rewardTrack = (item: IndexedHistoryItem): RewardTrack => {
  const track = payloadNumber(item, "track");
  if (track < 1 || track > 4)
    throw new RangeError(`Invalid reward track ${track}`);
  return track as RewardTrack;
};

const historyBase = (item: IndexedHistoryItem) => ({
  blockNumber: item.blockNumber,
  logIndex: item.logIndex,
  transactionHash: item.transactionHash,
  transactionIndex: item.transactionIndex,
});

const rewardFrom = (
  item: IndexedHistoryItem,
): RewardHistoryEvent | undefined => {
  const base = historyBase(item);
  if (item.eventName === "reward-epoch-opened") {
    return {
      ...base,
      type: "reward-epoch",
      epoch: {
        epochNumber: payloadBigint(item, "epochNumber"),
        openedWeth: payloadBigint(item, "openedAmount"),
        equalTrackShare: payloadBigint(item, "equalTrackShare"),
        finalTrackRemainder: payloadBigint(item, "finalTrackRemainder"),
      },
    };
  }
  if (item.eventName === "track-executed") {
    return {
      ...base,
      type: "track-conversion",
      track: rewardTrack(item),
      conversion: {
        spentWeth: payloadBigint(item, "wethInput"),
        stockReceived: payloadBigint(item, "measuredStockOutput"),
        remainingQueue: payloadBigint(item, "deferredTrackBudget"),
      },
    };
  }
  if (item.eventName === "reward-claimed") {
    return {
      ...base,
      type: "reward-claim",
      track: rewardTrack(item),
      claim: {
        amount: payloadBigint(item, "amount"),
        currentOwner: addressValue(
          item.payload.currentOwner,
          "reward-claimed.currentOwner",
        ),
        identityId: nonnegativeNumberValue(
          item.payload.identityId,
          "reward-claimed.identityId",
        ),
      },
    };
  }
  return undefined;
};

const operationalFrom = (
  item: IndexedHistoryItem,
  copy: ReturnType<typeof createIdentityProtocolCopy>["events"],
): OperationalEvent | undefined => {
  const base = {
    blockNumber: item.blockNumber,
    transactionHash: item.transactionHash,
    transactionIndex: item.transactionIndex,
    successful: true,
  } as const;
  if (item.eventName === "reward-epoch-opened") {
    const reward = rewardFrom(item);
    if (reward?.type !== "reward-epoch") return undefined;
    return {
      ...base,
      type: "reward-epoch",
      rewardEpoch: reward.epoch,
      explanation: copy.rewardEpochSucceeded,
    };
  }
  if (item.eventName === "track-executed") {
    const reward = rewardFrom(item);
    if (reward?.type !== "track-conversion") return undefined;
    return {
      ...base,
      type: "track-execution-unknown",
      track: reward.track,
      trackConversion: reward.conversion,
      explanation: copy.trackAttemptUnknown,
    };
  }
  if (item.eventName === "reward-claimed") {
    return {
      ...base,
      type: "claim",
      track: rewardTrack(item),
      explanation: copy.claimSucceeded,
    };
  }
  if (item.eventName === "protocol-liquidity-added") {
    return {
      ...base,
      type: "pol-execution",
      liquidityGrowth: {
        cycleNumber: payloadBigint(item, "cycleNumber"),
        pulledWeth: payloadBigint(item, "pulledWeth"),
        consumedWeth: payloadBigint(item, "consumedWeth"),
        queuedWeth: payloadBigint(item, "queuedWeth"),
        permanentlyLockedWeth: payloadBigint(item, "permanentlyLockedWeth"),
      },
      explanation: copy.liquiditySucceeded,
    };
  }
  return undefined;
};

const unknownKeeperAttemptEvidence = (): KeeperAttemptEvidence => ({
  source: "keeper-attempt-journal",
  generation: undefined,
  state: "unavailable",
  freshness: {},
  coverage: { 1: "partial", 2: "partial", 3: "partial", 4: "partial" },
  tracks: {
    1: { state: "unknown" },
    2: { state: "unknown" },
    3: { state: "unknown" },
    4: { state: "unknown" },
  },
});

const enumValue = <Value extends string>(
  value: unknown,
  label: string,
  allowed: readonly Value[],
): Value => {
  const decoded = stringValue(value, label) as Value;
  if (!allowed.includes(decoded))
    throw new TypeError(`${label} is unsupported`);
  return decoded;
};

type KeeperOutcome = NonNullable<KeeperAttemptEvidence["tracks"][1]["outcome"]>;
type KeeperFailureClass = NonNullable<
  KeeperAttemptEvidence["tracks"][1]["failureClass"]
>;
type KeeperTrackState = KeeperAttemptEvidence["tracks"][1]["state"];

const keeperOutcomeRules: Readonly<
  Record<
    KeeperOutcome,
    {
      readonly failureClasses: readonly KeeperFailureClass[];
      readonly failureRequired?: boolean;
      readonly receipt: boolean;
      readonly state: KeeperTrackState;
      readonly transaction: boolean;
    }
  >
> = {
  preparing: {
    state: "unknown",
    transaction: false,
    receipt: false,
    failureClasses: [],
  },
  "not-required": {
    state: "fresh",
    transaction: false,
    receipt: false,
    failureClasses: [],
  },
  simulated: {
    state: "unknown",
    transaction: false,
    receipt: false,
    failureClasses: [],
  },
  "failed-before-submission": {
    state: "retryable",
    transaction: false,
    receipt: false,
    failureRequired: true,
    failureClasses: [
      "quote-unavailable",
      "preflight-rejected",
      "submission-rejected",
    ],
  },
  pending: {
    state: "unknown",
    transaction: true,
    receipt: false,
    failureClasses: ["receipt-unavailable"],
  },
  succeeded: {
    state: "fresh",
    transaction: true,
    receipt: true,
    failureClasses: [],
  },
  reverted: {
    state: "retryable",
    transaction: true,
    receipt: true,
    failureRequired: true,
    failureClasses: ["execution-reverted"],
  },
  reorged: {
    state: "unknown",
    transaction: true,
    receipt: false,
    failureRequired: true,
    failureClasses: ["canonicality-uncertain"],
  },
};

const assertKeeperAttemptShape = (input: {
  readonly failureClass: KeeperFailureClass | undefined;
  readonly outcome: KeeperOutcome;
  readonly receiptPresent: boolean;
  readonly state: KeeperTrackState;
  readonly transactionPresent: boolean;
}): void => {
  const rule = keeperOutcomeRules[input.outcome];
  if (
    input.state !== rule.state ||
    input.receiptPresent !== rule.receipt ||
    input.transactionPresent !== rule.transaction ||
    (rule.failureRequired === true && input.failureClass === undefined) ||
    (input.failureClass !== undefined &&
      !rule.failureClasses.includes(input.failureClass))
  ) {
    throw new TypeError("Keeper attempt evidence is internally inconsistent");
  }
};

const keeperFailureClassFrom = (
  value: unknown,
): KeeperFailureClass | undefined =>
  value === undefined
    ? undefined
    : enumValue(value, "keeper attempt failure class", [
        "quote-unavailable",
        "preflight-rejected",
        "submission-rejected",
        "receipt-unavailable",
        "execution-reverted",
        "canonicality-uncertain",
      ] as const);

const keeperReceiptFrom = (
  value: unknown,
): KeeperAttemptEvidence["tracks"][1]["receipt"] => {
  if (value === undefined) return undefined;
  const receipt = record(value, "keeper attempt receipt");
  return {
    blockNumber: bigintValue(receipt.blockNumber, "keeper receipt block"),
    blockHash: hexValue(receipt.blockHash, "keeper receipt hash", 64),
    blockTimestamp: bigintValue(receipt.blockTimestamp, "keeper receipt time"),
  };
};

const keeperLatestAttemptFrom = (
  value: unknown,
  track: 1 | 2 | 3 | 4,
  state: KeeperTrackState,
): KeeperAttemptEvidence["tracks"][typeof track] => {
  const latest = record(value, `keeper track ${track} latest attempt`);
  if (nonnegativeNumberValue(latest.track, "keeper attempt track") !== track) {
    throw new TypeError("Keeper attempt is attached to the wrong track");
  }
  const outcome = enumValue(latest.outcome, "keeper attempt outcome", [
    "preparing",
    "not-required",
    "simulated",
    "failed-before-submission",
    "pending",
    "succeeded",
    "reverted",
    "reorged",
  ] as const);
  const actionKind = enumValue(latest.actionKind, "keeper action kind", [
    "reward-epoch",
    "reward-track",
    "protocol-liquidity",
  ] as const);
  if (actionKind !== "reward-track") {
    throw new TypeError("Keeper track evidence has the wrong action kind");
  }
  const failureClass = keeperFailureClassFrom(latest.failureClass);
  const transactionHash = nullableHex(
    latest.transactionHash,
    "keeper attempt transaction hash",
    64,
  );
  const receipt = keeperReceiptFrom(latest.receipt);
  assertKeeperAttemptShape({
    state,
    outcome,
    failureClass,
    transactionPresent: transactionHash !== undefined,
    receiptPresent: receipt !== undefined,
  });
  return {
    state,
    actionKind,
    outcome,
    ...(failureClass === undefined ? {} : { failureClass }),
    ...(transactionHash === undefined ? {} : { transactionHash }),
    observedBlock: bigintValue(latest.observedBlock, "keeper observed block"),
    observedAt: bigintValue(latest.observedAt, "keeper observed time"),
    ...(receipt === undefined ? {} : { receipt }),
  };
};

const keeperTrackFrom = (
  value: unknown,
  track: 1 | 2 | 3 | 4,
): KeeperAttemptEvidence["tracks"][typeof track] => {
  const item = record(value, `keeper track ${track}`);
  const state = enumValue(item.state, `keeper track ${track} state`, [
    "fresh",
    "retryable",
    "unknown",
  ] as const);
  if (item.latest === undefined) {
    if (state !== "unknown") {
      throw new TypeError("Known keeper track state requires an attempt");
    }
    return { state };
  }
  return keeperLatestAttemptFrom(item.latest, track, state);
};

const keeperAttemptEvidenceFrom = (
  value: unknown,
  expectedManifest: IndexedHistoryManifest,
): KeeperAttemptEvidence => {
  const body = record(value, "keeper-attempt response");
  assertManifestIdentity(manifestFrom(body.manifest), expectedManifest);
  const evidence = record(body.evidence, "keeper-attempt evidence");
  const freshness = record(evidence.freshness, "keeper-attempt freshness");
  const coverage = record(evidence.coverage, "keeper-attempt coverage");
  const tracks = record(evidence.tracks, "keeper-attempt tracks");
  const generation = stringValue(
    evidence.generation,
    "keeper-attempt generation",
  );
  if (generation.length === 0)
    throw new TypeError("keeper generation is empty");
  const coverageFor = (track: 1 | 2 | 3 | 4) =>
    enumValue(coverage[track], `keeper track ${track} coverage`, [
      "complete",
      "partial",
    ] as const);
  const observedAt = optionalBigint(freshness.observedAt, "keeper observedAt");
  const recordedAt = optionalBigint(freshness.recordedAt, "keeper recordedAt");
  const ageSeconds = optionalBigint(freshness.ageSeconds, "keeper ageSeconds");
  const maximumAgeSeconds = bigintValue(
    freshness.maximumAgeSeconds,
    "keeper maximumAgeSeconds",
  );
  if (maximumAgeSeconds === 0n) {
    throw new TypeError("keeper maximumAgeSeconds must be positive");
  }
  const state = enumValue(evidence.state, "keeper-attempt state", [
    "fresh",
    "stale",
    "incomplete",
    "unavailable",
  ] as const);
  const decodedCoverage = {
    1: coverageFor(1),
    2: coverageFor(2),
    3: coverageFor(3),
    4: coverageFor(4),
  } as const;
  const decodedTracks = {
    1: keeperTrackFrom(tracks[1], 1),
    2: keeperTrackFrom(tracks[2], 2),
    3: keeperTrackFrom(tracks[3], 3),
    4: keeperTrackFrom(tracks[4], 4),
  } as const;
  if (
    ([1, 2, 3, 4] as const).some(
      (track) =>
        (decodedCoverage[track] === "partial") !==
        (decodedTracks[track].state === "unknown"),
    )
  ) {
    throw new TypeError("Keeper coverage and track state disagree");
  }
  if (
    state !== "fresh" &&
    ([1, 2, 3, 4] as const).some(
      (track) =>
        decodedCoverage[track] !== "partial" ||
        decodedTracks[track].state !== "unknown" ||
        decodedTracks[track].outcome !== undefined,
    )
  ) {
    throw new TypeError("Non-fresh keeper evidence must remain unknown");
  }
  return {
    source: enumValue(evidence.source, "keeper-attempt source", [
      "keeper-attempt-journal",
    ] as const),
    generation,
    state,
    freshness: {
      ...(observedAt === undefined ? {} : { observedAt }),
      ...(recordedAt === undefined ? {} : { recordedAt }),
      ...(ageSeconds === undefined ? {} : { ageSeconds }),
      maximumAgeSeconds,
    },
    coverage: decodedCoverage,
    tracks: decodedTracks,
  };
};

const pinPageSnapshot = (
  pinned: IndexedHistorySnapshot | undefined,
  observed: IndexedHistorySnapshot,
): IndexedHistorySnapshot => {
  if (pinned === undefined) return observed;
  if (indexedHistorySnapshotKey(pinned) === indexedHistorySnapshotKey(observed))
    return pinned;
  throw new IndexedHistoryError(
    "history-snapshot-mismatch",
    "Indexed history pagination changed its pinned snapshot",
    502,
    { snapshot: observed },
  );
};

const rememberPaginationCursor = (
  cursor: string | undefined,
  seenCursors: Set<string>,
): void => {
  if (cursor === undefined) return;
  if (seenCursors.has(cursor)) {
    throw new IndexedHistoryError(
      "invalid-pagination",
      "History service repeated a pagination cursor",
      502,
    );
  }
  seenCursors.add(cursor);
};

export const collectIndexedHistoryPages = async (
  read: (request: IndexedHistoryRequest) => Promise<IndexedHistoryPage>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{
  readonly items: readonly IndexedHistoryItem[];
  readonly last: IndexedHistoryPage;
}> => {
  const items: IndexedHistoryItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let last: IndexedHistoryPage | undefined;
  let pinnedSnapshot: IndexedHistorySnapshot | undefined;
  do {
    last = await read({
      fromBlock,
      toBlock,
      limit: 100,
      order: "asc",
      ...(cursor === undefined ? {} : { cursor }),
    });
    pinnedSnapshot = pinPageSnapshot(pinnedSnapshot, last.snapshot);
    items.push(...last.items);
    cursor = last.page.nextCursor;
    rememberPaginationCursor(cursor, seenCursors);
  } while (last.page.hasMore && cursor !== undefined);
  if (last === undefined || (last.page.hasMore && cursor === undefined)) {
    throw new IndexedHistoryError(
      "invalid-pagination",
      "History service truncated a page without a continuation cursor",
      502,
    );
  }
  return { items, last };
};

type RewardItemCache = IndexedHistoryItemCache<IndexedHistoryItem>;

export const createIndexedHistoryReaders = ({
  fetcher,
  identity,
  manifest,
  basePath,
}: IndexedHistoryReaderOptions): IndexedHistoryReaders => {
  const expectedManifest = expectedManifestIdentity(manifest);
  const read = (endpoint: string) =>
    createPageReader(fetcher, basePath, endpoint, expectedManifest);
  const operations = read("protocol/operations");
  const keeperAttempts = async (): Promise<KeeperAttemptEvidence> => {
    try {
      const response = await fetcher(`${basePath}/protocol/keeper-attempts`);
      if (!response.ok) return unknownKeeperAttemptEvidence();
      return keeperAttemptEvidenceFrom(await response.json(), expectedManifest);
    } catch {
      return unknownKeeperAttemptEvidence();
    }
  };
  const permanentCommitments = read("protocol/permanent-commitments");
  const rewards = read("protocol/rewards");
  const copy = createIdentityProtocolCopy(identity).events;
  let rewardCache: RewardItemCache | undefined;
  let rewardLineage: string | undefined;
  const collectRewards = async (fromBlock: bigint, toBlock: bigint) => {
    try {
      return await collectIndexedHistoryPages(rewards, fromBlock, toBlock);
    } catch (cause) {
      rewardCache = undefined;
      rewardLineage = undefined;
      throw cause;
    }
  };
  return {
    status: async () => {
      const response = await fetcher(`${basePath}/status`);
      if (!response.ok) {
        throw await serviceErrorFrom(response, expectedManifest);
      }
      return serviceStatusFrom(await response.json(), expectedManifest);
    },
    market: {
      candles: async () => {
        const response = await fetcher(`${basePath}/market/candles`);
        if (!response.ok) {
          throw await serviceErrorFrom(response, expectedManifest);
        }
        return candleFeedFrom(await response.json(), expectedManifest);
      },
      swaps: read("market/swaps"),
      fees: read("market/fees"),
    },
    protocol: {
      discoveries: async (account, fromBlock, toBlock) =>
        discoveryHistoryFrom(
          await read("protocol/discoveries")({
            account,
            fromBlock,
            toBlock,
            limit: 100,
            order: "desc",
          }),
          account,
          manifest.contracts.fuelCore as Address,
        ),
      liquidityCycles: read("protocol/liquidity-cycles"),
      operations,
      permanentIdentityCandidates: async (fromBlock, toBlock) => {
        const page = await collectIndexedHistoryPages(
          permanentCommitments,
          fromBlock,
          toBlock,
        );
        const throughBlock = indexedHistoryCoveredThrough(
          page.last.status.coverage.indexedThroughBlock,
          toBlock,
          fromBlock,
        );
        if (
          throughBlock < fromBlock ||
          page.last.status.coverage.indexedThroughTime === undefined
        ) {
          throw new IndexedHistoryError(
            "history-not-synchronized",
            "Indexed permanent identity history is not synchronized",
            503,
            { snapshot: page.last.snapshot },
          );
        }
        const identityIds = [
          ...new Set(
            page.items
              .filter((item) => item.blockNumber <= throughBlock)
              .map((item) =>
                nonnegativeNumberValue(
                  item.payload.identityId,
                  "permanent-commitment.identityId",
                ),
              ),
          ),
        ].sort((left, right) => left - right);
        if (
          identityIds.some((identityId) => identityId < 1 || identityId > 4_444)
        ) {
          throw new RangeError("Permanent identity candidate is out of bounds");
        }
        return {
          identityIds,
          fromBlock,
          throughBlock,
          coverage: page.last.status.state,
          indexedThroughTime: page.last.status.coverage.indexedThroughTime,
        };
      },
      recentOperationalEvents: async (fromBlock, toBlock, limit) => {
        const [{ items }, attemptEvidence] = await Promise.all([
          collectIndexedHistoryPages(operations, fromBlock, toBlock),
          keeperAttempts(),
        ]);
        const events = items.flatMap((item) => {
          const event = operationalFrom(item, copy);
          return event === undefined ? [] : [event];
        });
        return {
          events: retainOperationalSummaryEvents(events, limit),
          trackAttemptCoverage: attemptEvidence.coverage,
          trackAttemptState: {
            1: attemptEvidence.tracks[1].state,
            2: attemptEvidence.tracks[2].state,
            3: attemptEvidence.tracks[3].state,
            4: attemptEvidence.tracks[4].state,
          },
          keeperAttemptEvidence: attemptEvidence,
          failureScanTruncated: false,
          claimScanTruncated: true,
          eventWindowTruncated: events.length > limit,
        };
      },
      rewardHistory: async (fromBlock, toBlock) => {
        let scanFrom = indexedHistoryScanStart(rewardCache, fromBlock, toBlock);
        let page = await collectRewards(scanFrom, toBlock);
        const pageLineage = indexedHistoryLineageKey(page.last.snapshot);
        if (rewardLineage !== undefined && rewardLineage !== pageLineage) {
          rewardCache = undefined;
          scanFrom = fromBlock;
          page = await collectRewards(scanFrom, toBlock);
        }
        let throughBlock = indexedHistoryCoveredThrough(
          page.last.status.coverage.indexedThroughBlock,
          toBlock,
          scanFrom,
        );
        if (
          scanFrom > fromBlock &&
          rewardCache !== undefined &&
          throughBlock < rewardCache.throughBlock
        ) {
          scanFrom = fromBlock;
          page = await collectRewards(scanFrom, toBlock);
          throughBlock = indexedHistoryCoveredThrough(
            page.last.status.coverage.indexedThroughBlock,
            toBlock,
            scanFrom,
          );
          rewardCache = undefined;
        }
        const items = mergeIndexedHistoryItems({
          cache: rewardCache,
          scanFrom,
          fresh: page.items,
          throughBlock,
        }).filter(
          (item) =>
            item.blockNumber >= fromBlock && item.blockNumber <= throughBlock,
        );
        rewardCache = { fromBlock, throughBlock, items };
        rewardLineage = indexedHistoryLineageKey(page.last.snapshot);
        return {
          events: items.flatMap((item) => {
            const event = rewardFrom(item);
            return event === undefined ? [] : [event];
          }),
          fromBlock,
          throughBlock,
          coverage: page.last.status.state,
          ...(page.last.status.coverage.indexedThroughTime === undefined
            ? {}
            : {
                indexedThroughTime:
                  page.last.status.coverage.indexedThroughTime,
              }),
        };
      },
    },
  };
};

export interface DiscoveryHistoryRequest {
  readonly requestId: Hex;
  readonly acquisitionHash?: Hex;
  readonly requestedAt?: bigint;
  readonly outcome: "pending" | "delivered" | "cancelled";
  readonly identityId?: number;
  readonly outcomeHash?: Hex;
}
export interface DiscoveryHistoryWindow {
  readonly requests: readonly DiscoveryHistoryRequest[];
  readonly truncated: boolean;
  readonly coverage: IndexedHistoryState;
  readonly observedAt: bigint | undefined;
  readonly throughBlock: bigint | undefined;
}
const discoveryHash = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new TypeError("Invalid discovery reference");
  return value as Hex;
};
function discoveryEvent(
  item: IndexedHistoryItem,
  account: Address,
  fuelCore: Address,
) {
  if (
    item.removed ||
    item.sourceAddress.toLowerCase() !== fuelCore.toLowerCase() ||
    String(item.payload.account).toLowerCase() !== account.toLowerCase()
  )
    throw new TypeError(
      "Discovery evidence does not match the canonical wallet source",
    );
  return discoveryHash(item.payload.requestId);
}
function discoveryOutcome(
  item: IndexedHistoryItem,
  prior: DiscoveryHistoryRequest,
): DiscoveryHistoryRequest {
  if (item.eventName === "discovery-requested")
    return {
      ...prior,
      acquisitionHash: item.transactionHash,
      requestedAt: item.blockTimestamp,
    };
  if (item.eventName === "discovery-cancelled")
    return {
      ...prior,
      outcome: "cancelled",
      outcomeHash: item.transactionHash,
    };
  if (item.eventName !== "discovery-fulfilled")
    throw new TypeError("Unexpected discovery event");
  const identityId = Number(item.payload.identityId);
  if (!Number.isSafeInteger(identityId) || identityId < 1 || identityId > 4444)
    throw new TypeError("Invalid delivered identity");
  return {
    ...prior,
    outcome: "delivered",
    identityId,
    outcomeHash: item.transactionHash,
  };
}
/** Canonical event correlation; delivery evidence never substitutes for current ownership. */
export function discoveryHistoryFrom(
  page: IndexedHistoryPage,
  account: Address,
  fuelCore: Address,
): DiscoveryHistoryWindow {
  const requests = new Map<Hex, DiscoveryHistoryRequest>();
  const items = [...page.items].sort(
    (left, right) =>
      Number(left.blockNumber - right.blockNumber) ||
      left.logIndex - right.logIndex,
  );
  for (const item of items) {
    const requestId = discoveryEvent(item, account, fuelCore);
    const prior = requests.get(requestId) ?? {
      requestId,
      outcome: "pending" as const,
    };
    if (prior.outcome !== "pending")
      throw new TypeError("Conflicting discovery outcomes");
    requests.set(requestId, discoveryOutcome(item, prior));
  }
  return {
    requests: [...requests.values()].reverse(),
    truncated: page.page.hasMore,
    coverage: page.status.state,
    observedAt: page.status.coverage.indexedThroughTime,
    throughBlock: page.status.coverage.indexedThroughBlock,
  };
}
