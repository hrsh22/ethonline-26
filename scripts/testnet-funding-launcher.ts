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

const dedicatedEnvironment = (
  host: EnvironmentVariables,
  profile: RuntimeEnvironmentProfile,
  root: string,
): EnvironmentVariables => {
  const configured = host.TESTNET_FUNDING_ENV_PATH?.trim();
  if (
    (configured === undefined || configured.length === 0) &&
    profile === "none"
  ) {
    return {};
  }
  const path =
    configured === undefined || configured.length === 0
      ? join(
          root,
          profile === "staging"
            ? ".env.testnet-funding.staging"
            : ".env.testnet-funding",
        )
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

export const createTestnetFundingLauncherEnvironment = (
  host: EnvironmentVariables,
  profile: RuntimeEnvironmentProfile,
  root = repositoryRoot,
): NodeJS.ProcessEnv => {
  const environment = readRuntimeEnvironmentProfile({
    developmentFileRequired: false,
    environment: host,
    profile,
    repositoryRoot: root,
  });
  return createRuntimeServiceEnvironment(
    "funding",
    environment,
    dedicatedEnvironment(environment, profile, root),
  );
};

const launchTestnetFundingWorker = async (): Promise<void> => {
  const parsed = parseRuntimeEnvironmentProfileArguments(process.argv.slice(2));
  if (parsed.remainingArguments.length !== 0) {
    throw new Error(
      "Funding launcher accepts only environment profile arguments",
    );
  }
  const isolated = createTestnetFundingLauncherEnvironment(
    process.env,
    parsed.profile,
  );
  replaceProcessEnvironment(isolated);
  const child = spawnRuntimeServiceProcess({
    arguments: [join(repositoryRoot, "scripts/testnet-funding-worker.ts")],
    command: process.execPath,
    cwd: repositoryRoot,
    environment: isolated,
    service: "funding",
    stdio: "inherit",
  });
  process.exitCode = await waitForChild(child);
};

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await launchTestnetFundingWorker();
}
