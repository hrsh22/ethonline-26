import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";
import { sha256, stringToHex } from "viem";

import {
  collectIndexedHistoryPages,
  createIndexedHistoryReaders as createConfiguredIndexedHistoryReaders,
  IndexedHistoryError,
  type IndexedHistoryReaderOptions,
} from "../src/history.js";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
const identity = selectIdentityConfiguration("orbit-4444");

const createIndexedHistoryReaders = (
  options: Omit<IndexedHistoryReaderOptions, "basePath">,
) =>
  createConfiguredIndexedHistoryReaders({
    ...options,
    basePath: "/v1/history",
  });

const manifestEnvelope = {
  chainId: manifest.chainId,
  network: manifest.network,
  fingerprint: sha256(stringToHex(JSON.stringify(manifest))),
  commitment: manifest.identity.manifestHash,
  launchBlock: manifest.launch.blockNumber.toString(),
  canonicalPool: manifest.canonicalPool,
  sources: {
    poolManager: manifest.contracts.uniswapV4PoolManager,
    canonicalFeeHook: manifest.contracts.canonicalFeeHook,
    protocolLiquidityVault: manifest.contracts.protocolLiquidityVault,
    epochConverter: manifest.contracts.epochConverter,
    fuelCore: manifest.contracts.fuelCore,
    rewardLedger: manifest.contracts.rewardLedger,
  },
};

const indexedItem = (
  eventName: string,
  payload: Record<string, string | number | boolean | null>,
  logIndex = 0,
) => ({
  blockNumber: "100",
  blockHash: `0x${"1".repeat(64)}`,
  parentHash: `0x${"2".repeat(64)}`,
  blockTimestamp: "1700000100",
  transactionHash: `0x${"3".repeat(64)}`,
  transactionIndex: 1,
  logIndex,
  sourceAddress: "0x0000000000000000000000000000000000000001",
  eventName,
  payload,
  removed: false,
});

const snapshotEnvelope = (
  overrides: Partial<{
    readonly generation: string;
    readonly canonicalRevision: number;
    readonly blockNumber: string;
    readonly blockHash: string;
  }> = {},
) => ({
  generation: "test-index-generation",
  canonicalRevision: 0,
  blockNumber: "100",
  blockHash: `0x${"1".repeat(64)}`,
  ...overrides,
});

const responseBody = ({
  items,
  hasMore = false,
  nextCursor,
  state = "complete",
  requestedFrom = "10",
  requestedTo = "100",
  indexedThrough = state === "complete" ? requestedTo : "90",
  snapshot,
}: {
  readonly items: readonly unknown[];
  readonly hasMore?: boolean;
  readonly nextCursor?: string;
  readonly state?: "complete" | "partial";
  readonly requestedFrom?: string;
  readonly requestedTo?: string;
  readonly indexedThrough?: string;
  readonly snapshot?: ReturnType<typeof snapshotEnvelope>;
}) => ({
  manifest: manifestEnvelope,
  snapshot: snapshot ?? snapshotEnvelope({ blockNumber: indexedThrough }),
  items,
  page: { hasMore, ...(nextCursor === undefined ? {} : { nextCursor }) },
  status: {
    state,
    requested: { fromBlock: requestedFrom, toBlock: requestedTo },
    coverage: {
      fromBlock: "10",
      indexedThroughBlock: indexedThrough,
      indexedThroughTime: "1700000090",
    },
    head: {
      observedBlock: "101",
      lagBlocks: state === "complete" ? "1" : "11",
    },
  },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("indexed history readers", () => {
  it("normalizes an unobserved checkpoint without inventing coverage", async () => {
    const readers = createIndexedHistoryReaders({
      identity,
      manifest,
      fetcher: async () =>
        jsonResponse({
          manifest: manifestEnvelope,
          snapshot: {
            generation: "starting",
            canonicalRevision: 0,
            blockNumber: null,
            blockHash: null,
          },
          status: { state: "partial", coverage: { fromBlock: "10" }, head: {} },
        }),
    });
    await expect(readers.status()).resolves.toMatchObject({
      snapshot: {
        generation: "starting",
        canonicalRevision: 0,
        blockNumber: undefined,
        blockHash: undefined,
      },
      status: {
        state: "partial",
        coverage: {
          fromBlock: 10n,
          indexedThroughBlock: undefined,
          indexedThroughTime: undefined,
        },
        head: { observedBlock: undefined, lagBlocks: undefined },
      },
    });
  });

  it.each([
    { snapshot: snapshotEnvelope({ blockNumber: "01" }) },
    { snapshot: snapshotEnvelope({ blockNumber: "0x64" }) },
    { snapshot: { ...snapshotEnvelope(), blockHash: null } },
    {
      snapshot: snapshotEnvelope({
        canonicalRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
    },
    { manifest: { ...manifestEnvelope, fingerprint: "0x12" } },
    {
      status: {
        state: "partial",
        coverage: { fromBlock: "10", indexedThroughBlock: null },
        head: {},
      },
    },
  ])("rejects malformed history envelope evidence %#", async (override) => {
    const readers = createIndexedHistoryReaders({
      identity,
      manifest,
      fetcher: async () =>
        jsonResponse({ ...responseBody({ items: [] }), ...override }),
    });
    await expect(readers.status()).rejects.toThrow();
  });

  it("reads the current index position without a chain-head dependency", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return jsonResponse({
        manifest: manifestEnvelope,
        snapshot: snapshotEnvelope({ blockNumber: "90" }),
        status: {
          state: "partial",
          coverage: {
            fromBlock: "10",
            indexedThroughBlock: "90",
            indexedThroughTime: "1700000090",
          },
          head: { observedBlock: "101", lagBlocks: "11" },
        },
      });
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const result = await readers.status();

    expect(requests).toEqual(["/v1/history/status"]);
    expect(result.status).toEqual({
      state: "partial",
      coverage: {
        fromBlock: 10n,
        indexedThroughBlock: 90n,
        indexedThroughTime: 1_700_000_090n,
      },
      head: { observedBlock: 101n, lagBlocks: 11n },
    });
    expect(result.snapshot).toEqual({
      generation: "test-index-generation",
      canonicalRevision: 0,
      blockNumber: 90n,
      blockHash: `0x${"1".repeat(64)}`,
    });
  });

  it("exposes lossless paginated Protocol-Owned Liquidity history", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return jsonResponse(
        responseBody({
          state: "partial",
          items: [
            indexedItem("protocol-liquidity-added", {
              cycleNumber: "3",
              pulledWeth: "40",
              consumedWeth: "30",
              queuedWeth: "10",
              permanentlyLockedWeth: "30",
            }),
          ],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const page = await readers.protocol.liquidityCycles({
      fromBlock: 10n,
      toBlock: 100n,
      limit: 5,
    });

    expect(requests[0]).toContain("/v1/history/protocol/liquidity-cycles");
    expect(page.items).toMatchObject([
      { eventName: "protocol-liquidity-added", blockNumber: 100n },
    ]);
    expect(page.status.state).toBe("partial");
  });

  it("derives the bounded permanent identity candidate set from indexed commitments", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return jsonResponse(
        responseBody({
          items: [
            indexedItem("permanent-commitment", { identityId: 1493 }),
            indexedItem("permanent-commitment", { identityId: 1493 }, 1),
            indexedItem("permanent-commitment", { identityId: 4441 }, 2),
          ],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const candidates = await readers.protocol.permanentIdentityCandidates(
      10n,
      100n,
    );

    expect(requests[0]).toContain("/protocol/permanent-commitments");
    expect(candidates).toEqual({
      identityIds: [1493, 4441],
      fromBlock: 10n,
      throughBlock: 100n,
      coverage: "complete",
      indexedThroughTime: 1_700_000_090n,
    });
  });

  it("collects every deterministic reward page without silent truncation", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (!url.includes("cursor=next")) {
        return jsonResponse(
          responseBody({
            hasMore: true,
            nextCursor: "next",
            items: [
              indexedItem("reward-notified", { track: 1, amount: "9" }),
              indexedItem(
                "reward-epoch-opened",
                {
                  epochNumber: "1",
                  openedAmount: "40",
                  equalTrackShare: "10",
                  finalTrackRemainder: "0",
                },
                1,
              ),
            ],
          }),
        );
      }
      return jsonResponse(
        responseBody({
          items: [
            indexedItem(
              "reward-claimed",
              {
                currentOwner: "0x0000000000000000000000000000000000000002",
                identityId: 4444,
                track: 1,
                amount: "7",
              },
              2,
            ),
          ],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const history = await readers.protocol.rewardHistory(10n, 100n);

    expect(requests).toHaveLength(2);
    expect(history.events).toMatchObject([
      { type: "reward-epoch", epoch: { epochNumber: 1n } },
      {
        type: "reward-claim",
        track: 1,
        claim: { identityId: 4444, amount: 7n },
      },
    ]);
    expect(history.coverage).toBe("complete");
    expect(history.throughBlock).toBe(100n);
  });

  it("keeps indexed successes when keeper-attempt evidence is malformed", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      if (String(input).includes("keeper-attempts")) {
        return jsonResponse({
          manifest: manifestEnvelope,
          evidence: { source: "malformed-attempt-source" },
        });
      }
      return jsonResponse(
        responseBody({
          items: [
            indexedItem("reward-epoch-opened", {
              epochNumber: "1",
              openedAmount: "40",
              equalTrackShare: "10",
              finalTrackRemainder: "0",
            }),
            indexedItem(
              "track-executed",
              {
                track: 2,
                wethInput: "10",
                measuredStockOutput: "20",
                deferredTrackBudget: "0",
              },
              1,
            ),
            indexedItem(
              "reward-claimed",
              {
                currentOwner: "0x0000000000000000000000000000000000000002",
                identityId: 4444,
                track: 2,
                amount: "7",
              },
              2,
            ),
            indexedItem(
              "protocol-liquidity-added",
              {
                cycleNumber: "3",
                pulledWeth: "40",
                consumedWeth: "30",
                queuedWeth: "10",
                permanentlyLockedWeth: "30",
              },
              3,
            ),
          ],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const window = await readers.protocol.recentOperationalEvents(
      10n,
      100n,
      10,
    );

    expect(requests[0]).toContain("/protocol/operations");
    expect(window.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "track-execution-unknown",
          track: 2,
          successful: true,
        }),
        expect.objectContaining({ type: "pol-execution" }),
      ]),
    );
    expect(window.trackAttemptState).toEqual({
      1: "unknown",
      2: "unknown",
      3: "unknown",
      4: "unknown",
    });
    expect(window.failureScanTruncated).toBe(false);
    expect(window.keeperAttemptEvidence?.state).toBe("unavailable");
  });

  it("keeps indexed successes when the keeper-attempt source is unavailable", async () => {
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes("keeper-attempts")) {
        return jsonResponse({ error: "attempt-source-unavailable" }, 503);
      }
      return jsonResponse(
        responseBody({
          items: [
            indexedItem("protocol-liquidity-added", {
              cycleNumber: "3",
              pulledWeth: "40",
              consumedWeth: "30",
              queuedWeth: "10",
              permanentlyLockedWeth: "30",
            }),
          ],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const window = await readers.protocol.recentOperationalEvents(
      10n,
      100n,
      10,
    );

    expect(window.events).toEqual([
      expect.objectContaining({ type: "pol-execution", successful: true }),
    ]);
    expect(window.keeperAttemptEvidence?.state).toBe("unavailable");
    expect(window.trackAttemptState).toEqual({
      1: "unknown",
      2: "unknown",
      3: "unknown",
      4: "unknown",
    });
    expect(window.failureScanTruncated).toBe(false);
  });

  it("uses authoritative keeper evidence for exact retryable tracks", async () => {
    const latest = (track: number, outcome: string, failureClass?: string) => ({
      actionKind: "reward-track",
      track,
      observedBlock: "99",
      observedAt: "1700000099",
      outcome,
      ...(failureClass === undefined ? {} : { failureClass }),
    });
    const fetcher: typeof fetch = async (input) => {
      const path = String(input);
      if (path.includes("keeper-attempts")) {
        return jsonResponse({
          manifest: manifestEnvelope,
          evidence: {
            source: "keeper-attempt-journal",
            generation: "generation-1",
            state: "fresh",
            freshness: {
              observedAt: "1700000100",
              recordedAt: "1700000101",
              ageSeconds: "4",
              maximumAgeSeconds: "900",
            },
            coverage: {
              1: "complete",
              2: "complete",
              3: "complete",
              4: "complete",
            },
            tracks: {
              1: { state: "fresh", latest: latest(1, "not-required") },
              2: {
                state: "retryable",
                latest: latest(
                  2,
                  "failed-before-submission",
                  "quote-unavailable",
                ),
              },
              3: { state: "fresh", latest: latest(3, "not-required") },
              4: { state: "fresh", latest: latest(4, "not-required") },
            },
          },
        });
      }
      return jsonResponse(responseBody({ items: [] }));
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const window = await readers.protocol.recentOperationalEvents(
      10n,
      100n,
      10,
    );

    expect(window.trackAttemptState).toEqual({
      1: "fresh",
      2: "retryable",
      3: "fresh",
      4: "fresh",
    });
    expect(window.failureScanTruncated).toBe(false);
    expect(window.keeperAttemptEvidence).toMatchObject({
      state: "fresh",
      generation: "generation-1",
      freshness: {
        observedAt: 1_700_000_100n,
        recordedAt: 1_700_000_101n,
      },
      tracks: {
        2: {
          state: "retryable",
          outcome: "failed-before-submission",
          failureClass: "quote-unavailable",
        },
      },
    });
  });

  it("refreshes reward history from a bounded reorg overlap", async () => {
    const requests: string[] = [];
    const epoch = (
      blockNumber: string,
      suffix: string,
      epochNumber: string,
    ) => ({
      ...indexedItem("reward-epoch-opened", {
        epochNumber,
        openedAmount: "40",
        equalTrackShare: "10",
        finalTrackRemainder: "0",
      }),
      blockNumber,
      blockHash: `0x${suffix.repeat(64)}`,
    });
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input), "http://app.local");
      requests.push(url.toString());
      const fromBlock = url.searchParams.get("fromBlock")!;
      const toBlock = url.searchParams.get("toBlock")!;
      return jsonResponse(
        responseBody({
          requestedFrom: fromBlock,
          requestedTo: toBlock,
          indexedThrough: toBlock,
          items:
            toBlock === "20000"
              ? [epoch("20000", "4", "1")]
              : [epoch("20000", "4", "1"), epoch("20010", "5", "2")],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await readers.protocol.rewardHistory(10n, 20_000n);
    const refreshed = await readers.protocol.rewardHistory(10n, 20_010n);

    expect(new URL(requests[1]!).searchParams.get("fromBlock")).toBe("10001");
    expect(refreshed.events).toMatchObject([
      { type: "reward-epoch", epoch: { epochNumber: 1n } },
      { type: "reward-epoch", epoch: { epochNumber: 2n } },
    ]);
  });

  it("restarts reward history from launch when the index generation changes", async () => {
    const requests: URL[] = [];
    let generation = "generation-a";
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input), "http://app.local");
      requests.push(url);
      const fromBlock = url.searchParams.get("fromBlock")!;
      const toBlock = url.searchParams.get("toBlock")!;
      const replacement = generation === "generation-b";
      return jsonResponse(
        responseBody({
          requestedFrom: fromBlock,
          requestedTo: toBlock,
          indexedThrough: toBlock,
          snapshot: snapshotEnvelope({ generation, blockNumber: toBlock }),
          items:
            fromBlock === "10"
              ? [
                  {
                    ...indexedItem("reward-epoch-opened", {
                      epochNumber: "1",
                      openedAmount: replacement ? "99" : "40",
                      equalTrackShare: "10",
                      finalTrackRemainder: "0",
                    }),
                    blockNumber: "20000",
                  },
                ]
              : [],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await readers.protocol.rewardHistory(10n, 20_000n);
    generation = "generation-b";
    const rebuilt = await readers.protocol.rewardHistory(10n, 20_000n);

    expect(requests.map((url) => url.searchParams.get("fromBlock"))).toEqual([
      "10",
      "10001",
      "10",
    ]);
    expect(rebuilt.events).toMatchObject([
      { type: "reward-epoch", epoch: { openedWeth: 99n } },
    ]);
  });

  it("keeps market reads provider-neutral and never sends a service credential", async () => {
    let observedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      observedInit = init;
      return jsonResponse(
        responseBody({ items: [indexedItem("swap", { tick: 4 })] }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const page = await readers.market.swaps({
      fromBlock: 10n,
      toBlock: 100n,
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      eventName: "swap",
      blockNumber: 100n,
    });
    expect(observedInit?.headers).toBeUndefined();
  });

  it("decodes a manifest-bound Uniswap v4 hourly candle feed", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toBe("/v1/history/market/candles");
      return jsonResponse({
        manifest: manifestEnvelope,
        feed: {
          source: "uniswap-v4-subgraph",
          state: "available",
          interval: "1h",
          indexedThroughBlock: "123",
          hasIndexingErrors: false,
          candles: [
            {
              intervalStart: "1699999200",
              intervalEnd: "1700002800",
              openWethPerLiquidTokenX18: "5000000000000000",
              highWethPerLiquidTokenX18: "6000000000000000",
              lowWethPerLiquidTokenX18: "4000000000000000",
              closeWethPerLiquidTokenX18: "5500000000000000",
              swapCount: 3,
            },
          ],
        },
      });
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await expect(readers.market.candles?.()).resolves.toEqual({
      source: "uniswap-v4-subgraph",
      state: "available",
      interval: "1h",
      indexedThroughBlock: 123n,
      hasIndexingErrors: false,
      candles: [
        {
          intervalStart: 1_699_999_200n,
          intervalEnd: 1_700_002_800n,
          openWethPerLiquidTokenX18: 5_000_000_000_000_000n,
          highWethPerLiquidTokenX18: 6_000_000_000_000_000n,
          lowWethPerLiquidTokenX18: 4_000_000_000_000_000n,
          closeWethPerLiquidTokenX18: 5_500_000_000_000_000n,
          swapCount: 3,
        },
      ],
    });
  });

  it("rejects history from a different deployment manifest", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        ...responseBody({ items: [] }),
        manifest: { ...manifestEnvelope, chainId: manifest.chainId + 1 },
      });
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await expect(
      readers.market.swaps({ fromBlock: 10n, toBlock: 100n, limit: 20 }),
    ).rejects.toMatchObject({
      name: "IndexedHistoryError",
      code: "history-manifest-mismatch",
    });
  });

  it("rejects malformed pagination instead of silently truncating", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        ...responseBody({ items: [] }),
        page: {},
      });
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await expect(
      readers.market.swaps({ fromBlock: 10n, toBlock: 100n, limit: 20 }),
    ).rejects.toThrow("hasMore");
  });

  it("rejects continuation pages from a different canonical snapshot", async () => {
    const fetcher: typeof fetch = async (input) => {
      const secondPage = String(input).includes("cursor=next");
      return jsonResponse(
        responseBody({
          hasMore: !secondPage,
          ...(secondPage ? {} : { nextCursor: "next" }),
          snapshot: snapshotEnvelope({
            canonicalRevision: secondPage ? 1 : 0,
          }),
          items: secondPage ? [] : [indexedItem("swap", { tick: 4 })],
        }),
      );
    };
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await expect(
      collectIndexedHistoryPages(readers.market.swaps, 10n, 100n),
    ).rejects.toMatchObject({
      name: "IndexedHistoryError",
      code: "history-snapshot-mismatch",
    });
  });

  it.each([
    {
      label: "short block hash",
      item: { ...indexedItem("swap", { tick: 4 }), blockHash: "0x12" },
      message: "32-byte hex value",
    },
    {
      label: "malformed source address",
      item: { ...indexedItem("swap", { tick: 4 }), sourceAddress: "0x12" },
      message: "20-byte hex value",
    },
    {
      label: "removed non-canonical event",
      item: { ...indexedItem("swap", { tick: 4 }), removed: true },
      message: "canonical event set",
    },
  ])("rejects a $label", async ({ item, message }) => {
    const fetcher: typeof fetch = async () =>
      jsonResponse(responseBody({ items: [item] }));
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    await expect(
      readers.market.swaps({ fromBlock: 10n, toBlock: 100n, limit: 20 }),
    ).rejects.toThrow(message);
  });

  it("preserves indexed coverage evidence on a typed upstream failure", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse(
        {
          manifest: manifestEnvelope,
          snapshot: snapshotEnvelope({ blockNumber: "88" }),
          status: {
            state: "error",
            requested: { fromBlock: "10", toBlock: "100" },
            coverage: {
              fromBlock: "10",
              indexedThroughBlock: "88",
              indexedThroughTime: "1700000088",
            },
            head: { observedBlock: "101", lagBlocks: "13" },
            error: { code: "history-unavailable", message: "index is offline" },
          },
        },
        503,
      );
    const readers = createIndexedHistoryReaders({
      fetcher,
      identity,
      manifest,
    });

    const failure = await readers.protocol
      .rewardHistory(10n, 100n)
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(IndexedHistoryError);
    expect(failure).toMatchObject({
      code: "history-unavailable",
      evidence: {
        requested: { fromBlock: 10n, toBlock: 100n },
        coverage: { indexedThroughBlock: 88n },
        head: { observedBlock: 101n, lagBlocks: 13n },
        snapshot: { generation: "test-index-generation", blockNumber: 88n },
      },
    });
  });
});
