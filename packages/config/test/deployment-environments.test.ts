import { readFileSync } from "node:fs";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeConfiguredDeploymentSelection,
  DeploymentEnvironmentConfigurationSchema,
  deploymentEnvironmentConfigurations,
  deploymentEnvironmentForChainId,
  deploymentEnvironmentForName,
  requireConfiguredDeploymentEnvironment,
  selectDeploymentEnvironment,
} from "../src/deployment-environments.js";

const readManifest = (chainId: 31_337 | 84_532): unknown =>
  JSON.parse(
    readFileSync(`../../deployments/${chainId}.json`, "utf8"),
  ) as unknown;

describe("deployment environments", () => {
  it("selects checked mock manifests for development and staging", () => {
    expect(deploymentEnvironmentForName("development")).toMatchObject({
      chainId: 31_337,
      manifestPath: "deployments/31337.json",
      assetPolicy: "mock",
    });
    expect(deploymentEnvironmentForName("staging")).toMatchObject({
      chainId: 84_532,
      manifestPath: "deployments/84532.json",
      assetPolicy: "mock",
    });
  });

  it("keeps the current POC on staging when no selector is supplied", () => {
    expect(selectDeploymentEnvironment(undefined).name).toBe("staging");
  });

  it("never falls back from production to a mock deployment", () => {
    const production = deploymentEnvironmentForName("production");
    expect(production).toEqual({
      status: "unconfigured",
      name: "production",
      chainId: 8_453,
      network: "base",
      chainLabel: "Base",
      applicationLabel: "Base Production",
      assetPolicy: "production",
    });
    expect(() => requireConfiguredDeploymentEnvironment(production)).toThrow(
      "production has no published manifest",
    );
  });

  it("rejects unknown names and chain IDs", () => {
    expect(() => deploymentEnvironmentForName("preview")).toThrow();
    expect(() => deploymentEnvironmentForChainId(1)).toThrow(
      "Unsupported deployment chain 1",
    );
  });

  it("rejects crossed environment fields at the Effect Schema boundary", () => {
    expect(() =>
      Schema.decodeUnknownSync(DeploymentEnvironmentConfigurationSchema)({
        ...deploymentEnvironmentConfigurations.development,
        manifestPath: "deployments/84532.json",
      }),
    ).toThrow();
  });

  it("rejects a checked manifest selected for the wrong environment", () => {
    expect(() =>
      decodeConfiguredDeploymentSelection({
        environment: deploymentEnvironmentConfigurations.development,
        manifest: readManifest(84_532),
      }),
    ).toThrow();
    expect(() =>
      decodeConfiguredDeploymentSelection({
        environment: deploymentEnvironmentConfigurations.staging,
        manifest: readManifest(31_337),
      }),
    ).toThrow();
  });

  it("rejects unexpected nested manifest fields without echoing their values", () => {
    const manifest = readManifest(84_532) as Record<string, unknown>;
    const contracts = manifest.contracts as Record<string, unknown>;
    const secretSentinel = "selection-secret-must-never-be-echoed";

    try {
      decodeConfiguredDeploymentSelection({
        environment: deploymentEnvironmentConfigurations.staging,
        manifest: {
          ...manifest,
          contracts: {
            ...contracts,
            rewardLedgre: secretSentinel,
          },
        },
      });
      throw new Error("expected the malformed manifest to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("contracts.rewardLedgre");
      expect((error as Error).message).not.toContain(secretSentinel);
    }
  });

  it("maps configured and future production chains to one environment", () => {
    expect(deploymentEnvironmentForChainId(31_337).name).toBe("development");
    expect(deploymentEnvironmentForChainId(84_532).name).toBe("staging");
    expect(deploymentEnvironmentForChainId(8_453).name).toBe("production");
  });
});
