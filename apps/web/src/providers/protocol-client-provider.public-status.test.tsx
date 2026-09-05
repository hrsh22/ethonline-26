/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { derivePublicStatusModel } from "@/lib/protocol-status-model";
import {
  readPublicEvidenceCache,
  writePublicEvidenceCache,
} from "@/lib/public-evidence-cache";

const testState = vi.hoisted(() => {
  const manifestHash = `0x${"12".repeat(32)}`;
  const health = {
    health: {
      checks: [
        {
          id: "read-freshness",
          status: "pass",
          severity: "warning",
          freshness: "fresh",
          observedBlock: 200n,
          expected: "at most 90s old",
          observed: "4s old",
          explanation: "The read is current.",
        },
      ],
    },
    deployment: {
      network: "base-sepolia",
      observedAt: 1_700_000_000,
      observedBlock: 200n,
      expectedChainId: 84_532,
      observedChainId: 84_532,
      expectedManifestCommitment: `0x${"34".repeat(32)}`,
      manifestCommitment: `0x${"34".repeat(32)}`,
    },
    collection: {
      availableIdentityCount: 3_604,
      pendingDiscoveryCount: 4,
      permanentCount: 800,
      transientCount: 40,
      accounting: { expected: 4_444n, observed: 4_444n },
    },
    market: {
      creatorPotWeth: 3n * 10n ** 18n,
      liquidityPotWeth: 2n * 10n ** 18n,
      rewardPotWeth: 1n * 10n ** 18n,
    },
    operations: {
      rewardEpochCount: 7n,
      rewardHistory: [],
      rewardHistoryStatus: "complete",
      rpcFailures: [{ method: "eth_call", message: "private RPC failed" }],
      trackQueues: ([1, 2, 3, 4] as const).map((trackId) => ({
        trackId,
        track: `TRACK-${trackId}`,
        weth: 1n * 10n ** 18n,
        deferred: true,
        status: "retryable",
        attemptHistoryAvailable: true,
      })),
      protocolOwnedLiquidity: {
        queuedWeth: 5n * 10n ** 18n,
        permanentlyLockedWeth: 6n * 10n ** 18n,
        cycleCount: 9n,
      },
      keeperAttemptEvidence: {
        source: "keeper-attempt-journal",
        generation: "private-generation",
        state: "fresh",
        tracks: { 1: { state: "retryable" } },
      },
    },
    rewards: {
      tracks: ["AAPLc", "GOOGLc", "METAc", "NVDAc"].map((track, index) => ({
        track,
        rawLiability: BigInt(index + 1) * 10n ** 18n,
        rawTokenBalance: 99n * 10n ** 18n,
        activeWeight: 4_444n,
        unclaimedTrackPot: 8n,
        basketRelicPot: 9n,
        indicatorRelicPot: 10n,
      })),
    },
    roles: {
      owners: {
        liquidToken: "0x0000000000000000000000000000000000000001",
      },
      keeper: "0x0000000000000000000000000000000000000002",
    },
  } as const;
  return {
    connection: {
      address: "0x0000000000000000000000000000000000000001",
      chainId: 84_532,
      status: "connected" as "connected" | "disconnected",
    },
    health,
    manifestHash,
    readPublicStatus: vi.fn(async () => health),
    readWallet: vi.fn(),
    getBlockNumber: vi.fn(async () => 201n),
    getBalance: vi
      .fn<(request: { blockNumber?: bigint }) => Promise<bigint>>()
      .mockResolvedValue(0n),
    readSignals: [] as AbortSignal[],
    pathname: "/status",
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => testState.pathname,
}));

vi.mock("wagmi", () => ({
  useConnection: () => testState.connection,
  useWalletClient: () => ({ data: undefined }),
}));

vi.mock("@orbit/protocol/reader", () => ({
  createProtocolReader: () => ({
    readPublicStatus: testState.readPublicStatus,
    readHealth: testState.readPublicStatus,
    readWallet: testState.readWallet,
  }),
}));

vi.mock("@orbit/protocol/history", () => ({
  createIndexedHistoryReaders: () => ({ protocol: {} }),
}));

vi.mock("@orbit/protocol/market-history", () => ({
  createCanonicalMarketHistoryReader: () => ({ readLatest: vi.fn() }),
}));

vi.mock("@orbit/protocol/viem-transport", () => ({
  makeViemProtocolTransport: () => ({}),
}));

vi.mock("@/lib/deployment", () => ({
  deploymentEnvironment: { chainId: 84_532 },
  protocolDeploymentManifest: {
    launch: { transactionHash: testState.manifestHash },
  },
}));

vi.mock("@/lib/wagmi", () => ({
  protocolChain: { id: 84_532 },
  protocolReadClient: {},
  createProtocolReadClient: (signal: AbortSignal) => {
    testState.readSignals.push(signal);
    return {
      getBlockNumber: testState.getBlockNumber,
      getBalance: testState.getBalance,
    };
  },
  protocolTransactionClient: {},
}));

import {
  isPublicStatusModel,
  ProtocolClientProvider,
  useProtocolClient,
} from "./protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;

let currentProtocol: ProtocolClient;

function ProtocolCapture() {
  const protocol = useProtocolClient();
  useEffect(() => {
    currentProtocol = protocol;
  }, [protocol]);
  return null;
}

describe("public status query boundary", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    testState.readPublicStatus.mockReset().mockResolvedValue(testState.health);
    testState.readWallet.mockReset();
    testState.getBlockNumber.mockReset().mockResolvedValue(201n);
    testState.getBalance.mockReset().mockResolvedValue(0n);
    testState.readSignals.length = 0;
    testState.pathname = "/status";
    testState.connection = {
      address: "0x0000000000000000000000000000000000000001",
      chainId: 84_532,
      status: "connected",
    };
    window.localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  it("accepts a structurally valid partial public model for offline fallback", () => {
    const complete = derivePublicStatusModel(testState.health);
    expect(
      isPublicStatusModel({
        ...complete,
        collection: {
          permanent: undefined,
          transient: undefined,
          pending: undefined,
          available: undefined,
        },
        rewardActivity: {
          ...complete.rewardActivity,
          epochCount: undefined,
          collectorLiability: complete.rewardActivity.collectorLiability.map(
            ({ track }) => ({ track, amount: undefined }),
          ),
        },
      }),
    ).toBe(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  it("caches and exposes only the exact sanitized public status model", async () => {
    queryClient.setQueryData(["protocol-health", "previous-route"], {
      roles: testState.health.roles,
      rpcFailures: testState.health.operations.rpcFailures,
    });
    queryClient.setQueryData(["protocol-wallet", "previous-route"], {
      collectibles: { permanent: [4_444n] },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>
        </QueryClientProvider>,
      );
    });

    const expected = {
      health: "healthy",
      freshness: "fresh",
      network: "base-sepolia",
      observedAt: 1_700_000_000,
      observedBlock: 200n,
      collection: {
        permanent: 800,
        transient: 40,
        pending: 4,
        available: 3_604,
      },
      funds: {
        creatorWeth: 3n * 10n ** 18n,
        rewardPotWeth: 1n * 10n ** 18n,
        liquidityQueuedWeth: 5n * 10n ** 18n,
        liquidityLockedWeth: 6n * 10n ** 18n,
        liquidityWaitingWeth: 7n * 10n ** 18n,
        rewardWethWaiting: 5n * 10n ** 18n,
      },
      rewardActivity: {
        epochCount: 7n,
        historyStatus: "complete",
        history: [],
        latestOpening: undefined,
        recentConversions: [],
        collectorLiability: [
          { track: "AAPLc", amount: 1n * 10n ** 18n },
          { track: "GOOGLc", amount: 2n * 10n ** 18n },
          { track: "METAc", amount: 3n * 10n ** 18n },
          { track: "NVDAc", amount: 4n * 10n ** 18n },
        ],
      },
    } as const;

    await vi.waitFor(() =>
      expect(currentProtocol.publicStatus).toEqual(expected),
    );

    expect(
      queryClient.getQueryData([
        "public-protocol-status",
        testState.manifestHash,
      ]),
    ).toEqual(expected);
    expect(currentProtocol.health).toBeUndefined();
    expect(testState.readPublicStatus).toHaveBeenCalledOnce();
    expect(testState.readPublicStatus).toHaveBeenCalledWith();
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data)
        .filter((data) => data !== undefined),
    ).toEqual([expected]);
    expect(
      queryClient.getQueryState([
        "protocol-health",
        testState.manifestHash,
        undefined,
        false,
        true,
      ]),
    ).toMatchObject({ data: undefined, fetchStatus: "idle" });
    expect(testState.readWallet).not.toHaveBeenCalled();
  });

  it.each(["/exchange", "/fleet", "/rewards", "/faucet"])(
    "anonymous %s uses public evidence without loading authorization diagnostics",
    async (pathname) => {
      testState.pathname = pathname;
      testState.connection.status = "disconnected";
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <ProtocolClientProvider>
              <ProtocolCapture />
            </ProtocolClientProvider>
          </QueryClientProvider>,
        );
      });
      await vi.waitFor(() =>
        expect(currentProtocol.publicStatus?.collection.permanent).toBe(800),
      );
      expect(currentProtocol.health).toBeUndefined();
      expect(testState.readWallet).not.toHaveBeenCalled();
    },
  );

  it("reports native ETH at its actual block and waits for it to catch up with confirmed wallet changes", async () => {
    testState.pathname = "/faucet";
    testState.readWallet.mockResolvedValue({
      observedBlock: 300n,
      collectibles: {
        permanent: [],
        transient: [],
        permanentHoldingsStatus: "complete",
        permanentObservedBlock: 300n,
      },
    });
    testState.getBalance.mockImplementation(async ({ blockNumber }) =>
      blockNumber === 201n ? 10_000_000_000_000_000n : 1_000_000_000_000_000n,
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() =>
      expect(currentProtocol.nativeBalanceRead).toMatchObject({
        status: "loaded",
        balance: { observedBlock: 201n, formatted: "0.01" },
      }),
    );

    await act(async () => currentProtocol.refreshWallet(300n));
    expect(currentProtocol.walletSynchronizing).toBe(true);
    expect(currentProtocol.nativeBalanceRead).toMatchObject({
      status: "loaded",
      balance: { observedBlock: 201n, formatted: "0.01" },
    });
    expect(
      currentProtocol.getActionState({
        type: "commit-collectible",
        identityId: 1,
      }).enabled,
    ).toBe(false);

    testState.getBalance.mockRejectedValue(new Error("Native RPC unavailable"));
    await act(async () => currentProtocol.refreshWallet());
    await vi.waitFor(() =>
      expect(currentProtocol.nativeBalanceRead).toMatchObject({
        status: "failed",
      }),
    );
    expect(currentProtocol.walletSynchronizing).toBe(true);

    testState.getBlockNumber.mockResolvedValue(300n);
    testState.getBalance.mockResolvedValue(1_000_000_000_000_000n);
    await act(async () => currentProtocol.refreshWallet());
    await vi.waitFor(() =>
      expect(currentProtocol.nativeBalanceRead).toMatchObject({
        status: "loaded",
        balance: { observedBlock: 300n, formatted: "0.001" },
      }),
    );
    expect(currentProtocol.walletSynchronizing).toBe(false);
  });

  it("query cancellation interrupts the read lifetime without publishing a late result", async () => {
    let resolveRead: ((value: typeof testState.health) => void) | undefined;
    testState.readPublicStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(testState.readSignals).toHaveLength(1));
    await act(async () => {
      await queryClient.cancelQueries({ queryKey: ["public-protocol-status"] });
    });
    expect(testState.readSignals[0]?.aborted).toBe(true);
    await act(async () => resolveRead?.(testState.health));
    expect(currentProtocol.publicStatus).toBeUndefined();
  });

  it("shows saved public evidence while a live refresh remains in flight", async () => {
    let resolveRead: ((value: typeof testState.health) => void) | undefined;
    testState.readPublicStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const cached = derivePublicStatusModel(testState.health);
    writePublicEvidenceCache(
      window.localStorage,
      testState.manifestHash,
      cached,
      1_700_000_000_000,
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() =>
      expect(currentProtocol.publicStatus).toEqual(cached),
    );
    expect(currentProtocol.publicStatusRefreshing).toBe(true);
    expect(
      readPublicEvidenceCache(window.localStorage, testState.manifestHash)
        ?.savedAt,
    ).toBe(1_700_000_000_000);

    await act(async () => resolveRead?.(testState.health));
    await vi.waitFor(() =>
      expect(currentProtocol.publicStatusRefreshing).toBe(false),
    );
  });

  it("rejects cached evidence whose specialized reward event has the wrong variant", async () => {
    testState.readPublicStatus.mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const cached = derivePublicStatusModel(testState.health);
    const conversion = {
      type: "track-conversion" as const,
      blockNumber: 190n,
      logIndex: 0,
      transactionHash: `0x${"56".repeat(32)}`,
      transactionIndex: 0,
      track: 1 as const,
      conversion: {
        spentWeth: 1n,
        stockReceived: 1n,
        remainingQueue: 0n,
      },
    };
    window.localStorage.setItem(
      `orbit:public-evidence:v1:${testState.manifestHash}`,
      JSON.stringify(
        {
          model: {
            ...cached,
            rewardActivity: {
              ...cached.rewardActivity,
              latestOpening: conversion,
            },
          },
          savedAt: Date.now(),
        },
        (_key, value) =>
          typeof value === "bigint"
            ? { __orbitPublicBigInt: value.toString() }
            : value,
      ),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    expect(
      queryClient.getQueryData([
        "public-protocol-status",
        testState.manifestHash,
      ]),
    ).toBeUndefined();
  });

  it("retries a failed public status read without activating private queries", async () => {
    testState.readPublicStatus
      .mockRejectedValueOnce(new Error("private RPC failed"))
      .mockResolvedValue(testState.health);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(currentProtocol.publicStatusError).toEqual(
          new Error("private RPC failed"),
        ),
      );
    });

    await act(async () => {
      await currentProtocol.refresh();
      await vi.waitFor(() =>
        expect(currentProtocol.publicStatus).toMatchObject({
          health: "healthy",
          observedBlock: 200n,
        }),
      );
    });

    expect(currentProtocol.publicStatusError).toBeNull();
    expect(testState.readPublicStatus).toHaveBeenCalledTimes(2);
    expect(testState.readWallet).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState([
        "protocol-health",
        testState.manifestHash,
        undefined,
        false,
        true,
      ]),
    ).toMatchObject({ data: undefined, fetchStatus: "idle" });
    expect(
      queryClient.getQueryData([
        "public-protocol-status",
        testState.manifestHash,
      ]),
    ).toMatchObject({ health: "healthy", observedBlock: 200n });
  });
});
