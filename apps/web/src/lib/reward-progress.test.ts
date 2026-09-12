import { describe, expect, it } from "vitest";
import { rewardCycleProgress, type RewardCycleInput } from "./reward-progress";

const input: RewardCycleInput = {
  rewardPotWeth: 40_000_000_000_000_000n,
  nextEpochAt: 1000n,
  observedAt: 1000,
  routesSealed: true,
  converterPaused: false,
  rewardsPaused: false,
};

describe("collector reward cycle progress", () => {
  it("measures the actual new-epoch pot, not money already queued for conversion", () => {
    const result = rewardCycleProgress({
      ...input,
      rewardPotWeth: 260_090_000_000_000n,
    });
    expect(result.percent).toBe(0.65);
    expect(result.remainingWeth).toBe(39_739_910_000_000_000n);
    expect(result.funded).toBe(false);
    expect(result.canOpen).toBe(false);
  });
  it("requires both the funding minimum and elapsed contract interval", () => {
    expect(rewardCycleProgress(input).canOpen).toBe(true);
    expect(rewardCycleProgress({ ...input, nextEpochAt: 1060n })).toMatchObject(
      { canOpen: false, secondsRemaining: 60 },
    );
    expect(rewardCycleProgress({ ...input, nextEpochAt: 0n }).canOpen).toBe(
      true,
    );
  });
  it.each([
    "rewardPotWeth",
    "nextEpochAt",
    "observedAt",
    "routesSealed",
    "converterPaused",
    "rewardsPaused",
  ] as const)("does not claim readiness with missing %s", (field) => {
    expect(rewardCycleProgress({ ...input, [field]: undefined }).canOpen).toBe(
      false,
    );
  });
  it("keeps a pause distinct from a missing read and clamps progress", () => {
    expect(
      rewardCycleProgress({ ...input, converterPaused: true }),
    ).toMatchObject({ canOpen: false, conversion: "paused" });
    expect(
      rewardCycleProgress({ ...input, rewardsPaused: true }).conversion,
    ).toBe("paused");
    expect(
      rewardCycleProgress({ ...input, routesSealed: false }).conversion,
    ).toBe("unconfigured");
    expect(
      rewardCycleProgress({ ...input, rewardPotWeth: 10n ** 18n }),
    ).toMatchObject({ percent: 100, remainingWeth: 0n });
    expect(
      rewardCycleProgress({ ...input, rewardPotWeth: undefined }).percent,
    ).toBeUndefined();
  });
});
