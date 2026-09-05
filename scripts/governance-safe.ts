import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { resolveRepositoryPath } from "./base-sepolia-manifest.ts";
import {
  SAFE_FALLBACK_HANDLER,
  SAFE_L2_SINGLETON,
  SAFE_PROXY_FACTORY,
  ZERO_ADDRESS,
  safeAbi,
  safeProxyFactoryAbi,
} from "./safe-contracts.ts";
import {
  decodeEnvironment,
  ensure,
  fileSystem,
  runMain,
  validate,
} from "./effect-runtime.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const EnvironmentSchema = Schema.Struct({
  RPC_URL: Schema.optional(NonEmptyString),
  BASE_SEPOLIA_RPC_URL: Schema.optional(NonEmptyString),
  DEPLOYER_PRIVATE_KEY: NonEmptyString,
  DEPLOYER_ADDRESS: Schema.optional(NonEmptyString),
  GOVERNANCE_SAFE_EVIDENCE_PATH: Schema.optional(NonEmptyString),
  GOVERNANCE_SAFE_SALT_NONCE: Schema.optional(NonEmptyString),
});

runMain(
  Effect.gen(function* () {
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const environment = yield* decodeEnvironment(
      EnvironmentSchema,
      "RPC_URL and DEPLOYER_PRIVATE_KEY are required",
    );
    const rpcUrl = yield* validate("RPC_URL is required", () => {
      const selected = environment.RPC_URL ?? environment.BASE_SEPOLIA_RPC_URL;
      if (selected === undefined) throw new Error("RPC_URL is required");
      return selected;
    });
    const account = yield* validate("DEPLOYER_PRIVATE_KEY is invalid", () => {
      const key = environment.DEPLOYER_PRIVATE_KEY.startsWith("0x")
        ? environment.DEPLOYER_PRIVATE_KEY
        : `0x${environment.DEPLOYER_PRIVATE_KEY}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
        throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte hex value");
      }
      return privateKeyToAccount(key as Hex);
    });
    yield* ensure(
      environment.DEPLOYER_ADDRESS === undefined ||
        environment.DEPLOYER_ADDRESS.toLowerCase() ===
          account.address.toLowerCase(),
      "DEPLOYER_ADDRESS does not match DEPLOYER_PRIVATE_KEY",
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

    for (const [label, address] of [
      ["SafeProxyFactory", SAFE_PROXY_FACTORY],
      ["SafeL2 singleton", SAFE_L2_SINGLETON],
      ["CompatibilityFallbackHandler", SAFE_FALLBACK_HANDLER],
    ] as const) {
      const code = yield* Effect.tryPromise({
        try: () => publicClient.getCode({ address }),
        catch: (cause) =>
          new Error(`Could not read ${label}: ${String(cause)}`),
      });
      yield* ensure(
        code !== undefined && code !== "0x",
        `${label} has no code at ${address} on this chain`,
      );
    }

    // A 1-of-1 Safe whose only signer is the deployer does not yet separate
    // governance from the deployer key. What it does buy is that module
    // ownership becomes rotatable for good: Safe owners and threshold are
    // mutable, so signers can be added and the threshold raised later without
    // any further protocol deployment. Until that happens, losing the deployer
    // key still loses governance.
    const initializer = encodeFunctionData({
      abi: safeAbi,
      functionName: "setup",
      args: [
        [account.address],
        1n,
        ZERO_ADDRESS,
        "0x",
        SAFE_FALLBACK_HANDLER,
        ZERO_ADDRESS,
        0n,
        ZERO_ADDRESS,
      ],
    });
    const saltNonce = yield* validate(
      "GOVERNANCE_SAFE_SALT_NONCE must be a decimal integer",
      () => BigInt(environment.GOVERNANCE_SAFE_SALT_NONCE ?? "0"),
    );

    const predicted = yield* Effect.tryPromise({
      try: () =>
        publicClient.simulateContract({
          account,
          address: SAFE_PROXY_FACTORY,
          abi: safeProxyFactoryAbi,
          functionName: "createProxyWithNonce",
          args: [SAFE_L2_SINGLETON, initializer, saltNonce],
        }),
      catch: (cause) =>
        new Error(
          `Safe deployment would revert: ${String(cause)}. The most common cause is re-running after a successful deployment -- the CREATE2 address is occupied, so raise GOVERNANCE_SAFE_SALT_NONCE to deploy a fresh Safe, or reuse the existing one recorded in the evidence file.`,
        ),
    });
    const safeAddress = getAddress(predicted.result as Address);

    const existing = yield* Effect.tryPromise({
      try: () => publicClient.getCode({ address: safeAddress }),
      catch: (cause) =>
        new Error(`Could not read the predicted Safe: ${String(cause)}`),
    });
    yield* ensure(
      existing === undefined || existing === "0x",
      `A contract already exists at ${safeAddress}; raise GOVERNANCE_SAFE_SALT_NONCE to deploy a fresh Safe`,
    );

    const hash = yield* Effect.tryPromise({
      try: () => walletClient.writeContract(predicted.request),
      catch: (cause) =>
        new Error(`Could not send the Safe deployment: ${String(cause)}`),
    });
    const receipt = yield* Effect.tryPromise({
      try: () => publicClient.waitForTransactionReceipt({ hash }),
      catch: (cause) =>
        new Error(`Could not confirm the Safe deployment: ${String(cause)}`),
    });
    yield* ensure(
      receipt.status === "success",
      `The Safe deployment reverted in ${hash}`,
    );
    process.stdout.write(
      `Safe deployed at ${safeAddress} in ${hash} (block ${receipt.blockNumber}).\n`,
    );

    // Read the Safe back rather than trusting the simulation: the point of this
    // script is to produce an address that provably controls itself.
    const [owners, threshold, version] = yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          publicClient.readContract({
            address: safeAddress,
            abi: safeAbi,
            functionName: "getOwners",
          }),
          publicClient.readContract({
            address: safeAddress,
            abi: safeAbi,
            functionName: "getThreshold",
          }),
          publicClient.readContract({
            address: safeAddress,
            abi: safeAbi,
            functionName: "VERSION",
          }),
        ]),
      catch: (cause) =>
        new Error(`Could not verify the deployed Safe: ${String(cause)}`),
    });
    yield* ensure(
      owners.length === 1 &&
        owners[0]?.toLowerCase() === account.address.toLowerCase(),
      "The deployed Safe does not have the deployer as its sole owner",
    );
    yield* ensure(
      threshold === 1n,
      "The deployed Safe has a threshold above 1",
    );

    const evidencePath = resolveRepositoryPath(
      repositoryRoot,
      environment.GOVERNANCE_SAFE_EVIDENCE_PATH,
      "deployments/84532-governance-safe.json",
    );
    yield* fileSystem("Could not write the Safe evidence", () => {
      mkdirSync(dirname(evidencePath), { recursive: true });
      return writeFileSync(
        evidencePath,
        `${JSON.stringify(
          {
            chainId: baseSepolia.id,
            network: "base-sepolia",
            safe: safeAddress,
            singleton: SAFE_L2_SINGLETON,
            fallbackHandler: SAFE_FALLBACK_HANDLER,
            proxyFactory: SAFE_PROXY_FACTORY,
            version,
            owners: owners.map((owner) => getAddress(owner)),
            threshold: threshold.toString(),
            deploymentTransactionHash: hash,
            deploymentBlockNumber: receipt.blockNumber.toString(),
          },
          null,
          2,
        )}\n`,
      );
    });

    process.stdout.write(
      `Deployed a ${threshold}-of-${owners.length} Safe ${version} at ${safeAddress}\n` +
        `Set GOVERNANCE_OWNER_ADDRESS=${safeAddress} before redeploying.\n`,
    );
  }),
);
