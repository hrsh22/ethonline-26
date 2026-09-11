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
import {
  parseRuntimeEnvironmentProfileArguments,
  readRuntimeEnvironmentProfile,
  type RuntimeEnvironmentProfile,
} from "./runtime-environment-profile.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The treasury key must never sit in a process that also holds the deployer,
 * operator, or funding-signer keys, so the replenisher gets the same minimal
 * launcher the funding signer gets: a dedicated file, an exact allowlist, and
 * a child that never sees the shared root environment.
 */
const dedicatedEnvironment = (
  host: EnvironmentVariables,
  profile: RuntimeEnvironmentProfile,
  root: string,
): EnvironmentVariables => {
  const configured = host.TESTNET_FUNDING_REPLENISH_ENV_PATH?.trim();
  if (
    (configured === undefined || configured.length === 0) &&
    profile === "none"
  ) {
    return {};
  }
  const path =
    configured === undefined || configured.length === 0
      ? join(root, ".env.testnet-funding-treasury")
      : resolve(root, configured);
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

export const createReplenisherLauncherEnvironment = (
  host: EnvironmentVariables,
  profile: RuntimeEnvironmentProfile,
  root = repositoryRoot,
): NodeJS.ProcessEnv =>
  createRuntimeServiceEnvironment(
    "funding-replenisher",
    readRuntimeEnvironmentProfile({
      developmentFileRequired: false,
      environment: host,
      profile,
      repositoryRoot: root,
    }),
    dedicatedEnvironment(host, profile, root),
  );

const launchReplenisher = async (): Promise<void> => {
  const parsed = parseRuntimeEnvironmentProfileArguments(process.argv.slice(2));
  if (parsed.remainingArguments.length !== 0) {
    throw new Error(
      "Funding replenisher launcher accepts only environment profile arguments",
    );
  }
  const isolated = createReplenisherLauncherEnvironment(
    process.env,
    parsed.profile,
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
