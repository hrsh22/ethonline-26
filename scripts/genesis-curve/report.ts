import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import {
  modelGenesisCurve,
  type GenesisCurveModel,
} from "@orbit/protocol/genesis-curve";

import type {
  DecodedGenesisCurveConfiguration,
  GenesisCurveSensitivityInput,
} from "./configuration.ts";

const DECIMALS = 18;
const DECIMAL_SCALE = 10n ** BigInt(DECIMALS);

export interface GenesisCurveManifestCrossCheck {
  readonly chainId: number;
  readonly poolId: string;
  readonly currencyOrderMatches: boolean;
  readonly tickSpacingMatches: boolean;
  readonly openingSqrtPriceMatches: boolean;
  readonly activeLiquidityMatches: boolean;
}

export interface GenesisCurveSensitivityReport {
  readonly name: string;
  readonly openingTick: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly openingMarginalWethPerLiquidTokenX18: bigint;
  readonly openingMarginalFullyDilutedWethWei: bigint;
  readonly liquidity: bigint;
  readonly wethToBuy100LiquidTokenWei: bigint | null;
  readonly wethToBuy1000LiquidTokenWei: bigint | null;
  readonly wethToBuy4000LiquidTokenWei: bigint | null;
}

export interface GenesisCurveReport {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly statement: string;
  readonly model: GenesisCurveModel;
  readonly manifestCrossCheck: GenesisCurveManifestCrossCheck;
  readonly sensitivity: readonly GenesisCurveSensitivityReport[];
}

const checkpointWeth = (
  model: GenesisCurveModel,
  wholeLiquidToken: bigint,
): bigint | null => {
  const target = wholeLiquidToken * DECIMAL_SCALE;
  return (
    model.exactOutputLiquidToken.find(
      ({ liquidTokenOutWei }) => liquidTokenOutWei === target,
    )?.traderWethInWei ?? null
  );
};

const sensitivityReport = (
  scenario: GenesisCurveSensitivityInput,
): GenesisCurveSensitivityReport => {
  const model = modelGenesisCurve(scenario.input);
  return {
    name: scenario.name,
    openingTick: model.openingTick,
    tickLower: model.tickLower,
    tickUpper: model.tickUpper,
    openingMarginalWethPerLiquidTokenX18:
      model.openingMarginalWethPerLiquidTokenX18,
    openingMarginalFullyDilutedWethWei:
      model.openingMarginalFullyDilutedWethWei,
    liquidity: model.liquidity,
    wethToBuy100LiquidTokenWei: checkpointWeth(model, 100n),
    wethToBuy1000LiquidTokenWei: checkpointWeth(model, 1_000n),
    wethToBuy4000LiquidTokenWei: checkpointWeth(model, 4_000n),
  };
};

const manifestCrossCheck = (
  model: GenesisCurveModel,
  manifest: ProtocolDeploymentManifest,
): GenesisCurveManifestCrossCheck => {
  const liquidTokenAddress = manifest.contracts.fuelCore;
  const manifestLiquidTokenIsCurrency0 =
    manifest.canonicalPool.currency0.toLowerCase() ===
    liquidTokenAddress?.toLowerCase();
  return {
    chainId: manifest.chainId,
    poolId: manifest.canonicalPool.poolId,
    currencyOrderMatches:
      manifestLiquidTokenIsCurrency0 === model.liquidTokenIsCurrency0,
    tickSpacingMatches:
      manifest.canonicalPool.tickSpacing === model.tickSpacing,
    openingSqrtPriceMatches:
      BigInt(manifest.canonicalPool.seedSqrtPriceX96) ===
      model.openingSqrtPriceX96,
    activeLiquidityMatches:
      BigInt(manifest.canonicalPool.activeLiquidity) === model.liquidity,
  };
};

const manifestMatches = (crossCheck: GenesisCurveManifestCrossCheck): boolean =>
  crossCheck.currencyOrderMatches &&
  crossCheck.tickSpacingMatches &&
  crossCheck.openingSqrtPriceMatches &&
  crossCheck.activeLiquidityMatches;

export const assertGenesisCurveManifestCrossCheck = (
  crossCheck: GenesisCurveManifestCrossCheck,
): void => {
  if (!manifestMatches(crossCheck)) {
    throw new RangeError(
      "Genesis curve model does not match the checked Base Sepolia manifest.",
    );
  }
};

export const buildGenesisCurveReport = (
  configuration: DecodedGenesisCurveConfiguration,
  manifest: ProtocolDeploymentManifest,
): GenesisCurveReport => {
  const model = modelGenesisCurve(configuration.input);
  const crossCheck = manifestCrossCheck(model, manifest);
  return {
    schemaVersion: 1,
    name: configuration.name,
    statement:
      "This is a reference benchmark, not a current-price promise or a production launch-price decision.",
    model,
    manifestCrossCheck: crossCheck,
    sensitivity: configuration.sensitivity.map(sensitivityReport),
  };
};

const formatUnits = (value: bigint): string => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = (absolute % DECIMAL_SCALE)
    .toString()
    .padStart(DECIMALS, "0")
    .replace(/0+$/u, "");
  return `${sign}${whole}${fraction.length === 0 ? "" : `.${fraction}`}`;
};

const formatPercent = (ratioX18: bigint): string =>
  `${formatUnits(ratioX18 * 100n)}%`;

const exactOutputRows = (model: GenesisCurveModel): readonly string[] =>
  model.exactOutputLiquidToken.map(
    (scenario) =>
      `${formatUnits(scenario.liquidTokenOutWei)} FUEL | ${formatUnits(
        scenario.poolWethInWei,
      )} WETH | ${formatUnits(scenario.feeWethWei)} WETH | ${formatUnits(
        scenario.traderWethInWei,
      )} WETH | ${formatUnits(
        scenario.preFeeAverageWethPerLiquidTokenX18,
      )} WETH/FUEL | ${formatUnits(
        scenario.postFeeAverageWethPerLiquidTokenX18,
      )} WETH/FUEL | ${formatPercent(
        scenario.preFeePriceImpactX18,
      )} | ${formatPercent(
        scenario.postFeePriceImpactX18,
      )} | ${formatUnits(scenario.remainingLiquidTokenWei)} FUEL`,
  );

const exactInputRows = (model: GenesisCurveModel): readonly string[] =>
  model.exactInputWeth.map(
    (scenario) =>
      `${formatUnits(scenario.traderWethInWei)} WETH | ${formatUnits(
        scenario.feeWethWei,
      )} WETH | ${formatUnits(scenario.poolWethInWei)} WETH | ${formatUnits(
        scenario.liquidTokenOutWei,
      )} FUEL | ${formatUnits(
        scenario.preFeeAverageWethPerLiquidTokenX18,
      )} WETH/FUEL | ${formatUnits(
        scenario.postFeeAverageWethPerLiquidTokenX18,
      )} WETH/FUEL | ${formatPercent(
        scenario.preFeePriceImpactX18,
      )} | ${formatPercent(scenario.postFeePriceImpactX18)}`,
  );

const optionalWeth = (value: bigint | null): string =>
  value === null ? "not modeled" : `${formatUnits(value)} WETH`;

const sensitivityRows = (
  sensitivity: readonly GenesisCurveSensitivityReport[],
): readonly string[] =>
  sensitivity.map(
    (scenario) =>
      `${scenario.name} | ${scenario.openingTick} | [${scenario.tickLower}, ${
        scenario.tickUpper
      }] | ${formatUnits(
        scenario.openingMarginalWethPerLiquidTokenX18,
      )} WETH/FUEL | ${formatUnits(
        scenario.openingMarginalFullyDilutedWethWei,
      )} WETH | ${optionalWeth(
        scenario.wethToBuy100LiquidTokenWei,
      )} | ${optionalWeth(scenario.wethToBuy1000LiquidTokenWei)} | ${optionalWeth(
        scenario.wethToBuy4000LiquidTokenWei,
      )}`,
  );

const manifestComparison = (
  crossCheck: GenesisCurveManifestCrossCheck,
): string =>
  manifestMatches(crossCheck)
    ? `${crossCheck.poolId} (currency order, tick spacing, opening sqrt price, and active liquidity all match)`
    : `${crossCheck.poolId} (scenario differs from the checked deployment; inspect the JSON match flags)`;

export const renderGenesisCurveReport = (
  report: GenesisCurveReport,
): string => {
  const model = report.model;
  return [
    `Genesis Liquidity curve: ${report.name}`,
    report.statement,
    "",
    `Opening tick/range: ${model.openingTick} / [${model.tickLower}, ${model.tickUpper}]`,
    `Currency order: ${model.liquidTokenIsCurrency0 ? "FUEL/WETH" : "WETH/FUEL"}`,
    `Opening marginal WETH/FUEL: ${formatUnits(model.openingMarginalWethPerLiquidTokenX18)}`,
    `Opening marginal FUEL/WETH: ${formatUnits(model.openingMarginalLiquidTokenPerWethX18)}`,
    `Opening marginal fully diluted value: ${formatUnits(
      model.openingMarginalFullyDilutedWethWei,
    )} WETH`,
    `Seeded FUEL / rounding dust: ${formatUnits(
      model.seededLiquidTokenWei,
    )} / ${model.roundingDustLiquidTokenWei} wei`,
    `Liquidity: ${model.liquidity}`,
    "",
    "Exact-output FUEL checkpoints",
    "FUEL out | Cumulative WETH entering pool | WETH-side fee | Trader WETH | Average curve price | Average trader price | Curve slippage | Total fee-inclusive impact | Remaining liquid supply",
    ...exactOutputRows(model),
    "",
    "Exact-input WETH checkpoints",
    "Trader WETH | WETH-side fee | Cumulative WETH entering pool | FUEL out | Average curve price | Average trader price | Curve slippage | Total fee-inclusive impact",
    ...exactInputRows(model),
    "",
    "Sensitivity (human decision inputs)",
    "Scenario | Tick | Range | Opening marginal price | Marginal FDV | 100 FUEL | 1,000 FUEL | 4,000 FUEL",
    ...sensitivityRows(report.sensitivity),
    "",
    `Manifest comparison: ${manifestComparison(report.manifestCrossCheck)}`,
    "Production curve selection remains a human economic/product decision.",
  ].join("\n");
};

export const serializeGenesisCurveReport = (
  report: GenesisCurveReport,
): string =>
  `${JSON.stringify(
    report,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  )}\n`;
