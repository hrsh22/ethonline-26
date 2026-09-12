import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RewardProgressEvidence } from "./reward-progress-panel";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

type Protocol = ReturnType<typeof useProtocolClient>;
const health = {
  deployment: { observedAt: 1000, seals: { conversionRoutes: true } },
  market: { rewardPotWeth: 260_090_000_000_000n },
  operations: {
    nextRewardEpochAt: 0n,
    trackQueues: ["AAPLc", "GOOGLc", "METAc", "NVDAc"].map((track, index) => ({
      track,
      weth: index === 2 ? 10n ** 16n : 0n,
      deferred: index === 2,
    })),
  },
  pauses: { converter: false, rewards: false },
} as unknown as NonNullable<Protocol["health"]>;
const wallet = {
  status: "loaded",
  snapshot: {
    collectibles: {
      permanentHoldingsStatus: "complete",
      permanent: [{ identityId: 1289, rewardTrack: "METAc" }],
    },
  },
} as unknown as Protocol["walletRead"];

describe("Orbiter reward progress", () => {
  it("shows the funding threshold, actual track, timing and deferred conversion without promising payout", () => {
    const html = renderToStaticMarkup(
      <RewardProgressEvidence
        health={health}
        wallet={wallet}
        service="running"
      />,
    );
    expect(html).toContain("When will my Orbiter receive rewards?");
    expect(html).toContain("METAc");
    expect(html.match(/Your track/g)).toHaveLength(1);
    expect(html).toContain('value="0.65"');
    expect(html).toContain("0.04");
    expect(html).toContain("Minimum wait is satisfied");
    expect(html).toContain("reserved for retry");
    expect(html).toContain("not a payout schedule");
    expect(html).not.toContain("The onchain conditions above are met");
    expect(html).not.toContain("Discovery request");
  });
  it("does not turn missing or stale observations into zero balances or readiness", () => {
    for (const input of [undefined, health]) {
      const html = renderToStaticMarkup(
        <RewardProgressEvidence
          health={input}
          wallet={wallet}
          service="unknown"
          stale
        />,
      );
      expect(html).not.toContain("<progress");
      expect(html).toContain("balance is unavailable");
      expect(html).toContain("Timing could not be verified");
      expect(html).not.toContain("Minimum wait is satisfied");
      expect(html).not.toContain("No queued budget");
      expect(html).not.toContain("The onchain conditions above are met");
    }
  });
  it("does not promise automatic processing while stopped, even with the threshold met", () => {
    const ready = {
      ...health,
      market: { ...health.market, rewardPotWeth: 40_000_000_000_000_000n },
    };
    const html = renderToStaticMarkup(
      <RewardProgressEvidence
        health={ready}
        wallet={wallet}
        service="stopped"
      />,
    );
    expect(html).toContain("Automatic processing is stopped");
    expect(html).toContain("Processing must be available");
    expect(html).toContain("does not yet mean rewards are claimable");
  });
  it("does not mark unknown ownership as eligible or highlight stale personal tracks", () => {
    const html = renderToStaticMarkup(
      <RewardProgressEvidence
        health={health}
        wallet={{ ...wallet, stale: true } as Protocol["walletRead"]}
        service="running"
      />,
    );
    expect(html).toContain("ownership is updating");
    expect(html).not.toContain("Your track");
    expect(html).not.toContain("Orbiter participates");
  });
  it("marks every track for a verified relic without confusing the allocation", () => {
    const relic = {
      status: "loaded",
      snapshot: {
        collectibles: {
          permanentHoldingsStatus: "complete",
          permanent: [{ identityId: 4444, rewardTrack: "All Reward Tracks" }],
        },
      },
    } as unknown as Protocol["walletRead"];
    const html = renderToStaticMarkup(
      <RewardProgressEvidence
        health={health}
        wallet={relic}
        service="running"
      />,
    );
    expect(html.match(/Your track/g)).toHaveLength(4);
    expect(html).toContain("All four tracks");
  });
});
