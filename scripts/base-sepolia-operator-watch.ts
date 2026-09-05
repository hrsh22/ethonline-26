import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect, Exit, Schema } from "effect";

import {
  decodeEnvironment,
  runInterruptibleMain,
  runManagedProcess,
} from "./effect-runtime.ts";
import {
  createRuntimeServiceEnvironment,
  spawnRuntimeServiceProcess,
} from "./runtime-environment.ts";
import { operatorDiagnostic } from "./base-sepolia-operator-diagnostic.ts";
import {
  readLaunchedBaseSepoliaManifest,
  resolveRepositoryPath,
} from "./base-sepolia-manifest.ts";
import { createOperatorControlServer } from "./operator-control/http-server.ts";
import {
  createOperatorSupervisor,
  type OperatorSupervisor,
  type OperatorCycleGrant,
} from "./operator-control/runtime.ts";
import { openOperatorControlStore } from "./operator-control/store.ts";
import { deploymentManifestFingerprint } from "@orbit/config/deployment-manifest";

const MINIMUM_INTERVAL_SECONDS = 60;
const DEFAULT_INTERVAL_SECONDS = 300;

type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const OperatorExecuteStringSchema = Schema.String.pipe(
  Schema.filter((value) => value === "true" || value === "false", {
    message: () => "OPERATOR_EXECUTE must be true or false",
  }),
);

const OperatorExecuteSchema = Schema.transform(
  OperatorExecuteStringSchema,
  Schema.Boolean,
  {
    strict: true,
    decode: (value) => value === "true",
    encode: (value) => (value ? "true" : "false"),
  },
);

const OperatorControlDatabaseSchema = Schema.String.pipe(Schema.minLength(1));

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

const OperatorControlHostSchema = Schema.String.pipe(
  Schema.filter((value) => LOOPBACK_HOSTS.has(value), {
    message: () =>
      "OPERATOR_CONTROL_HOST must be a loopback literal (127.0.0.1 or ::1); the control surface is never publicly routed",
  }),
);

const OperatorControlTokenSchema = Schema.String.pipe(
  Schema.minLength(32, {
    message: () => "OPERATOR_CONTROL_API_TOKEN must be at least 32 characters",
  }),
);

const OperatorWatchEnvironmentSchema = Schema.Struct({
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(
    Schema.String.pipe(Schema.minLength(1)),
  ),
  NEXT_PUBLIC_APP_URL: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  OPERATOR_CONTROL_API_TOKEN: Schema.optional(OperatorControlTokenSchema),
  OPERATOR_CONTROL_DATABASE_PATH: Schema.optional(
    OperatorControlDatabaseSchema,
  ),
  OPERATOR_CONTROL_HOST: Schema.optional(OperatorControlHostSchema),
  OPERATOR_CONTROL_PORT: Schema.optional(
    Schema.NumberFromString.pipe(
      Schema.int(),
      Schema.greaterThan(0),
      Schema.lessThan(65_536),
    ),
  ),
  OPERATOR_EXECUTE: Schema.optionalWith(OperatorExecuteSchema, {
    default: () => false,
  }),
  OPERATOR_INTERVAL_SECONDS: Schema.optionalWith(
    Schema.NumberFromString.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(MINIMUM_INTERVAL_SECONDS, {
        message: () =>
          `OPERATOR_INTERVAL_SECONDS must be an integer of at least ${MINIMUM_INTERVAL_SECONDS} seconds`,
      }),
    ),
    { default: () => DEFAULT_INTERVAL_SECONDS },
  ),
});

type OperatorWatchEnvironmentBindings =
  typeof OperatorWatchEnvironmentSchema.Type;

export interface OperatorControlSurfaceConfiguration {
  readonly host: string;
  readonly port: number;
  readonly serviceToken: string;
  /** The web origin whose host signed commands are bound to. */
  readonly applicationUrl: string;
  readonly manifestPath: string | undefined;
}

export interface OperatorWatchEnvironment {
  /**
   * The startup default only. Once a control ledger exists, the durable
   * desired policy governs every cycle, so this cannot pin the operator into
   * execute mode.
   */
  readonly execute: boolean;
  readonly intervalMilliseconds: number;
  readonly controlDatabasePath: string | undefined;
  /**
   * Present only when every piece of the control surface is configured. The
   * surface without a ledger, or a ledger with half a surface, is refused at
   * startup rather than silently running a console that cannot work.
   */
  readonly controlSurface: OperatorControlSurfaceConfiguration | undefined;
}

const controlSurfaceConfiguration = (
  environment: OperatorWatchEnvironmentBindings,
): OperatorControlSurfaceConfiguration | undefined => {
  const pieces = [
    environment.OPERATOR_CONTROL_HOST,
    environment.OPERATOR_CONTROL_PORT,
    environment.OPERATOR_CONTROL_API_TOKEN,
    environment.NEXT_PUBLIC_APP_URL,
  ];
  if (pieces.every((piece) => piece === undefined)) return undefined;
  if (pieces.some((piece) => piece === undefined)) {
    throw new Error(
      "The operator control surface needs OPERATOR_CONTROL_HOST, OPERATOR_CONTROL_PORT, OPERATOR_CONTROL_API_TOKEN, and NEXT_PUBLIC_APP_URL together; a partial configuration would run a console that cannot work",
    );
  }
  if (environment.OPERATOR_CONTROL_DATABASE_PATH === undefined) {
    throw new Error(
      "The operator control surface needs OPERATOR_CONTROL_DATABASE_PATH; without a ledger there is no policy to control",
    );
  }
  return {
    applicationUrl: environment.NEXT_PUBLIC_APP_URL!,
    host: environment.OPERATOR_CONTROL_HOST!,
    manifestPath: environment.DEPLOYMENT_MANIFEST_PATH,
    port: environment.OPERATOR_CONTROL_PORT!,
    serviceToken: environment.OPERATOR_CONTROL_API_TOKEN!,
  };
};

const operatorWatchEnvironment = (
  environment: OperatorWatchEnvironmentBindings,
): OperatorWatchEnvironment => ({
  controlDatabasePath: environment.OPERATOR_CONTROL_DATABASE_PATH,
  controlSurface: controlSurfaceConfiguration(environment),
  execute: environment.OPERATOR_EXECUTE,
  intervalMilliseconds: environment.OPERATOR_INTERVAL_SECONDS * 1_000,
});

const decodeOperatorWatchEnvironment = Schema.decodeUnknownSync(
  OperatorWatchEnvironmentSchema,
);

export const resolveOperatorWatchEnvironment = (
  environment: EnvironmentVariables,
): OperatorWatchEnvironment =>
  operatorWatchEnvironment(decodeOperatorWatchEnvironment(environment));

export const operatorWatchAnnouncement = (
  configuration: OperatorWatchEnvironment,
): string => {
  const seconds = configuration.intervalMilliseconds / 1_000;
  if (configuration.controlDatabasePath !== undefined) {
    // The durable policy is authoritative, so the announcement must not claim
    // a mode that a stored `stopped` policy will override.
    return `Base Sepolia operator watch started every ${seconds}s under control-plane policy; the stored desired mode governs each cycle and a fresh ledger fails closed.\n`;
  }
  return configuration.execute
    ? `WARNING: Base Sepolia operator watch started every ${seconds}s in EXECUTE mode; eligible transactions will be signed.\n`
    : `Base Sepolia operator watch started every ${seconds}s in DRY-RUN mode; no transactions will be submitted.\n`;
};

export const runOperatorWatchCycle = <RunError>({
  reportFailure,
  runOnce,
}: {
  readonly reportFailure: (message: string) => Effect.Effect<void>;
  readonly runOnce: Effect.Effect<void, RunError>;
}): Effect.Effect<void> =>
  runOnce.pipe(
    Effect.catchAll((cause) => reportFailure(operatorDiagnostic(cause))),
  );

export const runOperatorWatch = <RunError, WaitError>({
  reportFailure,
  runOnce,
  waitForNextRun,
}: {
  readonly reportFailure: (message: string) => Effect.Effect<void>;
  readonly runOnce: Effect.Effect<void, RunError>;
  readonly waitForNextRun: Effect.Effect<void, WaitError>;
}): Effect.Effect<never, WaitError> =>
  Effect.forever(
    runOperatorWatchCycle({ reportFailure, runOnce }).pipe(
      Effect.andThen(waitForNextRun),
    ),
  );

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const createOperatorWatchChildEnvironment = (
  environment: EnvironmentVariables,
): NodeJS.ProcessEnv =>
  createRuntimeServiceEnvironment("operator", environment);

const operatorProcess = runManagedProcess("Base Sepolia operator", () =>
  spawnRuntimeServiceProcess({
    arguments: [join(repositoryRoot, "scripts/base-sepolia-operator.ts")],
    command: process.execPath,
    cwd: repositoryRoot,
    environment: createOperatorWatchChildEnvironment(process.env),
    service: "operator",
    stdio: "inherit",
  }),
);

const loadOperatorWatchEnvironment = Effect.gen(function* () {
  const decoded = yield* decodeEnvironment(
    OperatorWatchEnvironmentSchema,
    "Operator watch environment is invalid",
  );
  return operatorWatchEnvironment(decoded);
});

export const runSupervisedOperatorCycle = <E>({
  supervisor,
  leaseMilliseconds,
  runChild,
}: {
  readonly supervisor: OperatorSupervisor;
  readonly leaseMilliseconds: number;
  readonly runChild: (grant: OperatorCycleGrant) => Effect.Effect<void, E>;
}): Effect.Effect<void, E | Error> =>
  Effect.gen(function* () {
    const grant = yield* Effect.try(() => supervisor.beginCycle());
    if (grant === undefined) return;
    if (grant.authority === "skip") return;
    const renew = Effect.forever(
      Effect.sleep(Math.max(1, Math.floor(leaseMilliseconds / 3))).pipe(
        Effect.andThen(
          Effect.try(() => {
            if (!grant.renew())
              throw new Error("Operator writer lease renewal failed");
          }),
        ),
      ),
    );
    yield* Effect.raceFirst(runChild(grant), renew).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() =>
          grant.finish({
            outcome: Exit.isSuccess(exit) ? "completed" : "failed",
            ...(Exit.isFailure(exit)
              ? { sanitizedFailure: "Operator run failed or was interrupted" }
              : {}),
          }),
        ),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(supervisor.release)));

const supervisedRun = (
  configuration: OperatorWatchEnvironment,
  supervisor?: OperatorSupervisor,
) =>
  supervisor === undefined
    ? operatorProcess
    : runSupervisedOperatorCycle({
        supervisor,
        leaseMilliseconds: Math.max(
          configuration.intervalMilliseconds * 2,
          60_000,
        ),
        runChild: (grant) =>
          runManagedProcess("Base Sepolia operator", () =>
            spawnRuntimeServiceProcess({
              arguments: [
                join(repositoryRoot, "scripts/base-sepolia-operator.ts"),
              ],
              command: process.execPath,
              cwd: repositoryRoot,
              service: "operator",
              stdio: "inherit",
              environment: {
                ...createOperatorWatchChildEnvironment(process.env),
                OPERATOR_CONTROL_DATABASE_PATH:
                  configuration.controlDatabasePath,
                OPERATOR_CONTROL_RUN_ID: grant.runId,
                OPERATOR_EXECUTE:
                  grant.authority === "execute" ? "true" : "false",
              },
            }),
          ),
      });

/**
 * The loopback, token-authorized control surface the public API proxies to.
 * It runs inside the watch process for the process lifetime: the watch is the
 * long-lived owner of the control ledger, and a surface nothing listens on is
 * a runbook that lies -- the console's commands would all fail while the docs
 * describe a working control plane.
 */
const runOperatorControlSurface = (
  surface: OperatorControlSurfaceConfiguration,
  controlDatabasePath: string,
  intervalMilliseconds: number,
): Effect.Effect<never, Error> =>
  Effect.gen(function* () {
    const manifestPath = resolveRepositoryPath(
      repositoryRoot,
      surface.manifestPath,
      "deployments/84532.json",
    );
    const manifest = yield* readLaunchedBaseSepoliaManifest(manifestPath);
    const applicationHost = yield* Effect.try({
      try: () => new URL(surface.applicationUrl).host,
      catch: () => new Error("NEXT_PUBLIC_APP_URL must be an absolute URL"),
    });
    yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const store = openOperatorControlStore(controlDatabasePath);
        const server = createOperatorControlServer({
          dependencies: {
            configuration: {
              chainId: manifest.chainId,
              deploymentFingerprint: deploymentManifestFingerprint(manifest),
              domain: applicationHost,
              heartbeatStaleAfterMilliseconds: Math.max(
                intervalMilliseconds * 2,
                60_000,
              ),
              intervalMilliseconds,
            },
            now: () => Date.now(),
            store,
          },
          host: surface.host,
          port: surface.port,
          serviceToken: surface.serviceToken,
        });
        server.listen(surface.port, surface.host);
        return { server, store };
      }),
      ({ server }) =>
        Effect.async<never>(() => {
          process.stdout.write(
            `Operator control surface listening at http://${surface.host}:${surface.port} for the public API proxy.\n`,
          );
          server.once("error", (cause) => {
            // Surface bind failures loudly instead of running a watch whose
            // console silently cannot work.
            process.stderr.write(
              `Operator control surface failed: ${operatorDiagnostic(cause)}\n`,
            );
          });
        }),
      ({ server, store }) =>
        Effect.sync(() => {
          server.close();
          store.close();
        }),
    );
  }) as Effect.Effect<never, Error>;

export const baseSepoliaOperatorWatch = Effect.scoped(
  Effect.gen(function* () {
    const configuration = yield* loadOperatorWatchEnvironment;
    let supervisor: OperatorSupervisor | undefined;
    if (configuration.controlDatabasePath !== undefined) {
      const path = configuration.controlDatabasePath;
      const store = yield* Effect.acquireRelease(
        Effect.try(() => openOperatorControlStore(path)),
        (store) => Effect.sync(store.close),
      );
      supervisor = createOperatorSupervisor({
        store,
        now: () => Date.now(),
        leaseMilliseconds: Math.max(
          configuration.intervalMilliseconds * 2,
          60_000,
        ),
      });
      if (!supervisor.initialize())
        return yield* Effect.fail(
          new Error(
            "Another operator supervisor holds the writer lease; startup refused",
          ),
        );
    }
    process.stdout.write(operatorWatchAnnouncement(configuration));
    if (
      configuration.controlSurface !== undefined &&
      configuration.controlDatabasePath !== undefined
    ) {
      // The surface and the cycle loop run for the same lifetime; either one
      // ending ends the process, and interruption releases both.
      yield* Effect.raceFirst(
        runOperatorControlSurface(
          configuration.controlSurface,
          configuration.controlDatabasePath,
          configuration.intervalMilliseconds,
        ),
        runWatchLoop(configuration, supervisor),
      );
      return;
    }
    yield* runWatchLoop(configuration, supervisor);
  }),
);

const runWatchLoop = (
  configuration: OperatorWatchEnvironment,
  supervisor?: OperatorSupervisor,
) =>
  runOperatorWatch({
    reportFailure: (message) =>
      Effect.sync(() => {
        process.stderr.write(
          `Base Sepolia operator watch: ${message}; retrying after the configured interval.\n`,
        );
      }),
    runOnce: supervisedRun(configuration, supervisor),
    waitForNextRun: Effect.sleep(configuration.intervalMilliseconds),
  });

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(baseSepoliaOperatorWatch);
}
