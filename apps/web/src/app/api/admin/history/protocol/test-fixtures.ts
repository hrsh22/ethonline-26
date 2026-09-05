export const localDeploymentFingerprint = `0x${"f".repeat(64)}` as const;

export const historyManifest = {
  canonicalPool: {
    currency0: "0x0000000000000000000000000000000000000001",
    currency1: "0x0000000000000000000000000000000000000002",
    poolId: `0x${"3".repeat(64)}`,
  },
  chainId: 84_532,
  commitment: `0x${"4".repeat(64)}`,
  fingerprint: localDeploymentFingerprint,
  launchBlock: "10",
  network: "base-sepolia",
  sources: {
    canonicalFeeHook: "0x0000000000000000000000000000000000000003",
    epochConverter: "0x0000000000000000000000000000000000000004",
    fuelCore: "0x0000000000000000000000000000000000000005",
    poolManager: "0x0000000000000000000000000000000000000006",
    protocolLiquidityVault: "0x0000000000000000000000000000000000000007",
    rewardLedger: "0x0000000000000000000000000000000000000008",
  },
} as const;

export const operationsHistoryResponse = {
  items: [
    {
      blockHash: `0x${"6".repeat(64)}`,
      blockNumber: "123",
      blockTimestamp: "456",
      eventName: "reward-epoch-opened",
      logIndex: 1,
      parentHash: `0x${"7".repeat(64)}`,
      payload: {
        epochNumber: "1",
        equalTrackShare: "20",
        finalTrackRemainder: "0",
        openedAmount: "80",
      },
      removed: false,
      sourceAddress: "0x0000000000000000000000000000000000000004",
      transactionHash: `0x${"8".repeat(64)}`,
      transactionIndex: 2,
    },
  ],
  manifest: historyManifest,
  page: { hasMore: false },
  snapshot: {
    blockHash: `0x${"5".repeat(64)}`,
    blockNumber: "123",
    canonicalRevision: 0,
    generation: "generation-1",
  },
  status: {
    coverage: {
      fromBlock: "10",
      indexedThroughBlock: "123",
      indexedThroughTime: "456",
    },
    head: { lagBlocks: "0", observedBlock: "123" },
    requested: { fromBlock: "10", toBlock: "123" },
    state: "complete",
  },
} as const;

export const keeperAttemptsHistoryResponse = {
  evidence: {
    coverage: {
      1: "complete",
      2: "complete",
      3: "complete",
      4: "complete",
    },
    freshness: {
      ageSeconds: "1",
      maximumAgeSeconds: "300",
      observedAt: "456",
      recordedAt: "457",
    },
    generation: "generation-1",
    source: "keeper-attempt-journal",
    state: "fresh",
    tracks: {
      1: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 1,
        },
        state: "fresh",
      },
      2: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 2,
        },
        state: "fresh",
      },
      3: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 3,
        },
        state: "fresh",
      },
      4: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 4,
        },
        state: "fresh",
      },
    },
  },
  manifest: historyManifest,
} as const;
