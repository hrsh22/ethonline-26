import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect, Schema } from "effect";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  encodePacked,
  getAddress,
  http,
  parseAbi,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { resolveRepositoryPath } from "./base-sepolia-manifest.ts";
import {
  decodeEnvironment,
  ensure,
  fileSystem,
  runMain,
  validate,
} from "./effect-runtime.ts";
import { ZERO_ADDRESS, safeAbi } from "./safe-contracts.ts";

const moduleAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function acceptOwnership()",
]);

/**
 * The four modules a governed deployment offers. FuelCore is deliberately
 * absent: it keeps the launch, pause, discovery, and blocklist authority the
 * deployment itself needs, so it is never nominated.
 */
const OFFERED_MODULES = [
  ["rewardLedger", "rewardLedger"],
  ["epochConverter", "epochConverter"],
  ["marketRegistry", "canonicalMarketRegistry"],
  ["protocolLiquidityVault", "protocolLiquidityVault"],
] as const;

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const EnvironmentSchema = Schema.Struct({
  RPC_URL: Schema.optional(NonEmptyString),
  BASE_SEPOLIA_RPC_URL: Schema.optional(NonEmptyString),
  DEPLOYER_PRIVATE_KEY: NonEmptyString,
  GOVERNANCE_OWNER_ADDRESS: NonEmptyString,
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(NonEmptyString),
});

runMain(
  Effect.gen(function* () {
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const environment = yield* decodeEnvironment(
      EnvironmentSchema,
      "RPC_URL, DEPLOYER_PRIVATE_KEY, and GOVERNANCE_OWNER_ADDRESS are required",
    );
    const rpcUrl = yield* validate("RPC_URL is required", () => {
      const selected = environment.RPC_URL ?? environment.BASE_SEPOLIA_RPC_URL;
      if (selected === undefined) throw new Error("RPC_URL is required");
      return selected;
    });
    const safeAddress = yield* validate(
      "GOVERNANCE_OWNER_ADDRESS is not an address",
      () => getAddress(environment.GOVERNANCE_OWNER_ADDRESS),
    );
    const account = yield* validate("DEPLOYER_PRIVATE_KEY is invalid", () => {
      const key = environment.DEPLOYER_PRIVATE_KEY.startsWith("0x")
        ? environment.DEPLOYER_PRIVATE_KEY
        : `0x${environment.DEPLOYER_PRIVATE_KEY}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
        throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte hex value");
      }
      return privateKeyToAccount(key as Hex);
    });

    const manifestPath = resolveRepositoryPath(
      repositoryRoot,
      environment.DEPLOYMENT_MANIFEST_PATH,
      "deployments/84532.json",
    );
    const manifestText = yield* fileSystem(
      "Could not read the deployment manifest",
      () => readFileSync(manifestPath, "utf8"),
    );
    const manifest = yield* validate("The deployment manifest is invalid", () =>
      decodeProtocolDeploymentManifest(JSON.parse(manifestText) as unknown),
    );

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });

    const owners = yield* Effect.tryPromise({
      try: () =>
        publicClient.readContract({
          address: safeAddress,
          abi: safeAbi,
          functionName: "getOwners",
        }),
      catch: (cause) =>
        new Error(`${safeAddress} is not a readable Safe: ${String(cause)}`),
    });
    yield* ensure(
      owners.some(
        (owner) => owner.toLowerCase() === account.address.toLowerCase(),
      ),
      "The deployer is not an owner of the governance Safe, so it cannot execute the handover",
    );
    const threshold = yield* Effect.tryPromise({
      try: () =>
        publicClient.readContract({
          address: safeAddress,
          abi: safeAbi,
          functionName: "getThreshold",
        }),
      catch: (cause) =>
        new Error(`Could not read the Safe threshold: ${String(cause)}`),
    });
    // The single pre-validated signature below satisfies checkNSignatures only
    // for a threshold-1 Safe. Once signers are added and the threshold raised,
    // every execTransaction reverts with a raw GS020 that says nothing about
    // why -- so refuse up front with the actual instruction.
    yield* ensure(
      threshold === 1n,
      `The governance Safe requires ${threshold} signatures; this script can only execute for a 1-of-N Safe. Collect the off-chain signatures and execute acceptOwnership through the Safe app or SDK instead.`,
    );

    /**
     * A pre-validated Safe signature. With `v = 1` the Safe accepts the owner
     * named in `r` when that owner is the caller, so a threshold-1 Safe whose
     * signer sends the transaction needs no off-chain signing at all.
     */
    const signature = encodePacked(
      ["uint256", "uint256", "uint8"],
      [BigInt(account.address), 0n, 1],
    );

    const accepted: Array<{ module: string; transactionHash: Hex }> = [];
    for (const [manifestKey, contractKey] of OFFERED_MODULES) {
      const moduleAddress = manifest.contracts[contractKey] as
        Address | undefined;
      yield* ensure(
        moduleAddress !== undefined,
        `The manifest does not record a ${contractKey} address`,
      );
      const pending = yield* Effect.tryPromise({
        try: () =>
          publicClient.readContract({
            address: moduleAddress!,
            abi: moduleAbi,
            functionName: "pendingOwner",
          }),
        catch: (cause) =>
          new Error(
            `Could not read ${manifestKey} pendingOwner: ${String(cause)}`,
          ),
      });
      // A partial earlier run leaves some modules already accepted -- their
      // nomination is spent and their owner is the Safe. Treating that as an
      // error made the script unresumable after any mid-loop RPC failure, and
      // the manifest re-record below never ran; recovery meant hand-editing
      // the manifest, which this script exists to prevent.
      if (pending.toLowerCase() === ZERO_ADDRESS) {
        const currentOwner = yield* Effect.tryPromise({
          try: () =>
            publicClient.readContract({
              address: moduleAddress!,
              abi: moduleAbi,
              functionName: "owner",
            }),
          catch: (cause) =>
            new Error(`Could not read ${manifestKey} owner: ${String(cause)}`),
        });
        yield* ensure(
          currentOwner.toLowerCase() === safeAddress.toLowerCase(),
          `${manifestKey} has no outstanding nomination and is owned by ${currentOwner}, not the Safe; a different party completed a handover`,
        );
        accepted.push({ module: manifestKey, transactionHash: "0x" as Hex });
        continue;
      }
      // Accepting a nomination that does not name this Safe would either revert
      // or, worse, hand the module to whoever the deployment actually named.
      yield* ensure(
        pending.toLowerCase() === safeAddress.toLowerCase(),
        `${manifestKey} offers ownership to ${pending}, not to ${safeAddress}`,
      );

      const hash = yield* Effect.tryPromise({
        try: () =>
          walletClient.writeContract({
            address: safeAddress,
            abi: safeAbi,
            functionName: "execTransaction",
            args: [
              moduleAddress!,
              0n,
              encodeFunctionData({
                abi: moduleAbi,
                functionName: "acceptOwnership",
              }),
              0,
              0n,
              0n,
              0n,
              ZERO_ADDRESS,
              ZERO_ADDRESS,
              signature,
            ],
          }),
        catch: (cause) =>
          new Error(`Could not accept ${manifestKey}: ${String(cause)}`),
      });
      const receipt = yield* Effect.tryPromise({
        try: () => publicClient.waitForTransactionReceipt({ hash }),
        catch: (cause) =>
          new Error(
            `Could not confirm ${manifestKey} acceptance: ${String(cause)}`,
          ),
      });
      yield* ensure(
        receipt.status === "success",
        `Accepting ${manifestKey} reverted in ${hash}`,
      );

      // Safe swallows an inner revert into a failure event rather than
      // reverting execTransaction, so a successful receipt is not proof the
      // handover happened. Read it back.
      const [owner, remaining] = yield* Effect.tryPromise({
        try: () =>
          Promise.all([
            publicClient.readContract({
              address: moduleAddress!,
              abi: moduleAbi,
              functionName: "owner",
            }),
            publicClient.readContract({
              address: moduleAddress!,
              abi: moduleAbi,
              functionName: "pendingOwner",
            }),
          ]),
        catch: (cause) =>
          new Error(`Could not verify ${manifestKey}: ${String(cause)}`),
      });
      yield* ensure(
        owner.toLowerCase() === safeAddress.toLowerCase(),
        `${manifestKey} still reports ${owner} as owner after acceptance`,
      );
      yield* ensure(
        remaining === ZERO_ADDRESS,
        `${manifestKey} still carries a nomination after acceptance`,
      );
      accepted.push({ module: manifestKey, transactionHash: hash });
    }

    // The manifest now describes a deployment that no longer exists: it records
    // the deployer as owner and the Safe as pending. Health checks both, so it
    // would fail until the manifest is re-recorded. Doing that here keeps the
    // repair mechanical instead of a hand edit nobody remembers to make.
    const updated = JSON.parse(manifestText) as {
      moduleOwners?: Record<string, string>;
      modulePendingOwners?: Record<string, string>;
    };
    yield* ensure(
      updated.moduleOwners !== undefined &&
        updated.modulePendingOwners !== undefined,
      "The manifest predates module ownership recording, so it cannot be re-recorded",
    );
    for (const [manifestKey] of OFFERED_MODULES) {
      updated.moduleOwners![manifestKey] = safeAddress;
      updated.modulePendingOwners![manifestKey] = ZERO_ADDRESS;
    }
    yield* validate("The re-recorded manifest is invalid", () =>
      decodeProtocolDeploymentManifest(updated as unknown),
    );
    yield* fileSystem("Could not write the re-recorded manifest", () =>
      writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`),
    );

    process.stdout.write(
      `${accepted.length} modules now owned by the governance Safe ${safeAddress}:\n` +
        accepted
          .map(({ module, transactionHash }) =>
            transactionHash === "0x"
              ? `  ${module} (already accepted)`
              : `  ${module} ${transactionHash}`,
          )
          .join("\n") +
        `\n${manifestPath} re-recorded. Commit it, then run the health check.\n`,
    );
  }),
);
