import { describe, expect, it } from "vitest";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";

import {
  deploymentEnvironment,
  protocolDeploymentManifest,
  selectProtocolDeployment,
} from "@/lib/deployment";

describe("web deployment binding", () => {
  it("publishes development-sepolia by default for the current POC", () => {
    expect(deploymentEnvironment.name).toBe("development-sepolia");
    expect(protocolDeploymentManifest).toMatchObject({
      schemaVersion: 3,
      chainId: 84_532,
      phase: "cca",
    });
  });

  it("selects distinct Anvil and Base Sepolia development manifests", () => {
    const development = selectProtocolDeployment("development");
    const developmentSepolia = selectProtocolDeployment("development-sepolia");

    expect(development.environment.chainId).toBe(31_337);
    expect(development.manifest?.chainId).toBe(31_337);
    expect(development.manifest?.contracts.mockAaplc).not.toBe(
      developmentSepolia.manifest?.contracts.mockAaplc,
    );
    expect(developmentSepolia.manifest?.chainId).toBe(84_532);
  });

  it("selects the published staging manifest without falling back to development-sepolia", () => {
    const staging = selectProtocolDeployment("staging");
    const developmentSepolia = selectProtocolDeployment("development-sepolia");

    expect(staging.environment).toMatchObject({
      name: "staging",
      status: "configured",
      chainId: 84_532,
      manifestPath: "deployments/84532.staging.json",
    });
    expect(staging.manifest).toMatchObject({
      chainId: 84_532,
      network: "base-sepolia",
      phase: "cca",
    });
    expect(staging.manifest?.contracts.fuelCore).not.toBe(
      developmentSepolia.manifest?.contracts.fuelCore,
    );
  });

  it("keeps production address-free until a manifest is published", () => {
    const production = selectProtocolDeployment("production");

    expect(production.environment.assetPolicy).toBe("production");
    expect(production.manifest).toBeUndefined();
  });

  it("retains the full Effect-schema validation boundary", () => {
    expect(protocolDeploymentManifest).toBeDefined();
    expect(() =>
      decodeProtocolDeploymentManifest(protocolDeploymentManifest),
    ).not.toThrow();
    expect(() =>
      decodeProtocolDeploymentManifest({
        ...protocolDeploymentManifest,
        contracts: {
          ...protocolDeploymentManifest?.contracts,
          fuelCore: "not-an-address",
        },
      }),
    ).toThrow();
  });
});
