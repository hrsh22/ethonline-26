import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  decodeDeploymentManifest,
  decodeProtocolDeploymentManifest,
  decodeProtocolDeploymentStagingManifest,
  isProtocolDeploymentManifest,
  type ProtocolDeploymentManifest,
  type ProtocolDeploymentStagingManifest,
} from "@orbit/config/deployment-manifest";
import {
  DeploymentEnvironmentNameSchema,
  deploymentEnvironmentConfigurations,
  deploymentEnvironmentForChainId,
  deploymentEnvironmentForName,
  requireDeployableDeploymentEnvironment,
  type DeployableDeploymentEnvironment,
} from "@orbit/config/deployment-environments";
import {
  selectedIdentityConfiguration,
  selectedIdentityKey,
} from "@orbit/config/identity";
import { Effect, Schema } from "effect";

import {
  decodeEnvironment,
  ensure,
  fileSystem,
  requireBindings,
  runMain,
  subprocess,
  validate,
  strippedOfSigningKeys,
} from "./effect-runtime.ts";
import { createJsonRpcClient } from "./json-rpc.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const DeploymentEnvironmentSchema = Schema.Struct({
  RPC_URL: NonEmptyString,
  DEPLOYMENT_ENVIRONMENT: Schema.optional(DeploymentEnvironmentNameSchema),
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(NonEmptyString),
  DEPLOYER_ADDRESS: Schema.optional(NonEmptyString),
  DEPLOYER_PRIVATE_KEY: Schema.optional(NonEmptyString),
  FORCE_PROTOCOL_DEPLOY: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false,
  }),
  DEPLOYMENT_VERBOSE: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false,
  }),
  SELF_FUNDED_TEST_ASSETS: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false,
  }),
  RECOVERY_AUTHORITY_ADDRESS: Schema.optional(NonEmptyString),
});

export const resolveProtocolManifestOutput = (
  target: DeployableDeploymentEnvironment,
  configuredPath: string | undefined,
) => {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const output =
    configuredPath === undefined
      ? join(repositoryRoot, target.manifestPath)
      : resolve(configuredPath);
  for (const environment of Object.values(
    deploymentEnvironmentConfigurations,
  )) {
    if (
      "manifestPath" in environment &&
      environment.name !== target.name &&
      manifestDestination(output) ===
        manifestDestination(resolve(repositoryRoot, environment.manifestPath))
    ) {
      throw new Error(
        `Manifest output belongs to deployment environment ${environment.name}`,
      );
    }
  }
  return output;
};

function manifestDestination(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path
    ? path
    : join(manifestDestination(parent), basename(path));
}

runMain(
  Effect.gen(function* () {
    const setup = yield* Effect.gen(function* () {
      const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
      const contractsRoot = join(repositoryRoot, "packages/contracts");
      const deploymentEnvironment = yield* decodeEnvironment(
        DeploymentEnvironmentSchema,
        "RPC_URL is required and deployment booleans must be true or false",
      );
      const rpcUrl = deploymentEnvironment.RPC_URL;
      const selectedIdentityEnvironment = {
        PRODUCT_IDENTITY_KEY: selectedIdentityKey,
        LIQUID_TOKEN_NAME: selectedIdentityConfiguration.liquidToken.name,
        LIQUID_TOKEN_SYMBOL: selectedIdentityConfiguration.liquidToken.symbol,
        COLLECTIBLE_TOKEN_NAME:
          selectedIdentityConfiguration.collectibleToken.name,
        COLLECTIBLE_TOKEN_SYMBOL:
          selectedIdentityConfiguration.collectibleToken.symbol,
        TRANSIENT_COLLECTIBLE_TERM:
          selectedIdentityConfiguration.terms.transientCollectible,
        PERMANENT_COLLECTIBLE_TERM:
          selectedIdentityConfiguration.terms.permanentCollectible,
        BASKET_RELIC_TERM: selectedIdentityConfiguration.terms.basketRelic,
        INDICATOR_RELIC_TERM:
          selectedIdentityConfiguration.terms.indicatorRelic,
        METADATA_DESCRIPTION: [
          selectedIdentityConfiguration.copy.metadataDescription,
          selectedIdentityConfiguration.disclosures.testnet,
          selectedIdentityConfiguration.disclosures.placeholderMetadata,
        ].join(" "),
        TRANSIENT_METADATA_LOCATION:
          selectedIdentityConfiguration.assets.transient,
        PERMANENT_METADATA_LOCATION:
          selectedIdentityConfiguration.assets.permanent,
        BASKET_RELIC_METADATA_LOCATION:
          selectedIdentityConfiguration.assets.basketRelic,
        INDICATOR_RELIC_METADATA_LOCATION:
          selectedIdentityConfiguration.assets.indicatorRelic,
      };

      const rpc = createJsonRpcClient(rpcUrl, { attempts: 8 });

      const chainId = Number(BigInt(yield* rpc("eth_chainId")));
      yield* ensure(
        chainId === 31_337 || chainId === 84_532,
        `Unsupported deployment chain ${chainId}`,
      );
      const chainEnvironment = requireDeployableDeploymentEnvironment(
        deploymentEnvironment.DEPLOYMENT_ENVIRONMENT === undefined
          ? deploymentEnvironmentForChainId(chainId)
          : deploymentEnvironmentForName(
              deploymentEnvironment.DEPLOYMENT_ENVIRONMENT,
            ),
      );
      yield* ensure(
        chainEnvironment.chainId === chainId,
        `Deployment environment ${chainEnvironment.name} does not match RPC chain ${chainId}`,
      );

      const configuredManifestPath =
        deploymentEnvironment.DEPLOYMENT_MANIFEST_PATH;
      const manifestPath = yield* validate(
        "Invalid deployment manifest output",
        () =>
          resolveProtocolManifestOutput(
            chainEnvironment,
            configuredManifestPath,
          ),
      );

      const readManifest = fileSystem(
        `Could not read deployment manifest at ${manifestPath}`,
        () => readFileSync(manifestPath, "utf8"),
      ).pipe(
        Effect.flatMap((serialized) =>
          validate("Deployment manifest is invalid", () =>
            decodeDeploymentManifest(JSON.parse(serialized) as unknown),
          ),
        ),
      );
      const manifestExists = yield* fileSystem(
        `Could not inspect deployment manifest at ${manifestPath}`,
        () => existsSync(manifestPath),
      );
      const originalManifest = manifestExists
        ? yield* fileSystem("Could not preserve the deployment manifest", () =>
            readFileSync(manifestPath, "utf8"),
          )
        : undefined;
      const localChain = yield* Effect.gen(function* () {
        let completedManifestExists =
          !deploymentEnvironment.FORCE_PROTOCOL_DEPLOY &&
          manifestExists &&
          isProtocolDeploymentManifest(yield* readManifest);
        let localDeployer: string | undefined;
        if (chainId === 31_337) {
          const accounts = yield* rpc("eth_accounts");
          localDeployer = deploymentEnvironment.DEPLOYER_ADDRESS ?? accounts[0];
          yield* ensure(
            localDeployer !== undefined,
            "Anvil exposes no unlocked account",
          );
          if (completedManifestExists) {
            const existingManifest = yield* readManifest;
            const deployerNonce = yield* rpc("eth_getTransactionCount", [
              localDeployer,
              "latest",
            ]);
            const contractCode = yield* Effect.forEach(
              Object.values(existingManifest.contracts),
              (address) => rpc("eth_getCode", [address, "latest"]),
              { concurrency: "unbounded" },
            );
            const freshEmptyChain =
              BigInt(deployerNonce) === 0n &&
              contractCode.every((code) => code === "0x");
            if (freshEmptyChain) completedManifestExists = false;
          }
        }
        return { completedManifestExists, localDeployer };
      });
      return {
        repositoryRoot,
        contractsRoot,
        deploymentEnvironment,
        rpcUrl,
        selectedIdentityEnvironment,
        rpc,
        chainId,
        chainEnvironment,
        manifestPath,
        readManifest,
        originalManifest,
        ...localChain,
      };
    });
    const {
      repositoryRoot,
      contractsRoot,
      deploymentEnvironment,
      rpcUrl,
      selectedIdentityEnvironment,
      rpc,
      chainId,
      chainEnvironment,
      manifestPath,
      readManifest,
      originalManifest,
      completedManifestExists,
      localDeployer,
    } = setup;

    yield* Effect.gen(function* () {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        ...selectedIdentityEnvironment,
        DEPLOYMENT_MANIFEST_PATH: manifestPath,
      };
      const forgeArguments = [
        "script",
        "script/DeployProtocol.s.sol:DeployProtocol",
        "--rpc-url",
        rpcUrl,
        "--rpc-timeout",
        "120",
        "--fork-retries",
        "5",
        "--fork-retry-backoff",
        "1000",
        "--force",
      ];
      if (deploymentEnvironment.DEPLOYMENT_VERBOSE) {
        forgeArguments.push("-vvvv");
      }

      if (!completedManifestExists) {
        environment.FORCE_PROTOCOL_DEPLOY = "true";
        if (chainId === 31_337) {
          yield* ensure(
            localDeployer !== undefined,
            "Anvil exposes no unlocked account",
          );
          environment.DEPLOYER_ADDRESS = localDeployer!;
          forgeArguments.push("--sender", localDeployer!, "--unlocked");
        } else {
          yield* ensure(
            deploymentEnvironment.DEPLOYER_PRIVATE_KEY !== undefined,
            "DEPLOYER_PRIVATE_KEY is required for Base Sepolia",
          );
        }
        forgeArguments.push("--broadcast", "--slow");
      }

      const forge = yield* subprocess("Could not start Forge deployment", () =>
        spawnSync("forge", forgeArguments, {
          cwd: contractsRoot,
          env: environment,
          stdio: "inherit",
        }),
      );
      if (forge.status !== 0) {
        if (!completedManifestExists) {
          if (originalManifest === undefined) {
            yield* fileSystem(
              "Could not remove the failed deployment manifest",
              () => rmSync(manifestPath, { force: true }),
            );
          } else {
            yield* fileSystem("Could not restore the deployment manifest", () =>
              writeFileSync(manifestPath, originalManifest),
            );
          }
        }
        return yield* ensure(
          false,
          `Protocol deployment verification exited with ${forge.status}`,
        );
      }
    });

    const { manifest, contracts } = yield* Effect.gen(function* () {
      let manifest:
        ProtocolDeploymentManifest | ProtocolDeploymentStagingManifest;
      if (completedManifestExists) {
        manifest = yield* readManifest.pipe(
          Effect.flatMap((decodedManifest) =>
            validate(
              "Forge did not produce a launched protocol manifest",
              () => {
                if (!isProtocolDeploymentManifest(decodedManifest)) {
                  throw new Error(
                    "Forge did not produce a launched protocol manifest",
                  );
                }
                return decodedManifest;
              },
            ),
          ),
        );
      } else {
        const stagingText = yield* fileSystem(
          `Could not read Forge staging manifest at ${manifestPath}`,
          () => readFileSync(manifestPath, "utf8"),
        );
        manifest = yield* validate(
          "Forge did not produce an exact protocol staging manifest",
          () =>
            decodeProtocolDeploymentStagingManifest(
              JSON.parse(stagingText) as unknown,
            ),
        );
      }
      const contracts = yield* validate(
        "Deployment manifest is missing required contracts",
        () =>
          requireBindings(manifest.contracts, [
            "attributeRegistry",
            "fuelCore",
            "mockAaplc",
            "uniswapV4PoolManager",
          ] as const),
      );
      if (!completedManifestExists) {
        const broadcastPath = join(
          contractsRoot,
          "broadcast/DeployProtocol.s.sol",
          String(chainId),
          "run-latest.json",
        );
        const broadcastText = yield* fileSystem(
          `Could not read Forge broadcast artifact at ${broadcastPath}`,
          () => readFileSync(broadcastPath, "utf8"),
        );
        const broadcast = yield* validate(
          "Forge broadcast artifact is invalid",
          () =>
            Schema.decodeUnknownSync(
              Schema.Struct({
                transactions: Schema.Array(
                  Schema.Struct({
                    hash: Schema.String,
                    function: Schema.optional(Schema.NullOr(Schema.String)),
                    contractAddress: Schema.optional(
                      Schema.NullOr(Schema.String),
                    ),
                  }),
                ),
                receipts: Schema.Array(
                  Schema.Struct({
                    transactionHash: Schema.String,
                    status: Schema.String,
                    blockNumber: Schema.String,
                    contractAddress: Schema.optional(
                      Schema.NullOr(Schema.String),
                    ),
                  }),
                ),
              }),
            )(JSON.parse(broadcastText) as unknown),
        );
        const transactions = broadcast.transactions;
        const receiptsByHash = new Map(
          broadcast.receipts.map((receipt) => [
            receipt.transactionHash.toLowerCase(),
            receipt,
          ]),
        );
        yield* ensure(
          transactions.length !== 0 &&
            receiptsByHash.size === transactions.length,
          "Broadcast artifact is missing transaction receipts",
        );
        for (const receipt of receiptsByHash.values()) {
          yield* ensure(
            receipt.status === "0x1",
            `Deployment transaction ${receipt.transactionHash} failed`,
          );
        }
        const launchTransactions = transactions.filter(
          (transaction) =>
            transaction.function === "launch()" &&
            transaction.contractAddress?.toLowerCase() ===
              contracts.fuelCore.toLowerCase(),
        );
        const launchTransaction = launchTransactions[0];
        yield* ensure(
          launchTransactions.length === 1 && launchTransaction !== undefined,
          "Broadcast artifact does not contain exactly one Fuel launch",
        );
        const launchReceipt = receiptsByHash.get(
          launchTransaction!.hash.toLowerCase(),
        );
        yield* ensure(
          launchReceipt !== undefined,
          "Fuel launch receipt is missing",
        );
        manifest = yield* validate(
          "Completed deployment manifest is invalid",
          () =>
            decodeProtocolDeploymentManifest({
              ...manifest,
              launch: {
                blockNumber: BigInt(launchReceipt!.blockNumber).toString(),
                transactionHash: launchTransaction!.hash,
              },
              transactions: Object.fromEntries(
                transactions.map((transaction, index) => [
                  `step${index.toString().padStart(3, "0")}`,
                  transaction.hash,
                ]),
              ),
            }),
        );
        yield* fileSystem(
          "Could not write the completed deployment manifest",
          () =>
            writeFileSync(
              manifestPath,
              `${JSON.stringify(manifest, null, 2)}\n`,
            ),
        );
      }
      const completedManifest = yield* validate(
        "Completed deployment manifest is invalid",
        () => decodeProtocolDeploymentManifest(manifest),
      );
      return { manifest: completedManifest, contracts };
    });

    const history = yield* Effect.gen(function* () {
      const transactionEntries = Object.entries(manifest.transactions).sort(
        ([left], [right]) => left.localeCompare(right),
      );
      yield* ensure(
        transactionEntries.length !== 0 &&
          !transactionEntries.some(
            ([key], index) =>
              key !== `step${index.toString().padStart(3, "0")}`,
          ),
        "Deployment manifest transaction steps are incomplete",
      );
      const transactionHashes = transactionEntries.map(([, hash]) => hash);
      yield* ensure(
        new Set(transactionHashes.map((hash) => hash.toLowerCase())).size ===
          transactionHashes.length,
        "Deployment manifest contains duplicate transaction hashes",
      );
      const confirmedPairs = yield* Effect.forEach(
        transactionHashes,
        (hash) =>
          Effect.all([
            rpc("eth_getTransactionReceipt", [hash]),
            rpc("eth_getTransactionByHash", [hash]),
          ] as const),
        { concurrency: 4 },
      );
      const [confirmedReceipts, confirmedTransactions] = yield* validate(
        "A manifest transaction is missing or unsuccessful onchain",
        () =>
          [
            confirmedPairs.map(([receipt]) => {
              if (receipt === null || receipt.status !== "0x1") {
                throw new Error(
                  "A manifest transaction is missing or unsuccessful onchain",
                );
              }
              return receipt;
            }),
            confirmedPairs.map(([, transaction]) => {
              if (transaction === null) {
                throw new Error(
                  "A manifest transaction is missing or unsuccessful onchain",
                );
              }
              return transaction;
            }),
          ] as const,
      );
      const expectedSender = manifest.roles.owner.toLowerCase();
      const transactionIsAttributable = (
        transaction: (typeof confirmedTransactions)[number],
        expectedHash: string,
        contiguousNonce: boolean,
      ) =>
        transaction.hash.toLowerCase() === expectedHash.toLowerCase() &&
        transaction.from.toLowerCase() === expectedSender &&
        transaction.blockNumber !== null &&
        contiguousNonce;
      for (let index = 0; index < confirmedTransactions.length; index += 1) {
        const transaction = confirmedTransactions[index]!;
        const previousTransaction = confirmedTransactions[index - 1];
        const contiguousNonce =
          index === 0
            ? true
            : previousTransaction !== undefined &&
              BigInt(transaction.nonce) ===
                BigInt(previousTransaction.nonce) + 1n;
        const attributable = transactionIsAttributable(
          transaction,
          transactionHashes[index]!,
          contiguousNonce,
        );
        yield* ensure(
          attributable,
          "Deployment transaction history is not contiguous or attributable",
        );
      }
      return {
        confirmedReceipts,
        confirmedTransactions,
        transactionHashes,
      };
    });
    const { confirmedReceipts, confirmedTransactions, transactionHashes } =
      history;

    yield* Effect.gen(function* () {
      const selfFundedTestAssets =
        deploymentEnvironment.SELF_FUNDED_TEST_ASSETS;
      const selectExternallyManagedContracts = () => {
        const names = new Set<string>();
        if (chainId !== 84_532) return names;
        names.add("uniswapV4PoolManager");
        names.add("weth");
        names.add("usdc");
        if (selfFundedTestAssets) {
          names.add("mockAaplc");
          names.add("mockGooglc");
          names.add("mockMetac");
          names.add("mockNvdac");
          names.add("testConversionVenue");
        }
        if (deploymentEnvironment.RECOVERY_AUTHORITY_ADDRESS !== undefined) {
          names.add("recoveryAuthority");
        }
        return names;
      };
      const externallyManagedContracts = selectExternallyManagedContracts();
      const internallyCreatedContracts = new Set([
        "fuelMirror",
        "canonicalFeeHook",
        // The VRF bootstrap creates and configures this consumer atomically so
        // its block-derived subscription ID is never copied from simulation
        // into a later broadcast transaction.
        "discoveryAdapter",
      ]);
      const expectedTopLevelDeployments = Object.entries(manifest.contracts)
        .filter(
          ([name]) =>
            !externallyManagedContracts.has(name) &&
            !internallyCreatedContracts.has(name),
        )
        .map(([, address]) => address.toLowerCase());
      const confirmedTopLevelDeployments = new Set(
        confirmedReceipts
          .map((receipt) => receipt.contractAddress?.toLowerCase())
          .filter((address) => address !== undefined),
      );
      const selectExpectedFirstDeployment = () => {
        if (chainId === 31_337)
          return contracts.uniswapV4PoolManager.toLowerCase();
        return selfFundedTestAssets
          ? contracts.attributeRegistry.toLowerCase()
          : contracts.mockAaplc.toLowerCase();
      };
      const topLevelDeploymentHistoryIsValid = (
        expectedFirstDeployment: string,
      ) => {
        const containsEveryExpectedDeployment =
          !expectedTopLevelDeployments.some(
            (address) => !confirmedTopLevelDeployments.has(address),
          );
        const startsWithExpectedDeployment =
          confirmedReceipts[0]?.contractAddress?.toLowerCase() ===
          expectedFirstDeployment;
        return containsEveryExpectedDeployment && startsWithExpectedDeployment;
      };
      const topLevelHistoryValid = topLevelDeploymentHistoryIsValid(
        selectExpectedFirstDeployment(),
      );
      yield* ensure(
        topLevelHistoryValid,
        "Deployment transaction history omits an expected contract creation",
      );

      const launchIndex = transactionHashes.length - 1;
      const launchTransaction = confirmedTransactions[launchIndex];
      const launchReceipt = confirmedReceipts[launchIndex];
      const launchHash = transactionHashes[launchIndex];
      const launchArtifactsAreComplete = () =>
        launchTransaction !== undefined &&
        launchReceipt !== undefined &&
        launchHash !== undefined;
      const launchTransactionMatchesManifest = () =>
        launchHash?.toLowerCase() ===
          manifest.launch.transactionHash.toLowerCase() &&
        launchTransaction?.to?.toLowerCase() ===
          contracts.fuelCore.toLowerCase() &&
        launchTransaction?.input === "0x01339c21";
      const launchBlockMatchesManifest = () =>
        launchReceipt !== undefined &&
        BigInt(launchReceipt.blockNumber).toString() ===
          manifest.launch.blockNumber;
      const launchHistoryMatchesManifest = () =>
        launchArtifactsAreComplete() &&
        launchTransactionMatchesManifest() &&
        launchBlockMatchesManifest();
      yield* ensure(
        launchHistoryMatchesManifest(),
        "Manifest launch transaction does not match FuelCore.launch()",
      );

      process.stdout.write(
        `Verified ${manifest.network} protocol deployment at ${contracts.fuelCore}\n`,
      );

      const shouldRefreshWebBinding = () =>
        chainEnvironment.name === "development-sepolia" &&
        resolve(manifestPath) ===
          join(repositoryRoot, chainEnvironment.manifestPath);
      if (shouldRefreshWebBinding()) {
        const generated = yield* subprocess(
          "Could not start the web deployment binding generator",
          () =>
            spawnSync(
              process.execPath,
              [
                join(
                  repositoryRoot,
                  "scripts/generate-web-deployment-manifest.ts",
                ),
              ],
              {
                cwd: repositoryRoot,
                // The generator only reads a checked manifest and writes a TS
                // binding. Signing material must not reach processes that do
                // not sign.
                env: strippedOfSigningKeys(process.env),
                stdio: "inherit",
              },
            ),
        );
        yield* ensure(
          generated.status === 0,
          "Could not refresh the checked web deployment binding",
        );
      }
    });
  }),
);
