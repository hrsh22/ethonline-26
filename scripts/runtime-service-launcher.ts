import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect } from "effect";

import {
  fileSystem,
  runInterruptibleMain,
  runManagedProcess,
  validate,
} from "./effect-runtime.ts";
import {
  createRuntimeServiceEnvironment,
  replaceProcessEnvironment,
  spawnRuntimeServiceProcess,
  type EnvironmentVariables,
  type RuntimeService,
} from "./runtime-environment.ts";
import {
  parseRuntimeEnvironmentProfileArguments,
  readRuntimeEnvironmentProfile,
  type RuntimeEnvironmentProfile,
} from "./runtime-environment-profile.ts";

type RuntimeLaunchTarget = "api" | "history" | "operator" | "operator-watch";

interface RuntimeLaunchConfiguration {
  readonly arguments: readonly string[];
  readonly command: string;
  readonly label: string;
  readonly service: RuntimeService;
}

export interface RuntimeServiceLaunchConfiguration extends RuntimeLaunchConfiguration {
  readonly environmentProfile: RuntimeEnvironmentProfile;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const runtimeLaunchTargets: readonly RuntimeLaunchTarget[] = [
  "api",
  "history",
  "operator",
  "operator-watch",
];

const isRuntimeLaunchTarget = (
  candidate: string | undefined,
): candidate is RuntimeLaunchTarget =>
  candidate !== undefined &&
  runtimeLaunchTargets.includes(candidate as RuntimeLaunchTarget);

const acceptsForwardedArguments = (
  target: RuntimeLaunchTarget,
  forwardedArguments: readonly string[],
): boolean =>
  target === "history"
    ? forwardedArguments.length === 0 ||
      (forwardedArguments.length === 1 && forwardedArguments[0] === "--once")
    : forwardedArguments.length === 0;

const operatorLaunchConfiguration = (
  target: "operator" | "operator-watch",
): RuntimeLaunchConfiguration => ({
  arguments: [
    join(
      repositoryRoot,
      target === "operator"
        ? "scripts/base-sepolia-operator.ts"
        : "scripts/base-sepolia-operator-watch.ts",
    ),
  ],
  command: process.execPath,
  label: target === "operator" ? "Base Sepolia operator" : "operator watch",
  service: "operator",
});

const launchConfigurationByTarget: Readonly<
  Record<
    RuntimeLaunchTarget,
    (forwardedArguments: readonly string[]) => RuntimeLaunchConfiguration
  >
> = {
  api: () => ({
    arguments: [join(repositoryRoot, "apps/api/dist/main.js")],
    command: process.execPath,
    label: "public API",
    service: "api",
  }),
  history: (forwardedArguments) => ({
    arguments: [
      join(repositoryRoot, "scripts/history-indexer.ts"),
      ...forwardedArguments,
    ],
    command: process.execPath,
    label: "history worker",
    service: "history",
  }),
  operator: () => operatorLaunchConfiguration("operator"),
  "operator-watch": () => operatorLaunchConfiguration("operator-watch"),
};

const runtimeLaunchConfiguration = (
  arguments_: readonly string[],
): RuntimeLaunchConfiguration => {
  const [target, ...forwardedArguments] = arguments_;
  if (!isRuntimeLaunchTarget(target)) {
    throw new Error(
      "Runtime service must be api, history, operator, or operator-watch",
    );
  }
  if (!acceptsForwardedArguments(target, forwardedArguments)) {
    throw new Error(`Unexpected ${target} runtime arguments`);
  }
  return launchConfigurationByTarget[target](forwardedArguments);
};

export const runtimeServiceLaunchConfiguration = (
  arguments_: readonly string[],
): RuntimeServiceLaunchConfiguration => {
  const parsed = parseRuntimeEnvironmentProfileArguments(arguments_);
  return {
    ...runtimeLaunchConfiguration(parsed.remainingArguments),
    environmentProfile: parsed.profile,
  };
};

const isolatedEnvironment = (
  host: EnvironmentVariables,
  service: RuntimeService,
  profile: RuntimeEnvironmentProfile,
): NodeJS.ProcessEnv =>
  createRuntimeServiceEnvironment(
    service,
    readRuntimeEnvironmentProfile({
      developmentFileRequired: false,
      environment: host,
      profile,
      repositoryRoot,
    }),
  );

const launcher = Effect.gen(function* () {
  const configuration = yield* validate(
    "Runtime service arguments are invalid",
    () => runtimeServiceLaunchConfiguration(process.argv.slice(2)),
  );
  const isolated = yield* fileSystem(
    "Unable to read the runtime service environment profile",
    () =>
      isolatedEnvironment(
        process.env,
        configuration.service,
        configuration.environmentProfile,
      ),
  );
  replaceProcessEnvironment(isolated);
  yield* runManagedProcess(configuration.label, () =>
    spawnRuntimeServiceProcess({
      ...configuration,
      cwd: repositoryRoot,
      environment: isolated,
      stdio: "inherit",
    }),
  );
});

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(launcher);
}
