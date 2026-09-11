import { readFileSync } from "node:fs";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeConfiguredDeploymentSelection,
  configuredDeploymentEnvironments,
  DeployableDeploymentEnvironmentSchema,
  DeploymentEnvironmentConfigurationSchema,
  deploymentEnvironmentConfigurations,
  deploymentEnvironmentForChainId,
  deploymentEnvironmentForName,
  requireConfiguredDeploymentEnvironment,
  requireDeployableDeploymentEnvironment,
  selectDeploymentEnvironment,
} from "../src/deployment-environments.js";

const readManifest = (manifestPath: string): unknown =>
  JSON.parse(readFileSync(`../../${manifestPath}`, "utf8")) as unknown;

describe("deployment environments", () => {
  it("selects checked mock manifests for both development identities", () => {
    expect(deploymentEnvironmentForName("development")).toMatchObject({
      chainId: 31_337,
      manifestPath: "deployments/31337.json",
      assetPolicy: "mock",
    });
    expect(deploymentEnvironmentForName("development-sepolia")).toMatchObject({
      chainId: 84_532,
      manifestPath: "deployments/84532.json",
      assetPolicy: "mock",
    });
  });

  it("keeps the current POC on development-sepolia when no selector is supplied", () => {
    expect(selectDeploymentEnvironment(undefined).name).toBe(
      "development-sepolia",
    );
  });

  it("publishes staging as a configured environment with its own manifest", () => {
    const staging = deploymentEnvironmentForName("staging");
    expect(requireConfiguredDeploymentEnvironment(staging)).toMatchObject({
      status: "configured",
      name: "staging",
      chainId: 84_532,
      manifestPath: "deployments/84532.staging.json",
    });
    expect(requireDeployableDeploymentEnvironment(staging)).toBe(staging);
    expect(configuredDeploymentEnvironments.map(({ name }) => name)).toEqual([
      "development",
      "development-sepolia",
      "staging",
    ]);
    const selection = decodeConfiguredDeploymentSelection({
      environment: staging,
      manifest: readManifest("deployments/84532.staging.json"),
    });
    expect(selection.environment).toStrictEqual(staging);
    expect(selection.manifest).toMatchObject({
      chainId: 84_532,
      network: "base-sepolia",
    });
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
    expect(() => requireDeployableDeploymentEnvironment(production)).toThrow(
      "production has no deployment target",
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
    for (const patch of [
      { status: "unconfigured" },
      { manifestPath: "deployments/84532.json" },
      { chainId: 31_337 },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(DeployableDeploymentEnvironmentSchema)({
          ...deploymentEnvironmentConfigurations.staging,
          ...patch,
        }),
      ).toThrow();
    }
  });

  it("rejects a checked manifest selected for the wrong environment", () => {
    expect(() =>
      decodeConfiguredDeploymentSelection({
        environment: deploymentEnvironmentConfigurations.development,
        manifest: readManifest("deployments/84532.json"),
      }),
    ).toThrow();
    expect(() =>
      decodeConfiguredDeploymentSelection({
        environment: deploymentEnvironmentConfigurations["development-sepolia"],
        manifest: readManifest("deployments/31337.json"),
      }),
    ).toThrow();
  });

  it("rejects unexpected nested manifest fields without echoing their values", () => {
    const manifest = readManifest("deployments/84532.json") as Record<
      string,
      unknown
    >;
    const contracts = manifest.contracts as Record<string, unknown>;
    const secretSentinel = "selection-secret-must-never-be-echoed";

    try {
      decodeConfiguredDeploymentSelection({
        environment: deploymentEnvironmentConfigurations["development-sepolia"],
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

  it("maps chains with a single identity and rejects ambiguous Base Sepolia lookup", () => {
    expect(deploymentEnvironmentForChainId(31_337).name).toBe("development");
    expect(() => deploymentEnvironmentForChainId(84_532)).toThrow(
      "Ambiguous deployment chain 84532; select an environment explicitly: development-sepolia, staging",
    );
    expect(deploymentEnvironmentForChainId(8_453).name).toBe("production");
  });
});
