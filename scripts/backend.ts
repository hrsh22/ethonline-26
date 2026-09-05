import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect } from "effect";
import {
  parseHistoryCredential,
  parseHistoryLoopbackUrl,
} from "@orbit/config/history-runtime";

import {
  acquireManagedProcess,
  fileSystem,
  nonBlankString,
  runInterruptibleMain,
  SubprocessError,
  successfulProcess,
} from "./effect-runtime.ts";
import { createServiceLogger } from "./service-log.ts";
import {
  createRuntimeProcessEnvironment,
  createRuntimeServiceEnvironment,
  readRuntimeEnvironmentSource,
  replaceProcessEnvironment,
  type EnvironmentVariables,
  type RuntimeService,
  spawnRuntimeServiceProcess,
} from "./runtime-environment.ts";

export interface BackendService {
  readonly id: "api" | "funding" | "history" | "operator" | "replenisher";
  readonly label: string;
  readonly command: string;
  readonly arguments: readonly string[];
}

export interface HistoryReadinessConfiguration {
  readonly readApiToken: string;
  readonly url: URL;
}

export interface BackendBinding {
  readonly host: "127.0.0.1";
  readonly label: string;
  readonly port: number;
}

export interface BackendConfiguration {
  readonly bindings: readonly BackendBinding[];
  readonly historyReadiness: HistoryReadinessConfiguration;
}

export interface BackendLaunchPlan {
  readonly configuration: BackendConfiguration;
  readonly serviceEnvironments: Readonly<
    Record<BackendService["id"], NodeJS.ProcessEnv>
  >;
  readonly supervisorEnvironment: NodeJS.ProcessEnv;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const SUPERVISOR_TAG = "backend";

/**
 * Wide enough for the longest service tag and the supervisor's own, so the
 * message column lines up and the eye can read down it.
 */
const serviceTagWidth = (services: readonly BackendService[]): number =>
  Math.max(
    SUPERVISOR_TAG.length,
    ...services.map((service) => service.id.length),
  );

const attachServiceLogging = (
  service: BackendService,
  child: ChildProcess,
  tagWidth: number,
): void => {
  const logger = createServiceLogger(service.id, { tagWidth });
  logger.attach(child.stdout, "info");
  // A child's stderr is not necessarily a failure -- the operator watch reports
  // a retryable cycle there -- so it is marked, not treated as fatal.
  logger.attach(child.stderr, "warn");
};

export const foundationalBackendServices: readonly BackendService[] = [
  {
    id: "history",
    label: "history worker",
    command: process.execPath,
    arguments: [join(repositoryRoot, "scripts/history-indexer.ts")],
  },
  {
    id: "funding",
    label: "funding worker",
    command: process.execPath,
    arguments: [join(repositoryRoot, "scripts/testnet-funding-launcher.ts")],
  },
  {
    id: "api",
    label: "public API",
    command: process.execPath,
    arguments: [join(repositoryRoot, "apps/api/dist/main.js")],
  },
  // Owns no listener and serves no request; it only tops the funding signer up
  // from a treasury the internet-facing worker never holds a key for. It idles
  // when no treasury is configured rather than taking the group down.
  {
    id: "replenisher",
    label: "funding replenisher",
    command: process.execPath,
    arguments: [
      join(repositoryRoot, "scripts/testnet-funding-replenisher-launcher.ts"),
    ],
  },
] as const;

export const operatorBackendService: BackendService = {
  id: "operator",
  label: "operator watch",
  command: process.execPath,
  arguments: [join(repositoryRoot, "scripts/base-sepolia-operator-watch.ts")],
};

const backendRuntimeService = (
  service: BackendService["id"],
): RuntimeService => {
  if (service === "funding") return "funding-launcher";
  if (service === "replenisher") return "funding-replenisher-launcher";
  return service;
};

export const createBackendServiceEnvironment = (
  service: BackendService["id"],
  environment: EnvironmentVariables,
): NodeJS.ProcessEnv => {
  const developmentOperatorSigner = () => {
    if (service !== "operator") return {};
    const hasDedicatedSigner = [
      environment.OPERATOR_PRIVATE_KEY,
      environment.OPERATOR_KEEPER_PRIVATE_KEY,
      environment.OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY,
    ].some((value) => nonBlankString(value) !== undefined);
    const deployerPrivateKey = nonBlankString(environment.DEPLOYER_PRIVATE_KEY);
    const singleSignerDevelopment =
      environment.DEPLOYMENT_ENVIRONMENT === "staging" &&
      environment.SELF_FUNDED_TEST_ASSETS === "true" &&
      environment.OPERATOR_EXECUTE === "true";
    return !hasDedicatedSigner &&
      singleSignerDevelopment &&
      deployerPrivateKey !== undefined
      ? { OPERATOR_PRIVATE_KEY: deployerPrivateKey }
      : {};
  };

  return createRuntimeServiceEnvironment(
    backendRuntimeService(service),
    environment,
    developmentOperatorSigner(),
  );
};

export const resolveHistoryReadinessConfiguration = (
  environment: EnvironmentVariables,
): HistoryReadinessConfiguration => {
  const configuredUrl = environment.HISTORY_INDEX_URL;
  const url = new URL(
    parseHistoryLoopbackUrl(
      configuredUrl === undefined || configuredUrl.length === 0
        ? "http://127.0.0.1:8787"
        : configuredUrl,
    ),
  );
  url.pathname = "/readyz";
  url.search = "";
  url.hash = "";
  return {
    readApiToken: parseHistoryCredential(
      environment.HISTORY_READ_API_TOKEN,
      "HISTORY_READ_API_TOKEN",
    ),
    url,
  };
};

const loopbackRootUrl = (
  environment: EnvironmentVariables,
  name: string,
): URL => {
  const value = nonBlankString(environment[name]);
  if (value === undefined) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username.length !== 0 ||
    url.password.length !== 0 ||
    url.search.length !== 0 ||
    url.hash.length !== 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(`${name} must be a root HTTP URL on 127.0.0.1`);
  }
  return url;
};

const portFromUrl = (url: URL): number =>
  url.port.length === 0 ? 80 : Number(url.port);

/**
 * A listener the supervisor only owns when it is configured. The fallback in
 * `configuredPort` is unreachable here because the guard already proved the
 * value is present; this exists to give an optional port the same range
 * validation a required one gets.
 */
const optionalPort = (
  environment: EnvironmentVariables,
  name: string,
): number | undefined =>
  nonBlankString(environment[name]) === undefined
    ? undefined
    : configuredPort(environment, name, 0);

const configuredPort = (
  environment: EnvironmentVariables,
  name: string,
  fallback: number,
): number => {
  const value = nonBlankString(environment[name]);
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return port;
};

export const resolveBackendConfiguration = (
  environment: EnvironmentVariables,
): BackendConfiguration => {
  const historyReadiness = resolveHistoryReadinessConfiguration(environment);
  const fundingUrl = loopbackRootUrl(
    environment,
    "TESTNET_FUNDING_SERVICE_URL",
  );
  const apiHost = nonBlankString(environment.PUBLIC_API_HOST) ?? "127.0.0.1";
  if (apiHost !== "127.0.0.1") {
    throw new Error("PUBLIC_API_HOST must be 127.0.0.1");
  }
  // The operator watch hosts a fourth listener whenever the control plane is
  // configured. Leaving it out of the preflight let the supervisor start three
  // servers and then lose the whole group to the operator's bind failure.
  const controlPort = optionalPort(environment, "OPERATOR_CONTROL_PORT");
  const bindings: readonly BackendBinding[] = [
    {
      host: "127.0.0.1",
      label: "history worker",
      port: portFromUrl(historyReadiness.url),
    },
    {
      host: "127.0.0.1",
      label: "funding worker",
      port: portFromUrl(fundingUrl),
    },
    {
      host: "127.0.0.1",
      label: "public API",
      port: configuredPort(environment, "PUBLIC_API_PORT", 8_800),
    },
    ...(controlPort === undefined
      ? []
      : [
          {
            host: "127.0.0.1" as const,
            label: "operator control surface",
            port: controlPort,
          },
        ]),
  ];
  if (new Set(bindings.map(({ port }) => port)).size !== bindings.length) {
    throw new Error("Backend listener ports must be distinct");
  }
  return { bindings, historyReadiness };
};

export const createBackendLaunchPlan = (
  environment: EnvironmentVariables,
): BackendLaunchPlan => ({
  configuration: resolveBackendConfiguration(environment),
  serviceEnvironments: {
    api: createBackendServiceEnvironment("api", environment),
    funding: createBackendServiceEnvironment("funding", environment),
    history: createBackendServiceEnvironment("history", environment),
    operator: createBackendServiceEnvironment("operator", environment),
    replenisher: createBackendServiceEnvironment("replenisher", environment),
  },
  supervisorEnvironment: createRuntimeProcessEnvironment(environment),
});

const probeBackendBinding = (binding: BackendBinding): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    const fail = (cause: Error): void => {
      server.removeAllListeners();
      reject(
        new Error(
          `${binding.label} cannot start because ${binding.host}:${binding.port} is unavailable`,
          { cause },
        ),
      );
    };
    server.once("error", fail);
    server.listen(binding.port, binding.host, () => {
      server.removeListener("error", fail);
      server.close((cause) => {
        if (cause === undefined) resolve();
        else fail(cause);
      });
    });
  });

export const ensureBackendBindingsAvailable = (
  bindings: readonly BackendBinding[],
): Effect.Effect<void, SubprocessError> =>
  Effect.tryPromise({
    try: async () => {
      for (const binding of bindings) await probeBackendBinding(binding);
    },
    catch: (cause) =>
      new SubprocessError({
        message: "A backend listener is already in use",
        cause,
      }),
  });

interface HistoryReadinessOptions {
  readonly fetcher?: typeof fetch;
  readonly pollMilliseconds?: number;
  readonly requestTimeoutMilliseconds?: number;
}

export const waitForHistoryReadiness = (
  configuration: HistoryReadinessConfiguration,
  options: HistoryReadinessOptions = {},
): Effect.Effect<void> => {
  const fetcher = options.fetcher ?? fetch;
  const pollMilliseconds = options.pollMilliseconds ?? 500;
  const requestTimeoutMilliseconds =
    options.requestTimeoutMilliseconds ?? 2_000;
  const check = Effect.promise(async () => {
    try {
      const response = await fetcher(configuration.url, {
        headers: {
          accept: "application/json",
          ...(configuration.readApiToken === undefined
            ? {}
            : {
                authorization: `Bearer ${configuration.readApiToken}`,
              }),
        },
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
  const wait: Effect.Effect<void> = Effect.suspend(() =>
    check.pipe(
      Effect.flatMap((ready) =>
        ready
          ? Effect.void
          : Effect.sleep(pollMilliseconds).pipe(Effect.andThen(wait)),
      ),
    ),
  );
  return wait;
};

const monitorPersistentService = (
  service: BackendService,
  child: ChildProcess,
) =>
  successfulProcess(child, service.label).pipe(
    Effect.andThen(
      Effect.fail(
        new SubprocessError({
          message: `${service.label} exited unexpectedly with code 0`,
          cause: { code: 0 },
        }),
      ),
    ),
  );

const monitorPersistentServices = (
  services: readonly {
    readonly child: ChildProcess;
    readonly service: BackendService;
  }[],
) =>
  Effect.all(
    services.map(({ child, service }) =>
      monitorPersistentService(service, child),
    ),
    { concurrency: "unbounded", discard: true },
  );

interface RunBackendServicesOptions<ReadinessError, PreflightError> {
  readonly environment?: EnvironmentVariables;
  readonly foundationalServices?: readonly BackendService[];
  readonly operatorService?: BackendService;
  readonly preflight?: Effect.Effect<void, PreflightError>;
  readonly startService?: (service: BackendService) => ChildProcess;
  readonly waitForOperatorDependency: Effect.Effect<void, ReadinessError>;
}

export const runBackendServices = <ReadinessError, PreflightError = never>({
  environment = process.env,
  foundationalServices = foundationalBackendServices,
  operatorService = operatorBackendService,
  preflight = Effect.void,
  startService = (service) =>
    spawnRuntimeServiceProcess({
      arguments: service.arguments,
      command: service.command,
      cwd: repositoryRoot,
      environment,
      service: backendRuntimeService(service.id),
      // Piped rather than inherited so every line can be attributed to the
      // service that wrote it. Five children shared one untagged stream.
      stdio: ["ignore", "pipe", "pipe"],
    }),
  waitForOperatorDependency,
}: RunBackendServicesOptions<ReadinessError, PreflightError>): Effect.Effect<
  void,
  PreflightError | ReadinessError | SubprocessError
> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* preflight;
      const tagWidth = serviceTagWidth([
        ...foundationalServices,
        operatorService,
      ]);
      const supervisor = createServiceLogger(SUPERVISOR_TAG, { tagWidth });
      const start = (service: BackendService) =>
        acquireManagedProcess(service.label, () => startService(service)).pipe(
          Effect.tap((child) =>
            Effect.sync(() => attachServiceLogging(service, child, tagWidth)),
          ),
          Effect.map((child) => ({ child, service })),
        );
      const foundationalProcesses = yield* Effect.forEach(
        foundationalServices,
        start,
      );
      supervisor.log(
        "info",
        "History, funding, API, and replenisher started; waiting for history readiness before starting operator watch.",
      );
      yield* Effect.raceFirst(
        waitForOperatorDependency,
        monitorPersistentServices(foundationalProcesses),
      );
      supervisor.log(
        "info",
        "History is ready; starting the recurring operator watch.",
      );
      const operatorProcess = yield* start(operatorService);
      yield* monitorPersistentServices([
        ...foundationalProcesses,
        operatorProcess,
      ]);
    }),
  );

const createBackendLaunchPlanFromRoot = (
  hostEnvironment: EnvironmentVariables,
): BackendLaunchPlan =>
  createBackendLaunchPlan(
    readRuntimeEnvironmentSource({
      environment: hostEnvironment,
      path: join(repositoryRoot, ".env"),
      required: true,
    }),
  );

const backendSession = Effect.gen(function* () {
  const launchPlan = yield* fileSystem(
    "Unable to load or validate the root .env for pnpm backend",
    () => createBackendLaunchPlanFromRoot(process.env),
  );
  replaceProcessEnvironment(launchPlan.supervisorEnvironment);
  yield* runBackendServices({
    preflight: ensureBackendBindingsAvailable(
      launchPlan.configuration.bindings,
    ),
    startService: (service) =>
      spawnRuntimeServiceProcess({
        arguments: service.arguments,
        command: service.command,
        cwd: repositoryRoot,
        environment: launchPlan.serviceEnvironments[service.id],
        service: backendRuntimeService(service.id),
        // Must match the default above: this is the entry point that actually
        // runs, and an inherited stream cannot be attributed to its service.
        stdio: ["ignore", "pipe", "pipe"],
      }),
    waitForOperatorDependency: waitForHistoryReadiness(
      launchPlan.configuration.historyReadiness,
    ),
  });
});

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(backendSession);
}
