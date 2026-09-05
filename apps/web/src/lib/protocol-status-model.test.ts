import type { ProtocolHealthCheck } from "@orbit/protocol/health";
import type { RewardHistoryEvent } from "@orbit/protocol/reader";
import { describe, expect, it } from "vitest";

import {
  type AdminDiagnosticsSnapshotInput,
  deriveAdminDiagnosticsModel,
  derivePublicStatusModel,
} from "./protocol-status-model";

const hash = (value: number) =>
  `0x${value.toString(16).padStart(64, "0")}` as const;

const checks: ProtocolHealthCheck[] = [
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
  {
    id: "supply-invariant",
    status: "pass",
    severity: "critical",
    freshness: "fresh",
    observedBlock: 200n,
    explanation: "Supply reconciles.",
  },
  {
    id: "binding:market.manager",
    status: "fail",
    severity: "critical",
    freshness: "fresh",
    observedBlock: 200n,
    explanation: "Market binding differs.",
  },
  {
    id: "track:AAPLc",
    status: "unknown",
    severity: "warning",
    freshness: "fresh",
    observedBlock: 200n,
    explanation: "Attempt history was intentionally omitted.",
  },
];

const rewardHistory: RewardHistoryEvent[] = [
  {
    type: "reward-epoch",
    blockNumber: 190n,
    logIndex: 0,
    transactionHash: hash(1),
    transactionIndex: 0,
    epoch: {
      epochNumber: 7n,
      openedWeth: 4n * 10n ** 18n,
      equalTrackShare: 10n ** 18n,
      finalTrackRemainder: 0n,
    },
  },
  ...([1, 2, 3, 4] as const).map((track): RewardHistoryEvent => ({
    type: "track-conversion",
    blockNumber: 190n + BigInt(track),
    logIndex: 0,
    transactionHash: hash(track + 1),
    transactionIndex: 0,
    track,
    conversion: {
      spentWeth: 10n ** 18n,
      stockReceived: BigInt(track) * 10n ** 18n,
      remainingQueue: 0n,
    },
  })),
];

const health = {
  health: { checks },
  deployment: {
    network: "base-sepolia",
    expectedChainId: 84_532,
    observedChainId: 84_532,
    observedBlock: 200n,
    observedAt: 1_700_000_000,
    expectedManifestCommitment: hash(11),
    manifestCommitment: hash(11),
  },
  collection: {
    liquidSupplyFormatted: "3600",
    permanentCount: 800,
    transientCount: 40,
    pendingDiscoveryCount: 4,
    availableIdentityCount: 3_604,
  },
  market: {
    rewardPotWeth: 10n ** 18n,
    liquidityPotWeth: 2n * 10n ** 18n,
    creatorPotWeth: 3n * 10n ** 18n,
  },
  operations: {
    keeperAttemptEvidence: {
      source: "keeper-attempt-journal",
      generation: "generation-1",
      state: "fresh",
      freshness: {
        observedAt: 1_700_000_000n,
        ageSeconds: 4n,
        maximumAgeSeconds: 900n,
      },
      coverage: {
        1: "complete",
        2: "complete",
        3: "complete",
        4: "complete",
      },
      tracks: {
        1: { state: "fresh" },
        2: { state: "fresh" },
        3: { state: "fresh" },
        4: { state: "fresh" },
      },
    },
    historyStatus: "partial",
    rewardHistoryStatus: "complete",
    rewardEpochCount: 7n,
    rewardHistory,
    trackQueues: ([1, 2, 3, 4] as const).map((trackId) => ({
      track: `TRACK-${trackId}`,
      trackId,
      weth: 10n ** 18n,
      wethFormatted: "1",
      deferred: false,
      status: "clear" as const,
    })),
    trackOutcomes: {
      1: { latest: undefined },
      2: { latest: undefined },
      3: { latest: undefined },
      4: { latest: undefined },
    },
    protocolOwnedLiquidity: {
      queuedWeth: 5n * 10n ** 18n,
      queuedWethFormatted: "5",
      permanentlyLockedWeth: 6n * 10n ** 18n,
      permanentlyLockedWethFormatted: "6",
      cycleCount: 2n,
    },
    summary: {
      "reward-epoch": { lastSuccessful: undefined, lastFailed: undefined },
      conversion: { lastSuccessful: undefined, lastFailed: undefined },
      retry: { lastSuccessful: undefined, lastFailed: undefined },
      claim: { lastSuccessful: undefined, lastFailed: undefined },
      "pol-execution": { lastSuccessful: undefined, lastFailed: undefined },
    },
    recentEvents: [],
  },
  rewards: {
    tracks: ["AAPLc", "GOOGLc", "METAc", "NVDAc"].map((track, index) => ({
      track,
      rawTokenBalance:
        index === 0 ? 9n * 10n ** 18n : BigInt(index + 1) * 10n ** 18n,
      rawLiability: BigInt(index + 1) * 10n ** 18n,
      solvent: true,
      activeWeight: 1n,
      unclaimedTrackPot: 0n,
      basketRelicPot: 0n,
      indicatorRelicPot: 0n,
    })),
  },
  roles: {
    owners: {
      liquidToken: "0x0000000000000000000000000000000000000001",
      rewards: "0x0000000000000000000000000000000000000002",
      converter: "0x0000000000000000000000000000000000000004",
      liquidity: "0x0000000000000000000000000000000000000005",
    },
    keeper: "0x0000000000000000000000000000000000000003",
    liquidityExecutor: "0x0000000000000000000000000000000000000003",
    guardian: "0x0000000000000000000000000000000000000006",
    recoveryAuthority: "0x0000000000000000000000000000000000000007",
    creator: "0x0000000000000000000000000000000000000008",
  },
} as const;

const adminHealth: AdminDiagnosticsSnapshotInput = health;

describe("public protocol status model", () => {
  it("derives a bounded public summary without raw deployment or role evidence", () => {
    const model = derivePublicStatusModel(health);

    expect(model).toMatchObject({
      health: "critical",
      freshness: "fresh",
      observedBlock: 200n,
      collection: {
        permanent: 800,
        transient: 40,
        pending: 4,
        available: 3_604,
      },
      funds: {
        rewardWethWaiting: 5n * 10n ** 18n,
        liquidityWaitingWeth: 7n * 10n ** 18n,
        liquidityLockedWeth: 6n * 10n ** 18n,
        creatorWeth: 3n * 10n ** 18n,
      },
      rewardActivity: {
        epochCount: 7n,
        historyStatus: "complete",
        latestOpening: expect.objectContaining({
          type: "reward-epoch",
          epoch: expect.objectContaining({ epochNumber: 7n }),
        }),
      },
    });
    expect(model.rewardActivity.collectorLiability).toEqual([
      { track: "AAPLc", amount: 10n ** 18n },
      { track: "GOOGLc", amount: 2n * 10n ** 18n },
      { track: "METAc", amount: 3n * 10n ** 18n },
      { track: "NVDAc", amount: 4n * 10n ** 18n },
    ]);
    expect(model).not.toHaveProperty("deployment.manifestCommitment");
    expect(model).not.toHaveProperty("roles");
    expect(model).not.toHaveProperty("checks");
    expect(model).not.toHaveProperty("automation");
  });

  it("does not degrade public health for intentionally omitted track history", () => {
    const model = derivePublicStatusModel({
      ...health,
      health: {
        checks: [checks[0]!, checks[3]!],
      },
    });

    expect(model.health).toBe("healthy");
  });

  it("does not treat non-authoritative failed-attempt state as public health", () => {
    const model = derivePublicStatusModel({
      ...health,
      health: {
        checks: [
          checks[0]!,
          {
            ...checks[3]!,
            status: "fail",
            explanation: "The queued track can be retried.",
          },
        ],
      },
    });

    expect(model.health).toBe("healthy");
  });

  it("keeps public protocol health independent of the connected wallet", () => {
    const model = derivePublicStatusModel({
      ...health,
      health: {
        checks: [
          checks[0]!,
          {
            id: "freeze:connected-wallet",
            status: "fail",
            severity: "warning",
            freshness: "fresh",
            observedBlock: 200n,
            explanation: "The connected wallet is frozen.",
          },
        ],
      },
    });

    expect(model.health).toBe("healthy");
  });

  it("does not expose or derive health from keeper-attempt evidence", () => {
    const snapshotWithKeeperAttemptEvidence = {
      ...health,
      health: { checks: [checks[0]!] },
      operations: {
        ...health.operations,
        keeperAttemptEvidence: {
          ...health.operations.keeperAttemptEvidence,
          tracks: {
            ...health.operations.keeperAttemptEvidence.tracks,
            2: {
              state: "retryable" as const,
              outcome: "failed-before-submission" as const,
              failureClass: "quote-unavailable" as const,
              observedBlock: 199n,
              observedAt: 1_700_000_000n,
            },
          },
        },
      },
    } as const;
    const model = derivePublicStatusModel(snapshotWithKeeperAttemptEvidence);

    expect(model.health).toBe("healthy");
    expect(model).not.toHaveProperty("automation");
    expect(model).not.toHaveProperty("keeperAttemptEvidence");
  });

  it("keeps openings and conversions independent when queues span epochs", () => {
    const events: RewardHistoryEvent[] = [
      rewardHistory[0]!,
      {
        type: "reward-epoch",
        blockNumber: 195n,
        logIndex: 0,
        transactionHash: hash(20),
        transactionIndex: 0,
        epoch: {
          epochNumber: 8n,
          openedWeth: 8n * 10n ** 18n,
          equalTrackShare: 2n * 10n ** 18n,
          finalTrackRemainder: 0n,
        },
      },
      rewardHistory[1]!,
    ];
    const model = derivePublicStatusModel({
      ...health,
      operations: { ...health.operations, rewardHistory: events },
    });

    expect(model.rewardActivity.latestOpening?.epoch.epochNumber).toBe(8n);
    expect(model.rewardActivity.recentConversions).toHaveLength(1);
    expect(model.rewardActivity.recentConversions[0]).not.toHaveProperty(
      "epochNumber",
    );
    expect(model.rewardActivity.history.map((event) => event.type)).toEqual([
      "reward-epoch",
      "track-conversion",
      "reward-epoch",
    ]);
  });

  it("does not invent current history or freshness when evidence is missing", () => {
    const model = derivePublicStatusModel({
      ...health,
      health: { checks: checks.slice(1) },
      operations: {
        ...health.operations,
        rewardHistory: [],
        rewardHistoryStatus: "unknown",
      },
    });

    expect(model.freshness).toBe("unknown");
    expect(model.rewardActivity.latestOpening).toBeUndefined();
    expect(model.rewardActivity.history).toEqual([]);
    expect(model.rewardActivity.historyStatus).toBe("unknown");
  });
});

describe("admin diagnostics model", () => {
  it("accounts for every check once and distinguishes evidence sources", () => {
    const model = deriveAdminDiagnosticsModel(adminHealth, {
      state: "loaded",
      serviceState: "ready",
    });
    const groupedChecks = Object.values(model.checks).flat();

    expect(groupedChecks).toHaveLength(checks.length);
    expect(new Set(groupedChecks.map((check) => check.id)).size).toBe(
      checks.length,
    );
    expect(model.sources).toEqual([
      expect.objectContaining({ source: "onchain", state: "critical" }),
      expect.objectContaining({
        source: "operational-index",
        state: "partial",
      }),
      expect.objectContaining({
        source: "reward-index",
        state: "complete",
      }),
      expect.objectContaining({ source: "funding", state: "ready" }),
      expect.objectContaining({
        source: "keeper-attempts",
        state: "fresh",
      }),
      expect.objectContaining({
        source: "automation",
        state: "not-inferable",
      }),
    ]);
    expect(model.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "keeper",
          address: "0x0000000000000000000000000000000000000003",
        }),
        expect.objectContaining({
          role: "recovery-authority-contract",
          address: "0x0000000000000000000000000000000000000007",
        }),
      ]),
    );
  });

  it("keeps an unavailable funding read distinct from worker execution", () => {
    const model = deriveAdminDiagnosticsModel(adminHealth, {
      state: "failed",
    });

    expect(model.sources.at(3)).toMatchObject({
      source: "funding",
      state: "unavailable",
    });
    expect(model.sources.at(5)).toMatchObject({
      source: "automation",
      state: "not-inferable",
    });
  });
});
