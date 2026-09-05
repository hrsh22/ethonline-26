import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { selectedIdentityConfiguration } from "@orbit/config/identity";
import { makeViemProtocolTransport } from "@orbit/protocol/viem-transport";
import { Effect } from "effect";
import { createPublicClient, getAddress, http } from "viem";
import { baseSepolia } from "viem/chains";

import { readLaunchedBaseSepoliaManifest } from "./base-sepolia-manifest.ts";
import {
  ensure,
  fileSystem,
  rpc,
  runMain,
  validate,
} from "./effect-runtime.ts";
import { loadHealthEnvironment } from "./health-environment.ts";
import { createBaseSepoliaHealthReader } from "./health-history.ts";
import { readFundingHealth } from "./health-funding.ts";

runMain(
  Effect.gen(function* () {
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const environment = yield* loadHealthEnvironment(repositoryRoot);
    const {
      evidencePath,
      fundingApiToken,
      fundingServiceUrl,
      historyReadApiToken,
      historyIndexUrl,
      manifestPath,
      rpcUrl,
    } = environment;
    const manifest = yield* readLaunchedBaseSepoliaManifest(manifestPath);

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl, { retryCount: 6, retryDelay: 250 }),
    });
    yield* ensure(
      (yield* rpc("Could not read the health RPC chain ID", () =>
        publicClient.getChainId(),
      )) === 84_532,
      "Health RPC is not Base Sepolia chain 84532",
    );
    const connectedWallet = yield* validate("DEPLOYER_ADDRESS is invalid", () =>
      getAddress(environment.deployerAddress ?? manifest.roles.owner),
    );
    const reader = createBaseSepoliaHealthReader({
      manifest,
      identity: selectedIdentityConfiguration,
      historyReadApiToken,
      historyIndexUrl,
      transport: makeViemProtocolTransport(
        publicClient as unknown as Parameters<
          typeof makeViemProtocolTransport
        >[0],
        manifest,
        selectedIdentityConfiguration,
      ),
    });
    const snapshot = yield* rpc("Could not read protocol health", () =>
      reader.readHealth(connectedWallet),
    );
    const funding = yield* readFundingHealth({
      apiToken: fundingApiToken,
      serviceUrl: fundingServiceUrl,
    });
    const counts = Object.fromEntries(
      ["pass", "fail", "unknown"].map((status) => [
        status,
        snapshot.health.checks.filter((check) => check.status === status)
          .length,
      ]),
    );
    const evidence = {
      schemaVersion: 1,
      chainId: 84_532,
      network: "base-sepolia",
      manifestLaunch: manifest.launch,
      connectedWallet,
      observedBlock: snapshot.deployment.observedBlock,
      observedAt: snapshot.deployment.observedAt,
      status: snapshot.health.status,
      freshness: snapshot.health.freshness,
      counts,
      funding,
      checks: snapshot.health.checks,
      rpcFailures: snapshot.health.rpcFailures,
      trackQueues: snapshot.operations.trackQueues,
      recentEvents: snapshot.operations.recentEvents,
      rewardEpochCount: snapshot.operations.rewardEpochCount,
      rewardHistoryStatus: snapshot.operations.rewardHistoryStatus,
      rewardHistory: snapshot.operations.rewardHistory,
      capabilities: snapshot.capabilities,
    };
    yield* fileSystem("Could not write Base Sepolia health evidence", () => {
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(
        evidencePath,
        `${JSON.stringify(
          evidence,
          (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2,
        )}\n`,
      );
    });

    yield* ensure(
      funding.ok,
      funding.reason ?? "Testnet funding health failed",
    );
    yield* ensure(
      snapshot.health.status === "healthy" &&
        snapshot.health.freshness === "fresh" &&
        !snapshot.health.checks.some((check) => check.status !== "pass") &&
        snapshot.health.rpcFailures.length === 0,
      `Base Sepolia health is ${snapshot.health.status}`,
    );
    process.stdout.write(
      `Base Sepolia health passed ${counts.pass} checks at block ${snapshot.deployment.observedBlock}; funding ${funding.state}; evidence at ${evidencePath}\n`,
    );
  }),
);
