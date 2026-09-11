import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect } from "effect";
import { formatEther, getAddress, isHash, type Address, type Hex } from "viem";

import { runInterruptibleMain } from "./effect-runtime.ts";
import {
  createViemReplenishChain,
  type ReplenishChain,
} from "./testnet-funding-replenisher/chain.ts";
import {
  resolveReplenisherEnvironment,
  type ReplenisherEnvironment,
} from "./testnet-funding-replenisher/configuration.ts";
import {
  openReplenishLedger,
  type ReplenishLedger,
} from "./testnet-funding-replenisher/ledger.ts";
import {
  runReplenishCycle,
  type ReplenishCycleReport,
  type ReplenishGuard,
} from "./testnet-funding-replenisher/replenish.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CHAIN_ID = 84_532;

const replenisherManifestPath = (value: string | undefined): string => {
  const configured = value?.trim() || "deployments/84532.json";
  return isAbsolute(configured)
    ? configured
    : resolve(repositoryRoot, configured);
};

interface ReplenisherInputs {
  readonly environment: ReplenisherEnvironment;
  readonly guard: ReplenishGuard;
  readonly deploymentTransactionHash: Hex;
  readonly usdc: Address;
  readonly weth: Address;
}

type ReplenisherStartup = { readonly enabled: false } | ReplenisherInputs;

const privilegedAddresses = (
  roles: Readonly<Record<string, string | undefined>>,
): ReadonlySet<Address> =>
  new Set(
    Object.values(roles)
      .filter((address): address is string => address !== undefined)
      .map((address) => getAddress(address)),
  );

const readRuntimeInputs = Effect.try({
  try: (): ReplenisherStartup => {
    const environment = resolveReplenisherEnvironment(
      process.env,
      repositoryRoot,
    );
    if (!environment.enabled) return { enabled: false };
    const manifest = decodeProtocolDeploymentManifest(
      JSON.parse(
        readFileSync(
          replenisherManifestPath(
            process.env.TESTNET_FUNDING_REPLENISH_MANIFEST_PATH,
          ),
          "utf8",
        ),
      ) as unknown,
    );
    if (manifest.chainId !== CHAIN_ID || manifest.network !== "base-sepolia") {
      throw new Error("A launched Base Sepolia manifest is required");
    }
    const deploymentTransactionHash = manifest.transactions.step000;
    if (deploymentTransactionHash === undefined) {
      throw new Error(
        "The deployment manifest is missing its first transaction",
      );
    }
    if (!isHash(deploymentTransactionHash)) {
      throw new Error("The deployment manifest transaction hash is invalid");
    }
    return {
      deploymentTransactionHash,
      environment,
      guard: {
        chainId: CHAIN_ID,
        privilegedAddresses: privilegedAddresses(manifest.roles),
        signer: environment.signer,
        treasury: environment.treasury,
      },
      usdc: getAddress(manifest.contracts.usdc ?? ""),
      weth: getAddress(manifest.contracts.weth ?? ""),
    };
  },
  catch: (cause) => cause,
});

const chainFor = (inputs: ReplenisherInputs): ReplenishChain =>
  createViemReplenishChain({
    deploymentTransactionHash: inputs.deploymentTransactionHash,
    privateKey: inputs.environment.privateKey,
    rpcUrl: inputs.environment.rpcUrl,
    signer: inputs.environment.signer,
    usdc: inputs.usdc,
    weth: inputs.weth,
  });

const acquireLedger = (inputs: ReplenisherInputs) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(dirname(inputs.environment.databasePath), {
          mode: 0o700,
          recursive: true,
        });
        return openReplenishLedger(inputs.environment.databasePath, {
          chainId: CHAIN_ID,
          signer: inputs.environment.signer,
          treasury: inputs.environment.treasury,
        });
      },
      catch: (cause) => cause,
    }),
    (ledger) => Effect.sync(() => ledger.close()),
  );

const reportCycle = (report: ReplenishCycleReport): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const submitted of report.submitted) {
      process.stdout.write(
        `Funding replenisher sent ${formatEther(submitted.amountWei)} ${submitted.asset} to the funding signer (${submitted.hash}).\n`,
      );
    }
    // An exhausted treasury is the one outcome a human has to act on, so it is
    // reported every cycle rather than once.
    for (const decision of report.decisions) {
      if (decision.outcome !== "treasury-exhausted") continue;
      process.stderr.write(
        `Funding replenisher cannot top up ${decision.asset}: the treasury is exhausted.\n`,
      );
    }
    if (report.unsettled > 0) {
      process.stdout.write(
        `Funding replenisher is waiting on ${report.unsettled} in-flight transfer(s).\n`,
      );
    }
  });

const cycle = (
  inputs: ReplenisherInputs,
  chain: ReplenishChain,
  ledger: ReplenishLedger,
): Effect.Effect<void, unknown> =>
  runReplenishCycle({
    chain,
    guard: inputs.guard,
    ledger,
    nowMilliseconds: Date.now,
    policy: inputs.environment.policy,
    replenishmentId: randomUUID,
  }).pipe(Effect.flatMap(reportCycle));

/**
 * A failed cycle must not end the process: the funding worker keeps serving
 * from whatever inventory remains, and the next cycle re-reads the chain.
 */
const supervisedCycle = (
  inputs: ReplenisherInputs,
  chain: ReplenishChain,
  ledger: ReplenishLedger,
): Effect.Effect<void> =>
  cycle(inputs, chain, ledger).pipe(
    Effect.catchAll((cause) =>
      Effect.sync(() => {
        process.stderr.write(
          `Funding replenisher cycle failed: ${cause instanceof Error ? cause.message : String(cause)}; retrying after the configured interval.\n`,
        );
      }),
    ),
  );

export const testnetFundingReplenisher = Effect.scoped(
  Effect.gen(function* () {
    const startup = yield* readRuntimeInputs;
    if (!("environment" in startup)) {
      process.stdout.write(
        "Funding replenisher is disabled; set TESTNET_FUNDING_REPLENISH_ENABLED=true to arm it.\n",
      );
      // Idling rather than exiting: the supervisor treats any child exit as a
      // reason to stop the whole backend group.
      return yield* Effect.never;
    }
    const inputs = startup;
    const ledger = yield* acquireLedger(inputs);
    const chain = chainFor(inputs);
    process.stdout.write(
      `Funding replenisher armed every ${inputs.environment.intervalMilliseconds / 1_000}s; treasury ${inputs.environment.treasury} tops up ${inputs.environment.signer}.\n`,
    );
    yield* Effect.forever(
      supervisedCycle(inputs, chain, ledger).pipe(
        Effect.andThen(Effect.sleep(inputs.environment.intervalMilliseconds)),
      ),
    );
  }),
);

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(testnetFundingReplenisher);
}
