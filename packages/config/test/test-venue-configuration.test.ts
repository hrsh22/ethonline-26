import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decodeProtocolDeploymentManifest } from "../src/deployment-manifest.js";
import { decodeTestVenueConfiguration } from "../src/test-venue-configuration.js";

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8")) as unknown;

describe("public test venue configuration", () => {
  it("decodes the checked developer Base Sepolia address configuration", () => {
    const configuration = decodeTestVenueConfiguration(
      readJson("../../deployments/84532.venue.json"),
    );

    expect(configuration.environment).toBe("development-sepolia");
    expect(configuration.assetProfile).toBe("self-funded-test-assets");
    expect(configuration.contracts.mockAaplc).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("matches every externally managed address in the developer manifest", () => {
    const configuration = decodeTestVenueConfiguration(
      readJson("../../deployments/84532.venue.json"),
    );
    const manifest = decodeProtocolDeploymentManifest(
      readJson("../../deployments/84532.json"),
    );

    expect(configuration.operator).toBe(manifest.roles.owner);
    for (const name of [
      "weth",
      "usdc",
      "uniswapV4PoolManager",
      "testConversionVenue",
      "mockAaplc",
      "mockGooglc",
      "mockMetac",
      "mockNvdac",
    ] as const) {
      expect(configuration.contracts[name]).toBe(manifest.contracts[name]);
    }
  });

  it("rejects mock venue addresses labelled as production", () => {
    const development = readJson(
      "../../deployments/84532.venue.json",
    ) as Record<string, unknown>;

    expect(() =>
      decodeTestVenueConfiguration({
        ...development,
        environment: "production",
      }),
    ).toThrow();
  });

  it("rejects malformed public addresses", () => {
    const development = readJson(
      "../../deployments/84532.venue.json",
    ) as Record<string, unknown>;
    const contracts = development.contracts as Record<string, unknown>;

    expect(() =>
      decodeTestVenueConfiguration({
        ...development,
        contracts: { ...contracts, mockAaplc: "not-an-address" },
      }),
    ).toThrow();
  });
});
