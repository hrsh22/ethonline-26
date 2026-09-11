import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect, Schema } from "effect";

import { normalizePublicApiBaseUrl } from "@orbit/config/public-api";

import {
  fileSystem,
  nonBlankString,
  runInterruptibleMain,
  runManagedProcess,
} from "./effect-runtime.ts";
import {
  nextRuntimeArguments,
  type NextRuntimeSubcommand,
} from "./next-runtime-command.ts";
import {
  createRuntimeProcessEnvironment,
  createRuntimeServiceEnvironment,
  replaceProcessEnvironment,
  spawnRuntimeServiceProcess,
} from "./runtime-environment.ts";
import { readRuntimeEnvironmentProfile } from "./runtime-environment-profile.ts";

type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export type WebRuntimeTarget =
  | "browser"
  | "browser:self"
  | "build"
  | "dev"
  | "dev:local"
  | "dev:staging"
  | "start"
  | "typecheck";

interface WebRuntimeCommand {
  readonly arguments: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly label: string;
}

const StagingWebEnvironmentSchema = Schema.Struct({
  BASE_SEPOLIA_RPC_URL: Schema.optional(Schema.String),
  NEXT_PUBLIC_API_URL: Schema.optional(Schema.String),
  RPC_URL: Schema.optional(Schema.String),
});

type StagingWebEnvironmentBindings = typeof StagingWebEnvironmentSchema.Type;

export interface StagingWebEnvironment {
  readonly publicApiUrl: string;
  readonly rpcUrl: string;
}

interface WebRuntimeLaunchPlan {
  readonly supervisorEnvironment: NodeJS.ProcessEnv;
  readonly webEnvironment: NodeJS.ProcessEnv;
}

export interface StagingWebLaunchPlan extends WebRuntimeLaunchPlan {
  readonly configuration: StagingWebEnvironment;
}

const stagingWebEnvironment = (
  environment: StagingWebEnvironmentBindings,
): StagingWebEnvironment => {
  const rpcUrl =
    nonBlankString(environment.RPC_URL) ??
    nonBlankString(environment.BASE_SEPOLIA_RPC_URL);
  if (rpcUrl === undefined) {
    throw new Error("RPC_URL or BASE_SEPOLIA_RPC_URL is required for pnpm dev");
  }
  const publicApiUrl = nonBlankString(environment.NEXT_PUBLIC_API_URL);
  if (publicApiUrl === undefined) {
    throw new Error("NEXT_PUBLIC_API_URL is required for pnpm dev");
  }
  return {
    publicApiUrl: normalizePublicApiBaseUrl(publicApiUrl),
    rpcUrl,
  };
};

const decodeStagingWebEnvironment = Schema.decodeUnknownSync(
  StagingWebEnvironmentSchema,
);

export const resolveStagingWebEnvironment = (
  environment: EnvironmentVariables,
): StagingWebEnvironment =>
  stagingWebEnvironment(decodeStagingWebEnvironment(environment));

export const normalizeCanonicalApplicationUrl = (
  value: string | undefined,
): string => {
  const configured = nonBlankString(value);
  if (configured === undefined) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is required for a production web build",
    );
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a canonical HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL must be a canonical HTTPS origin");
  }
  return url.origin;
};

export const createWebEnvironment = (
  configuration: StagingWebEnvironment,
  environment: NodeJS.ProcessEnv,
  deploymentEnvironment = "staging",
): NodeJS.ProcessEnv =>
  createRuntimeServiceEnvironment("web", {
    ...environment,
    NEXT_PUBLIC_API_URL: configuration.publicApiUrl,
    NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    NEXT_PUBLIC_RPC_URL: configuration.rpcUrl,
  });

const createConfiguredWebLaunchPlan = (
  environment: EnvironmentVariables,
  deploymentEnvironment: "development-sepolia" | "staging",
): StagingWebLaunchPlan => {
  const configuration = resolveStagingWebEnvironment(environment);
  return {
    configuration,
    supervisorEnvironment: createRuntimeProcessEnvironment(environment),
    webEnvironment: createWebEnvironment(
      configuration,
      environment,
      deploymentEnvironment,
    ),
  };
};

export const createStagingWebLaunchPlan = (
  environment: EnvironmentVariables,
): StagingWebLaunchPlan =>
  createConfiguredWebLaunchPlan(environment, "staging");

export const createDevelopmentSepoliaWebLaunchPlan = (
  environment: EnvironmentVariables,
): StagingWebLaunchPlan =>
  createConfiguredWebLaunchPlan(environment, "development-sepolia");

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(repositoryRoot, "apps/web");
const typeScriptCli = join(webRoot, "node_modules/typescript/bin/tsc");

export const assertNoUncheckedNextEnvironmentFiles = (
  directory: string,
): void => {
  const unexpected = readdirSync(directory)
    .filter((name) => name !== ".env.example" && /^\.env(?:\.|$)/u.test(name))
    .sort();
  if (unexpected.length === 0) return;
  throw new Error(
    `Unchecked Next.js environment files are not allowed: ${unexpected.join(
      ", ",
    )}. Move reviewed browser-public bindings to the root .env or the web process manager.`,
  );
};

const webRuntimeTargets: readonly WebRuntimeTarget[] = [
  "browser",
  "browser:self",
  "build",
  "dev",
  "dev:local",
  "dev:staging",
  "start",
  "typecheck",
];

const webRuntimeTarget = (arguments_: readonly string[]): WebRuntimeTarget => {
  // The browser targets forward trailing `--flag=value` arguments to the
  // matrix runner, so only the leading positional argument names the target.
  const positional = arguments_.filter((value) => !value.startsWith("--"));
  if (
    positional.length !== 1 ||
    !webRuntimeTargets.includes(positional[0] as WebRuntimeTarget)
  ) {
    throw new Error(
      "Web runtime target must be browser, browser:self, build, dev, dev:local, dev:staging, start, or typecheck",
    );
  }
  return positional[0] as WebRuntimeTarget;
};

const genericWebLaunchPlan = (
  environment: EnvironmentVariables,
  target: Exclude<WebRuntimeTarget, "dev" | "dev:staging">,
): WebRuntimeLaunchPlan => {
  const additions = {
    ...(target === "dev:local"
      ? { NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "development" }
      : {}),
    ...(target === "build"
      ? {
          NEXT_PUBLIC_APP_URL: normalizeCanonicalApplicationUrl(
            environment.NEXT_PUBLIC_APP_URL,
          ),
        }
      : {}),
  };
  return {
    supervisorEnvironment: createRuntimeProcessEnvironment(environment),
    webEnvironment: createRuntimeServiceEnvironment(
      "web",
      environment,
      additions,
    ),
  };
};

const createWebRuntimeLaunchPlanFromRoot = (
  target: WebRuntimeTarget,
  hostEnvironment: EnvironmentVariables,
): WebRuntimeLaunchPlan => {
  const environment = readRuntimeEnvironmentProfile({
    developmentFileRequired: target === "dev" || target === "dev:local",
    environment: hostEnvironment,
    profile: target === "dev:staging" ? "staging" : "development",
    repositoryRoot,
  });
  if (target === "dev") {
    return createDevelopmentSepoliaWebLaunchPlan(environment);
  }
  if (target === "dev:staging") {
    return createStagingWebLaunchPlan(environment);
  }
  return genericWebLaunchPlan(environment, target);
};

const nextCommand = (
  subcommand: NextRuntimeSubcommand,
  label: string,
): WebRuntimeCommand => ({
  arguments: nextRuntimeArguments(subcommand),
  command: process.execPath,
  cwd: webRoot,
  label,
});

const browserMatrixCommand = (
  target: "browser" | "browser:self",
): WebRuntimeCommand => ({
  arguments: [
    join(webRoot, "scripts/test-browser-matrix.ts"),
    ...(target === "browser:self" ? ["--self-test"] : []),
    ...process.argv.slice(3).filter((value) => value.startsWith("--")),
  ],
  command: process.execPath,
  cwd: webRoot,
  label:
    target === "browser:self"
      ? "browser harness self-test"
      : "production browser matrix",
});

const webRuntimeCommands = (
  target: WebRuntimeTarget,
): readonly WebRuntimeCommand[] => {
  if (target === "dev" || target === "dev:local" || target === "dev:staging") {
    return [
      nextCommand(
        "dev",
        target === "dev:local"
          ? "local web application"
          : target === "dev:staging"
            ? "staging web application"
            : "Base Sepolia development web application",
      ),
    ];
  }
  if (target === "start") {
    return [nextCommand("start", "production web application")];
  }
  if (target === "typecheck") {
    return [
      nextCommand("typegen", "Next.js route type generation"),
      {
        arguments: [typeScriptCli, "--noEmit"],
        command: process.execPath,
        cwd: webRoot,
        label: "web TypeScript check",
      },
    ];
  }
  if (target === "browser" || target === "browser:self") {
    return [browserMatrixCommand(target)];
  }
  return [
    {
      arguments: ["--filter", "@orbit/config", "build"],
      command: "pnpm",
      cwd: repositoryRoot,
      label: "web configuration package build",
    },
    {
      arguments: [
        join(repositoryRoot, "scripts/generate-web-deployment-manifest.ts"),
        "--check",
      ],
      command: process.execPath,
      cwd: repositoryRoot,
      label: "web deployment manifest verification",
    },
    nextCommand("build", "production web build"),
  ];
};

export const webRuntimeSession = Effect.gen(function* () {
  const target = yield* fileSystem("Web runtime target is invalid", () =>
    webRuntimeTarget(process.argv.slice(2)),
  );
  yield* fileSystem(
    "Unchecked Next.js environment files prevent web startup",
    () => assertNoUncheckedNextEnvironmentFiles(webRoot),
  );
  const launchPlan = yield* fileSystem(
    "Unable to load or validate the web runtime environment",
    () => createWebRuntimeLaunchPlanFromRoot(target, process.env),
  );
  replaceProcessEnvironment(launchPlan.supervisorEnvironment);
  yield* Effect.forEach(
    webRuntimeCommands(target),
    (runtimeCommand) =>
      runManagedProcess(runtimeCommand.label, () =>
        spawnRuntimeServiceProcess({
          arguments: runtimeCommand.arguments,
          command: runtimeCommand.command,
          cwd: runtimeCommand.cwd,
          environment: launchPlan.webEnvironment,
          service: "web",
          stdio: "inherit",
        }),
      ),
    { concurrency: 1, discard: true },
  );
});

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(webRuntimeSession);
}
