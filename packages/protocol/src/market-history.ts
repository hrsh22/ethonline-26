import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import type { IdentityConfiguration } from "@orbit/config/identity";
import type { Address, Hex } from "viem";

import {
  CANONICAL_MARKET_TOKEN_DECIMALS,
  deriveCanonicalMarketPrice,
} from "./domain.js";
import {
  assertIndexedHistoryProgress,
  assertIndexedHistorySnapshotsCoherent,
  collectIndexedHistoryPages,
  indexedHistoryLineageKey,
  type IndexedHistoryReaders,
  type IndexedHistoryItem,
  type IndexedHistoryPage,
  type IndexedHistoryRequest,
  type IndexedHistoryServiceStatus,
  type IndexedHistorySnapshot,
  type IndexedHistoryState,
} from "./history.js";
import {
  indexedHistoryCoveredThrough,
  indexedHistoryScanStart,
  mergeIndexedHistoryItems,
  type IndexedHistoryItemCache,
} from "./indexed-history-cache.js";

const MINUTELY_INTERVAL_SECONDS = 60n;

export type CanonicalMarketCandleInterval = "1m" | "1h";

export interface LiquidityCycleHistory {
  readonly cycleNumber: bigint;
  readonly blockNumber: bigint;
  readonly blockTimestamp: bigint;
  readonly transactionHash: Hex;
  readonly pulledWeth: bigint;
  readonly consumedWeth: bigint;
  readonly queuedWeth: bigint;
  readonly permanentlyLockedWeth: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
}

export interface MarketCandle {
  readonly intervalStart: bigint;
  readonly intervalEnd: bigint;
  readonly openWethPerLiquidTokenX18: bigint | undefined;
  readonly highWethPerLiquidTokenX18: bigint | undefined;
  readonly lowWethPerLiquidTokenX18: bigint | undefined;
  readonly closeWethPerLiquidTokenX18: bigint | undefined;
  readonly grossWethVolume: bigint;
  readonly protocolFeeWeth: bigint;
  readonly swapCount: number;
  readonly matchedFeeCount: number;
  readonly feeMatchState: IndexedHistoryState;
}

export interface CanonicalMarketHistorySnapshot {
  readonly interval: CanonicalMarketCandleInterval;
  readonly candleSource: {
    readonly kind: "indexed-history" | "uniswap-v4-subgraph";
    readonly state: IndexedHistoryState;
    readonly indexedThroughBlock: bigint | undefined;
  };
  readonly status: {
    readonly state: IndexedHistoryState;
    readonly fromBlock: bigint;
    readonly indexedThroughBlock: bigint | undefined;
    readonly indexedThroughTime: bigint | undefined;
    readonly observedBlock: bigint | undefined;
    readonly lagBlocks: bigint | undefined;
  };
  readonly feeMatching: {
    readonly state: IndexedHistoryState;
    readonly matchedSwapCount: number;
    readonly unmatchedSwapCount: number;
    readonly unmatchedFeeCount: number;
  };
  readonly liquidityCycles: readonly LiquidityCycleHistory[];
  readonly candles: readonly MarketCandle[];
}

type HistoryCollection = Pick<IndexedHistoryPage, "items" | "status">;

export interface CanonicalMarketHistoryInput {
  readonly manifest: ProtocolDeploymentManifest;
  readonly identity: IdentityConfiguration;
  readonly index: IndexedHistoryServiceStatus;
  readonly swaps: HistoryCollection;
  readonly fees: HistoryCollection;
  readonly liquidityCycles: HistoryCollection;
}

export interface CanonicalMarketHistoryReader {
  readonly readLatest: () => Promise<CanonicalMarketHistorySnapshot>;
}

export interface CanonicalMarketHistoryReaderOptions {
  readonly history: IndexedHistoryReaders;
  readonly manifest: ProtocolDeploymentManifest;
  readonly identity: IdentityConfiguration;
}

const requiredAddress = (
  manifest: ProtocolDeploymentManifest,
  name: keyof ProtocolDeploymentManifest["contracts"],
): Address => {
  const address = manifest.contracts[name];
  if (address === undefined) {
    throw new TypeError(`Deployment manifest is missing ${name}`);
  }
  return address as Address;
};

const payloadString = (item: IndexedHistoryItem, key: string): string => {
  const value = item.payload[key];
  if (typeof value !== "string") {
    throw new TypeError(`${item.eventName}.${key} must be a string`);
  }
  return value;
};

const payloadBigint = (item: IndexedHistoryItem, key: string): bigint => {
  const value = payloadString(item, key);
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${item.eventName}.${key} must be an unsigned integer`);
  }
  return BigInt(value);
};

const payloadInteger = (item: IndexedHistoryItem, key: string): number => {
  const value = item.payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${item.eventName}.${key} must be a safe integer`);
  }
  return value;
};

const compareBigint = (left: bigint, right: bigint): number =>
  left === right ? 0 : left < right ? -1 : 1;

const compareHistoryPosition = (
  left: IndexedHistoryItem,
  right: IndexedHistoryItem,
): number =>
  compareBigint(left.blockNumber, right.blockNumber) ||
  left.transactionIndex - right.transactionIndex ||
  left.logIndex - right.logIndex;

const ordered = (items: readonly IndexedHistoryItem[]) =>
  [...items].sort(compareHistoryPosition);

const cycleFrom = (item: IndexedHistoryItem): LiquidityCycleHistory => {
  if (item.eventName !== "protocol-liquidity-added") {
    throw new TypeError(
      `Expected a liquidity cycle, received ${item.eventName}`,
    );
  }
  return {
    cycleNumber: payloadBigint(item, "cycleNumber"),
    blockNumber: item.blockNumber,
    blockTimestamp: item.blockTimestamp,
    transactionHash: item.transactionHash,
    pulledWeth: payloadBigint(item, "pulledWeth"),
    consumedWeth: payloadBigint(item, "consumedWeth"),
    queuedWeth: payloadBigint(item, "queuedWeth"),
    permanentlyLockedWeth: payloadBigint(item, "permanentlyLockedWeth"),
    tickLower: payloadInteger(item, "tickLower"),
    tickUpper: payloadInteger(item, "tickUpper"),
    liquidity: payloadBigint(item, "liquidity"),
  };
};

const liquidityHistory = (
  items: readonly IndexedHistoryItem[],
): readonly LiquidityCycleHistory[] => {
  const cycles = ordered(items).map(cycleFrom);
  cycles.forEach((cycle, index) => {
    const previous = cycles[index - 1];
    if (previous !== undefined && previous.cycleNumber >= cycle.cycleNumber) {
      throw new RangeError("Liquidity cycle history is not strictly ordered");
    }
  });
  return cycles;
};

interface MatchedSwap {
  readonly item: IndexedHistoryItem;
  readonly priceX18: bigint;
  readonly fee:
    | {
        readonly wethVolume: bigint;
        readonly totalFee: bigint;
      }
    | undefined;
}

const feesByTransaction = (fees: readonly IndexedHistoryItem[]) => {
  const grouped = new Map<string, IndexedHistoryItem[]>();
  ordered(fees).forEach((fee) => {
    if (fee.eventName !== "fee-accrued") {
      throw new TypeError(`Expected a fee event, received ${fee.eventName}`);
    }
    const key = fee.transactionHash.toLowerCase();
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [fee]);
    else bucket.push(fee);
  });
  return grouped;
};

const eventCountsByTransaction = (
  items: readonly IndexedHistoryItem[],
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = item.transactionHash.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

const swapPrice = (
  item: IndexedHistoryItem,
  manifest: ProtocolDeploymentManifest,
  identity: IdentityConfiguration,
) => {
  if (item.eventName !== "swap") {
    throw new TypeError(`Expected a swap, received ${item.eventName}`);
  }
  return deriveCanonicalMarketPrice({
    sqrtPriceX96: payloadBigint(item, "sqrtPriceX96"),
    currency0: manifest.canonicalPool.currency0 as Address,
    currency1: manifest.canonicalPool.currency1 as Address,
    liquidToken: requiredAddress(manifest, "fuelCore"),
    identity,
    liquidTokenDecimals: CANONICAL_MARKET_TOKEN_DECIMALS.liquidToken,
    settlementTokenDecimals: CANONICAL_MARKET_TOKEN_DECIMALS.settlementToken,
  }).wethPerLiquidTokenWei;
};

const matchSwapFees = (
  swaps: readonly IndexedHistoryItem[],
  fees: readonly IndexedHistoryItem[],
  manifest: ProtocolDeploymentManifest,
  identity: IdentityConfiguration,
) => {
  const groupedFees = feesByTransaction(fees);
  const swapCounts = eventCountsByTransaction(swaps);
  const candidateByTransaction = new Map<string, number>();
  let matchedSwapCount = 0;
  const observations: MatchedSwap[] = ordered(swaps).map((swap) => {
    const key = swap.transactionHash.toLowerCase();
    const candidates = groupedFees.get(key) ?? [];
    const candidateIndex = candidateByTransaction.get(key) ?? 0;
    candidateByTransaction.set(key, candidateIndex + 1);
    // FeeAccrued is emitted from beforeSwap when WETH is specified and from
    // afterSwap when WETH is unspecified. The event can therefore sit on
    // either side of PoolManager.Swap. Within one transaction, the nth fee
    // still belongs to the nth swap. Unequal counts are ambiguous, so their
    // volume is intentionally left unmatched instead of guessed.
    const matchedFee =
      candidates.length === swapCounts.get(key)
        ? candidates[candidateIndex]
        : undefined;
    if (matchedFee !== undefined) matchedSwapCount += 1;
    return {
      item: swap,
      priceX18: swapPrice(swap, manifest, identity),
      fee:
        matchedFee === undefined
          ? undefined
          : {
              wethVolume: payloadBigint(matchedFee, "wethVolume"),
              totalFee: payloadBigint(matchedFee, "totalFee"),
            },
    };
  });
  const unmatchedSwapCount = observations.length - matchedSwapCount;
  const unmatchedFeeCount = fees.length - matchedSwapCount;
  return {
    observations,
    feeMatching: {
      state:
        unmatchedSwapCount === 0 && unmatchedFeeCount === 0
          ? ("complete" as const)
          : ("partial" as const),
      matchedSwapCount,
      unmatchedSwapCount,
      unmatchedFeeCount,
    },
  };
};

const intervalStart = (timestamp: bigint, duration: bigint) =>
  timestamp - (timestamp % duration);

const minimum = (values: readonly bigint[]) =>
  values.reduce((result, value) => (value < result ? value : result));

const maximum = (values: readonly bigint[]) =>
  values.reduce((result, value) => (value > result ? value : result));

const candleFrom = (
  start: bigint,
  duration: bigint,
  observations: readonly MatchedSwap[],
  previousClose: bigint | undefined,
): MarketCandle => {
  const prices = observations.map((observation) => observation.priceX18);
  const extentPrices =
    previousClose === undefined ? prices : [previousClose, ...prices];
  const matchedFees = observations.flatMap((observation) =>
    observation.fee === undefined ? [] : [observation.fee],
  );
  return {
    intervalStart: start,
    intervalEnd: start + duration,
    // A Swap event reports the pool price after the trade. The prior traded
    // close is therefore the only observed price immediately before a later
    // interval's first swap, and preserves that swap's direction in OHLC.
    openWethPerLiquidTokenX18: previousClose ?? prices[0],
    highWethPerLiquidTokenX18:
      extentPrices.length === 0 ? undefined : maximum(extentPrices),
    lowWethPerLiquidTokenX18:
      extentPrices.length === 0 ? undefined : minimum(extentPrices),
    closeWethPerLiquidTokenX18: prices.at(-1),
    grossWethVolume: matchedFees.reduce(
      (total, fee) => total + fee.wethVolume,
      0n,
    ),
    protocolFeeWeth: matchedFees.reduce(
      (total, fee) => total + fee.totalFee,
      0n,
    ),
    swapCount: observations.length,
    matchedFeeCount: matchedFees.length,
    feeMatchState:
      matchedFees.length === observations.length ? "complete" : "partial",
  };
};

const minuteCandles = (
  observations: readonly MatchedSwap[],
): readonly MarketCandle[] => {
  const byInterval = new Map<string, MatchedSwap[]>();
  observations.forEach((observation) => {
    const start = intervalStart(
      observation.item.blockTimestamp,
      MINUTELY_INTERVAL_SECONDS,
    );
    const key = start.toString();
    const bucket = byInterval.get(key);
    if (bucket === undefined) byInterval.set(key, [observation]);
    else bucket.push(observation);
  });
  const starts = [...byInterval.keys()].map(BigInt).sort(compareBigint);
  // A no-trade minute is not market data. Omitting empty buckets keeps sparse
  // testnet activity honest without manufacturing carried-forward prices or
  // stretching a handful of real swaps across hundreds of empty marks.
  let previousClose: bigint | undefined;
  return starts.map((start) => {
    const candle = candleFrom(
      start,
      MINUTELY_INTERVAL_SECONDS,
      byInterval.get(start.toString()) ?? [],
      previousClose,
    );
    previousClose = candle.closeWethPerLiquidTokenX18;
    return candle;
  });
};

const minimumDefined = (
  values: readonly (bigint | undefined)[],
): bigint | undefined => {
  const defined = values.filter(
    (value): value is bigint => value !== undefined,
  );
  return defined.length === 0 ? undefined : minimum(defined);
};

const combinedStatus = (
  input: CanonicalMarketHistoryInput,
): CanonicalMarketHistorySnapshot["status"] => {
  const endpointStatuses = [
    input.swaps.status,
    input.fees.status,
    input.liquidityCycles.status,
  ];
  return {
    state:
      input.index.status.state === "partial" ||
      endpointStatuses.some((status) => status.state === "partial")
        ? "partial"
        : "complete",
    fromBlock: input.index.status.coverage.fromBlock,
    indexedThroughBlock: minimumDefined([
      input.index.status.coverage.indexedThroughBlock,
      ...endpointStatuses.map((status) => status.coverage.indexedThroughBlock),
    ]),
    indexedThroughTime: minimumDefined([
      input.index.status.coverage.indexedThroughTime,
      ...endpointStatuses.map((status) => status.coverage.indexedThroughTime),
    ]),
    observedBlock: input.index.status.head.observedBlock,
    lagBlocks: input.index.status.head.lagBlocks,
  };
};

export const deriveCanonicalMarketHistorySnapshot = (
  input: CanonicalMarketHistoryInput,
): CanonicalMarketHistorySnapshot => {
  const matched = matchSwapFees(
    input.swaps.items,
    input.fees.items,
    input.manifest,
    input.identity,
  );
  return {
    interval: "1m",
    candleSource: {
      kind: "indexed-history",
      state: input.swaps.status.state,
      indexedThroughBlock: input.swaps.status.coverage.indexedThroughBlock,
    },
    status: combinedStatus(input),
    feeMatching: matched.feeMatching,
    liquidityCycles: liquidityHistory(input.liquidityCycles.items),
    candles: minuteCandles(matched.observations),
  };
};

interface HistoryCollectionCache
  extends HistoryCollection, IndexedHistoryItemCache<IndexedHistoryItem> {
  readonly snapshot: IndexedHistorySnapshot;
}

type PageReader = (
  request: IndexedHistoryRequest,
) => Promise<IndexedHistoryPage>;

const readCollectionFrom = async (
  read: PageReader,
  cache: HistoryCollectionCache | undefined,
  fromBlock: bigint,
  toBlock: bigint,
  scanFrom: bigint,
  expectedSnapshot: IndexedHistorySnapshot,
): Promise<HistoryCollectionCache> => {
  const page = await collectIndexedHistoryPages(read, scanFrom, toBlock);
  assertIndexedHistoryProgress(expectedSnapshot, page.last.snapshot);
  const throughBlock = indexedHistoryCoveredThrough(
    page.last.status.coverage.indexedThroughBlock,
    toBlock,
    scanFrom,
  );
  if (
    cache !== undefined &&
    scanFrom > fromBlock &&
    throughBlock < cache.throughBlock
  ) {
    return readCollectionFrom(
      read,
      undefined,
      fromBlock,
      toBlock,
      fromBlock,
      expectedSnapshot,
    );
  }
  return {
    fromBlock,
    throughBlock,
    snapshot: page.last.snapshot,
    items: mergeIndexedHistoryItems({
      cache,
      scanFrom,
      fresh: page.items,
      throughBlock,
    }),
    status: page.last.status,
  };
};

const readCollection = (
  read: PageReader,
  cache: HistoryCollectionCache | undefined,
  fromBlock: bigint,
  toBlock: bigint,
  expectedSnapshot: IndexedHistorySnapshot,
) =>
  readCollectionFrom(
    read,
    cache,
    fromBlock,
    toBlock,
    indexedHistoryScanStart(cache, fromBlock, toBlock),
    expectedSnapshot,
  );

const emptyCollection = (
  index: IndexedHistoryServiceStatus,
): HistoryCollectionCache => ({
  fromBlock: index.status.coverage.fromBlock,
  throughBlock: index.status.coverage.fromBlock - 1n,
  snapshot: index.snapshot,
  items: [],
  status: {
    state: "partial",
    requested: {
      fromBlock: index.status.coverage.fromBlock,
      toBlock: index.status.coverage.fromBlock,
    },
    coverage: index.status.coverage,
    head: index.status.head,
  },
});

export const createCanonicalMarketHistoryReader = ({
  history,
  manifest,
  identity,
}: CanonicalMarketHistoryReaderOptions): CanonicalMarketHistoryReader => {
  let swaps: HistoryCollectionCache | undefined;
  let fees: HistoryCollectionCache | undefined;
  let liquidityCycles: HistoryCollectionCache | undefined;
  let cachedLineage: string | undefined;
  let inFlight: Promise<CanonicalMarketHistorySnapshot> | undefined;
  const clearCaches = () => {
    swaps = undefined;
    fees = undefined;
    liquidityCycles = undefined;
    cachedLineage = undefined;
  };
  const readLatest = async (): Promise<CanonicalMarketHistorySnapshot> => {
    try {
      const index = await history.status();
      const currentLineage = indexedHistoryLineageKey(index.snapshot);
      if (cachedLineage !== undefined && cachedLineage !== currentLineage) {
        clearCaches();
      }
      const toBlock = index.status.coverage.indexedThroughBlock;
      if (toBlock === undefined) {
        clearCaches();
        const finalIndex = await history.status();
        assertIndexedHistoryProgress(index.snapshot, finalIndex.snapshot);
        cachedLineage = currentLineage;
        const empty = emptyCollection(index);
        return deriveCanonicalMarketHistorySnapshot({
          manifest,
          identity,
          index,
          swaps: empty,
          fees: empty,
          liquidityCycles: empty,
        });
      }
      const fromBlock = index.status.coverage.fromBlock;
      // Prices, fees and liquidity share one canonical checkpoint. The optional
      // subgraph endpoint cannot prove that identity and is not an input here.
      const [refreshedSwaps, refreshedFees, refreshedLiquidityCycles] =
        await Promise.all([
          readCollection(
            history.market.swaps,
            swaps,
            fromBlock,
            toBlock,
            index.snapshot,
          ),
          readCollection(
            history.market.fees,
            fees,
            fromBlock,
            toBlock,
            index.snapshot,
          ),
          readCollection(
            history.protocol.liquidityCycles,
            liquidityCycles,
            fromBlock,
            toBlock,
            index.snapshot,
          ),
        ]);
      const finalIndex = await history.status();
      assertIndexedHistoryProgress(index.snapshot, finalIndex.snapshot);
      const refreshed = [
        refreshedFees,
        refreshedLiquidityCycles,
        refreshedSwaps,
      ];
      refreshed.forEach((collection) =>
        assertIndexedHistoryProgress(collection.snapshot, finalIndex.snapshot),
      );
      assertIndexedHistorySnapshotsCoherent([
        index.snapshot,
        ...refreshed.map((collection) => collection.snapshot),
        finalIndex.snapshot,
      ]);
      swaps = refreshedSwaps;
      fees = refreshedFees;
      liquidityCycles = refreshedLiquidityCycles;
      cachedLineage = currentLineage;
      return deriveCanonicalMarketHistorySnapshot({
        manifest,
        identity,
        index,
        swaps: refreshedSwaps,
        fees: refreshedFees,
        liquidityCycles: refreshedLiquidityCycles,
      });
    } catch (cause) {
      clearCaches();
      throw cause;
    }
  };
  return {
    readLatest: () => {
      if (inFlight !== undefined) return inFlight;
      const request = readLatest();
      const settled = request.then(
        (snapshot) => {
          if (inFlight === settled) inFlight = undefined;
          return snapshot;
        },
        (cause: unknown) => {
          if (inFlight === settled) inFlight = undefined;
          throw cause;
        },
      );
      inFlight = settled;
      return settled;
    },
  };
};
