import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect } from "effect";
import { getAddress, isHash, type Address, type Hex } from "viem";

import { runInterruptibleMain } from "./effect-runtime.ts";
import {
  acquireTestnetFundingHttpServer,
  type TestnetFundingConfiguration,
} from "./testnet-funding/http-server.ts";
import { resolveTestnetFundingEnvironment } from "./testnet-funding/runtime-configuration.ts";
import type { TestnetFundingChain } from "./testnet-funding/types.ts";
import { createViemTestnetFundingChain } from "./testnet-funding/viem-chain.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const unavailableChain: TestnetFundingChain = {
  inspect: () => Effect.die("Disabled funding worker cannot inspect the chain"),
  prepare: () => Effect.die("Disabled funding worker cannot prepare transfers"),
  broadcast: () => Effect.die("Disabled funding worker cannot broadcast"),
  receipt: () => Effect.die("Disabled funding worker cannot read receipts"),
  signerNonce: () => Effect.die("Disabled funding worker has no signer"),
};

const readRuntimeInputs = Effect.try({
  try: () => {
    const environment = resolveTestnetFundingEnvironment(
      process.env,
      repositoryRoot,
    );
    const manifest = decodeProtocolDeploymentManifest(
      JSON.parse(
        readFileSync(join(repositoryRoot, "deployments/84532.json"), "utf8"),
      ) as unknown,
    );
    if (manifest.chainId !== 84_532 || manifest.network !== "base-sepolia") {
      throw new Error("A launched Base Sepolia manifest is required");
    }
    return { environment, manifest };
  },
  catch: (cause) => cause,
});

const privilegedAddresses = (
  roles: Readonly<Record<string, string | undefined>>,
): ReadonlySet<Address> =>
  new Set(
    Object.values(roles)
      .filter((address): address is string => address !== undefined)
      .map((address) => getAddress(address)),
  );

const configurationFromInputs = (
  environment: Effect.Effect.Success<typeof readRuntimeInputs>["environment"],
  roles: Readonly<Record<string, string | undefined>>,
): TestnetFundingConfiguration => ({
  enabled: environment.enabled,
  chainId: 84_532,
  signer: environment.signer,
  privilegedAddresses: privilegedAddresses(roles),
  policy: environment.policy,
  abusePolicy: environment.abusePolicy,
  proofDomain: environment.proofDomain,
});

const deploymentTransactionHash = (
  inputs: Effect.Effect.Success<typeof readRuntimeInputs>,
): Hex => {
  const hash = inputs.manifest.transactions.step000;
  if (hash === undefined || !isHash(hash)) {
    throw new Error("The deployment manifest is missing its first transaction");
  }
  return hash;
};

const chainFromInputs = (
  inputs: Effect.Effect.Success<typeof readRuntimeInputs>,
): TestnetFundingChain => {
  if (!inputs.environment.enabled) return unavailableChain;
  const { privateKey, rpcUrl } = inputs.environment;
  if (privateKey === undefined || rpcUrl === undefined) {
    throw new Error("Enabled funding worker credentials were not resolved");
  }
  return createViemTestnetFundingChain({
    rpcUrl,
    privateKey,
    deploymentTransactionHash: deploymentTransactionHash(inputs),
    weth: getAddress(inputs.manifest.contracts.weth ?? ""),
    usdc: getAddress(inputs.manifest.contracts.usdc ?? ""),
  });
};

export const testnetFundingWorker = Effect.scoped(
  Effect.gen(function* () {
    const inputs = yield* readRuntimeInputs;
    yield* Effect.sync(() =>
      mkdirSync(dirname(inputs.environment.databasePath), {
        mode: 0o700,
        recursive: true,
      }),
    );
    const server = yield* acquireTestnetFundingHttpServer({
      apiToken: inputs.environment.apiToken,
      chain: chainFromInputs(inputs),
      configuration: configurationFromInputs(
        inputs.environment,
        inputs.manifest.roles,
      ),
      databasePath: inputs.environment.databasePath,
      host: inputs.environment.host,
      log: (message) => {
        process.stdout.write(`${message}\n`);
      },
      nowMilliseconds: Date.now,
      port: inputs.environment.port,
      requestId: randomUUID,
    });
    process.stdout.write(
      `Testnet funding worker ${inputs.environment.enabled ? "ready" : "disabled"} at ${server.url}\n`,
    );
    return yield* Effect.never;
  }),
);

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(testnetFundingWorker);
}
