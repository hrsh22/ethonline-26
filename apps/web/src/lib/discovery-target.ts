import { EXCHANGE_SLIPPAGE_POLICY } from "./exchange-state";

const wholeFuel = 10n ** 18n;

/** Enough quoted output that the protected minimum crosses the next whole unit. */
export const discoveryTargetOutput = (fuelBalance: bigint): bigint => {
  const remaining = wholeFuel - (fuelBalance % wholeFuel);
  const denominator = 10_000n - BigInt(EXCHANGE_SLIPPAGE_POLICY.toleranceBps);
  return (remaining * 10_000n + denominator - 1n) / denominator;
};
