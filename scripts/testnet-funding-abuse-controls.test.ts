import { describe, expect, it } from "vitest";

import {
  evaluateFundingBudget,
  evaluateFundingThrottle,
  fundingBudgetWindowStart,
  fundingClientWindowStart,
  fundingDepletionState,
  FUNDING_BUDGET_WINDOW_MILLISECONDS,
  type TestnetFundingAbusePolicy,
} from "./testnet-funding/abuse-controls.ts";

const policy: TestnetFundingAbusePolicy = {
  dailyBudget: { wethWei: 1_000n, ethWei: 100n },
  dailyGrantLimit: 4,
  clientWindowMilliseconds: 3_600_000,
  clientWindowLimit: 2,
  elevatedUsageRatio: 0.6,
  criticalUsageRatio: 0.9,
};

const spend = (wethWei: bigint, ethWei: bigint, grants: number) => ({
  wethWei,
  ethWei,
  grants,
});

describe("service-wide funding budget", () => {
  it("allows a grant that fits the remaining window budget", () => {
    expect(
      evaluateFundingBudget(policy, spend(400n, 40n, 1), {
        wethWei: 600n,
        ethWei: 60n,
      }),
    ).toEqual({ ok: true });
  });

  it("stops multi-address depletion once the WETH budget is spent", () => {
    expect(
      evaluateFundingBudget(policy, spend(600n, 0n, 1), {
        wethWei: 500n,
        ethWei: 0n,
      }),
    ).toEqual({ ok: false, reason: "budget-exhausted" });
  });

  it("stops depletion once the ETH budget is spent", () => {
    expect(
      evaluateFundingBudget(policy, spend(0n, 80n, 1), {
        wethWei: 0n,
        ethWei: 30n,
      }),
    ).toEqual({ ok: false, reason: "budget-exhausted" });
  });

  it("stops depletion at the grant count even with budget left", () => {
    expect(
      evaluateFundingBudget(policy, spend(0n, 0n, 4), {
        wethWei: 1n,
        ethWei: 1n,
      }),
    ).toEqual({ ok: false, reason: "grant-limit" });
  });

  it("allows a grant that exactly consumes the budget", () => {
    expect(
      evaluateFundingBudget(policy, spend(0n, 0n, 0), {
        wethWei: 1_000n,
        ethWei: 100n,
      }),
    ).toEqual({ ok: true });
  });

  it("buckets spend into fixed daily windows", () => {
    const start = fundingBudgetWindowStart(1_800_000_123_456);
    expect(start % FUNDING_BUDGET_WINDOW_MILLISECONDS).toBe(0);
    expect(fundingBudgetWindowStart(start)).toBe(start);
    expect(
      fundingBudgetWindowStart(start + FUNDING_BUDGET_WINDOW_MILLISECONDS),
    ).toBe(start + FUNDING_BUDGET_WINDOW_MILLISECONDS);
  });
});

describe("depletion velocity alert", () => {
  it("reports normal usage below the elevated threshold", () => {
    const result = fundingDepletionState(policy, spend(100n, 0n, 0));
    expect(result.state).toBe("normal");
    expect(result.usedRatio).toBeCloseTo(0.1, 5);
  });

  it("elevates once the configured share is spent", () => {
    expect(fundingDepletionState(policy, spend(700n, 0n, 0)).state).toBe(
      "elevated",
    );
  });

  it("escalates to critical near exhaustion", () => {
    expect(fundingDepletionState(policy, spend(950n, 0n, 0)).state).toBe(
      "critical",
    );
  });

  it("escalates on grant velocity even when amounts are small", () => {
    expect(fundingDepletionState(policy, spend(1n, 0n, 4)).state).toBe(
      "critical",
    );
  });

  it("reports a bounded ratio", () => {
    const result = fundingDepletionState(policy, spend(10_000n, 0n, 99));
    expect(result.usedRatio).toBe(1);
  });
});

describe("funding-specific client throttle", () => {
  const windowStart = fundingClientWindowStart(1_800_000_000_000, 3_600_000);

  it("allows attempts up to the window limit", () => {
    expect(
      evaluateFundingThrottle(policy, 2, windowStart + 1_000, windowStart),
    ).toEqual({ ok: true });
  });

  it("throttles past the limit and reports when the window resets", () => {
    const verdict = evaluateFundingThrottle(
      policy,
      3,
      windowStart + 1_000,
      windowStart,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.retryAfterMilliseconds).toBe(3_600_000 - 1_000);
    }
  });

  it("never reports a negative retry delay", () => {
    const verdict = evaluateFundingThrottle(
      policy,
      99,
      windowStart + 7_200_000,
      windowStart,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.retryAfterMilliseconds).toBe(0);
  });
});
