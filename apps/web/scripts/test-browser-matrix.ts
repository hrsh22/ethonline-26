import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

import { Effect } from "effect";

import {
  acquireManagedProcess,
  rpc,
  runInterruptibleMain,
} from "../../../scripts/effect-runtime.ts";
import { nextRuntimeArguments } from "../../../scripts/next-runtime-command.ts";
import { startAdminFixtureServer } from "../browser/admin-fixture.ts";
import { runBrowserMatrix, writeMatrixReport } from "../browser/run-matrix.ts";
import { runHarnessSelfTest } from "../browser/self-test.ts";
import { createProductionServerEnvironment } from "../browser/production-server-environment.ts";

const PORT = 3_108;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API_PORT = 18_800;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

const argument = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found?.slice(prefix.length);
};

const awaitReady = async (output: readonly string[]): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await wait(250);
  }
  throw new Error(
    `Production application server did not become ready.\n${output.join("")}`,
  );
};

runInterruptibleMain(
  Effect.scoped(
    Effect.gen(function* () {
      const only = argument("only")?.split(",").filter(Boolean);
      if (
        !process.argv.includes("--self-test") &&
        (only === undefined ||
          only.some((filter) =>
            "admin-inputs:keeper-and-creator@375".includes(filter),
          ))
      ) {
        yield* Effect.acquireRelease(
          rpc(`Could not start test-only admin API on ${API_ORIGIN}`, () =>
            startAdminFixtureServer(API_PORT),
          ),
          (api) => Effect.promise(() => api[Symbol.asyncDispose]()),
        );
      }
      const server = yield* acquireManagedProcess(
        "production Next.js server",
        () =>
          spawn(
            process.execPath,
            nextRuntimeArguments("start", "--port", String(PORT)),
            {
              cwd: new URL("..", import.meta.url),
              // next.config.ts revalidates the app origin and deployment
              // identity at production start. Browser-visible values were
              // already baked into the reviewed build.
              env: createProductionServerEnvironment(process.env, API_ORIGIN),
              stdio: ["ignore", "pipe", "pipe"],
            },
          ),
      );
      const output: string[] = [];
      server.stdout?.on("data", (chunk) => output.push(String(chunk)));
      server.stderr?.on("data", (chunk) => output.push(String(chunk)));

      yield* rpc("Production browser matrix failed", async () => {
        await awaitReady(output);

        if (process.argv.includes("--self-test")) {
          const selfTest = await runHarnessSelfTest(ORIGIN);
          const undetected = selfTest.filter((entry) => !entry.detected);
          if (undetected.length > 0) {
            throw new Error(
              [
                "The browser harness did not produce every expected result:",
                ...undetected.map(
                  (entry) =>
                    `  - ${entry.name} (expected ${entry.expected}); observed: ${
                      entry.observed.length === 0
                        ? "nothing"
                        : entry.observed
                            .map(
                              (failure) =>
                                `[${failure.kind}] ${failure.detail}`,
                            )
                            .join(" | ")
                    }`,
                ),
              ].join("\n"),
            );
          }
          console.log(
            `Harness self-test passed: verified ${selfTest.length} cases (${selfTest
              .map((entry) => entry.name)
              .join(", ")})`,
          );
          return;
        }

        const result = await runBrowserMatrix({
          origin: ORIGIN,
          ...(only === undefined ? {} : { only }),
          screenshotDirectory: argument("screenshots"),
        });
        writeMatrixReport(
          argument("report") ?? "browser-matrix-report.json",
          result,
        );
        if (result.failures.length > 0) {
          throw new Error(
            [
              `Production browser matrix found ${result.failures.length} failure(s):`,
              ...result.failures.map(
                (failure) => `  - [${failure.kind}] ${failure.detail}`,
              ),
            ].join("\n"),
          );
        }
        console.log(
          `Production browser matrix passed ${result.cases.length} case(s)`,
        );
      });
    }),
  ),
);
