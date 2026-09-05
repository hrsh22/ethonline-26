export const MIN_UNISWAP_TICK = -887_272;
export const MAX_UNISWAP_TICK = 887_272;
export const Q96 = 1n << 96n;
export const MAX_SIGNED_LIQUIDITY = (1n << 127n) - 1n;

const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;

// Ported from Uniswap v4-core TickMath.getSqrtPriceAtTick. Each multiplier is
// the audited Q128.128 inverse sqrt-price constant for the corresponding bit.
const TICK_PRICE_MULTIPLIERS = [
  [0x1n, 0xfffcb933bd6fad37aa2d162d1a594001n],
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
] as const;

export const divideRoundingUp = (
  numerator: bigint,
  denominator: bigint,
): bigint => {
  if (denominator <= 0n) {
    throw new RangeError("Division requires a positive denominator.");
  }
  return (numerator + denominator - 1n) / denominator;
};

export const amount0Delta = (
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint => {
  const lower = sqrtPriceA < sqrtPriceB ? sqrtPriceA : sqrtPriceB;
  const upper = sqrtPriceA < sqrtPriceB ? sqrtPriceB : sqrtPriceA;
  if (lower <= 0n) {
    throw new RangeError("Currency0 delta requires a positive price.");
  }
  const numerator = (liquidity << 96n) * (upper - lower);
  const dividedByUpper = roundUp
    ? divideRoundingUp(numerator, upper)
    : numerator / upper;
  return roundUp
    ? divideRoundingUp(dividedByUpper, lower)
    : dividedByUpper / lower;
};

export const amount1Delta = (
  sqrtPriceA: bigint,
  sqrtPriceB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint => {
  const distance =
    sqrtPriceA >= sqrtPriceB
      ? sqrtPriceA - sqrtPriceB
      : sqrtPriceB - sqrtPriceA;
  const numerator = liquidity * distance;
  return roundUp ? divideRoundingUp(numerator, Q96) : numerator / Q96;
};

export const sqrtPriceAtTick = (tick: number): bigint => {
  if (
    !Number.isInteger(tick) ||
    tick < MIN_UNISWAP_TICK ||
    tick > MAX_UNISWAP_TICK
  ) {
    throw new RangeError("Tick is outside Uniswap bounds.");
  }
  const absoluteTick = BigInt(Math.abs(tick));
  let price = Q128;
  for (const [mask, multiplier] of TICK_PRICE_MULTIPLIERS) {
    if ((absoluteTick & mask) !== 0n) {
      price = (price * multiplier) >> 128n;
    }
  }
  if (tick > 0) price = MAX_UINT256 / price;
  return divideRoundingUp(price, 1n << 32n);
};
