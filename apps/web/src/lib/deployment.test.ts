import { describe, expect, it } from "vitest";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";

import {
  deploymentEnvironment,
  protocolDeploymentManifest,
  selectProtocolDeployment,
} from "@/lib/deployment";

describe("web deployment binding", () => {
  it("publishes staging by default for the current POC", () => {
    expect(deploymentEnvironment.name).toBe("staging");
    expect(protocolDeploymentManifest).toMatchObject({
      schemaVersion: 3,
      chainId: 84_532,
      phase: "cca",
    });
  });

  it("selects the development manifest without reusing staging addresses", () => {
    const development = selectProtocolDeployment("development");
    const staging = selectProtocolDeployment("staging");

    expect(development.environment.chainId).toBe(31_337);
    expect(development.manifest?.chainId).toBe(31_337);
    expect(development.manifest?.contracts.mockAaplc).not.toBe(
      staging.manifest?.contracts.mockAaplc,
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
