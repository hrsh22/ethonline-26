import { readFileSync } from "node:fs";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeGenesisCurveConfiguration } from "./genesis-curve/configuration.ts";
import {
  assertGenesisCurveManifestCrossCheck,
  buildGenesisCurveReport,
  renderGenesisCurveReport,
  serializeGenesisCurveReport,
} from "./genesis-curve/report.ts";

const readJson = (url: URL): Readonly<Record<string, unknown>> =>
  JSON.parse(readFileSync(url, "utf8")) as Readonly<Record<string, unknown>>;

const configuration = readJson(
  new URL("../docs/economics/genesis-curve-base-sepolia.json", import.meta.url),
);
const manifest = decodeProtocolDeploymentManifest(
  readJson(new URL("../deployments/84532.json", import.meta.url)),
);

describe("Genesis Liquidity curve modeling command", () => {
  it("validates decimal configuration with Effect and preserves every economic input", async () => {
    const decoded = await Effect.runPromise(
      decodeGenesisCurveConfiguration(configuration),
    );

    expect(decoded.input).toMatchObject({
      supplyLiquidTokenWei: 4_444n * 10n ** 18n,
      // The deployed FuelCore address sorts below the WETH-like asset, so the
      // canonical pool puts the Liquid Token first and the one-sided range runs
      // upward from the opening tick rather than down to it.
      liquidTokenIsCurrency0: true,
      tickSpacing: 60,
      openingTick: -51_600,
      tickLower: -51_600,
      tickUpper: 887_220,
      feePolicy: { denominator: 10_000n, totalFee: 300n },
    });
    expect(decoded.input.exactOutputLiquidTokenWei).toContain(
      100n * 10n ** 18n,
    );
    expect(decoded.input.exactInputWethWei).toContain(10n ** 18n);
    expect(decoded.sensitivity).toHaveLength(5);
  });

  it("identifies the pre-CCA seed model as different from the pending CCA pool", async () => {
    const decoded = await Effect.runPromise(
      decodeGenesisCurveConfiguration(configuration),
    );
    const report = buildGenesisCurveReport(decoded, manifest);

    expect(report.manifestCrossCheck).toEqual({
      chainId: 84_532,
      // Read from the manifest rather than pinned: a redeployment changes the
      // pool identity, and pinning it here turns "the model no longer describes
      // the deployed pool" into "somebody forgot to update a fixture".
      poolId: manifest.canonicalPool.poolId,
      currencyOrderMatches: true,
      tickSpacingMatches: true,
      openingSqrtPriceMatches: false,
      activeLiquidityMatches: false,
    });
    expect(() =>
      assertGenesisCurveManifestCrossCheck(report.manifestCrossCheck),
    ).toThrow(/does not match/iu);
    expect(BigInt(manifest.canonicalPool.seedSqrtPriceX96)).toBe(0n);
    expect(report.model.openingSqrtPriceX96).toBeGreaterThan(0n);
    expect(report.sensitivity).toHaveLength(5);
  });

  it("renders deterministic human and JSON reports with explicit economic distinctions", async () => {
    const decoded = await Effect.runPromise(
      decodeGenesisCurveConfiguration(configuration),
    );
    const report = buildGenesisCurveReport(decoded, manifest);
    const human = renderGenesisCurveReport(report);
    const json = serializeGenesisCurveReport(report);

    expect(human).toContain("reference benchmark, not a current-price promise");
    expect(human).toContain("Exact-output FUEL checkpoints");
    expect(human).toContain("Cumulative WETH entering pool");
    expect(human).toContain("Average curve price");
    expect(human).toContain("Average trader price");
    expect(human).toContain("Curve slippage");
    expect(human).toContain("Total fee-inclusive impact");
    expect(human).toContain("Sensitivity (human decision inputs)");
    expect(human).toContain("scenario differs from the checked deployment");
    expect(json).toContain(
      `"openingSqrtPriceX96": "${report.model.openingSqrtPriceX96}"`,
    );
    expect(json).not.toContain("[object Object]");
  });

  it("models alternative curves while identifying deployment differences", async () => {
    const alternative = await Effect.runPromise(
      decodeGenesisCurveConfiguration({
        ...configuration,
        name: "Alternative curve",
        openingTick: -49_920,
        tickLower: -49_920,
        sensitivity: [],
      }),
    );
    const report = buildGenesisCurveReport(alternative, manifest);

    expect(report.manifestCrossCheck.openingSqrtPriceMatches).toBe(false);
    expect(report.manifestCrossCheck.activeLiquidityMatches).toBe(false);
    expect(renderGenesisCurveReport(report)).toContain(
      "scenario differs from the checked deployment",
    );
  });

  it("includes tick spacing in the strict deployment cross-check", async () => {
    const alternativeSpacing = await Effect.runPromise(
      decodeGenesisCurveConfiguration({
        ...configuration,
        tickSpacing: 30,
      }),
    );
    const report = buildGenesisCurveReport(alternativeSpacing, manifest);

    expect(report.manifestCrossCheck.tickSpacingMatches).toBe(false);
    expect(() =>
      assertGenesisCurveManifestCrossCheck(report.manifestCrossCheck),
    ).toThrow(/does not match/iu);
  });

  it("fails closed on invalid decimals, ranges, dust, and representative trades", async () => {
    await expect(
      Effect.runPromise(
        decodeGenesisCurveConfiguration({
          ...configuration,
          supplyLiquidToken: "4444.0000000000000000001",
        }),
      ),
    ).rejects.toThrow(/configuration/iu);
    await expect(
      Effect.runPromise(
        decodeGenesisCurveConfiguration({
          ...configuration,
          tickLower: 887_220,
        }),
      ),
    ).rejects.toThrow(/range/iu);
    await expect(
      Effect.runPromise(
        decodeGenesisCurveConfiguration({
          ...configuration,
          sensitivity: [
            {
              name: "Unseedable rounding dust",
              openingTick: -51_600,
              tickLower: -51_600,
              tickUpper: 600_000,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/rounding dust/iu);
    await expect(
      Effect.runPromise(
        decodeGenesisCurveConfiguration({
          ...configuration,
          exactOutputLiquidToken: [],
        }),
      ),
    ).rejects.toThrow(/configuration/iu);
  });

  it("exposes one deterministic workspace command", () => {
    const workspace = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    expect(workspace.scripts["model:genesis-curve"]).toBe(
      "pnpm build:packages && node scripts/model-genesis-curve.ts",
    );
  });
});
