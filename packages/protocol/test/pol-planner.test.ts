import { describe, expect, it } from "vitest";

import {
  DEFAULT_POL_BUDGET_POLICY,
  planWethOnlyPolCycle,
  validatePolBudgetPolicy,
  validatePolSimulation,
  wethConsumptionForLiquidity,
  type PolCyclePlan,
} from "../src/pol-planner.js";

const WETH = 10n ** 18n;

const readyPlan = (plan: PolCyclePlan) => {
  expect(plan.status).toBe("ready");
  if (plan.status !== "ready") throw new Error(plan.reason);
  return plan;
};

const plan = (
  overrides: Partial<Parameters<typeof planWethOnlyPolCycle>[0]> = {},
) =>
  planWethOnlyPolCycle({
    currentTick: -51_601,
    tickSpacing: 60,
    wethIsCurrency0: true,
    availableWeth: 51_969_758_100_000_000n,
    currentTimestamp: 1_000n,
    ...overrides,
  });

describe("WETH-budgeted Protocol-Owned Liquidity planning", () => {
  it("plans both WETH currency orderings as one-sided ranges", () => {
    const weth0 = readyPlan(plan());
    expect(weth0).toMatchObject({
      tickLower: -51_600,
      tickUpper: -51_000,
      selectedBudgetWeth: 25_000_000_000_000_000n,
      maximumWeth: 25_000_000_000_000_000n,
    });

    const weth1 = readyPlan(
      plan({ currentTick: 51_601, wethIsCurrency0: false }),
    );
    expect(weth1).toMatchObject({
      tickLower: 51_000,
      tickUpper: 51_600,
      selectedBudgetWeth: 25_000_000_000_000_000n,
    });
    expect(weth0.expectedConsumptionWeth).toBe(weth0.selectedBudgetWeth);
    expect(weth1.expectedConsumptionWeth).toBe(weth1.selectedBudgetWeth);
  });

  it("selects the greatest safe liquidity within one integer liquidity quantum", () => {
    const selected = readyPlan(plan({ currentTick: -1 }));
    expect(
      selected.selectedBudgetWeth - selected.expectedConsumptionWeth,
    ).toBeLessThanOrEqual(selected.roundingToleranceWeth);
    expect(
      wethConsumptionForLiquidity({
        tickLower: selected.tickLower,
        tickUpper: selected.tickUpper,
        liquidity: selected.liquidity + 1n,
        wethIsCurrency0: true,
      }),
    ).toBeGreaterThan(selected.selectedBudgetWeth);
    expect(
      wethConsumptionForLiquidity({
        tickLower: selected.tickLower,
        tickUpper: selected.tickUpper,
        liquidity: 1n,
        wethIsCurrency0: true,
      }),
    ).toBe(1n);
  });

  it("accepts the irreducible safe remainder from one integer liquidity quantum", () => {
    const selected = readyPlan(plan({ currentTick: -85_921 }));
    expect(selected.expectedConsumptionWeth).toBe(24_999_999_999_999_998n);
    expect(selected.budgetRemainderWeth).toBe(2n);
    expect(selected.roundingToleranceWeth).toBeGreaterThanOrEqual(2n);
    expect(
      wethConsumptionForLiquidity({
        tickLower: selected.tickLower,
        tickUpper: selected.tickUpper,
        liquidity: selected.liquidity + 1n,
        wethIsCurrency0: true,
      }),
    ).toBeGreaterThan(selected.selectedBudgetWeth);
  });

  it("rejects non-increasing ranges at the exported math boundary", () => {
    expect(() =>
      wethConsumptionForLiquidity({
        tickLower: 60,
        tickUpper: 0,
        liquidity: 1n << 100n,
        wethIsCurrency0: false,
      }),
    ).toThrow("increasing tick range");
  });

  it("waits below the minimum queue and clips an aspirational target to the hard maximum", () => {
    expect(
      plan({
        availableWeth: DEFAULT_POL_BUDGET_POLICY.minimumQueueWeth - 1n,
      }),
    ).toMatchObject({
      status: "not-eligible",
      reason: "below-minimum-queue",
      selectedBudgetWeth: 0n,
      estimatedCyclesRemaining: 0n,
    });

    const clipped = readyPlan(
      plan({
        availableWeth: WETH,
        policy: {
          minimumQueueWeth: WETH / 100n,
          targetWethPerCycle: WETH / 10n,
          maximumWethPerCycle: WETH / 20n,
        },
      }),
    );
    expect(clipped.selectedBudgetWeth).toBe(WETH / 20n);
    expect(clipped.maximumWeth).toBe(WETH / 20n);
  });

  it("fails closed at unavailable tick boundaries and rejects extreme-price dust", () => {
    expect(plan({ currentTick: 887_272 })).toMatchObject({
      status: "not-eligible",
      reason: "range-unavailable",
    });
    expect(
      plan({ currentTick: -887_272, wethIsCurrency0: false }),
    ).toMatchObject({
      status: "not-eligible",
      reason: "range-unavailable",
    });
    expect(plan({ currentTick: -887_272 })).toMatchObject({
      status: "not-eligible",
      reason: "dust-consumption",
    });
    expect(
      plan({ currentTick: 887_272, wethIsCurrency0: false }),
    ).toMatchObject({
      status: "not-eligible",
      reason: "dust-consumption",
    });
  });

  it("serializes complete economic evidence for every skip reason", () => {
    const skipped = [
      plan({
        availableWeth: DEFAULT_POL_BUDGET_POLICY.minimumQueueWeth - 1n,
      }),
      plan({ currentTick: 887_272 }),
      plan({ currentTick: -887_272 }),
      plan({
        currentTick: 800_000,
        availableWeth: 100n * WETH,
        policy: {
          minimumQueueWeth: 1n,
          targetWethPerCycle: 100n * WETH,
          maximumWethPerCycle: 100n * WETH,
        },
      }),
    ];
    expect(
      skipped.map((candidate) =>
        candidate.status === "not-eligible" ? candidate.reason : "ready",
      ),
    ).toEqual([
      "below-minimum-queue",
      "range-unavailable",
      "dust-consumption",
      "rounding-tolerance",
    ]);
    for (const candidate of skipped) {
      const serialized = JSON.parse(
        JSON.stringify(candidate, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ) as Record<string, unknown>;
      expect(Object.keys(serialized)).toEqual(
        expect.arrayContaining([
          "tickLower",
          "tickUpper",
          "liquidity",
          "expectedConsumptionWeth",
          "estimatedRemainderWeth",
          "budgetRemainderWeth",
          "roundingToleranceWeth",
          "simulationToleranceWeth",
        ]),
      );
      expect(serialized.liquidity).toEqual(expect.any(String));
      expect(serialized.expectedConsumptionWeth).toEqual(expect.any(String));
      expect(serialized.estimatedRemainderWeth).toEqual(expect.any(String));
    }
  });

  it("reduces the audited live queue to two meaningful cycles and holds the sub-threshold remainder", () => {
    const first = readyPlan(plan());
    expect(first.availableWeth).toBe(51_969_758_100_000_000n);
    expect(first.expectedConsumptionWeth).toBe(25_000_000_000_000_000n);
    expect(first.estimatedRemainderWeth).toBe(26_969_758_100_000_000n);
    expect(first.estimatedCyclesRemaining).toBe(2n);

    const second = readyPlan(
      plan({ availableWeth: first.estimatedRemainderWeth }),
    );
    expect(second.estimatedCyclesRemaining).toBe(1n);
    expect(
      plan({ availableWeth: second.estimatedRemainderWeth }),
    ).toMatchObject({
      status: "not-eligible",
      reason: "below-minimum-queue",
      availableWeth: 1_969_758_100_000_000n,
      estimatedCyclesRemaining: 0n,
    });
  });

  it("accepts only a meaningful simulated consumption within the planned budget and tolerance", () => {
    const selected = readyPlan(plan({ currentTick: -1 }));

    expect(
      validatePolSimulation(selected, selected.expectedConsumptionWeth),
    ).toBe(selected.expectedConsumptionWeth);
    expect(() => validatePolSimulation(selected, 1n)).toThrow(
      "meaningful-cycle threshold",
    );
    expect(() =>
      validatePolSimulation(selected, selected.selectedBudgetWeth + 1n),
    ).toThrow("selected WETH budget");
    expect(() =>
      validatePolSimulation(
        selected,
        selected.expectedConsumptionWeth -
          selected.simulationToleranceWeth -
          1n,
      ),
    ).toThrow("simulation tolerance");
  });

  it("validates every policy bound before planning", () => {
    expect(validatePolBudgetPolicy(DEFAULT_POL_BUDGET_POLICY)).toEqual(
      DEFAULT_POL_BUDGET_POLICY,
    );
    expect(() =>
      validatePolBudgetPolicy({
        ...DEFAULT_POL_BUDGET_POLICY,
        minimumQueueWeth: 0n,
      }),
    ).toThrow("minimum queue");
    expect(() =>
      validatePolBudgetPolicy({
        ...DEFAULT_POL_BUDGET_POLICY,
        targetWethPerCycle: 1n,
      }),
    ).toThrow("target");
    expect(() =>
      validatePolBudgetPolicy({
        ...DEFAULT_POL_BUDGET_POLICY,
        maximumWethPerCycle: 1n,
      }),
    ).toThrow("maximum");
  });
});
