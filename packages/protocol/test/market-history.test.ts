import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";

import type {
  IndexedHistoryItem,
  IndexedHistoryPage,
  IndexedHistoryReaders,
  IndexedHistoryRequest,
  IndexedHistoryServiceStatus,
} from "../src/history.js";
import {
  createCanonicalMarketHistoryReader,
  deriveCanonicalMarketHistorySnapshot,
} from "../src/market-history.js";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
const identity = selectIdentityConfiguration("orbit-4444");
const permanentIdentityCandidates = async () => {
  throw new Error("not used");
};
const q96 = 1n << 96n;

const hash = (character: string) =>
  `0x${character.repeat(64)}` as `0x${string}`;

const indexSnapshot = (
  overrides: Partial<{
    readonly generation: string;
    readonly canonicalRevision: number;
    readonly blockNumber: bigint;
    readonly blockHash: `0x${string}`;
  }> = {},
) => ({
  generation: "test-index-generation",
  canonicalRevision: 0,
  blockNumber: 200n,
  blockHash: hash("8"),
  ...overrides,
});

const item = ({
  eventName,
  payload,
  blockNumber = 100n,
  blockTimestamp = 1_700_000_000n,
  transactionIndex = 0,
  logIndex = 0,
  transactionHash = hash("3"),
}: {
  readonly eventName: string;
  readonly payload: IndexedHistoryItem["payload"];
  readonly blockNumber?: bigint;
  readonly blockTimestamp?: bigint;
  readonly transactionIndex?: number;
  readonly logIndex?: number;
  readonly transactionHash?: `0x${string}`;
}): IndexedHistoryItem => ({
  blockNumber,
  blockHash: hash("1"),
  parentHash: hash("2"),
  blockTimestamp,
  transactionHash,
  transactionIndex,
  logIndex,
  sourceAddress: manifest.contracts.uniswapV4PoolManager as `0x${string}`,
  eventName,
  payload,
  removed: false,
});

const status = (
  state: "complete" | "partial" = "complete",
  indexedThroughBlock = 200n,
): IndexedHistoryPage["status"] => ({
  state,
  requested: {
    fromBlock: BigInt(manifest.launch.blockNumber),
    toBlock: 200n,
  },
  coverage: {
    fromBlock: BigInt(manifest.launch.blockNumber),
    indexedThroughBlock,
    indexedThroughTime: 1_700_010_000n,
  },
  head: { observedBlock: 205n, lagBlocks: 5n },
});

const serviceStatus = (
  state: "complete" | "partial" = "complete",
  snapshot = indexSnapshot(),
): IndexedHistoryServiceStatus => ({
  manifest: {
    chainId: manifest.chainId,
    network: manifest.network,
    fingerprint: hash("4"),
    commitment: manifest.identity.manifestHash as `0x${string}`,
    launchBlock: BigInt(manifest.launch.blockNumber),
    canonicalPool: manifest.canonicalPool as never,
    sources: {
      poolManager: manifest.contracts.uniswapV4PoolManager as `0x${string}`,
      canonicalFeeHook: manifest.contracts.canonicalFeeHook as `0x${string}`,
      protocolLiquidityVault: manifest.contracts
        .protocolLiquidityVault as `0x${string}`,
      epochConverter: manifest.contracts.epochConverter as `0x${string}`,
      fuelCore: manifest.contracts.fuelCore as `0x${string}`,
      rewardLedger: manifest.contracts.rewardLedger as `0x${string}`,
    },
  },
  snapshot,
  status: {
    state,
    coverage: {
      fromBlock: BigInt(manifest.launch.blockNumber),
      indexedThroughBlock: 200n,
      indexedThroughTime: 1_700_010_000n,
    },
    head: { observedBlock: 205n, lagBlocks: 5n },
  },
});

const source = (
  items: readonly IndexedHistoryItem[],
  sourceStatus = status(),
) => ({ items, status: sourceStatus });

const swap = ({
  timestamp,
  sqrtPriceX96,
  transactionIndex,
  logIndex,
  transactionHash,
}: {
  readonly timestamp: bigint;
  readonly sqrtPriceX96: bigint;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
}) =>
  item({
    eventName: "swap",
    blockTimestamp: timestamp,
    transactionIndex,
    logIndex,
    transactionHash,
    payload: {
      amount0: "-1",
      amount1: "1",
      sqrtPriceX96: sqrtPriceX96.toString(),
      liquidity: "100",
      tick: 0,
      fee: 999_999,
    },
  });

const fee = ({
  timestamp,
  transactionIndex,
  logIndex,
  transactionHash,
  wethVolume,
  totalFee,
}: {
  readonly timestamp: bigint;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
  readonly wethVolume: bigint;
  readonly totalFee: bigint;
}) =>
  item({
    eventName: "fee-accrued",
    blockTimestamp: timestamp,
    transactionIndex,
    logIndex,
    transactionHash,
    payload: {
      wethVolume: wethVolume.toString(),
      totalFee: totalFee.toString(),
      rewardAmount: "0",
      liquidityAmount: "0",
      creatorAmount: "0",
    },
  });

describe("canonical indexed market history", () => {
  it("orders same-block swaps and aggregates traded minutes without synthetic gaps", () => {
    const firstTransaction = hash("5");
    const secondTransaction = hash("6");
    const thirdTransaction = hash("7");
    const hour = 3_600n;
    const base = 1_699_999_200n;
    const snapshot = deriveCanonicalMarketHistorySnapshot({
      manifest,
      identity,
      index: serviceStatus(),
      swaps: source([
        swap({
          timestamp: base + 110n,
          sqrtPriceX96: q96 * 2n,
          transactionIndex: 1,
          logIndex: 8,
          transactionHash: secondTransaction,
        }),
        swap({
          timestamp: base + 100n,
          sqrtPriceX96: q96,
          transactionIndex: 0,
          logIndex: 2,
          transactionHash: firstTransaction,
        }),
        swap({
          timestamp: base + hour * 2n + 100n,
          sqrtPriceX96: q96,
          transactionIndex: 2,
          logIndex: 3,
          transactionHash: thirdTransaction,
        }),
      ]),
      fees: source([
        fee({
          timestamp: base + 100n,
          transactionIndex: 0,
          logIndex: 1,
          transactionHash: firstTransaction,
          wethVolume: 100n,
          totalFee: 3n,
        }),
        fee({
          timestamp: base + 110n,
          transactionIndex: 1,
          logIndex: 9,
          transactionHash: secondTransaction,
          wethVolume: 200n,
          totalFee: 6n,
        }),
        fee({
          timestamp: base + hour * 2n + 100n,
          transactionIndex: 2,
          logIndex: 4,
          transactionHash: thirdTransaction,
          wethVolume: 50n,
          totalFee: 1n,
        }),
      ]),
      liquidityCycles: source([]),
    });

    expect(snapshot.interval).toBe("1m");
    expect(snapshot.candles).toHaveLength(2);
    expect(snapshot.candles[0]).toMatchObject({
      openWethPerLiquidTokenX18: 10n ** 18n,
      highWethPerLiquidTokenX18: 4n * 10n ** 18n,
      lowWethPerLiquidTokenX18: 10n ** 18n,
      closeWethPerLiquidTokenX18: 4n * 10n ** 18n,
      grossWethVolume: 300n,
      protocolFeeWeth: 9n,
      swapCount: 2,
      feeMatchState: "complete",
    });
    expect(snapshot.candles[1]).toMatchObject({
      closeWethPerLiquidTokenX18: 10n ** 18n,
      grossWethVolume: 50n,
    });
  });

  it("does not guess fee volume when transaction-level matching is ambiguous", () => {
    const matchedTransaction = hash("8");
    const unmatchedTransaction = hash("9");
    const snapshot = deriveCanonicalMarketHistorySnapshot({
      manifest,
      identity,
      index: serviceStatus(),
      swaps: source([
        swap({
          timestamp: 1_700_000_100n,
          sqrtPriceX96: q96,
          transactionIndex: 0,
          logIndex: 4,
          transactionHash: matchedTransaction,
        }),
        swap({
          timestamp: 1_700_000_200n,
          sqrtPriceX96: q96,
          transactionIndex: 1,
          logIndex: 4,
          transactionHash: unmatchedTransaction,
        }),
      ]),
      fees: source([
        fee({
          timestamp: 1_700_000_100n,
          transactionIndex: 0,
          logIndex: 3,
          transactionHash: matchedTransaction,
          wethVolume: 999n,
          totalFee: 999n,
        }),
        fee({
          timestamp: 1_700_000_100n,
          transactionIndex: 0,
          logIndex: 5,
          transactionHash: matchedTransaction,
          wethVolume: 100n,
          totalFee: 3n,
        }),
      ]),
      liquidityCycles: source([]),
    });

    expect(snapshot.feeMatching).toEqual({
      state: "partial",
      matchedSwapCount: 0,
      unmatchedSwapCount: 2,
      unmatchedFeeCount: 2,
    });
    expect(snapshot.candles[0]).toMatchObject({
      grossWethVolume: 0n,
      protocolFeeWeth: 0n,
      feeMatchState: "partial",
    });
  });

  it("uses official Uniswap OHLC while retaining exact hook fee accounting", () => {
    const base = 1_699_999_200n;
    const firstTransaction = hash("b");
    const secondTransaction = hash("c");
    const snapshot = deriveCanonicalMarketHistorySnapshot({
      manifest,
      identity,
      index: serviceStatus(),
      candleFeed: {
        source: "uniswap-v4-subgraph",
        state: "available",
        interval: "1h",
        indexedThroughBlock: 190n,
        hasIndexingErrors: false,
        candles: [
          {
            intervalStart: base,
            intervalEnd: base + 3_600n,
            openWethPerLiquidTokenX18: 5n,
            highWethPerLiquidTokenX18: 8n,
            lowWethPerLiquidTokenX18: 4n,
            closeWethPerLiquidTokenX18: 7n,
            swapCount: 1,
          },
          {
            intervalStart: base + 7_200n,
            intervalEnd: base + 10_800n,
            openWethPerLiquidTokenX18: 7n,
            highWethPerLiquidTokenX18: 9n,
            lowWethPerLiquidTokenX18: 6n,
            closeWethPerLiquidTokenX18: 8n,
            swapCount: 2,
          },
        ],
      },
      fees: source([
        fee({
          timestamp: base + 10n,
          transactionIndex: 0,
          logIndex: 1,
          transactionHash: firstTransaction,
          wethVolume: 100n,
          totalFee: 3n,
        }),
        fee({
          timestamp: base + 7_210n,
          transactionIndex: 1,
          logIndex: 1,
          transactionHash: secondTransaction,
          wethVolume: 200n,
          totalFee: 6n,
        }),
      ]),
      liquidityCycles: source([]),
    });

    expect(snapshot.candleSource).toEqual({
      kind: "uniswap-v4-subgraph",
      state: "complete",
      indexedThroughBlock: 190n,
    });
    expect(snapshot.status.indexedThroughBlock).toBe(190n);
    expect(snapshot.candles).toHaveLength(2);
    expect(snapshot.candles[0]).toMatchObject({
      openWethPerLiquidTokenX18: 5n,
      grossWethVolume: 100n,
      protocolFeeWeth: 3n,
      feeMatchState: "complete",
    });
    expect(snapshot.candles[1]).toMatchObject({
      closeWethPerLiquidTokenX18: 8n,
      grossWethVolume: 200n,
      protocolFeeWeth: 6n,
      feeMatchState: "partial",
    });
    expect(snapshot.feeMatching).toEqual({
      state: "partial",
      matchedSwapCount: 2,
      unmatchedSwapCount: 1,
      unmatchedFeeCount: 0,
    });
  });

  it("retains every liquidity-cycle field and exposes partial index coverage", () => {
    const cycle = item({
      eventName: "protocol-liquidity-added",
      blockNumber: 150n,
      blockTimestamp: 1_700_000_300n,
      payload: {
        cycleNumber: "2",
        positionSalt: hash("a"),
        pulledWeth: "50",
        consumedWeth: "40",
        queuedWeth: "10",
        permanentlyLockedWeth: "80",
        tickLower: -120,
        tickUpper: -60,
        liquidity: "1234",
      },
    });
    const snapshot = deriveCanonicalMarketHistorySnapshot({
      manifest,
      identity,
      index: serviceStatus("partial"),
      swaps: source([]),
      fees: source([]),
      liquidityCycles: source([cycle], status("partial", 180n)),
    });

    expect(snapshot.status).toMatchObject({
      state: "partial",
      indexedThroughBlock: 180n,
      indexedThroughTime: 1_700_010_000n,
    });
    expect(snapshot.liquidityCycles).toEqual([
      expect.objectContaining({
        cycleNumber: 2n,
        blockNumber: 150n,
        blockTimestamp: 1_700_000_300n,
        pulledWeth: 50n,
        consumedWeth: 40n,
        queuedWeth: 10n,
        permanentlyLockedWeth: 80n,
        tickLower: -120,
        tickUpper: -60,
        liquidity: 1234n,
      }),
    ]);
  });

  it("does not download indexed swap pages when the Uniswap feed is healthy", async () => {
    let swapReads = 0;
    const index = serviceStatus();
    const emptyPage = async (
      request: IndexedHistoryRequest,
    ): Promise<IndexedHistoryPage> => ({
      manifest: index.manifest,
      snapshot: index.snapshot,
      items: [],
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: index.status.coverage,
        head: index.status.head,
      },
    });
    const history: IndexedHistoryReaders = {
      status: async () => index,
      market: {
        candles: async () => ({
          source: "uniswap-v4-subgraph",
          state: "available",
          interval: "1h",
          indexedThroughBlock: 200n,
          hasIndexingErrors: false,
          candles: [],
        }),
        swaps: async (request) => {
          swapReads += 1;
          return emptyPage(request);
        },
        fees: emptyPage,
      },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: emptyPage,
        operations: emptyPage,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };

    const snapshot = await createCanonicalMarketHistoryReader({
      history,
      manifest,
      identity,
    }).readLatest();

    expect(swapReads).toBe(0);
    expect(snapshot.candleSource.kind).toBe("uniswap-v4-subgraph");
  });

  it("refreshes only the bounded mutable tail and merges new cycles without duplicates", async () => {
    const requests: IndexedHistoryRequest[] = [];
    let indexedThrough = 20_000n;
    const cycleAt = (blockNumber: bigint, cycleNumber: bigint) =>
      item({
        eventName: "protocol-liquidity-added",
        blockNumber,
        blockTimestamp: 1_700_000_000n + blockNumber,
        logIndex: Number(cycleNumber),
        payload: {
          cycleNumber: cycleNumber.toString(),
          positionSalt: hash("a"),
          pulledWeth: "10",
          consumedWeth: "9",
          queuedWeth: "1",
          permanentlyLockedWeth: (cycleNumber * 9n).toString(),
          tickLower: -120,
          tickUpper: -60,
          liquidity: "100",
        },
      });
    const pageFor = (
      request: IndexedHistoryRequest,
      items: readonly IndexedHistoryItem[],
    ): IndexedHistoryPage => ({
      manifest: serviceStatus().manifest,
      snapshot: indexSnapshot({ blockNumber: request.toBlock }),
      items,
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: {
          fromBlock: request.fromBlock,
          toBlock: request.toBlock,
        },
        coverage: {
          fromBlock: BigInt(manifest.launch.blockNumber),
          indexedThroughBlock: request.toBlock,
          indexedThroughTime: 1_700_000_000n + request.toBlock,
        },
        head: { observedBlock: request.toBlock, lagBlocks: 0n },
      },
    });
    const readEmpty = async (request: IndexedHistoryRequest) =>
      pageFor(request, []);
    const history: IndexedHistoryReaders = {
      status: async () => ({
        ...serviceStatus(),
        snapshot: indexSnapshot({ blockNumber: indexedThrough }),
        status: {
          state: "complete",
          coverage: {
            fromBlock: BigInt(manifest.launch.blockNumber),
            indexedThroughBlock: indexedThrough,
            indexedThroughTime: 1_700_000_000n + indexedThrough,
          },
          head: { observedBlock: indexedThrough, lagBlocks: 0n },
        },
      }),
      market: { swaps: readEmpty, fees: readEmpty },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: async (request) => {
          requests.push(request);
          return pageFor(
            request,
            indexedThrough === 20_000n
              ? [cycleAt(20_000n, 1n)]
              : [cycleAt(20_000n, 1n), cycleAt(20_010n, 2n)],
          );
        },
        operations: readEmpty,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };
    const reader = createCanonicalMarketHistoryReader({
      history,
      manifest,
      identity,
    });

    await reader.readLatest();
    indexedThrough = 20_010n;
    const refreshed = await reader.readLatest();

    expect(requests[0]?.fromBlock).toBe(BigInt(manifest.launch.blockNumber));
    expect(requests[1]?.fromBlock).toBe(10_001n);
    expect(refreshed.liquidityCycles.map((cycle) => cycle.cycleNumber)).toEqual(
      [1n, 2n],
    );
  });

  it("invalidates every incremental cache after a failed index read", async () => {
    const launchBlock = BigInt(manifest.launch.blockNumber);
    const firstTip = launchBlock + 20_000n;
    const recoveredTip = firstTip + 10n;
    const requests: IndexedHistoryRequest[] = [];
    let phase: "first" | "failed" | "recovered" = "first";
    const cycleAt = (
      locked: bigint,
      cycleNumber: bigint,
      blockNumber: bigint,
    ) =>
      item({
        eventName: "protocol-liquidity-added",
        blockNumber,
        blockTimestamp: 1_700_000_000n + blockNumber,
        logIndex: Number(cycleNumber),
        payload: {
          cycleNumber: cycleNumber.toString(),
          positionSalt: hash("a"),
          pulledWeth: "10",
          consumedWeth: "9",
          queuedWeth: "1",
          permanentlyLockedWeth: locked.toString(),
          tickLower: -120,
          tickUpper: -60,
          liquidity: "100",
        },
      });
    const pageFor = (
      request: IndexedHistoryRequest,
      items: readonly IndexedHistoryItem[],
    ): IndexedHistoryPage => ({
      manifest: serviceStatus().manifest,
      snapshot: indexSnapshot({ blockNumber: request.toBlock }),
      items,
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: {
          fromBlock: launchBlock,
          indexedThroughBlock: request.toBlock,
          indexedThroughTime: 1_700_000_000n + request.toBlock,
        },
        head: { observedBlock: request.toBlock, lagBlocks: 0n },
      },
    });
    const readEmpty = async (request: IndexedHistoryRequest) =>
      pageFor(request, []);
    const history: IndexedHistoryReaders = {
      status: async () => {
        if (phase === "failed") throw new Error("canonical reset");
        const tip = phase === "first" ? firstTip : recoveredTip;
        return {
          ...serviceStatus(),
          snapshot: indexSnapshot({ blockNumber: tip }),
          status: {
            state: "complete",
            coverage: {
              fromBlock: launchBlock,
              indexedThroughBlock: tip,
              indexedThroughTime: 1_700_000_000n + tip,
            },
            head: { observedBlock: tip, lagBlocks: 0n },
          },
        };
      },
      market: { swaps: readEmpty, fees: readEmpty },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: async (request) => {
          requests.push(request);
          if (phase === "first") {
            return pageFor(request, [cycleAt(9n, 1n, launchBlock + 5n)]);
          }
          return pageFor(
            request,
            request.fromBlock === launchBlock
              ? [
                  cycleAt(99n, 1n, launchBlock + 5n),
                  cycleAt(108n, 2n, recoveredTip),
                ]
              : [cycleAt(108n, 2n, recoveredTip)],
          );
        },
        operations: readEmpty,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };
    const reader = createCanonicalMarketHistoryReader({
      history,
      manifest,
      identity,
    });

    await reader.readLatest();
    phase = "failed";
    await expect(reader.readLatest()).rejects.toThrow("canonical reset");
    phase = "recovered";
    const recovered = await reader.readLatest();

    expect(requests.at(-1)?.fromBlock).toBe(launchBlock);
    expect(
      recovered.liquidityCycles.map((cycle) => cycle.permanentlyLockedWeth),
    ).toEqual([99n, 108n]);
  });

  it("rebuilds from launch when an unobserved database generation changes", async () => {
    const launchBlock = BigInt(manifest.launch.blockNumber);
    const tip = launchBlock + 20_000n;
    const requests: IndexedHistoryRequest[] = [];
    let generation = "generation-a";
    const cycleAt = (locked: bigint) =>
      item({
        eventName: "protocol-liquidity-added",
        blockNumber: launchBlock + 5n,
        payload: {
          cycleNumber: "1",
          positionSalt: hash("a"),
          pulledWeth: "10",
          consumedWeth: "9",
          queuedWeth: "1",
          permanentlyLockedWeth: locked.toString(),
          tickLower: -120,
          tickUpper: -60,
          liquidity: "100",
        },
      });
    const pageFor = (
      request: IndexedHistoryRequest,
      items: readonly IndexedHistoryItem[],
    ): IndexedHistoryPage => ({
      manifest: serviceStatus().manifest,
      snapshot: indexSnapshot({ generation, blockNumber: tip }),
      items,
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: {
          fromBlock: launchBlock,
          indexedThroughBlock: tip,
          indexedThroughTime: 1_700_000_000n + tip,
        },
        head: { observedBlock: tip, lagBlocks: 0n },
      },
    });
    const readEmpty = async (request: IndexedHistoryRequest) =>
      pageFor(request, []);
    const history: IndexedHistoryReaders = {
      status: async () => ({
        ...serviceStatus(),
        snapshot: indexSnapshot({ generation, blockNumber: tip }),
        status: {
          state: "complete",
          coverage: {
            fromBlock: launchBlock,
            indexedThroughBlock: tip,
            indexedThroughTime: 1_700_000_000n + tip,
          },
          head: { observedBlock: tip, lagBlocks: 0n },
        },
      }),
      market: { swaps: readEmpty, fees: readEmpty },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: async (request) => {
          requests.push(request);
          return pageFor(
            request,
            request.fromBlock === launchBlock
              ? [cycleAt(generation === "generation-a" ? 9n : 99n)]
              : [],
          );
        },
        operations: readEmpty,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };
    const reader = createCanonicalMarketHistoryReader({
      history,
      manifest,
      identity,
    });

    expect(
      (await reader.readLatest()).liquidityCycles[0]?.permanentlyLockedWeth,
    ).toBe(9n);
    generation = "generation-b";
    const rebuilt = await reader.readLatest();

    expect(requests.at(-1)?.fromBlock).toBe(launchBlock);
    expect(rebuilt.liquidityCycles).toEqual([
      expect.objectContaining({ permanentlyLockedWeth: 99n }),
    ]);
  });

  it("rejects endpoint facts from a different canonical revision", async () => {
    const index = serviceStatus("complete", indexSnapshot());
    const pageFor = (
      request: IndexedHistoryRequest,
      canonicalRevision: number,
    ): IndexedHistoryPage => ({
      manifest: index.manifest,
      snapshot: indexSnapshot({ canonicalRevision }),
      items: [],
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: index.status.coverage,
        head: index.status.head,
      },
    });
    const revisionZero = async (request: IndexedHistoryRequest) =>
      pageFor(request, 0);
    const history: IndexedHistoryReaders = {
      status: async () => index,
      market: {
        swaps: async (request) => pageFor(request, 1),
        fees: revisionZero,
      },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: revisionZero,
        operations: revisionZero,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };
    const reader = createCanonicalMarketHistoryReader({
      history,
      manifest,
      identity,
    });

    await expect(reader.readLatest()).rejects.toMatchObject({
      name: "IndexedHistoryError",
      code: "history-snapshot-mismatch",
    });
  });

  it("rejects a canonical revision change after the independent reads", async () => {
    let statusReads = 0;
    const index = serviceStatus();
    const read = async (
      request: IndexedHistoryRequest,
    ): Promise<IndexedHistoryPage> => ({
      manifest: index.manifest,
      snapshot: indexSnapshot(),
      items: [],
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: index.status.coverage,
        head: index.status.head,
      },
    });
    const history: IndexedHistoryReaders = {
      status: async () => ({
        ...index,
        snapshot: indexSnapshot({
          canonicalRevision: statusReads++ === 0 ? 0 : 1,
        }),
      }),
      market: { swaps: read, fees: read },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: read,
        operations: read,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };
    const reader = createCanonicalMarketHistoryReader({
      history,
      manifest,
      identity,
    });

    await expect(reader.readLatest()).rejects.toMatchObject({
      code: "history-snapshot-mismatch",
    });
  });

  it.each([
    {
      label: "moves backward",
      pageSnapshot: indexSnapshot({ blockNumber: 199n, blockHash: hash("7") }),
    },
    {
      label: "changes hash at the same height",
      pageSnapshot: indexSnapshot({ blockHash: hash("9") }),
    },
  ])("rejects an endpoint checkpoint that $label", async ({ pageSnapshot }) => {
    const index = serviceStatus();
    const read = async (
      request: IndexedHistoryRequest,
    ): Promise<IndexedHistoryPage> => ({
      manifest: index.manifest,
      snapshot: pageSnapshot,
      items: [],
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: index.status.coverage,
        head: index.status.head,
      },
    });
    const history: IndexedHistoryReaders = {
      status: async () => index,
      market: { swaps: read, fees: read },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: read,
        operations: read,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };

    await expect(
      createCanonicalMarketHistoryReader({
        history,
        manifest,
        identity,
      }).readLatest(),
    ).rejects.toMatchObject({ code: "history-snapshot-mismatch" });
  });

  it("rejects conflicting endpoint hashes at the same intermediate height", async () => {
    let statusReads = 0;
    const initial = serviceStatus();
    const final = serviceStatus(
      "complete",
      indexSnapshot({ blockNumber: 202n, blockHash: hash("6") }),
    );
    const pageFor = (
      request: IndexedHistoryRequest,
      blockHash: `0x${string}`,
    ): IndexedHistoryPage => ({
      manifest: initial.manifest,
      snapshot: indexSnapshot({ blockNumber: 201n, blockHash }),
      items: [],
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: initial.status.coverage,
        head: initial.status.head,
      },
    });
    const history: IndexedHistoryReaders = {
      status: async () => (statusReads++ === 0 ? initial : final),
      market: {
        swaps: async (request) => pageFor(request, hash("9")),
        fees: async (request) => pageFor(request, hash("7")),
      },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: async (request) => pageFor(request, hash("9")),
        operations: async (request) => pageFor(request, hash("9")),
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };

    await expect(
      createCanonicalMarketHistoryReader({
        history,
        manifest,
        identity,
      }).readLatest(),
    ).rejects.toMatchObject({ code: "history-snapshot-mismatch" });
  });

  it("rejects a final checkpoint behind an endpoint checkpoint", async () => {
    const index = serviceStatus();
    const advanced = indexSnapshot({ blockNumber: 201n, blockHash: hash("9") });
    const read = async (
      request: IndexedHistoryRequest,
    ): Promise<IndexedHistoryPage> => ({
      manifest: index.manifest,
      snapshot: advanced,
      items: [],
      page: { hasMore: false, nextCursor: undefined },
      status: {
        state: "complete",
        requested: { fromBlock: request.fromBlock, toBlock: request.toBlock },
        coverage: index.status.coverage,
        head: index.status.head,
      },
    });
    const history: IndexedHistoryReaders = {
      status: async () => index,
      market: { swaps: read, fees: read },
      protocol: {
        permanentIdentityCandidates,
        liquidityCycles: read,
        operations: read,
        recentOperationalEvents: async () => {
          throw new Error("not used");
        },
        rewardHistory: async () => {
          throw new Error("not used");
        },
      },
    };

    await expect(
      createCanonicalMarketHistoryReader({
        history,
        manifest,
        identity,
      }).readLatest(),
    ).rejects.toMatchObject({ code: "history-snapshot-mismatch" });
  });
});
