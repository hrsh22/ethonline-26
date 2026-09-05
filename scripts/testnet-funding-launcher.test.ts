import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createRuntimeServiceEnvironment } from "./runtime-environment.ts";

describe("testnet funding process isolation", () => {
  it("passes only funding and minimal runtime variables to the signer process", () => {
    const isolated = createRuntimeServiceEnvironment(
      "funding",
      {
        AWS_SECRET_ACCESS_KEY: "cloud-secret",
        DEPLOYER_PRIVATE_KEY: "deployer-secret",
        HISTORY_INGEST_API_TOKEN: "history-ingest-secret",
        HISTORY_READ_API_TOKEN: "history-read-secret",
        NODE_OPTIONS: "--require=/sentinel/forbidden.cjs",
        OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
        OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
        OPERATOR_PRIVATE_KEY: "operator-secret",
        PATH: "/bin",
        RPC_URL: "https://shared-rpc.invalid",
        TESTNET_FUNDING_API_TOKEN: "host-token",
      },
      {
        RPC_URL: "https://funding-rpc.invalid",
        TESTNET_FUNDING_API_TOKEN: "dedicated-token",
        TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-key",
      },
    );

    expect(isolated).toEqual({
      PATH: "/bin",
      RPC_URL: "https://funding-rpc.invalid",
      TESTNET_FUNDING_API_TOKEN: "dedicated-token",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-key",
    });
  });

  it("resolves shared bindings from the root environment the same way supervised", () => {
    // The supervisor loads the root .env before projecting; the standalone
    // launchers did not, so `pnpm funding:worker` and `pnpm
    // funding:replenisher` refused to start on their own while the identical
    // child under `pnpm backend` came up fine.
    for (const launcher of [
      "./testnet-funding-launcher.ts",
      "./testnet-funding-replenisher-launcher.ts",
    ]) {
      const source = readFileSync(new URL(launcher, import.meta.url), "utf8");
      expect(source).toContain("readRuntimeEnvironmentSource({");
      expect(source).toContain('path: join(repositoryRoot, ".env"),');
    }
  });

  it("still lets the dedicated file win over a shared binding", () => {
    // The root environment supplies what both processes share; it must never
    // reach past the dedicated file for the signer's own identity.
    expect(
      createRuntimeServiceEnvironment(
        "funding",
        {
          NEXT_PUBLIC_APP_URL: "https://orbit.example",
          TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "root-key",
        },
        { TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "dedicated-key" },
      ),
    ).toMatchObject({
      NEXT_PUBLIC_APP_URL: "https://orbit.example",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "dedicated-key",
    });
  });
});
