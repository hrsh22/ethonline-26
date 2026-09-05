import { describe, expect, it } from "vitest";

import {
  modelGenesisCurve,
  type GenesisCurveInput,
  type ExactOutputLiquidTokenScenario,
} from "../src/genesis-curve.js";

const LIQUID_TOKEN = 10n ** 18n;
const WETH = 10n ** 18n;

const BASE_SEPOLIA_INPUT: GenesisCurveInput = {
  supplyLiquidTokenWei: 4_444n * LIQUID_TOKEN,
  liquidTokenIsCurrency0: false,
  tickSpacing: 60,
  openingTick: 51_600,
  tickLower: -887_220,
  tickUpper: 51_600,
  feePolicy: { denominator: 10_000n, totalFee: 300n },
  exactOutputLiquidTokenWei: [
    1n,
    5n,
    10n,
    25n,
    100n,
    500n,
    1_000n,
    2_222n,
    4_000n,
  ].map((amount) => amount * LIQUID_TOKEN),
  exactInputWethWei: [
    WETH / 100n,
    WETH / 20n,
    WETH / 10n,
    WETH / 4n,
    WETH,
    5n * WETH,
    10n * WETH,
  ],
};

const checkpointAt = (
  checkpoints: readonly ExactOutputLiquidTokenScenario[],
  index: number,
): ExactOutputLiquidTokenScenario => {
  const checkpoint = checkpoints[index];
  if (checkpoint === undefined) throw new Error(`Missing checkpoint ${index}`);
  return checkpoint;
};

describe("Genesis Liquidity curve model", () => {
  it("reproduces the checked Base Sepolia opening manifest and POC benchmark with integer math", () => {
    const model = modelGenesisCurve(BASE_SEPOLIA_INPUT);

    expect(model.openingTick).toBe(51_600);
    expect(model.tickLower).toBe(-887_220);
    expect(model.tickUpper).toBe(51_600);
    expect(model.openingSqrtPriceX96).toBe(
      1_045_450_144_060_342_713_734_433_280_827n,
    );
    expect(model.liquidity).toBe(336_783_113_201_300_883_150n);
    expect(model.seededLiquidTokenWei).toBe(4_443_999_999_999_999_999_998n);
    expect(model.roundingDustLiquidTokenWei).toBe(2n);
    expect(model.openingMarginalWethPerLiquidTokenX18).toBe(
      5_743_181_136_509_477n,
    );
    expect(model.openingMarginalLiquidTokenPerWethX18).toBe(
      174_119_529_966_238_895_231n,
    );
    expect(model.openingMarginalFullyDilutedWethWei).toBe(
      25_522_696_970_648_119_980n,
    );
    expect(
      model.openingMarginalWethPerLiquidTokenX18 - 5_743_181_136_509_477n,
    ).toBeLessThanOrEqual(1n);
  });

  it("models exact-output and exact-input buys with v4 and hook rounding", () => {
    const model = modelGenesisCurve(BASE_SEPOLIA_INPUT);
    const exactOutput = model.exactOutputLiquidToken.find(
      ({ liquidTokenOutWei }) => liquidTokenOutWei === LIQUID_TOKEN,
    );
    const exactInput = model.exactInputWeth.find(
      ({ traderWethInWei }) => traderWethInWei === WETH,
    );

    expect(exactOutput).toMatchObject({
      liquidTokenOutWei: LIQUID_TOKEN,
      poolWethInWei: 5_744_473_772_371_848n,
      feeWethWei: 177_664_137_289_850n,
      traderWethInWei: 5_922_137_909_661_698n,
      remainingLiquidTokenWei: 4_442_999_999_999_999_999_998n,
      endSqrtPriceX96: 1_045_214_894_252_948_397_192_189_665_927n,
    });
    expect(exactInput).toMatchObject({
      traderWethInWei: WETH,
      feeWethWei: 30_000_000_000_000_000n,
      poolWethInWei: 970_000_000_000_000_000n,
      liquidTokenOutWei: 162_712_010_965_735_327_875n,
      endSqrtPriceX96: 1_007_172_174_819_911_556_693_205_761_849n,
    });
  });

  it("preserves the economic result when the currency order and range are mirrored", () => {
    const inverse = modelGenesisCurve(BASE_SEPOLIA_INPUT);
    const direct = modelGenesisCurve({
      ...BASE_SEPOLIA_INPUT,
      liquidTokenIsCurrency0: true,
      openingTick: -51_600,
      tickLower: -51_600,
      tickUpper: 887_220,
    });

    expect(direct.liquidity).toBe(inverse.liquidity);
    expect(direct.roundingDustLiquidTokenWei).toBe(
      inverse.roundingDustLiquidTokenWei,
    );
    expect(direct.openingMarginalWethPerLiquidTokenX18).toBe(
      inverse.openingMarginalWethPerLiquidTokenX18,
    );
    expect(direct.exactOutputLiquidToken[0]).toMatchObject({
      liquidTokenOutWei: inverse.exactOutputLiquidToken[0]?.liquidTokenOutWei,
      poolWethInWei: inverse.exactOutputLiquidToken[0]?.poolWethInWei,
      feeWethWei: inverse.exactOutputLiquidToken[0]?.feeWethWei,
      traderWethInWei: inverse.exactOutputLiquidToken[0]?.traderWethInWei,
    });
    expect(direct.exactInputWeth[0]).toMatchObject({
      traderWethInWei: inverse.exactInputWeth[0]?.traderWethInWei,
      poolWethInWei: inverse.exactInputWeth[0]?.poolWethInWei,
      feeWethWei: inverse.exactInputWeth[0]?.feeWethWei,
      liquidTokenOutWei: inverse.exactInputWeth[0]?.liquidTokenOutWei,
    });
  });

  it("reports cumulative WETH and remaining supply monotonically across meaningful checkpoints", () => {
    const checkpoints =
      modelGenesisCurve(BASE_SEPOLIA_INPUT).exactOutputLiquidToken;

    expect(
      checkpoints.map(
        ({ liquidTokenOutWei }) => liquidTokenOutWei / LIQUID_TOKEN,
      ),
    ).toEqual([1n, 5n, 10n, 25n, 100n, 500n, 1_000n, 2_222n, 4_000n]);
    for (let index = 1; index < checkpoints.length; index += 1) {
      const previous = checkpointAt(checkpoints, index - 1);
      const current = checkpointAt(checkpoints, index);
      expect(current.poolWethInWei).toBeGreaterThan(previous.poolWethInWei);
      expect(current.remainingLiquidTokenWei).toBeLessThan(
        previous.remainingLiquidTokenWei,
      );
      expect(current.endMarginalWethPerLiquidTokenX18).toBeGreaterThan(
        previous.endMarginalWethPerLiquidTokenX18,
      );
    }
  });

  it("rejects invalid tick ranges, fee policies, and trades beyond the liquid supply", () => {
    expect(() =>
      modelGenesisCurve({
        ...BASE_SEPOLIA_INPUT,
        tickLower: 51_600,
      }),
    ).toThrow(/range/iu);
    expect(() =>
      modelGenesisCurve({
        ...BASE_SEPOLIA_INPUT,
        feePolicy: { denominator: 10_000n, totalFee: 10_000n },
      }),
    ).toThrow(/fee/iu);
    expect(() =>
      modelGenesisCurve({
        ...BASE_SEPOLIA_INPUT,
        exactOutputLiquidTokenWei: [4_444n * LIQUID_TOKEN],
      }),
    ).toThrow(/liquid supply/iu);
  });
});
