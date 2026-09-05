import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect } from "effect";

import {
  ensure,
  fileSystem,
  requireBindings,
  runMain,
  spawnProcess,
  subprocess,
  validate,
} from "./effect-runtime.ts";
import { createJsonRpcClient } from "./json-rpc.ts";

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

type MutableManifestBase = DeepMutable<ProtocolDeploymentManifest>;
type MutableProtocolDeploymentManifest = Omit<MutableManifestBase, "seals"> & {
  seals: Omit<MutableManifestBase["seals"], "metadata"> & {
    metadata: boolean;
  };
};

/**
 * A governed deployment ends with every module still deployer-owned and the
 * four mutable ones offered to the governance address. FuelCore is never
 * offered, so an outstanding nomination on it would mean the launch, pause,
 * discovery, and blocklist authority is one `acceptOwnership` from moving.
 */
/** The four modules a governed deployment offers, as manifest keys. */
const offeredModuleKeys = [
  "rewardLedger",
  "epochConverter",
  "marketRegistry",
  "protocolLiquidityVault",
] as const;

/** `acceptOwnership()`. */
const acceptOwnershipSelector = "0x79ba5097";
/** No outstanding nomination. */
const zeroAddressLiteral = "0x0000000000000000000000000000000000000000";

const recordsPendingHandover = (
  pending: NonNullable<ProtocolDeploymentManifest["modulePendingOwners"]>,
  governanceOwner: string,
): boolean => {
  const { liquidToken, ...offered } = pending;
  const names = (address: string): boolean =>
    address.toLowerCase() === governanceOwner.toLowerCase();
  return (
    liquidToken === zeroAddressLiteral &&
    Object.values(offered).every((address) => names(address))
  );
};

const teardownTasks: Array<() => void> = [];

const runTeardown = (): void => {
  let task = teardownTasks.pop();
  while (task !== undefined) {
    try {
      task();
    } catch (cause) {
      process.stderr.write(`Teardown step failed: ${String(cause)}\n`);
    }
    task = teardownTasks.pop();
  }
};

runMain(
  Effect.gen(function* () {
    const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
    const deployScript = join(repositoryRoot, "scripts/deploy-protocol.ts");
    const temporaryDirectory = yield* fileSystem(
      "Could not create the local deployment test directory",
      () =>
        mkdtempSync(
          join(repositoryRoot, "deployments/.local-deployment-test-"),
        ),
    );
    teardownTasks.push(() =>
      rmSync(temporaryDirectory, { recursive: true, force: true }),
    );
    const manifestPath = join(temporaryDirectory, "31337.json");
    const port = 20_000 + (process.pid % 10_000);
    const rpcUrl = `http://127.0.0.1:${port}`;
    const anvilArguments = (chainPort: number): readonly string[] => [
      "--silent",
      "--host",
      "127.0.0.1",
      "--port",
      String(chainPort),
      "--chain-id",
      "31337",
      "--accounts",
      "2",
      "--balance",
      "10000",
    ];
    const anvil = yield* spawnProcess("Could not start local Anvil", () =>
      spawn("anvil", [...anvilArguments(port)], { stdio: "ignore" }),
    );
    teardownTasks.push(() => anvil.kill("SIGTERM"));

    const rpcResult = createJsonRpcClient(rpcUrl);

    const waitForChain = (client: typeof rpcResult) =>
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const ready = yield* client("eth_chainId").pipe(
            Effect.as(true),
            Effect.catchAll(() => Effect.succeed(false)),
          );
          if (ready) return;
          yield* Effect.sleep(50);
        }
        yield* ensure(false, "Anvil did not become ready");
      });

    interface DeploymentInputs {
      readonly environment?: NodeJS.ProcessEnv;
      readonly manifestPath?: string;
    }

    const runDeployment = (
      shouldSucceed: boolean,
      inputs: DeploymentInputs = {},
    ) =>
      Effect.gen(function* () {
        const result = yield* subprocess(
          "Could not start deployment verification",
          () =>
            spawnSync(process.execPath, [deployScript], {
              cwd: repositoryRoot,
              env: {
                ...process.env,
                RPC_URL: rpcUrl,
                DEPLOYMENT_MANIFEST_PATH: inputs.manifestPath ?? manifestPath,
                ...inputs.environment,
              },
              encoding: "utf8",
              maxBuffer: 10 * 1024 * 1024,
            }),
        );
        const succeeded = result.status === 0;
        yield* ensure(
          succeeded === shouldSucceed,
          [
            `Deployment verification unexpectedly ${succeeded ? "succeeded" : "failed"}`,
            result.stdout,
            result.stderr,
          ].join("\n"),
        );
      });

    const writeManifest = (
      manifest: ProtocolDeploymentManifest | MutableProtocolDeploymentManifest,
    ) =>
      fileSystem("Could not write the local deployment manifest", () =>
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
      );

    const blockedVenueSlot = Effect.gen(function* () {
      const result = yield* subprocess("Could not start forge inspect", () =>
        spawnSync("forge", ["inspect", "FuelCore", "storageLayout", "--json"], {
          cwd: join(repositoryRoot, "packages", "contracts"),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        }),
      );
      yield* ensure(
        result.error === undefined && result.status === 0,
        `forge inspect failed: ${
          result.error === undefined ? result.stderr : String(result.error)
        }`,
      );
      const layout = yield* validate(
        "Could not read the FuelCore storage layout",
        () =>
          JSON.parse(result.stdout) as {
            storage: ReadonlyArray<{ label: string; slot: string }>;
          },
      );
      const entry = layout.storage.find(
        (slot) => slot.label === "isBlockedVenueCodehash",
      );
      yield* ensure(
        entry !== undefined,
        "FuelCore no longer declares isBlockedVenueCodehash",
      );
      return entry!.slot;
    });

    const cast = (...arguments_: string[]) =>
      Effect.gen(function* () {
        const result = yield* subprocess("Could not start cast", () =>
          spawnSync("cast", arguments_, {
            cwd: repositoryRoot,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
          }),
        );
        // A missing binary surfaces as `error` with a null status; reporting
        // "failed: null" named neither the binary nor the ENOENT.
        yield* ensure(
          result.error === undefined && result.status === 0,
          `cast ${arguments_.join(" ")} failed: ${
            result.error === undefined ? result.stderr : String(result.error)
          }`,
        );
        return result.stdout.trim();
      });

    const governedDeploymentPass = Effect.gen(function* () {
      // A value-bearing deployment sets GOVERNANCE_OWNER_ADDRESS to a reviewed
      // multisig and supplies an alternative-venue inventory. Claim eligibility
      // remains fixed to current Permanent Collectible ownership; governance is
      // deliberately not inserted into ordinary collector claims.
      //
      // It runs on its own chain. The script places exactly one deployment per
      // chain and verifies an existing one instead of placing a second, and
      // Anvil is deterministic enough that the deployment above already
      // occupies the addresses a governed rerun would target.
      const governedPort = port + 1;
      const governedRpcUrl = `http://127.0.0.1:${governedPort}`;
      governedAnvil = yield* spawnProcess(
        "Could not start the governed Anvil",
        () =>
          spawn("anvil", [...anvilArguments(governedPort)], {
            stdio: "ignore",
          }),
      );
      teardownTasks.push(() => governedAnvil?.kill("SIGTERM"));
      const governedRpc = createJsonRpcClient(governedRpcUrl);
      const governedManifestPath = join(
        temporaryDirectory,
        "31337-governed.json",
      );
      const inventoryPath = join(temporaryDirectory, "blocked-venues.json");
      const inventoryCodehash = `0x${"ab".repeat(32)}`;
      const inventoryLabel = "synthetic-local-test-venue";
      yield* fileSystem("Could not write the blocked-venue inventory", () => {
        writeFileSync(
          inventoryPath,
          `${JSON.stringify(
            {
              $schema: "./blocked-venue-schema.json",
              schemaVersion: 1,
              chainId: 31337,
              network: "anvil",
              observedAtBlock: "0",
              entries: [
                {
                  label: inventoryLabel,
                  address: `0x${"cd".repeat(20)}`,
                  codehash: inventoryCodehash,
                  source: "synthetic fixture for the local deployment test",
                  verifiedBy:
                    "not a real contract; the value is asserted on chain below",
                  rationale:
                    "Proves the deployment applies an inventory entry it was given and records its label.",
                },
              ],
            },
            null,
            2,
          )}\n`,
        );
        writeFileSync(
          governedManifestPath,
          readFileSync(join(repositoryRoot, "deployments/31337.json"), "utf8"),
        );
      });
      yield* waitForChain(governedRpc);
      const governedAccounts = yield* governedRpc("eth_accounts");
      const [governedDeployer, governanceOwner] = governedAccounts;
      yield* ensure(
        governedDeployer !== undefined && governanceOwner !== undefined,
        "The governed chain did not expose both deployment test accounts",
      );
      const governedEnvironment: NodeJS.ProcessEnv = {
        BLOCKED_VENUE_INVENTORY_PATH: inventoryPath,
        GOVERNANCE_OWNER_ADDRESS: governanceOwner!,
        RPC_URL: governedRpcUrl,
      };
      const governedInputs = {
        environment: governedEnvironment,
        manifestPath: governedManifestPath,
      };
      yield* runDeployment(true, governedInputs);
      const governedManifestText = yield* fileSystem(
        "Could not read the governed deployment manifest",
        () => readFileSync(governedManifestPath, "utf8"),
      );
      const governedManifest = yield* validate(
        "The governed deployment manifest is invalid",
        () =>
          decodeProtocolDeploymentManifest(
            JSON.parse(governedManifestText) as unknown,
          ),
      );
      const { claimPolicy, moduleOwners, modulePendingOwners } =
        governedManifest;
      yield* ensure(
        moduleOwners !== undefined &&
          claimPolicy !== undefined &&
          modulePendingOwners !== undefined,
        "The governed deployment recorded no module owners, pending owners, or claim policy",
      );
      // The manifest records checksummed addresses; Anvil reports them in lower
      // case, so every comparison below is case-insensitive.
      // An absent record is not a match, so a manifest that omits the field
      // fails the assertion instead of being asserted away.
      const sameAddress = (
        left: string | undefined,
        right: string | undefined,
      ): boolean =>
        left !== undefined &&
        right !== undefined &&
        left.toLowerCase() === right.toLowerCase();
      yield* ensure(
        sameAddress(governedManifest.roles.governanceOwner, governanceOwner!),
        "The governed deployment did not record the configured governance owner",
      );
      // Ownership is two-step, so a deployment cannot push it onto an address
      // that has not accepted. It ends with the deployer still owning every
      // module and the handover only offered, which is what the manifest has to
      // say: recording the governance address as owner would misreport who can
      // act right now.
      yield* ensure(
        Object.values(moduleOwners!).every((owner) =>
          sameAddress(owner, governedDeployer!),
        ),
        "The governed deployment did not record the owners the chain holds",
      );
      // Recording the accepted owners alone cannot tell a handover that was
      // never offered from one offered to the wrong address, and whoever holds
      // a nomination can take the module by accepting it. The nominations are
      // therefore recorded too, and FuelCore must have none.
      yield* ensure(
        recordsPendingHandover(modulePendingOwners!, governanceOwner!),
        "The governed deployment did not record the outstanding handover",
      );
      yield* ensure(
        claimPolicy!.mode === "always-allow" &&
          sameAddress(
            claimPolicy!.administrator,
            "0x0000000000000000000000000000000000000000",
          ),
        "The governed deployment inserted an administrator into claim eligibility",
      );
      // The label travels with the codehash so a health failure can name the
      // venue instead of printing a bare hash.
      yield* ensure(
        governedManifest.blockedVenues?.some(
          (venue) =>
            venue.codehash === inventoryCodehash &&
            venue.label === inventoryLabel,
        ) === true,
        "The governed deployment did not record the blocked-venue inventory",
      );

      // The manifest is written from the same chain reads it records, so it
      // agrees with itself by construction. Reading ownership back over RPC is
      // what proves the deployment actually moved it off the deployer.
      const governedContracts = yield* validate(
        "The governed deployment is missing required contracts",
        () =>
          requireBindings(governedManifest.contracts, [
            "canonicalMarketRegistry",
            "claimGate",
            "epochConverter",
            "fuelCore",
            "protocolLiquidityVault",
            "rewardLedger",
          ] as const),
      );
      // FuelCore is deliberately absent: it keeps the launch, pause, and
      // discovery authority the deployment itself needs, so it is never
      // offered.
      const offeredModules = [
        governedContracts.canonicalMarketRegistry,
        governedContracts.epochConverter,
        governedContracts.protocolLiquidityVault,
        governedContracts.rewardLedger,
      ];
      const namesAddress = (word: string, address: string): boolean =>
        word.toLowerCase().endsWith(address.slice(2).toLowerCase());
      for (const module of offeredModules) {
        const owner = yield* governedRpc("eth_call", [
          { to: module, data: "0x8da5cb5b" },
          "latest",
        ]);
        const pending = yield* governedRpc("eth_call", [
          { to: module, data: "0xe30c3978" },
          "latest",
        ]);
        yield* ensure(
          namesAddress(owner, governedDeployer!) &&
            namesAddress(pending, governanceOwner!),
          `Module ${module} did not offer ownership to the governance owner`,
        );
      }
      const governedGateCode = yield* governedRpc("eth_getCode", [
        governedContracts.claimGate,
        "latest",
      ]);
      const governedGateCodehash = yield* cast("keccak", governedGateCode);
      yield* ensure(
        governedGateCodehash === claimPolicy!.implementationCodehash,
        "The bound claim gate is not the implementation the manifest declares",
      );
      const inventorySlot = yield* cast(
        "index",
        "bytes32",
        inventoryCodehash,
        yield* blockedVenueSlot,
      );
      const inventoryValue = yield* governedRpc("eth_getStorageAt", [
        governedContracts.fuelCore,
        inventorySlot,
        "latest",
      ]);
      yield* ensure(
        BigInt(inventoryValue) === 1n,
        "The blocked-venue inventory entry was not applied on chain",
      );

      yield* runDeployment(true, governedInputs);
      const governedManifestAfterRerun = yield* fileSystem(
        "Could not read the governed manifest after rerun",
        () => readFileSync(governedManifestPath, "utf8"),
      );
      yield* ensure(
        governedManifestAfterRerun === governedManifestText,
        "The governed deployment was not idempotent",
      );
      // Complete the handover the deployment only offered, then re-record the
      // manifest exactly as `pnpm governance:accept` does. Verification has to
      // keep working afterwards: checking every module against one nominal
      // `roles.owner` would fail forever once the governance owner accepts,
      // with no way to re-record out of it.
      yield* Effect.gen(function* () {
        for (const module of offeredModules) {
          yield* governedRpc("eth_sendTransaction", [
            {
              from: governanceOwner!,
              to: module,
              data: acceptOwnershipSelector,
            },
          ]);
        }
        const acceptedManifest = structuredClone(
          governedManifest,
        ) as MutableProtocolDeploymentManifest;
        for (const module of offeredModuleKeys) {
          acceptedManifest.moduleOwners![module] = governanceOwner!;
          acceptedManifest.modulePendingOwners![module] = zeroAddressLiteral;
        }
        yield* fileSystem("Could not write the accepted manifest", () =>
          writeFileSync(
            governedManifestPath,
            `${JSON.stringify(acceptedManifest, null, 2)}\n`,
          ),
        );
        yield* runDeployment(true, governedInputs);

        // And a manifest that still claims the deployer owns them is now
        // wrong, so it must fail rather than pass on a stale record. This is
        // the operational mistake of accepting the handover and forgetting to
        // re-record.
        yield* fileSystem("Could not restore the pre-handover manifest", () =>
          writeFileSync(governedManifestPath, governedManifestText),
        );
        yield* runDeployment(false, governedInputs);

        // A manifest claiming no handover is outstanding, on a deployment
        // whose modules were offered to somebody else, is describing roles it
        // does not have.
        const disownedManifest = structuredClone(
          governedManifest,
        ) as MutableProtocolDeploymentManifest;
        disownedManifest.roles.governanceOwner = governedDeployer!;
        for (const module of offeredModuleKeys) {
          disownedManifest.modulePendingOwners![module] = zeroAddressLiteral;
        }
        yield* fileSystem("Could not write the disowned manifest", () =>
          writeFileSync(
            governedManifestPath,
            `${JSON.stringify(disownedManifest, null, 2)}\n`,
          ),
        );
        yield* runDeployment(false, governedInputs);
      });
    });

    let governedAnvil: ChildProcess | undefined;
    try {
      yield* waitForChain(rpcResult);
      const accounts = yield* rpcResult("eth_accounts");
      const [deployer, alternateAccount] = accounts;
      yield* ensure(
        deployer !== undefined && alternateAccount !== undefined,
        "Anvil did not expose both deployment test accounts",
      );
      yield* fileSystem("Could not seed the local deployment manifest", () =>
        writeFileSync(
          manifestPath,
          readFileSync(join(repositoryRoot, "deployments/31337.json"), "utf8"),
        ),
      );
      yield* runDeployment(true);

      const originalManifestText = yield* fileSystem(
        "Could not read the deployed local manifest",
        () => readFileSync(manifestPath, "utf8"),
      );
      const originalManifest = yield* validate(
        "The deployed local manifest is invalid",
        () =>
          decodeProtocolDeploymentManifest(
            JSON.parse(originalManifestText) as unknown,
          ),
      );
      yield* ensure(
        originalManifest.identity.key === "orbit-4444" &&
          originalManifest.identity.metadataLocations.transient ===
            "placeholder://orbit-4444/grounded-craft",
        "Deployment did not consume the selected product identity",
      );
      const nonceAfterDeployment = yield* rpcResult("eth_getTransactionCount", [
        deployer!,
        "latest",
      ]);
      const reversedTransactionManifest = structuredClone(
        originalManifest,
      ) as MutableProtocolDeploymentManifest;
      reversedTransactionManifest.transactions = Object.fromEntries(
        Object.entries(originalManifest.transactions).reverse(),
      );
      yield* writeManifest(reversedTransactionManifest);
      yield* runDeployment(true);
      const nonceAfterReversedTransactionVerification = yield* rpcResult(
        "eth_getTransactionCount",
        [deployer!, "latest"],
      );
      yield* ensure(
        nonceAfterReversedTransactionVerification === nonceAfterDeployment,
        "Property-order-independent verification changed the deployer nonce",
      );
      yield* fileSystem("Could not restore the canonical local manifest", () =>
        writeFileSync(manifestPath, originalManifestText),
      );
      yield* runDeployment(true);
      const nonceAfterRerun = yield* rpcResult("eth_getTransactionCount", [
        deployer!,
        "latest",
      ]);
      const manifestAfterRerun = yield* fileSystem(
        "Could not read the deployment manifest after rerun",
        () => readFileSync(manifestPath, "utf8"),
      );
      yield* ensure(
        nonceAfterDeployment === nonceAfterRerun &&
          manifestAfterRerun === originalManifestText,
        "Idempotent rerun changed the deployer nonce or manifest",
      );

      const originalContracts = yield* validate(
        "Local deployment is missing required contracts",
        () =>
          requireBindings(originalManifest.contracts, [
            "canonicalRouter",
            "claimGate",
            "discoveryAdapter",
            "fuelCore",
            "recoveryAuthority",
            "testConversionVenue",
          ] as const),
      );
      const mutations: Array<
        (manifest: MutableProtocolDeploymentManifest) => void
      > = [
        (manifest) => {
          manifest.roles.owner = alternateAccount!;
        },
        (manifest) => {
          manifest.canonicalPool.poolId = `0x${"0".repeat(64)}`;
        },
        (manifest) => {
          manifest.identity.manifestHash = `0x${"1".repeat(64)}`;
        },
        (manifest) => {
          manifest.identity.key = "neutral-test";
        },
        (manifest) => {
          manifest.contracts.fuelMirror = originalContracts.fuelCore;
        },
        (manifest) => {
          manifest.contracts.discoveryAdapter = originalContracts.claimGate;
        },
        (manifest) => {
          manifest.contracts.claimGate = originalContracts.discoveryAdapter;
        },
        (manifest) => {
          manifest.contracts.recoveryAuthority = originalContracts.claimGate;
        },
        (manifest) => {
          manifest.seals.metadata = false;
        },
        (manifest) => {
          manifest.transactions = {
            step000: manifest.launch.transactionHash,
          };
        },
      ];
      const { step000: firstTransactionHash } = yield* validate(
        "Local deployment is missing its first transaction",
        () =>
          requireBindings(originalManifest.transactions, ["step000"] as const),
      );
      const firstTransactionReceipt = yield* rpcResult(
        "eth_getTransactionReceipt",
        [firstTransactionHash],
      );
      const checkedFirstReceipt = yield* validate(
        "The first deployment transaction receipt is missing",
        () => {
          if (firstTransactionReceipt === null) {
            throw new Error(
              "The first deployment transaction receipt is missing",
            );
          }
          return firstTransactionReceipt;
        },
      );
      mutations.push((manifest) => {
        manifest.launch.transactionHash = firstTransactionHash;
        manifest.launch.blockNumber = BigInt(
          checkedFirstReceipt.blockNumber,
        ).toString();
      });
      for (const mutate of mutations) {
        const mutated = structuredClone(
          originalManifest,
        ) as MutableProtocolDeploymentManifest;
        mutate(mutated);
        yield* writeManifest(mutated);
        yield* runDeployment(false);
      }
      yield* fileSystem("Could not restore the local deployment manifest", () =>
        writeFileSync(manifestPath, originalManifestText),
      );

      const venueCode = yield* rpcResult("eth_getCode", [
        originalContracts.testConversionVenue,
        "latest",
      ]);
      const blockedVenueCodehash = yield* cast("keccak", venueCode);
      const blockedVenueStorageSlot = yield* cast(
        "index",
        "bytes32",
        blockedVenueCodehash,
        yield* blockedVenueSlot,
      );
      const originalBlockedVenueValue = yield* rpcResult("eth_getStorageAt", [
        originalContracts.fuelCore,
        blockedVenueStorageSlot,
        "latest",
      ]);
      yield* rpcResult("anvil_setStorageAt", [
        originalContracts.fuelCore,
        blockedVenueStorageSlot,
        `0x${"0".repeat(64)}`,
      ]);
      // Not try/finally: a yielded failure short-circuits the generator and a
      // `yield*` inside a finalizing generator is discarded unexecuted, so the
      // restore silently vanished on exactly the failure it existed for.
      yield* runDeployment(false).pipe(
        Effect.ensuring(
          rpcResult("anvil_setStorageAt", [
            originalContracts.fuelCore,
            blockedVenueStorageSlot,
            originalBlockedVenueValue,
          ]).pipe(Effect.ignore),
        ),
      );

      const router = originalContracts.canonicalRouter
        .slice(2)
        .toLowerCase()
        .padStart(64, "0");
      const postLaunchExemptionCall = `0x6bab0ecd${router}${"0".repeat(64)}`;
      const exemptionMutationRejected = yield* rpcResult("eth_call", [
        {
          from: originalManifest.roles.owner,
          to: originalContracts.fuelCore,
          data: postLaunchExemptionCall,
        },
        "latest",
      ]).pipe(
        Effect.as(false),
        Effect.catchAll(() => Effect.succeed(true)),
      );
      yield* ensure(
        exemptionMutationRejected,
        "Discovery exemption remained mutable after launch",
      );

      yield* governedDeploymentPass;

      process.stdout.write(
        "Local deployment, governed redeployment, idempotent rerun, mutation preflights, and launch seals passed\n",
      );
    } finally {
      runTeardown();
    }
  }).pipe(Effect.ensuring(Effect.sync(runTeardown))),
);
