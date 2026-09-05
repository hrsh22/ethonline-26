import type { ChildProcess } from "node:child_process";
import { loadEnvFile } from "node:process";

import { Cause, Data, Effect, Exit, Option, Schema, Scope } from "effect";
import { getAddress } from "viem";
import type { Address } from "viem";

import { operatorDiagnostic } from "./base-sepolia-operator-diagnostic.ts";

export class EnvironmentError extends Data.TaggedError("EnvironmentError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class SubprocessError extends Data.TaggedError("SubprocessError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RpcError extends Data.TaggedError("RpcError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const PROCESS_SHUTDOWN_GRACE_MILLISECONDS = 5_000;

const sensitiveUrl = /\b(?:https?|wss?):\/\/[^\s)\]}>,]+/giu;
const sensitiveAssignment =
  /(\b(?:authorization|api[_-]?key|access[_-]?token|token|secret|password)\b\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/giu;

/**
 * A child environment with deployment and operator signing material removed.
 * For children that read manifests, upload sources, or generate bindings --
 * anything that does not sign -- inheriting the full parent environment hands
 * a signing key to a process with no use for it.
 */
export const strippedOfSigningKeys = (
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const child = { ...environment };
  delete child.DEPLOYER_PRIVATE_KEY;
  delete child.OPERATOR_PRIVATE_KEY;
  delete child.KEEPER_PRIVATE_KEY;
  delete child.LIQUIDITY_EXECUTOR_PRIVATE_KEY;
  return child;
};

export const redactDiagnostic = (value: string): string =>
  value
    .replace(sensitiveUrl, "[REDACTED_URL]")
    .replace(sensitiveAssignment, "$1[REDACTED]");

export const nonBlankString = (
  value: string | undefined,
): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
};

const failureDiagnostic = <Error>(cause: Cause.Cause<Error>): string => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return operatorDiagnostic(failure.value);
  try {
    return operatorDiagnostic(Cause.pretty(cause));
  } catch {
    return "Runtime failed safely";
  }
};

export const runMain = <Error>(
  program: Effect.Effect<void, Error, never>,
): void => {
  void Effect.runPromiseExit(program).then((exit) => {
    if (Exit.isSuccess(exit)) return;
    process.stderr.write(`${failureDiagnostic(exit.cause)}\n`);
    process.exitCode = 1;
  });
};

export const runInterruptibleMain = <Error>(
  program: Effect.Effect<void, Error, never>,
): void => {
  const abortController = new AbortController();
  let shutdownRequested = false;
  const shutdown = (): void => {
    shutdownRequested = true;
    abortController.abort();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  void Effect.runPromiseExit(program, {
    signal: abortController.signal,
  }).then((exit) => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    if (Exit.isSuccess(exit) || shutdownRequested) return;
    process.stderr.write(`${failureDiagnostic(exit.cause)}\n`);
    process.exitCode = 1;
  });
};

export const decodeEnvironment = <Output, Input>(
  schema: Schema.Schema<Output, Input, never>,
  message: string,
): Effect.Effect<Output, EnvironmentError> =>
  Schema.decodeUnknown(schema)(process.env).pipe(
    Effect.mapError((cause) => new EnvironmentError({ message, cause })),
  );

export const fileSystem = <Value>(
  message: string,
  operation: () => Value,
): Effect.Effect<Value, FileSystemError> =>
  Effect.try({
    try: operation,
    catch: (cause) => new FileSystemError({ message, cause }),
  });

export const loadEnvironmentFile = (
  path: string,
  message: string,
): Effect.Effect<void, FileSystemError> =>
  fileSystem(message, () => loadEnvFile(path));

export const subprocess = <Value>(
  message: string,
  operation: () => Value,
): Effect.Effect<Value, SubprocessError> =>
  Effect.try({
    try: operation,
    catch: (cause) => new SubprocessError({ message, cause }),
  });

export const spawnProcess = <Process extends ChildProcess>(
  message: string,
  operation: () => Process,
): Effect.Effect<Process, SubprocessError> =>
  Effect.async<Process, SubprocessError>((resume) => {
    let child: Process;
    try {
      child = operation();
    } catch (cause) {
      resume(Effect.fail(new SubprocessError({ message, cause })));
      return;
    }

    const onSpawn = (): void => {
      child.removeListener("error", onError);
      resume(Effect.succeed(child));
    };
    const onError = (cause: Error): void => {
      child.removeListener("spawn", onSpawn);
      resume(Effect.fail(new SubprocessError({ message, cause })));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);

    return Effect.sync(() => {
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
      if (!child.killed) child.kill("SIGTERM");
    });
  });

const waitForProcess = (
  child: ChildProcess,
  label: string,
): Effect.Effect<
  { readonly code: number | null; readonly signal: NodeJS.Signals | null },
  SubprocessError
> =>
  Effect.async((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(
        Effect.succeed({ code: child.exitCode, signal: child.signalCode }),
      );
      return;
    }
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      child.removeListener("error", onError);
      resume(Effect.succeed({ code, signal }));
    };
    const onError = (cause: Error): void => {
      child.removeListener("exit", onExit);
      resume(
        Effect.fail(
          new SubprocessError({ message: `${label} process failed`, cause }),
        ),
      );
    };
    child.once("exit", onExit);
    child.once("error", onError);
    return Effect.sync(() => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    });
  });

const terminateProcess = (child: ChildProcess): Effect.Effect<void> =>
  Effect.async((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }
    const finish = (): void => {
      clearTimeout(timeout);
      child.removeListener("exit", finish);
      resume(Effect.void);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, PROCESS_SHUTDOWN_GRACE_MILLISECONDS);
    child.once("exit", finish);
    if (!child.kill("SIGTERM")) finish();
    return Effect.sync(() => {
      clearTimeout(timeout);
      child.removeListener("exit", finish);
    });
  });

export const acquireManagedProcess = (
  label: string,
  start: () => ChildProcess,
): Effect.Effect<ChildProcess, SubprocessError, Scope.Scope> =>
  Effect.acquireRelease(
    spawnProcess(`Could not start ${label}`, start),
    (child) => terminateProcess(child),
  );

export const successfulProcess = (
  child: ChildProcess,
  label: string,
): Effect.Effect<void, SubprocessError> =>
  waitForProcess(child, label).pipe(
    Effect.flatMap(({ code, signal }) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new SubprocessError({
              message: `${label} exited ${
                signal === null
                  ? `with code ${code ?? "unknown"}`
                  : `on ${signal}`
              }`,
              cause: { code, signal },
            }),
          ),
    ),
  );

export const runManagedProcess = (
  label: string,
  start: () => ChildProcess,
): Effect.Effect<void, SubprocessError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* acquireManagedProcess(label, start);
      yield* successfulProcess(child, label);
    }),
  );

export const rpc = <Value>(
  message: string,
  operation: () => Promise<Value>,
): Effect.Effect<Value, RpcError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new RpcError({ message, cause }),
  });

export const network = <Value>(
  message: string,
  operation: () => Promise<Value>,
): Effect.Effect<Value, NetworkError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new NetworkError({ message, cause }),
  });

export const validate = <Value>(
  message: string,
  operation: () => Value,
): Effect.Effect<Value, ValidationError> =>
  Effect.try({
    try: operation,
    catch: (cause) => new ValidationError({ message, cause }),
  });

export const ensure = (
  condition: boolean,
  message: string,
): Effect.Effect<void, ValidationError> =>
  condition
    ? Effect.void
    : Effect.fail(new ValidationError({ message, cause: message }));

export const requireBindings = <const Names extends readonly string[], Value>(
  bindings: Readonly<Record<string, Value>>,
  names: Names,
): Readonly<Record<Names[number], Value>> => {
  for (const name of names) {
    if (bindings[name] === undefined) {
      throw new Error(`Required binding ${name} is missing`);
    }
  }
  return bindings as Readonly<Record<Names[number], Value>>;
};

export const requireAddresses = <const Names extends readonly string[]>(
  bindings: Readonly<Record<string, string>>,
  names: Names,
): Readonly<Record<Names[number], Address>> =>
  Object.fromEntries(
    names.map((name) => [name, getAddress(bindings[name] ?? "")]),
  ) as Readonly<Record<Names[number], Address>>;
