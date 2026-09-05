import {
  amount0Delta,
  amount1Delta,
  MAX_SIGNED_LIQUIDITY,
  MAX_UNISWAP_TICK,
  MIN_UNISWAP_TICK,
  sqrtPriceAtTick,
} from "./v4-math.js";

const LIQUIDITY_SEARCH_STEPS = 127;
const SIMULATION_CONSUMPTION_TOLERANCE_WETH = 0n;

export interface PolBudgetPolicy {
  readonly minimumQueueWeth: bigint;
  readonly targetWethPerCycle: bigint;
  readonly maximumWethPerCycle: bigint;
}

export const DEFAULT_POL_BUDGET_POLICY: PolBudgetPolicy = {
  minimumQueueWeth: 5_000_000_000_000_000n,
  targetWethPerCycle: 25_000_000_000_000_000n,
  maximumWethPerCycle: 50_000_000_000_000_000n,
};

export interface PolPlanningInput {
  readonly currentTick: number;
  readonly tickSpacing: number;
  readonly wethIsCurrency0: boolean;
  readonly availableWeth: bigint;
  readonly currentTimestamp: bigint;
  readonly policy?: PolBudgetPolicy;
}

interface PolPlanEvidence {
  readonly availableWeth: bigint;
  readonly selectedBudgetWeth: bigint;
  readonly estimatedCyclesRemaining: bigint;
  readonly minimumQueueWeth: bigint;
  readonly targetWethPerCycle: bigint;
  readonly maximumWethPerCycle: bigint;
  readonly roundingToleranceWeth: bigint;
  readonly simulationToleranceWeth: bigint;
}

export interface ReadyPolCyclePlan extends PolPlanEvidence {
  readonly status: "ready";
  readonly type: "execute-pol";
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  readonly maximumWeth: bigint;
  readonly deadline: bigint;
  readonly expectedConsumptionWeth: bigint;
  readonly estimatedRemainderWeth: bigint;
  readonly budgetRemainderWeth: bigint;
}

export type PolSkipReason =
  | "below-minimum-queue"
  | "range-unavailable"
  | "dust-consumption"
  | "rounding-tolerance";

export interface SkippedPolCyclePlan extends PolPlanEvidence {
  readonly status: "not-eligible";
  readonly reason: PolSkipReason;
  readonly message: string;
  readonly tickLower: number | null;
  readonly tickUpper: number | null;
  readonly liquidity: bigint;
  readonly expectedConsumptionWeth: bigint;
  readonly estimatedRemainderWeth: bigint;
  readonly budgetRemainderWeth: bigint;
}

export type PolCyclePlan = ReadyPolCyclePlan | SkippedPolCyclePlan;

const absoluteDifference = (left: bigint, right: bigint): bigint =>
  left >= right ? left - right : right - left;

const minimum = (...values: readonly bigint[]): bigint =>
  values.reduce((selected, value) => (value < selected ? value : selected));

const estimateMeaningfulCycles = (
  availableWeth: bigint,
  cycleBudgetWeth: bigint,
  minimumQueueWeth: bigint,
): bigint => {
  if (availableWeth < minimumQueueWeth) return 0n;
  const completeCycles = availableWeth / cycleBudgetWeth;
  const remainderWeth = availableWeth % cycleBudgetWeth;
  return completeCycles + (remainderWeth >= minimumQueueWeth ? 1n : 0n);
};

const floorToSpacing = (tick: number, spacing: number): number => {
  const remainder = tick % spacing;
  return remainder < 0 ? tick - remainder - spacing : tick - remainder;
};

export const validatePolBudgetPolicy = (
  policy: PolBudgetPolicy,
): PolBudgetPolicy => {
  if (policy.minimumQueueWeth <= 0n) {
    throw new RangeError("POL minimum queue WETH must be positive");
  }
  if (policy.targetWethPerCycle < policy.minimumQueueWeth) {
    throw new RangeError("POL target WETH must meet the minimum queue");
  }
  if (policy.maximumWethPerCycle < policy.minimumQueueWeth) {
    throw new RangeError("POL maximum WETH must meet the minimum queue");
  }
  return policy;
};

const validatePlanningInput = (input: PolPlanningInput): void => {
  if (!Number.isInteger(input.tickSpacing) || input.tickSpacing <= 0) {
    throw new RangeError("Canonical tick spacing must be a positive integer.");
  }
  if (
    !Number.isInteger(input.currentTick) ||
    input.currentTick < MIN_UNISWAP_TICK ||
    input.currentTick > MAX_UNISWAP_TICK
  ) {
    throw new RangeError("Canonical current tick is outside Uniswap bounds.");
  }
  if (input.availableWeth < 0n || input.currentTimestamp < 0n) {
    throw new RangeError("POL queue and timestamp cannot be negative.");
  }
};

export const wethConsumptionForLiquidity = ({
  tickLower,
  tickUpper,
  liquidity,
  wethIsCurrency0,
}: {
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  readonly wethIsCurrency0: boolean;
}): bigint => {
  if (liquidity <= 0n || liquidity > MAX_SIGNED_LIQUIDITY) {
    throw new RangeError("POL liquidity is outside the signed int128 bound.");
  }
  if (tickLower >= tickUpper) {
    throw new RangeError(
      "POL liquidity math requires an increasing tick range.",
    );
  }
  const sqrtLower = sqrtPriceAtTick(tickLower);
  const sqrtUpper = sqrtPriceAtTick(tickUpper);
  return wethIsCurrency0
    ? amount0Delta(sqrtLower, sqrtUpper, liquidity, true)
    : amount1Delta(sqrtLower, sqrtUpper, liquidity, true);
};

const wethOnlyRange = (
  currentTick: number,
  tickSpacing: number,
  wethIsCurrency0: boolean,
): { readonly tickLower: number; readonly tickUpper: number } | undefined => {
  const rangeWidth = tickSpacing * 10;
  const minimumUsableTick = -floorToSpacing(-MIN_UNISWAP_TICK, tickSpacing);
  const maximumUsableTick = floorToSpacing(MAX_UNISWAP_TICK, tickSpacing);
  const currentFloor = floorToSpacing(currentTick, tickSpacing);
  const tickLower = wethIsCurrency0
    ? currentFloor + tickSpacing
    : currentFloor - rangeWidth;
  const tickUpper = wethIsCurrency0 ? tickLower + rangeWidth : currentFloor;
  return tickLower < minimumUsableTick || tickUpper > maximumUsableTick
    ? undefined
    : { tickLower, tickUpper };
};

const greatestSafeLiquidity = (
  budget: bigint,
  range: { readonly tickLower: number; readonly tickUpper: number },
  wethIsCurrency0: boolean,
): bigint => {
  const consumption = (liquidity: bigint) =>
    wethConsumptionForLiquidity({ ...range, liquidity, wethIsCurrency0 });
  let lower = 1n;
  let upper = MAX_SIGNED_LIQUIDITY;
  let selected = 0n;
  for (
    let iteration = 0;
    iteration < LIQUIDITY_SEARCH_STEPS && lower <= upper;
    iteration += 1
  ) {
    const candidate = (lower + upper) >> 1n;
    if (consumption(candidate) <= budget) {
      selected = candidate;
      lower = candidate + 1n;
    } else {
      upper = candidate - 1n;
    }
  }
  return selected;
};

interface SkippedPlanEconomics {
  readonly range?: { readonly tickLower: number; readonly tickUpper: number };
  readonly liquidity?: bigint;
  readonly expectedConsumptionWeth?: bigint;
  readonly roundingToleranceWeth?: bigint;
}

const nullableRange = (
  range: SkippedPlanEconomics["range"],
): { readonly tickLower: number | null; readonly tickUpper: number | null } =>
  range === undefined ? { tickLower: null, tickUpper: null } : range;

const skippedPlan = (
  evidence: PolPlanEvidence,
  reason: PolSkipReason,
  message: string,
  {
    range,
    liquidity = 0n,
    expectedConsumptionWeth = 0n,
    roundingToleranceWeth = 0n,
  }: SkippedPlanEconomics = {},
): SkippedPolCyclePlan => {
  return {
    status: "not-eligible",
    reason,
    message,
    ...evidence,
    ...nullableRange(range),
    liquidity,
    expectedConsumptionWeth,
    estimatedRemainderWeth: evidence.availableWeth - expectedConsumptionWeth,
    budgetRemainderWeth: evidence.selectedBudgetWeth - expectedConsumptionWeth,
    roundingToleranceWeth,
  };
};

export const planWethOnlyPolCycle = (input: PolPlanningInput): PolCyclePlan => {
  validatePlanningInput(input);
  const policy = validatePolBudgetPolicy(
    input.policy ?? DEFAULT_POL_BUDGET_POLICY,
  );
  const effectiveCycleBudget = minimum(
    policy.targetWethPerCycle,
    policy.maximumWethPerCycle,
  );
  const estimatedCyclesRemaining = estimateMeaningfulCycles(
    input.availableWeth,
    effectiveCycleBudget,
    policy.minimumQueueWeth,
  );
  const baseEvidence = {
    availableWeth: input.availableWeth,
    selectedBudgetWeth: 0n,
    estimatedCyclesRemaining,
    minimumQueueWeth: policy.minimumQueueWeth,
    targetWethPerCycle: policy.targetWethPerCycle,
    maximumWethPerCycle: policy.maximumWethPerCycle,
    roundingToleranceWeth: 0n,
    simulationToleranceWeth: SIMULATION_CONSUMPTION_TOLERANCE_WETH,
  };
  if (input.availableWeth < policy.minimumQueueWeth) {
    return skippedPlan(
      baseEvidence,
      "below-minimum-queue",
      "Available POL WETH is below the configured minimum queue threshold.",
    );
  }
  const selectedBudgetWeth = minimum(input.availableWeth, effectiveCycleBudget);
  const evidence = { ...baseEvidence, selectedBudgetWeth };
  const range = wethOnlyRange(
    input.currentTick,
    input.tickSpacing,
    input.wethIsCurrency0,
  );
  if (range === undefined) {
    return skippedPlan(
      evidence,
      "range-unavailable",
      "A WETH-only POL range is unavailable at the current market tick.",
    );
  }
  const liquidity = greatestSafeLiquidity(
    selectedBudgetWeth,
    range,
    input.wethIsCurrency0,
  );
  if (liquidity === 0n) {
    return skippedPlan(
      evidence,
      "dust-consumption",
      "The selected WETH budget cannot fund one safe liquidity unit.",
      { range },
    );
  }
  const expectedConsumptionWeth = wethConsumptionForLiquidity({
    ...range,
    liquidity,
    wethIsCurrency0: input.wethIsCurrency0,
  });
  const nextConsumptionWeth =
    liquidity === MAX_SIGNED_LIQUIDITY
      ? undefined
      : wethConsumptionForLiquidity({
          ...range,
          liquidity: liquidity + 1n,
          wethIsCurrency0: input.wethIsCurrency0,
        });
  const roundingToleranceWeth =
    nextConsumptionWeth === undefined
      ? 0n
      : nextConsumptionWeth - expectedConsumptionWeth - 1n;
  if (expectedConsumptionWeth < policy.minimumQueueWeth) {
    return skippedPlan(
      evidence,
      "dust-consumption",
      "Expected WETH consumption is below the meaningful-cycle threshold.",
      {
        range,
        liquidity,
        expectedConsumptionWeth,
        roundingToleranceWeth,
      },
    );
  }
  const budgetRemainderWeth = selectedBudgetWeth - expectedConsumptionWeth;
  if (budgetRemainderWeth > roundingToleranceWeth) {
    return skippedPlan(
      evidence,
      "rounding-tolerance",
      "Greatest safe liquidity leaves more WETH than the rounding tolerance.",
      {
        range,
        liquidity,
        expectedConsumptionWeth,
        roundingToleranceWeth,
      },
    );
  }
  return {
    status: "ready",
    type: "execute-pol",
    ...evidence,
    ...range,
    liquidity,
    maximumWeth: selectedBudgetWeth,
    deadline: input.currentTimestamp + 300n,
    expectedConsumptionWeth,
    estimatedRemainderWeth: input.availableWeth - expectedConsumptionWeth,
    budgetRemainderWeth,
    roundingToleranceWeth,
  };
};

export const validatePolSimulation = (
  plan: ReadyPolCyclePlan,
  simulatedConsumptionWeth: bigint,
): bigint => {
  if (simulatedConsumptionWeth < plan.minimumQueueWeth) {
    throw new RangeError(
      "Simulated POL consumption is below the meaningful-cycle threshold.",
    );
  }
  if (simulatedConsumptionWeth > plan.selectedBudgetWeth) {
    throw new RangeError(
      "Simulated POL consumption exceeds the selected WETH budget.",
    );
  }
  if (
    absoluteDifference(simulatedConsumptionWeth, plan.expectedConsumptionWeth) >
    plan.simulationToleranceWeth
  ) {
    throw new RangeError(
      "Simulated POL consumption exceeds the planned simulation tolerance.",
    );
  }
  return simulatedConsumptionWeth;
};
