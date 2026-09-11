import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect } from "effect";

import {
  FileSystemError,
  runInterruptibleMain,
  runManagedProcess,
} from "./effect-runtime.ts";
import { spawnRuntimeServiceProcess } from "./runtime-environment.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const stagingWebBootstrap = Effect.gen(function* () {
  yield* runManagedProcess("shared web package build", () =>
    spawnRuntimeServiceProcess({
      arguments: ["build:packages"],
      command: "pnpm",
      cwd: repositoryRoot,
      environment: process.env,
      service: "web",
      stdio: "inherit",
    }),
  );
  const runtime = yield* Effect.tryPromise({
    try: () => import("./staging-web.ts"),
    catch: (cause) =>
      new FileSystemError({
        message: "Unable to load the compiled web runtime",
        cause,
      }),
  });
  yield* runtime.webRuntimeSession;
});

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(stagingWebBootstrap);
}
