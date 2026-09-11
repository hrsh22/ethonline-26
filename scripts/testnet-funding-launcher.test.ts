import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeServiceEnvironment } from "./runtime-environment.ts";
import { createTestnetFundingLauncherEnvironment } from "./testnet-funding-launcher.ts";
import { createReplenisherLauncherEnvironment } from "./testnet-funding-replenisher-launcher.ts";

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

  it("uses the funding dedicated file selected by the root profile", () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "orbit-funding-profile-"),
    );
    try {
      writeFileSync(
        join(repositoryRoot, ".env"),
        "RPC_URL=https://development.invalid\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.staging"),
        "RPC_URL=https://staging.invalid\nTESTNET_FUNDING_ENV_PATH=.env.testnet-funding.staging\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding"),
        "TESTNET_FUNDING_SIGNER_PRIVATE_KEY=development-key\nTESTNET_FUNDING_MANIFEST_PATH=deployments/development.json\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding.staging"),
        "TESTNET_FUNDING_SIGNER_PRIVATE_KEY=staging-key\nTESTNET_FUNDING_MANIFEST_PATH=deployments/staging.json\n",
      );

      expect(
        createTestnetFundingLauncherEnvironment(
          {},
          "development",
          repositoryRoot,
        ),
      ).toMatchObject({
        RPC_URL: "https://development.invalid",
        TESTNET_FUNDING_MANIFEST_PATH: "deployments/development.json",
        TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "development-key",
      });
      expect(
        createTestnetFundingLauncherEnvironment({}, "staging", repositoryRoot),
      ).toMatchObject({
        RPC_URL: "https://staging.invalid",
        TESTNET_FUNDING_MANIFEST_PATH: "deployments/staging.json",
        TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "staging-key",
      });
      expect(
        createTestnetFundingLauncherEnvironment(
          { RPC_URL: "https://injected.invalid" },
          "none",
          repositoryRoot,
        ),
      ).toEqual({ RPC_URL: "https://injected.invalid" });
    } finally {
      rmSync(repositoryRoot, { force: true, recursive: true });
    }
  });

  it("uses the replenisher dedicated file selected by the root profile", () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "orbit-replenisher-profile-"),
    );
    try {
      writeFileSync(
        join(repositoryRoot, ".env"),
        "RPC_URL=https://development.invalid\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.staging"),
        "RPC_URL=https://staging.invalid\nTESTNET_FUNDING_REPLENISH_ENV_PATH=.env.testnet-funding-treasury.staging\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding-treasury"),
        "TESTNET_FUNDING_TREASURY_PRIVATE_KEY=development-treasury\nTESTNET_FUNDING_REPLENISH_MANIFEST_PATH=deployments/development.json\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding-treasury.staging"),
        "TESTNET_FUNDING_TREASURY_PRIVATE_KEY=staging-treasury\nTESTNET_FUNDING_REPLENISH_MANIFEST_PATH=deployments/staging.json\n",
      );

      expect(
        createReplenisherLauncherEnvironment({}, "development", repositoryRoot),
      ).toMatchObject({
        RPC_URL: "https://development.invalid",
        TESTNET_FUNDING_REPLENISH_MANIFEST_PATH: "deployments/development.json",
        TESTNET_FUNDING_TREASURY_PRIVATE_KEY: "development-treasury",
      });
      expect(
        createReplenisherLauncherEnvironment({}, "staging", repositoryRoot),
      ).toMatchObject({
        RPC_URL: "https://staging.invalid",
        TESTNET_FUNDING_REPLENISH_MANIFEST_PATH: "deployments/staging.json",
        TESTNET_FUNDING_TREASURY_PRIVATE_KEY: "staging-treasury",
      });
      expect(
        createReplenisherLauncherEnvironment({}, "none", repositoryRoot),
      ).toEqual({});
    } finally {
      rmSync(repositoryRoot, { force: true, recursive: true });
    }
  });

  it("defaults staging to staging-specific dedicated files", () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "orbit-staging-dedicated-defaults-"),
    );
    try {
      writeFileSync(
        join(repositoryRoot, ".env.staging"),
        "RPC_URL=https://staging.invalid\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding"),
        "TESTNET_FUNDING_SIGNER_PRIVATE_KEY=development-key\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding.staging"),
        "TESTNET_FUNDING_SIGNER_PRIVATE_KEY=staging-key\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding-treasury"),
        "TESTNET_FUNDING_TREASURY_PRIVATE_KEY=development-treasury\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.testnet-funding-treasury.staging"),
        "TESTNET_FUNDING_TREASURY_PRIVATE_KEY=staging-treasury\n",
      );

      expect(
        createTestnetFundingLauncherEnvironment({}, "staging", repositoryRoot)
          .TESTNET_FUNDING_SIGNER_PRIVATE_KEY,
      ).toBe("staging-key");
      expect(
        createReplenisherLauncherEnvironment({}, "staging", repositoryRoot)
          .TESTNET_FUNDING_TREASURY_PRIVATE_KEY,
      ).toBe("staging-treasury");
      expect(
        createTestnetFundingLauncherEnvironment(
          { TESTNET_FUNDING_ENV_PATH: " " },
          "staging",
          repositoryRoot,
        ).TESTNET_FUNDING_SIGNER_PRIVATE_KEY,
      ).toBe("staging-key");
      expect(
        createReplenisherLauncherEnvironment(
          { TESTNET_FUNDING_REPLENISH_ENV_PATH: " " },
          "staging",
          repositoryRoot,
        ).TESTNET_FUNDING_TREASURY_PRIVATE_KEY,
      ).toBe("staging-treasury");
    } finally {
      rmSync(repositoryRoot, { force: true, recursive: true });
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
