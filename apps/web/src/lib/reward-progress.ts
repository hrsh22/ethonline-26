import { MINIMUM_REWARD_EPOCH_WETH } from "@orbit/protocol/operator-policy";

export interface RewardCycleInput {
  readonly rewardPotWeth: bigint | undefined;
  readonly nextEpochAt: bigint | undefined;
  readonly observedAt: number | undefined;
  readonly routesSealed: boolean | undefined;
  readonly converterPaused: boolean | undefined;
  readonly rewardsPaused: boolean | undefined;
}

/** Queue budgets belong to previous cycles and must never inflate this pot. */
export function rewardCycleProgress(input: RewardCycleInput) {
  const pot = input.rewardPotWeth;
  const funded =
    pot === undefined ? undefined : pot >= MINIMUM_REWARD_EPOCH_WETH;
  const remainingWeth =
    pot === undefined
      ? undefined
      : funded
        ? 0n
        : MINIMUM_REWARD_EPOCH_WETH - pot;
  const percent =
    pot === undefined
      ? undefined
      : funded
        ? 100
        : Number((pot * 10_000n) / MINIMUM_REWARD_EPOCH_WETH) / 100;
  const secondsRemaining =
    input.nextEpochAt === undefined || input.observedAt === undefined
      ? undefined
      : Math.max(0, Number(input.nextEpochAt) - input.observedAt);
  const conversion = conversionState(input);
  return {
    funded,
    remainingWeth,
    percent,
    secondsRemaining,
    conversion,
    canOpen:
      funded === true && secondsRemaining === 0 && conversion === "enabled",
  };
}

function conversionState(
  input: RewardCycleInput,
): "paused" | "unconfigured" | "unknown" | "enabled" {
  if (input.converterPaused === true || input.rewardsPaused === true)
    return "paused";
  if (input.routesSealed === false) return "unconfigured";
  if (
    input.routesSealed === undefined ||
    input.converterPaused === undefined ||
    input.rewardsPaused === undefined
  )
    return "unknown";
  return "enabled";
}
