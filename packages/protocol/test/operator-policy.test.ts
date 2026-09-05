import { describe, expect, it } from "vitest";

import {
  MAXIMUM_TRACK_EXECUTION_WETH,
  minimumOutputFromQuote,
  nextRewardEpochAt,
  rewardEpochIsEligible,
  trackExecutionInput,
} from "../src/operator-policy.js";

const readyEpoch = {
  configurationSealed: true,
  paused: false,
  rewardEpochCount: 2n,
  lastRewardEpochAt: 1_000n,
  rewardPotWeth: 40_000_000_000_000_000n,
  currentTimestamp: 1_060n,
};

describe("Base Sepolia operator policy", () => {
  it("opens an epoch only after every onchain precondition is satisfied", () => {
    expect(rewardEpochIsEligible(readyEpoch)).toBe(true);
    expect(rewardEpochIsEligible({ ...readyEpoch, paused: true })).toBe(false);
    expect(
      rewardEpochIsEligible({ ...readyEpoch, currentTimestamp: 1_059n }),
    ).toBe(false);
    expect(rewardEpochIsEligible({ ...readyEpoch, rewardPotWeth: 1n })).toBe(
      false,
    );
    expect(nextRewardEpochAt({ ...readyEpoch, rewardEpochCount: 0n })).toBe(0n);
  });

  it("caps track execution inputs", () => {
    expect(trackExecutionInput(MAXIMUM_TRACK_EXECUTION_WETH + 1n)).toBe(
      MAXIMUM_TRACK_EXECUTION_WETH,
    );
  });

  it("derives a nonzero protected output from the live venue quote", () => {
    expect(minimumOutputFromQuote(1_000_000n, 9_900)).toBe(990_000n);
    expect(() => minimumOutputFromQuote(1n, 9_900)).toThrow("rounds to zero");
    expect(() => minimumOutputFromQuote(1_000n, 10_001)).toThrow(
      "from 1 to 10000",
    );
  });
});
