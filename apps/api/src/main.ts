import { pathToFileURL } from "node:url";

import { Cause, Effect, Exit, Option } from "effect";

import { openAdminAuthRuntime } from "./admin-auth-runtime.js";
import { resolvePublicApiConfiguration } from "./configuration.js";
import { acquirePublicApiServer } from "./http-server.js";

const configuration = Effect.try({
  try: () => resolvePublicApiConfiguration(process.env),
  catch: (cause) => new Error("Public API configuration is invalid", { cause }),
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const resolved = yield* configuration;
    const adminAuth = yield* Effect.acquireRelease(
      Effect.try({
        try: () => openAdminAuthRuntime(resolved.adminAuth),
        catch: (cause) => new Error("Admin auth runtime is invalid", { cause }),
      }),
      (runtime) => Effect.sync(runtime.close),
    );
    const server = yield* acquirePublicApiServer({
      adminAuth: adminAuth.service,
      configuration: resolved,
    });
    process.stdout.write(`Public API ready at ${server.url}\n`);
    return yield* Effect.never;
  }),
);

const errorMessage = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && failure.value instanceof Error) {
    const nested = failure.value.cause;
    return nested instanceof Error
      ? `${failure.value.message}: ${nested.message}`
      : failure.value.message;
  }
  return "Public API terminated unexpectedly";
};

const run = (): void => {
  const controller = new AbortController();
  let interrupted = false;
  const interrupt = (): void => {
    interrupted = true;
    controller.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  void Effect.runPromiseExit(program, { signal: controller.signal }).then(
    (exit) => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (Exit.isSuccess(exit) || interrupted) return;
      process.stderr.write(`${errorMessage(exit.cause)}\n`);
      process.exitCode = 1;
    },
  );
};

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  run();
}
