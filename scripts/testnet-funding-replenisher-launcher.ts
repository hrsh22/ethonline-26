import type { ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRuntimeServiceEnvironment,
  readRuntimeEnvironmentSource,
  replaceProcessEnvironment,
  spawnRuntimeServiceProcess,
  type EnvironmentVariables,
} from "./runtime-environment.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The treasury key must never sit in a process that also holds the deployer,
 * operator, or funding-signer keys, so the replenisher gets the same minimal
 * launcher the funding signer gets: a dedicated file, an exact allowlist, and
 * a child that never sees the shared root environment.
 */
const dedicatedEnvironment = (
  host: EnvironmentVariables,
): EnvironmentVariables => {
  const configured = host.TESTNET_FUNDING_REPLENISH_ENV_PATH?.trim();
  const path =
    configured === undefined || configured.length === 0
      ? join(repositoryRoot, ".env.testnet-funding-treasury")
      : resolve(repositoryRoot, configured);
  return readRuntimeEnvironmentSource({
    environment: {},
    path,
    required: false,
  });
};

const terminationSignals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

const waitForChild = (child: ChildProcess): Promise<number> =>
  new Promise((resolveExit, reject) => {
    const forwarders = terminationSignals.map((signal) => {
      const forward = (): void => {
        child.kill(signal);
      };
      process.once(signal, forward);
      return { signal, forward };
    });
    const cleanup = (): void => {
      for (const { signal, forward } of forwarders) {
        process.off(signal, forward);
      }
    };
    child.once("error", (cause) => {
      cleanup();
      reject(cause);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolveExit(signal === null ? (code ?? 1) : 128);
    });
  });

const launchReplenisher = async (): Promise<void> => {
  // The supervisor loads the root .env before projecting, so a supervised
  // child sees the shared browser-public and RPC bindings and a standalone one
  // did not: the signer refused to start on its own. The allowlist still
  // strips everything else, and the dedicated file still wins.
  const isolated = createRuntimeServiceEnvironment(
    "funding-replenisher",
    readRuntimeEnvironmentSource({
      environment: process.env,
      path: join(repositoryRoot, ".env"),
      required: false,
    }),
    dedicatedEnvironment(process.env),
  );
  replaceProcessEnvironment(isolated);
  const child = spawnRuntimeServiceProcess({
    arguments: [join(repositoryRoot, "scripts/testnet-funding-replenisher.ts")],
    command: process.execPath,
    cwd: repositoryRoot,
    environment: isolated,
    service: "funding-replenisher",
    stdio: "inherit",
  });
  process.exitCode = await waitForChild(child);
};

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await launchReplenisher();
}
