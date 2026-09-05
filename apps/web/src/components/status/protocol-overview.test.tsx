import type { RewardHistoryEvent } from "@orbit/protocol/reader";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  deriveProtocolFunds,
  derivePublicStatusModel,
} from "@/lib/protocol-status-model";

import { applicationCopy } from "@/lib/identity";
import { ProtocolOverview } from "./protocol-overview";

const hash = (value: number) =>
  `0x${value.toString(16).padStart(64, "0")}` as const;

const rewardHistory: RewardHistoryEvent[] = [
  {
    type: "reward-epoch",
    blockNumber: 100n,
    logIndex: 0,
    transactionHash: hash(1),
    transactionIndex: 0,
    epoch: {
      epochNumber: 3n,
      openedWeth: 40n,
      equalTrackShare: 10n,
      finalTrackRemainder: 0n,
    },
  },
  ...([1, 2, 3, 4] as const).map((track): RewardHistoryEvent => ({
    type: "track-conversion",
    blockNumber: 100n + BigInt(track === 3 ? 5 : track === 4 ? 4 : track),
    logIndex: 0,
    transactionHash: hash(track + 1),
    transactionIndex: 0,
    track,
    conversion: {
      spentWeth: 10n,
      stockReceived: BigInt(track * 100),
      remainingQueue: 0n,
    },
  })),
  {
    type: "reward-claim",
    blockNumber: 106n,
    logIndex: 0,
    transactionHash: hash(6),
    transactionIndex: 0,
    track: 1,
    claim: {
      amount: 25n,
      currentOwner: "0x0000000000000000000000000000000000000001",
      identityId: 349,
    },
  },
];

const health = {
  health: {
    status: "healthy",
    checks: [
      {
        id: "read-freshness",
        status: "pass",
        severity: "warning",
        freshness: "fresh",
        observedBlock: 110n,
        explanation: "The read is current.",
      },
    ],
  },
  deployment: {
    network: "base-sepolia",
    observedAt: 1_700_000_000,
    observedBlock: 110n,
  },
  collection: {
    permanentCount: 800,
    transientCount: 40,
    pendingDiscoveryCount: 4,
    availableIdentityCount: 3_604,
  },
  market: {
    rewardPotWeth: 1n,
    liquidityPotWeth: 20n,
    creatorPotWeth: 3n,
  },
  operations: {
    trackQueues: ([1, 2, 3, 4] as const).map((trackId) => ({
      trackId,
      weth: 1n,
    })),
    protocolOwnedLiquidity: {
      queuedWeth: 30n,
      permanentlyLockedWeth: 4n,
    },
    rewardEpochCount: 1n,
    rewardHistory,
    rewardHistoryStatus: "complete",
  },
  rewards: {
    tracks: ["AAPLc", "GOOGLc", "METAc", "NVDAc"].map((track, index) => ({
      track,
      rawLiability: index === 0 ? 75n : BigInt((index + 1) * 100),
    })),
  },
} as const;

describe("plain-language protocol overview", () => {
  it("reconciles destination-locked WETH without inventing a treasury", () => {
    expect(deriveProtocolFunds(health)).toEqual({
      creatorWeth: 3n,
      liquidityLockedWeth: 4n,
      liquidityWaitingWeth: 50n,
      rewardWethWaiting: 5n,
    });
  });

  it("does not attribute deferred conversions to the latest epoch opening", () => {
    const crossEpochHistory: RewardHistoryEvent[] = [
      rewardHistory[0]!,
      {
        type: "reward-epoch",
        blockNumber: 103n,
        logIndex: 0,
        transactionHash: hash(20),
        transactionIndex: 0,
        epoch: {
          epochNumber: 4n,
          openedWeth: 40n,
          equalTrackShare: 10n,
          finalTrackRemainder: 0n,
        },
      },
      rewardHistory[1]!,
    ];
    const html = renderToStaticMarkup(
      <ProtocolOverview
        model={derivePublicStatusModel({
          ...health,
          operations: {
            ...health.operations,
            rewardEpochCount: 2n,
            rewardHistory: crossEpochHistory,
          },
        })}
      />,
    );

    expect(html).toContain("Reward Epoch 4 opened");
    expect(html).toContain("AAPLc conversion");
    expect(html).toContain("Conversion events do not carry an epoch ID");
    expect(html).not.toContain("routes completed");
  });

  it("does not present missing history as zero conversion or zero claims", () => {
    const incompleteHealth = {
      ...health,
      operations: {
        ...health.operations,
        rewardHistory: [],
        rewardHistoryStatus: "partial",
      },
    } as const;

    const html = renderToStaticMarkup(
      <ProtocolOverview model={derivePublicStatusModel(incompleteHealth)} />,
    );
    expect(html).toContain("Partial indexed reward history");
    expect(html).not.toContain("View complete indexed reward event history");
    expect(html).not.toContain("0 stock tokens");
    expect(html).toContain('data-state="partial"');
    expect(html).toContain("Indexed reward history is incomplete");
    expect(html).not.toContain('class="empty-state"');
  });

  it("shows indexed conversions without inventing a missing opening", () => {
    const html = renderToStaticMarkup(
      <ProtocolOverview
        model={derivePublicStatusModel({
          ...health,
          operations: {
            ...health.operations,
            rewardHistory: [rewardHistory[1]!],
            rewardHistoryStatus: "partial",
          },
        })}
      />,
    );

    expect(html).toContain("No Reward Epoch opening is present");
    expect(html).toContain("AAPLc conversion");
    expect(html).toContain("Partial indexed reward history");
    expect(html).toMatch(
      /data-history-coverage="partial"[\s\S]*?data-state="partial"/u,
    );
  });

  it("never describes unavailable reward history as partial", () => {
    const html = renderToStaticMarkup(
      <ProtocolOverview
        model={derivePublicStatusModel({
          ...health,
          operations: {
            ...health.operations,
            rewardHistory: [],
            rewardHistoryStatus: "unknown",
          },
        })}
      />,
    );

    expect(html).toContain("Reward history unavailable");
    expect(html).toContain("Stock conversion history unavailable");
    expect(html).toMatch(
      /data-history-coverage="unknown"[\s\S]*?data-state="blocked"/u,
    );
    expect(html).not.toContain("partial index");
  });

  it("renders durable reward-event history after events leave the bounded operational window", () => {
    const html = renderToStaticMarkup(
      <ProtocolOverview
        model={derivePublicStatusModel({
          ...health,
          operations: {
            ...health.operations,
            rewardEpochCount: 1n,
            rewardHistory,
            rewardHistoryStatus: "complete",
          },
        })}
      />,
    );

    expect(html).toContain("Reward Epoch 3");
    expect(html).toContain("View complete indexed reward event history");
  });

  it("explains funds and epoch activity before technical evidence", () => {
    const html = renderToStaticMarkup(
      <ProtocolOverview model={derivePublicStatusModel(health)} />,
    );

    expect(html).toContain("Collection state");
    expect(html).toContain("Destination-locked funds");
    expect(html).toContain("No general-purpose treasury");
    expect(html).toContain("Latest indexed reward activity");
    expect(html).toContain("cannot prove that the Keeper is currently running");
    expect(html).not.toContain("Latest keeper cycle");
    expect(html).not.toContain("Keeper attempt evidence");
    expect(html).toContain('href="/market"');
    expect(html).toContain('href="/rewards"');
    expect(html).toContain("Reward Epoch 3");
    expect(html).toContain("AAPLc");
    expect(html).toContain("AAPLc reserved for collector claims");
    expect(html).toContain("Conversion events do not carry an epoch ID");
  });
  it("keeps exact reward evidence public but behind disclosure", () => {
    const html = renderToStaticMarkup(
      <ProtocolOverview model={derivePublicStatusModel(health)} />,
    );

    const disclosureIndex = html.indexOf(
      applicationCopy.publicStatus.evidenceDisclosure,
    );
    // The summary board answers first; the per-event receipts sit behind it.
    const summaryIndex = html.indexOf('id="latest-reward-heading"');
    const evidenceIndex = html.indexOf('id="reward-evidence-heading"');
    expect(disclosureIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeLessThan(disclosureIndex);
    expect(evidenceIndex).toBeGreaterThan(disclosureIndex);
    expect(
      html.indexOf(applicationCopy.publicStatus.viewTransaction),
    ).toBeGreaterThan(disclosureIndex);
    // Nothing classified public is removed; it is only grouped.
    expect(html).toContain("Reward index evidence and methodology");
  });

  it("puts the collection and fund answer ahead of the evidence disclosure", () => {
    const html = renderToStaticMarkup(
      <ProtocolOverview model={derivePublicStatusModel(health)} />,
    );

    const fundIndex =
      html.indexOf('className="fund-board"') >= 0
        ? html.indexOf('className="fund-board"')
        : html.indexOf('id="protocol-funds-heading"');
    const disclosureIndex = html.indexOf(
      applicationCopy.publicStatus.evidenceDisclosure,
    );
    expect(fundIndex).toBeGreaterThan(-1);
    expect(fundIndex).toBeLessThan(disclosureIndex);
  });
});
