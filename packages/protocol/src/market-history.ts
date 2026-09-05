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
  type CanonicalMarketCandleFeed,
  type CanonicalMarketCandleObservation,
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
const HOURLY_INTERVAL_SECONDS = 3_600n;

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
  readonly swaps?: HistoryCollection;
  readonly candleFeed?: CanonicalMarketCandleFeed;
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
    grouped.set(key, [...(grouped.get(key) ?? []), fee]);
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
): MarketCandle => {
  const prices = observations.map((observation) => observation.priceX18);
  const matchedFees = observations.flatMap((observation) =>
    observation.fee === undefined ? [] : [observation.fee],
  );
  return {
    intervalStart: start,
    intervalEnd: start + duration,
    openWethPerLiquidTokenX18: prices[0],
    highWethPerLiquidTokenX18:
      prices.length === 0 ? undefined : maximum(prices),
    lowWethPerLiquidTokenX18: prices.length === 0 ? undefined : minimum(prices),
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
    byInterval.set(key, [...(byInterval.get(key) ?? []), observation]);
  });
  const starts = [...byInterval.keys()].map(BigInt).sort(compareBigint);
  // A no-trade minute is not market data. Omitting empty buckets keeps sparse
  // testnet activity honest without manufacturing carried-forward prices or
  // stretching a handful of real swaps across hundreds of empty marks.
  return starts.map((start) =>
    candleFrom(
      start,
      MINUTELY_INTERVAL_SECONDS,
      byInterval.get(start.toString()) ?? [],
    ),
  );
};

interface FeeBucket {
  readonly fees: readonly IndexedHistoryItem[];
  readonly grossWethVolume: bigint;
  readonly protocolFeeWeth: bigint;
}

const EMPTY_FEE_BUCKET: FeeBucket = {
  fees: [],
  grossWethVolume: 0n,
  protocolFeeWeth: 0n,
};

const pricesFromExternal = (
  observation: CanonicalMarketCandleObservation | undefined,
): Pick<
  MarketCandle,
  | "openWethPerLiquidTokenX18"
  | "highWethPerLiquidTokenX18"
  | "lowWethPerLiquidTokenX18"
  | "closeWethPerLiquidTokenX18"
> =>
  observation === undefined
    ? {
        openWethPerLiquidTokenX18: undefined,
        highWethPerLiquidTokenX18: undefined,
        lowWethPerLiquidTokenX18: undefined,
        closeWethPerLiquidTokenX18: undefined,
      }
    : {
        openWethPerLiquidTokenX18: observation.openWethPerLiquidTokenX18,
        highWethPerLiquidTokenX18: observation.highWethPerLiquidTokenX18,
        lowWethPerLiquidTokenX18: observation.lowWethPerLiquidTokenX18,
        closeWethPerLiquidTokenX18: observation.closeWethPerLiquidTokenX18,
      };

const feeBuckets = (
  fees: readonly IndexedHistoryItem[],
): ReadonlyMap<string, FeeBucket> => {
  const items = new Map<string, IndexedHistoryItem[]>();
  fees.forEach((fee) => {
    if (fee.eventName !== "fee-accrued") {
      throw new TypeError(`Expected a fee event, received ${fee.eventName}`);
    }
    const start = intervalStart(
      fee.blockTimestamp,
      HOURLY_INTERVAL_SECONDS,
    ).toString();
    items.set(start, [...(items.get(start) ?? []), fee]);
  });
  return new Map(
    [...items].map(([start, bucket]) => [
      start,
      {
        fees: bucket,
        grossWethVolume: bucket.reduce(
          (total, fee) => total + payloadBigint(fee, "wethVolume"),
          0n,
        ),
        protocolFeeWeth: bucket.reduce(
          (total, fee) => total + payloadBigint(fee, "totalFee"),
          0n,
        ),
      },
    ]),
  );
};

const externalCandleFrom = (
  observation: CanonicalMarketCandleObservation | undefined,
  start: bigint,
  feeBucket: FeeBucket | undefined,
): MarketCandle => {
  const swapCount = observation?.swapCount ?? 0;
  const observedFees = feeBucket ?? EMPTY_FEE_BUCKET;
  const feeCount = observedFees.fees.length;
  return {
    intervalStart: start,
    intervalEnd: start + HOURLY_INTERVAL_SECONDS,
    ...pricesFromExternal(observation),
    grossWethVolume: observedFees.grossWethVolume,
    protocolFeeWeth: observedFees.protocolFeeWeth,
    swapCount,
    matchedFeeCount: Math.min(swapCount, feeCount),
    feeMatchState: swapCount === feeCount ? "complete" : "partial",
  };
};

const externalHourlyCandles = (
  observations: readonly CanonicalMarketCandleObservation[],
  fees: readonly IndexedHistoryItem[],
): readonly MarketCandle[] => {
  const first = observations[0]?.intervalStart;
  const last = observations.at(-1)?.intervalStart;
  if (first === undefined || last === undefined) return [];
  const feesByInterval = feeBuckets(
    fees.filter(
      (fee) =>
        fee.blockTimestamp >= first && fee.blockTimestamp < last + 3_600n,
    ),
  );
  return observations.map((observation) =>
    externalCandleFrom(
      observation,
      observation.intervalStart,
      feesByInterval.get(observation.intervalStart.toString()),
    ),
  );
};

const externalFeeMatching = (
  observations: readonly CanonicalMarketCandleObservation[],
  fees: readonly IndexedHistoryItem[],
): CanonicalMarketHistorySnapshot["feeMatching"] => {
  const first = observations[0]?.intervalStart;
  const last = observations.at(-1)?.intervalEnd;
  const relevantFees =
    first === undefined || last === undefined
      ? []
      : fees.filter(
          (fee) => fee.blockTimestamp >= first && fee.blockTimestamp < last,
        );
  const swapCounts = new Map(
    observations.map((observation) => [
      observation.intervalStart.toString(),
      observation.swapCount,
    ]),
  );
  const feeCounts = new Map(
    [...feeBuckets(relevantFees)].map(([start, bucket]) => [
      start,
      bucket.fees.length,
    ]),
  );
  const starts = new Set([...swapCounts.keys(), ...feeCounts.keys()]);
  let matchedSwapCount = 0;
  let unmatchedSwapCount = 0;
  let unmatchedFeeCount = 0;
  starts.forEach((start) => {
    const swaps = swapCounts.get(start) ?? 0;
    const observedFees = feeCounts.get(start) ?? 0;
    matchedSwapCount += Math.min(swaps, observedFees);
    unmatchedSwapCount += Math.max(0, swaps - observedFees);
    unmatchedFeeCount += Math.max(0, observedFees - swaps);
  });
  return {
    state:
      unmatchedSwapCount === 0 && unmatchedFeeCount === 0
        ? "complete"
        : "partial",
    matchedSwapCount,
    unmatchedSwapCount,
    unmatchedFeeCount,
  };
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
    ...(input.swaps === undefined ? [] : [input.swaps.status]),
    input.fees.status,
    input.liquidityCycles.status,
  ];
  const externalFeed =
    input.candleFeed?.state === "available" ? input.candleFeed : undefined;
  return {
    state:
      input.index.status.state === "partial" ||
      endpointStatuses.some((status) => status.state === "partial") ||
      externalFeed?.hasIndexingErrors === true
        ? "partial"
        : "complete",
    fromBlock: input.index.status.coverage.fromBlock,
    indexedThroughBlock: minimumDefined([
      input.index.status.coverage.indexedThroughBlock,
      ...endpointStatuses.map((status) => status.coverage.indexedThroughBlock),
      externalFeed?.indexedThroughBlock,
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
  if (input.candleFeed?.state === "available") {
    const feeMatching = externalFeeMatching(
      input.candleFeed.candles,
      input.fees.items,
    );
    return {
      interval: "1h",
      candleSource: {
        kind: "uniswap-v4-subgraph",
        state: input.candleFeed.hasIndexingErrors ? "partial" : "complete",
        indexedThroughBlock: input.candleFeed.indexedThroughBlock,
      },
      status: combinedStatus(input),
      feeMatching,
      liquidityCycles: liquidityHistory(input.liquidityCycles.items),
      candles: externalHourlyCandles(
        input.candleFeed.candles,
        input.fees.items,
      ),
    };
  }
  if (input.swaps === undefined) {
    throw new TypeError("Indexed swaps are required without a candle feed");
  }
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
  const unavailableCandleFeed = (): CanonicalMarketCandleFeed => ({
    source: "uniswap-v4-subgraph",
    state: "unavailable",
  });
  const readCandleFeed = async (): Promise<CanonicalMarketCandleFeed> => {
    if (history.market.candles === undefined) return unavailableCandleFeed();
    try {
      return await history.market.candles();
    } catch {
      // The external feed is an enhancement. A public API rolling deployment,
      // provider outage, or malformed external response must degrade to the
      // canonical PoolManager events rather than remove market history.
      return unavailableCandleFeed();
    }
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
      const [candleFeed, refreshedFees, refreshedLiquidityCycles] =
        await Promise.all([
          readCandleFeed(),
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
      const refreshedSwaps =
        candleFeed.state === "available"
          ? undefined
          : await readCollection(
              history.market.swaps,
              swaps,
              fromBlock,
              toBlock,
              index.snapshot,
            );
      const finalIndex = await history.status();
      assertIndexedHistoryProgress(index.snapshot, finalIndex.snapshot);
      const refreshed = [
        refreshedFees,
        refreshedLiquidityCycles,
        ...(refreshedSwaps === undefined ? [] : [refreshedSwaps]),
      ];
      refreshed.forEach((collection) =>
        assertIndexedHistoryProgress(collection.snapshot, finalIndex.snapshot),
      );
      assertIndexedHistorySnapshotsCoherent([
        index.snapshot,
        ...refreshed.map((collection) => collection.snapshot),
        finalIndex.snapshot,
      ]);
      if (refreshedSwaps !== undefined) swaps = refreshedSwaps;
      fees = refreshedFees;
      liquidityCycles = refreshedLiquidityCycles;
      cachedLineage = currentLineage;
      return deriveCanonicalMarketHistorySnapshot({
        manifest,
        identity,
        index,
        ...(refreshedSwaps === undefined ? {} : { swaps: refreshedSwaps }),
        fees: refreshedFees,
        liquidityCycles: refreshedLiquidityCycles,
        candleFeed,
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
