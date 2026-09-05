import {
  amount0Delta,
  amount1Delta,
  divideRoundingUp,
  MAX_SIGNED_LIQUIDITY,
  MAX_UNISWAP_TICK,
  MIN_UNISWAP_TICK,
  Q96,
  sqrtPriceAtTick,
} from "./v4-math.js";

const Q192 = 1n << 192n;
const DECIMAL_SCALE = 10n ** 18n;
const MAX_GENESIS_ROUNDING_DUST = 2n;

export interface GenesisCurveFeePolicy {
  readonly denominator: bigint;
  readonly totalFee: bigint;
}

export interface GenesisCurveInput {
  readonly supplyLiquidTokenWei: bigint;
  readonly liquidTokenIsCurrency0: boolean;
  readonly tickSpacing: number;
  readonly openingTick: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly feePolicy: GenesisCurveFeePolicy;
  readonly exactOutputLiquidTokenWei: readonly bigint[];
  readonly exactInputWethWei: readonly bigint[];
}

export interface RationalValue {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface BuyScenarioBase {
  readonly liquidTokenOutWei: bigint;
  readonly poolWethInWei: bigint;
  readonly feeWethWei: bigint;
  readonly traderWethInWei: bigint;
  readonly remainingLiquidTokenWei: bigint;
  readonly endSqrtPriceX96: bigint;
  readonly endMarginalWethPerLiquidToken: RationalValue;
  readonly endMarginalWethPerLiquidTokenX18: bigint;
  readonly preFeeAverageWethPerLiquidToken: RationalValue;
  readonly preFeeAverageWethPerLiquidTokenX18: bigint;
  readonly postFeeAverageWethPerLiquidToken: RationalValue;
  readonly postFeeAverageWethPerLiquidTokenX18: bigint;
  readonly preFeePriceImpactX18: bigint;
  readonly postFeePriceImpactX18: bigint;
}

export interface ExactOutputLiquidTokenScenario extends BuyScenarioBase {
  readonly type: "exact-output-liquid-token";
  readonly hookFeeBaseWethWei: bigint;
}

export interface ExactInputWethScenario extends BuyScenarioBase {
  readonly type: "exact-input-weth";
}

export interface GenesisCurveModel {
  readonly supplyLiquidTokenWei: bigint;
  readonly liquidTokenIsCurrency0: boolean;
  readonly tickSpacing: number;
  readonly openingTick: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly openingSqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly seededLiquidTokenWei: bigint;
  readonly roundingDustLiquidTokenWei: bigint;
  readonly openingMarginalWethPerLiquidToken: RationalValue;
  readonly openingMarginalWethPerLiquidTokenX18: bigint;
  readonly openingMarginalLiquidTokenPerWeth: RationalValue;
  readonly openingMarginalLiquidTokenPerWethX18: bigint;
  readonly openingMarginalFullyDilutedWethWei: bigint;
  readonly feePolicy: GenesisCurveFeePolicy;
  readonly exactOutputLiquidToken: readonly ExactOutputLiquidTokenScenario[];
  readonly exactInputWeth: readonly ExactInputWethScenario[];
}

const scaleRationalToX18 = (value: RationalValue): bigint =>
  (value.numerator * DECIMAL_SCALE) / value.denominator;

const liquidityForLiquidToken = (
  input: GenesisCurveInput,
  sqrtLower: bigint,
  sqrtUpper: bigint,
): bigint => {
  const priceDistance = sqrtUpper - sqrtLower;
  if (!input.liquidTokenIsCurrency0) {
    return (input.supplyLiquidTokenWei * Q96) / priceDistance;
  }
  const intermediate = (sqrtLower * sqrtUpper) / Q96;
  return (input.supplyLiquidTokenWei * intermediate) / priceDistance;
};

const seededLiquidTokenAmount = (
  liquidTokenIsCurrency0: boolean,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  liquidity: bigint,
): bigint =>
  liquidTokenIsCurrency0
    ? amount0Delta(sqrtLower, sqrtUpper, liquidity, true)
    : amount1Delta(sqrtLower, sqrtUpper, liquidity, true);

const wethPerLiquidTokenAtSqrtPrice = (
  sqrtPriceX96: bigint,
  liquidTokenIsCurrency0: boolean,
): RationalValue => {
  const squaredPrice = sqrtPriceX96 * sqrtPriceX96;
  return liquidTokenIsCurrency0
    ? { numerator: squaredPrice, denominator: Q192 }
    : { numerator: Q192, denominator: squaredPrice };
};

const inverse = (value: RationalValue): RationalValue => ({
  numerator: value.denominator,
  denominator: value.numerator,
});

const relativeIncreaseX18 = (
  observed: RationalValue,
  baseline: RationalValue,
): bigint => {
  const observedCross = observed.numerator * baseline.denominator;
  const baselineCross = baseline.numerator * observed.denominator;
  if (observedCross <= baselineCross) return 0n;
  return ((observedCross - baselineCross) * DECIMAL_SCALE) / baselineCross;
};

const nextPriceFromExactLiquidTokenOutput = (
  currentPrice: bigint,
  liquidity: bigint,
  liquidTokenOutWei: bigint,
  liquidTokenIsCurrency0: boolean,
): bigint => {
  if (!liquidTokenIsCurrency0) {
    return currentPrice - divideRoundingUp(liquidTokenOutWei * Q96, liquidity);
  }
  const liquidityX96 = liquidity << 96n;
  const denominator = liquidityX96 - liquidTokenOutWei * currentPrice;
  if (denominator <= 0n) {
    throw new RangeError("Exact-output trade exceeds the active curve.");
  }
  return divideRoundingUp(liquidityX96 * currentPrice, denominator);
};

const nextPriceFromExactWethInput = (
  currentPrice: bigint,
  liquidity: bigint,
  poolWethInWei: bigint,
  liquidTokenIsCurrency0: boolean,
): bigint => {
  if (liquidTokenIsCurrency0) {
    return currentPrice + (poolWethInWei * Q96) / liquidity;
  }
  const liquidityX96 = liquidity << 96n;
  return divideRoundingUp(
    liquidityX96 * currentPrice,
    liquidityX96 + poolWethInWei * currentPrice,
  );
};

const wethInputDelta = (
  currentPrice: bigint,
  nextPrice: bigint,
  liquidity: bigint,
  liquidTokenIsCurrency0: boolean,
): bigint =>
  liquidTokenIsCurrency0
    ? amount1Delta(currentPrice, nextPrice, liquidity, true)
    : amount0Delta(nextPrice, currentPrice, liquidity, true);

const liquidTokenOutputDelta = (
  currentPrice: bigint,
  nextPrice: bigint,
  liquidity: bigint,
  liquidTokenIsCurrency0: boolean,
): bigint =>
  liquidTokenIsCurrency0
    ? amount0Delta(currentPrice, nextPrice, liquidity, false)
    : amount1Delta(nextPrice, currentPrice, liquidity, false);

const feeAmount = (wethVolume: bigint, policy: GenesisCurveFeePolicy): bigint =>
  (wethVolume * policy.totalFee) / policy.denominator;

const grossWethVolume = (
  netWeth: bigint,
  policy: GenesisCurveFeePolicy,
): bigint =>
  (netWeth * policy.denominator) / (policy.denominator - policy.totalFee);

const validateScenarioPrice = (
  nextPrice: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
): void => {
  if (nextPrice <= sqrtLower || nextPrice >= sqrtUpper) {
    throw new RangeError("Trade exceeds the active Genesis Liquidity curve.");
  }
};

const scenarioEvidence = ({
  liquidTokenOutWei,
  poolWethInWei,
  feeWethWei,
  traderWethInWei,
  seededLiquidTokenWei,
  endSqrtPriceX96,
  liquidTokenIsCurrency0,
  openingMarginalWethPerLiquidToken,
}: {
  readonly liquidTokenOutWei: bigint;
  readonly poolWethInWei: bigint;
  readonly feeWethWei: bigint;
  readonly traderWethInWei: bigint;
  readonly seededLiquidTokenWei: bigint;
  readonly endSqrtPriceX96: bigint;
  readonly liquidTokenIsCurrency0: boolean;
  readonly openingMarginalWethPerLiquidToken: RationalValue;
}): BuyScenarioBase => {
  const endMarginalWethPerLiquidToken = wethPerLiquidTokenAtSqrtPrice(
    endSqrtPriceX96,
    liquidTokenIsCurrency0,
  );
  const preFeeAverageWethPerLiquidToken = {
    numerator: poolWethInWei,
    denominator: liquidTokenOutWei,
  };
  const postFeeAverageWethPerLiquidToken = {
    numerator: traderWethInWei,
    denominator: liquidTokenOutWei,
  };
  return {
    liquidTokenOutWei,
    poolWethInWei,
    feeWethWei,
    traderWethInWei,
    remainingLiquidTokenWei: seededLiquidTokenWei - liquidTokenOutWei,
    endSqrtPriceX96,
    endMarginalWethPerLiquidToken,
    endMarginalWethPerLiquidTokenX18: scaleRationalToX18(
      endMarginalWethPerLiquidToken,
    ),
    preFeeAverageWethPerLiquidToken,
    preFeeAverageWethPerLiquidTokenX18: scaleRationalToX18(
      preFeeAverageWethPerLiquidToken,
    ),
    postFeeAverageWethPerLiquidToken,
    postFeeAverageWethPerLiquidTokenX18: scaleRationalToX18(
      postFeeAverageWethPerLiquidToken,
    ),
    preFeePriceImpactX18: relativeIncreaseX18(
      preFeeAverageWethPerLiquidToken,
      openingMarginalWethPerLiquidToken,
    ),
    postFeePriceImpactX18: relativeIncreaseX18(
      postFeeAverageWethPerLiquidToken,
      openingMarginalWethPerLiquidToken,
    ),
  };
};

const exactOutputScenario = ({
  liquidTokenOutWei,
  input,
  openingSqrtPriceX96,
  sqrtLower,
  sqrtUpper,
  liquidity,
  seededLiquidTokenWei,
  openingMarginalWethPerLiquidToken,
}: ScenarioContext & {
  readonly liquidTokenOutWei: bigint;
}): ExactOutputLiquidTokenScenario => {
  if (liquidTokenOutWei <= 0n || liquidTokenOutWei >= seededLiquidTokenWei) {
    throw new RangeError(
      "Exact-output Liquid Token amount must be below the liquid supply.",
    );
  }
  const endSqrtPriceX96 = nextPriceFromExactLiquidTokenOutput(
    openingSqrtPriceX96,
    liquidity,
    liquidTokenOutWei,
    input.liquidTokenIsCurrency0,
  );
  validateScenarioPrice(endSqrtPriceX96, sqrtLower, sqrtUpper);
  const poolWethInWei = wethInputDelta(
    openingSqrtPriceX96,
    endSqrtPriceX96,
    liquidity,
    input.liquidTokenIsCurrency0,
  );
  const hookFeeBaseWethWei = grossWethVolume(poolWethInWei, input.feePolicy);
  const feeWethWei = feeAmount(hookFeeBaseWethWei, input.feePolicy);
  const traderWethInWei = poolWethInWei + feeWethWei;
  return {
    type: "exact-output-liquid-token",
    hookFeeBaseWethWei,
    ...scenarioEvidence({
      liquidTokenOutWei,
      poolWethInWei,
      feeWethWei,
      traderWethInWei,
      seededLiquidTokenWei,
      endSqrtPriceX96,
      liquidTokenIsCurrency0: input.liquidTokenIsCurrency0,
      openingMarginalWethPerLiquidToken,
    }),
  };
};

interface ScenarioContext {
  readonly input: GenesisCurveInput;
  readonly openingSqrtPriceX96: bigint;
  readonly sqrtLower: bigint;
  readonly sqrtUpper: bigint;
  readonly liquidity: bigint;
  readonly seededLiquidTokenWei: bigint;
  readonly openingMarginalWethPerLiquidToken: RationalValue;
}

const exactInputScenario = ({
  traderWethInWei,
  input,
  openingSqrtPriceX96,
  sqrtLower,
  sqrtUpper,
  liquidity,
  seededLiquidTokenWei,
  openingMarginalWethPerLiquidToken,
}: ScenarioContext & {
  readonly traderWethInWei: bigint;
}): ExactInputWethScenario => {
  if (traderWethInWei <= 0n) {
    throw new RangeError("Exact-input WETH must be positive.");
  }
  const feeWethWei = feeAmount(traderWethInWei, input.feePolicy);
  const poolWethInWei = traderWethInWei - feeWethWei;
  const endSqrtPriceX96 = nextPriceFromExactWethInput(
    openingSqrtPriceX96,
    liquidity,
    poolWethInWei,
    input.liquidTokenIsCurrency0,
  );
  validateScenarioPrice(endSqrtPriceX96, sqrtLower, sqrtUpper);
  const liquidTokenOutWei = liquidTokenOutputDelta(
    openingSqrtPriceX96,
    endSqrtPriceX96,
    liquidity,
    input.liquidTokenIsCurrency0,
  );
  return {
    type: "exact-input-weth",
    ...scenarioEvidence({
      liquidTokenOutWei,
      poolWethInWei,
      feeWethWei,
      traderWethInWei,
      seededLiquidTokenWei,
      endSqrtPriceX96,
      liquidTokenIsCurrency0: input.liquidTokenIsCurrency0,
      openingMarginalWethPerLiquidToken,
    }),
  };
};

const validateTick = (tick: number, label: string): void => {
  if (
    !Number.isInteger(tick) ||
    tick < MIN_UNISWAP_TICK ||
    tick > MAX_UNISWAP_TICK
  ) {
    throw new RangeError(`${label} is outside Uniswap tick bounds.`);
  }
};

const validateGenesisRange = (input: GenesisCurveInput): void => {
  if (input.tickLower >= input.tickUpper) {
    throw new RangeError("Genesis Liquidity range must be increasing.");
  }
  if (
    input.tickLower % input.tickSpacing !== 0 ||
    input.tickUpper % input.tickSpacing !== 0
  ) {
    throw new RangeError("Genesis Liquidity range must be tick-aligned.");
  }
  const expectedBoundary = input.liquidTokenIsCurrency0
    ? input.tickLower
    : input.tickUpper;
  if (input.openingTick !== expectedBoundary) {
    throw new RangeError(
      "Opening tick must be the one-sided Liquid Token range boundary.",
    );
  }
};

const validateFeePolicy = (policy: GenesisCurveFeePolicy): void => {
  if (policy.denominator <= 0n) {
    throw new RangeError("Canonical WETH fee denominator must be positive.");
  }
  if (policy.totalFee < 0n || policy.totalFee >= policy.denominator) {
    throw new RangeError("Canonical WETH fee must be below its denominator.");
  }
};

const validateGenesisCurveInput = (input: GenesisCurveInput): void => {
  validateTick(input.openingTick, "Opening tick");
  validateTick(input.tickLower, "Lower tick");
  validateTick(input.tickUpper, "Upper tick");
  if (
    !Number.isInteger(input.tickSpacing) ||
    input.tickSpacing <= 0 ||
    input.tickSpacing > 32_767
  ) {
    throw new RangeError("Tick spacing must be a positive integer.");
  }
  validateGenesisRange(input);
  if (input.supplyLiquidTokenWei <= 0n) {
    throw new RangeError("Genesis Liquid Token supply must be positive.");
  }
  validateFeePolicy(input.feePolicy);
};

export const modelGenesisCurve = (
  input: GenesisCurveInput,
): GenesisCurveModel => {
  validateGenesisCurveInput(input);
  const sqrtLower = sqrtPriceAtTick(input.tickLower);
  const sqrtUpper = sqrtPriceAtTick(input.tickUpper);
  const openingSqrtPriceX96 = sqrtPriceAtTick(input.openingTick);
  const liquidity = liquidityForLiquidToken(input, sqrtLower, sqrtUpper);
  if (liquidity <= 0n || liquidity > MAX_SIGNED_LIQUIDITY) {
    throw new RangeError(
      "Genesis Liquidity is outside the signed int128 bound.",
    );
  }
  const seededLiquidTokenWei = seededLiquidTokenAmount(
    input.liquidTokenIsCurrency0,
    sqrtLower,
    sqrtUpper,
    liquidity,
  );
  const roundingDustLiquidTokenWei =
    input.supplyLiquidTokenWei - seededLiquidTokenWei;
  if (
    roundingDustLiquidTokenWei < 0n ||
    roundingDustLiquidTokenWei > MAX_GENESIS_ROUNDING_DUST
  ) {
    throw new RangeError(
      "Genesis Liquid Token rounding dust exceeds the contract bound.",
    );
  }
  const openingMarginalWethPerLiquidToken = wethPerLiquidTokenAtSqrtPrice(
    openingSqrtPriceX96,
    input.liquidTokenIsCurrency0,
  );
  const openingMarginalLiquidTokenPerWeth = inverse(
    openingMarginalWethPerLiquidToken,
  );
  const context = {
    input,
    openingSqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    liquidity,
    seededLiquidTokenWei,
    openingMarginalWethPerLiquidToken,
  };
  return {
    supplyLiquidTokenWei: input.supplyLiquidTokenWei,
    liquidTokenIsCurrency0: input.liquidTokenIsCurrency0,
    tickSpacing: input.tickSpacing,
    openingTick: input.openingTick,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    openingSqrtPriceX96,
    liquidity,
    seededLiquidTokenWei,
    roundingDustLiquidTokenWei,
    openingMarginalWethPerLiquidToken,
    openingMarginalWethPerLiquidTokenX18: scaleRationalToX18(
      openingMarginalWethPerLiquidToken,
    ),
    openingMarginalLiquidTokenPerWeth,
    openingMarginalLiquidTokenPerWethX18: scaleRationalToX18(
      openingMarginalLiquidTokenPerWeth,
    ),
    openingMarginalFullyDilutedWethWei:
      (input.supplyLiquidTokenWei *
        openingMarginalWethPerLiquidToken.numerator) /
      openingMarginalWethPerLiquidToken.denominator,
    feePolicy: input.feePolicy,
    exactOutputLiquidToken: input.exactOutputLiquidTokenWei.map(
      (liquidTokenOutWei) =>
        exactOutputScenario({ ...context, liquidTokenOutWei }),
    ),
    exactInputWeth: input.exactInputWethWei.map((traderWethInWei) =>
      exactInputScenario({ ...context, traderWethInWei }),
    ),
  };
};
