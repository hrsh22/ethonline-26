import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect, Schema } from "effect";

import {
  decodeEnvironment,
  ensure,
  fileSystem,
  network,
  requireBindings,
  runMain,
  spawnProcess,
  subprocess,
  validate,
} from "./effect-runtime.ts";
import { createJsonRpcClient } from "./json-rpc.ts";
import { decodeForkSmokeEvidence } from "./smoke-evidence.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const ForkEnvironmentSchema = Schema.Struct({
  BASE_SEPOLIA_RPC_URL: NonEmptyString,
  DEPLOYER_PRIVATE_KEY: NonEmptyString,
  DEPLOYER_ADDRESS: NonEmptyString,
});

/**
 * Teardown that survives failure. `Effect.gen` does not run a generator's
 * `finally` when a yielded effect fails, so a failed assertion previously left
 * the forked Anvil running -- holding the event loop open until the job timed
 * out -- and left its temporary directory behind.
 */
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
    const repositoryRoot = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
    );
    const environment = yield* decodeEnvironment(
      ForkEnvironmentSchema,
      "BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, and DEPLOYER_ADDRESS are required",
    );
    const upstreamRpcUrl = environment.BASE_SEPOLIA_RPC_URL;
    const deployerPrivateKey = environment.DEPLOYER_PRIVATE_KEY;
    const deployerAddress = environment.DEPLOYER_ADDRESS;

    const freePort = yield* network(
      "Could not reserve an Anvil port",
      () =>
        new Promise<number>((resolvePort, reject) => {
          const server = createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (typeof address !== "object" || address === null) {
              reject(new Error("Could not reserve an Anvil port"));
              return;
            }
            const { port } = address;
            server.close((error) =>
              error ? reject(error) : resolvePort(port),
            );
          });
        }),
    );

    const rpcUrl = `http://127.0.0.1:${freePort}`;
    const temporaryDirectory = yield* fileSystem(
      "Could not create the Base Sepolia fork test directory",
      () => mkdtempSync(join(repositoryRoot, "deployments/.fork-deployment-")),
    );
    teardownTasks.push(() => {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    });
    const manifestPath = join(temporaryDirectory, "84532.json");
    const sourceManifestPath = join(repositoryRoot, "deployments/84532.json");
    const sourceManifestText = yield* fileSystem(
      "Could not read the Base Sepolia source manifest",
      () => readFileSync(sourceManifestPath, "utf8"),
    );
    const sourceManifest = yield* validate(
      "The Base Sepolia source manifest is invalid",
      () =>
        decodeProtocolDeploymentManifest(
          JSON.parse(sourceManifestText) as unknown,
        ),
    );
    const sourceContracts = yield* validate(
      "The Base Sepolia source manifest is missing venue contracts",
      () =>
        requireBindings(sourceManifest.contracts, [
          "mockAaplc",
          "mockGooglc",
          "mockMetac",
          "mockNvdac",
          "testConversionVenue",
          "uniswapV4PoolManager",
          "usdc",
          "weth",
        ] as const),
    );
    const venueOnlyManifest = {
      $schema: "./schema.json",
      schemaVersion: 1,
      chainId: 84_532,
      network: "base-sepolia",
      contracts: {
        mockAaplc: sourceContracts.mockAaplc,
        mockGooglc: sourceContracts.mockGooglc,
        mockMetac: sourceContracts.mockMetac,
        mockNvdac: sourceContracts.mockNvdac,
        selfFundedTestUsdc: sourceContracts.usdc,
        selfFundedTestWeth: sourceContracts.weth,
        testConversionVenue: sourceContracts.testConversionVenue,
        uniswapV4PoolManager: sourceContracts.uniswapV4PoolManager,
      },
      conversionPools: sourceManifest.conversionPools,
    };
    yield* fileSystem("Could not write the fork deployment seed manifest", () =>
      writeFileSync(
        manifestPath,
        `${JSON.stringify(venueOnlyManifest, null, 2)}\n`,
      ),
    );
    const forkProcessEnvironment: NodeJS.ProcessEnv = { ...process.env };
    delete forkProcessEnvironment.RECOVERY_AUTHORITY_ADDRESS;

    const anvil = yield* spawnProcess("Could not start forked Anvil", () =>
      spawn(
        "anvil",
        [
          "--fork-url",
          upstreamRpcUrl,
          "--chain-id",
          "84532",
          "--port",
          String(freePort),
          "--silent",
        ],
        { stdio: "ignore" },
      ),
    );
    teardownTasks.push(() => {
      anvil.kill("SIGTERM");
    });

    const rpcResult = createJsonRpcClient(rpcUrl);

    {
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        ready = yield* rpcResult("eth_chainId").pipe(
          Effect.map((chainId) => chainId === "0x14a34"),
          Effect.catchAll(() => Effect.succeed(false)),
        );
        if (ready) break;
        yield* Effect.sleep(250);
      }
      yield* ensure(ready, "Forked Anvil did not become ready");

      yield* rpcResult("anvil_setBalance", [
        deployerAddress,
        "0x3635c9adc5dea00000",
      ]);

      const protocolEnvironment: NodeJS.ProcessEnv = {
        ...forkProcessEnvironment,
        RPC_URL: rpcUrl,
        DEPLOYMENT_MANIFEST_PATH: manifestPath,
        SELF_FUNDED_TEST_ASSETS: "true",
        DEPLOYER_PRIVATE_KEY: deployerPrivateKey,
        GUARDIAN_ADDRESS: deployerAddress,
        KEEPER_ADDRESS: deployerAddress,
        LIQUIDITY_EXECUTOR_ADDRESS: deployerAddress,
        CREATOR_ADDRESS: deployerAddress,
        RECOVERY_COSIGNER_ADDRESS: "0x0000000000000000000000000000000000000B0B",
      };
      const deployment = yield* subprocess(
        "Could not start the fork deployment",
        () =>
          spawnSync(
            process.execPath,
            [join(repositoryRoot, "scripts/deploy-protocol.ts")],
            {
              cwd: repositoryRoot,
              env: protocolEnvironment,
              stdio: "inherit",
            },
          ),
      );
      yield* ensure(
        deployment.status === 0,
        `Fork deployment exited with ${deployment.status}`,
      );

      const manifestText = yield* fileSystem(
        "Could not read the fork deployment manifest",
        () => readFileSync(manifestPath, "utf8"),
      );
      const manifest = yield* validate(
        "The fork deployment manifest is invalid",
        () =>
          decodeProtocolDeploymentManifest(JSON.parse(manifestText) as unknown),
      );
      const manifestContracts = yield* validate(
        "The fork deployment manifest is missing protocol contracts",
        () =>
          requireBindings(manifest.contracts, [
            "fuelCore",
            "recoveryAuthority",
          ] as const),
      );
      const expectedContracts = sourceContracts;
      const reusedContracts = {
        weth: expectedContracts.weth,
        usdc: expectedContracts.usdc,
        mockAaplc: expectedContracts.mockAaplc,
        mockGooglc: expectedContracts.mockGooglc,
        mockMetac: expectedContracts.mockMetac,
        mockNvdac: expectedContracts.mockNvdac,
        testConversionVenue: expectedContracts.testConversionVenue,
        uniswapV4PoolManager: expectedContracts.uniswapV4PoolManager,
      };
      for (const name of Object.keys(reusedContracts) as Array<
        keyof typeof reusedContracts
      >) {
        const expectedAddress = reusedContracts[name];
        yield* ensure(
          manifest.contracts[name].toLowerCase() ===
            expectedAddress.toLowerCase(),
          `Fork deployment did not reuse ${name}`,
        );
      }
      yield* ensure(
        manifest.schemaVersion === 2 && manifest.phase === "launched",
        "Fork deployment did not produce a launched schema-v2 manifest",
      );
      const recoveryCode = yield* rpcResult("eth_getCode", [
        manifestContracts.recoveryAuthority,
        "latest",
      ]);
      yield* ensure(
        manifestContracts.recoveryAuthority.toLowerCase() ===
          manifest.roles.recoveryAuthority.toLowerCase() &&
          recoveryCode !== "0x",
        "Fork deployment did not deploy its threshold authority",
      );

      const evidencePath = join(temporaryDirectory, "84532-evidence.json");
      const smoke = yield* subprocess(
        "Could not start the fork smoke test",
        () =>
          spawnSync(
            process.execPath,
            [join(repositoryRoot, "scripts/smoke-base-sepolia.ts")],
            {
              cwd: repositoryRoot,
              env: {
                ...forkProcessEnvironment,
                RPC_URL: rpcUrl,
                DEPLOYMENT_MANIFEST_PATH: manifestPath,
                SMOKE_EVIDENCE_PATH: evidencePath,
                SMOKE_FORK: "true",
                DEPLOYER_ADDRESS: deployerAddress,
                DEPLOYER_PRIVATE_KEY: deployerPrivateKey,
              },
              stdio: "inherit",
            },
          ),
      );
      yield* ensure(
        smoke.status === 0,
        `Fork smoke exited with ${smoke.status}`,
      );
      const evidenceText = yield* fileSystem(
        "Could not read fork smoke evidence",
        () => readFileSync(evidencePath, "utf8"),
      );
      const evidence = yield* validate("Fork smoke evidence is invalid", () =>
        decodeForkSmokeEvidence(JSON.parse(evidenceText) as unknown),
      );
      yield* ensure(
        !evidence.healthSnapshots.some(
          (snapshot) => snapshot.rpcFailures.length !== 0,
        ) &&
          evidence.failedTrack.retainedQueue !== "0" &&
          evidence.invariants.polFuelAfter === "0",
        "Fork smoke evidence did not reconcile",
      );

      const manifestAfterSmoke = yield* fileSystem(
        "Could not read the manifest after the fork smoke test",
        () => readFileSync(manifestPath, "utf8"),
      );
      const nonceAfterSmoke = yield* rpcResult("eth_getTransactionCount", [
        deployerAddress,
        "latest",
      ]);
      const postTradeVerification = yield* subprocess(
        "Could not start post-trade deployment verification",
        () =>
          spawnSync(
            process.execPath,
            [join(repositoryRoot, "scripts/deploy-protocol.ts")],
            {
              cwd: repositoryRoot,
              env: protocolEnvironment,
              stdio: "inherit",
            },
          ),
      );
      yield* ensure(
        postTradeVerification.status === 0,
        `Post-trade deployment verification exited with ${postTradeVerification.status}`,
      );
      const nonceAfterVerification = yield* rpcResult(
        "eth_getTransactionCount",
        [deployerAddress, "latest"],
      );
      const manifestAfterVerification = yield* fileSystem(
        "Could not read the manifest after post-trade verification",
        () => readFileSync(manifestPath, "utf8"),
      );
      yield* ensure(
        nonceAfterVerification === nonceAfterSmoke &&
          manifestAfterVerification === manifestAfterSmoke,
        "Post-trade verification broadcast or rewrote the manifest",
      );
      process.stdout.write(
        `Verified self-funded Base Sepolia fork deployment and post-trade rerun at ${manifestContracts.fuelCore}\n`,
      );
    }
  }).pipe(Effect.ensuring(Effect.sync(runTeardown))),
);
