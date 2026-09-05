export const MINIMUM_REWARD_EPOCH_WETH = 40_000_000_000_000_000n;
export const MINIMUM_REWARD_EPOCH_INTERVAL = 60n;
export const MAXIMUM_TRACK_EXECUTION_WETH = 10_000_000_000_000_000_000n;
export const BASIS_POINTS_DENOMINATOR = 10_000n;
/** Matches the operator's OPERATOR_MINIMUM_OUTPUT_BPS default. */
export const DEFAULT_MINIMUM_OUTPUT_BPS = 9_900;

export interface RewardEpochState {
  readonly configurationSealed: boolean;
  readonly paused: boolean;
  readonly rewardEpochCount: bigint;
  readonly lastRewardEpochAt: bigint;
  readonly rewardPotWeth: bigint;
  readonly currentTimestamp: bigint;
}

export const nextRewardEpochAt = (state: RewardEpochState): bigint =>
  state.rewardEpochCount === 0n
    ? 0n
    : state.lastRewardEpochAt + MINIMUM_REWARD_EPOCH_INTERVAL;

export const rewardEpochIsEligible = (state: RewardEpochState): boolean =>
  state.configurationSealed &&
  !state.paused &&
  state.rewardPotWeth >= MINIMUM_REWARD_EPOCH_WETH &&
  state.currentTimestamp >= nextRewardEpochAt(state);

export const trackExecutionInput = (queuedWeth: bigint): bigint =>
  queuedWeth > MAXIMUM_TRACK_EXECUTION_WETH
    ? MAXIMUM_TRACK_EXECUTION_WETH
    : queuedWeth;

export const minimumOutputFromQuote = (
  quotedOutput: bigint,
  minimumOutputBps: number,
): bigint => {
  if (!Number.isInteger(minimumOutputBps)) {
    throw new RangeError("Minimum-output basis points must be an integer");
  }
  if (minimumOutputBps < 1 || minimumOutputBps > 10_000) {
    throw new RangeError("Minimum-output basis points must be from 1 to 10000");
  }
  const minimum =
    (quotedOutput * BigInt(minimumOutputBps)) / BASIS_POINTS_DENOMINATOR;
  if (minimum === 0n) {
    throw new RangeError("The protected minimum output rounds to zero");
  }
  return minimum;
};
