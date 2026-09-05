import { spawn, type ChildProcess } from "node:child_process";

import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";

import { acquireManagedProcess, spawnProcess } from "./effect-runtime.ts";

describe("spawnProcess", () => {
  it("maps asynchronous executable lookup failures to SubprocessError", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        spawnProcess("Could not start missing executable", () =>
          spawn("base-quotron-command-that-does-not-exist"),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({
        _tag: "SubprocessError",
        message: "Could not start missing executable",
      });
    }
  });

  it("terminates a managed child when its Effect scope closes", async () => {
    let child: ChildProcess | undefined;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          child = yield* acquireManagedProcess("lifecycle test", () =>
            spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              stdio: "ignore",
            }),
          );
        }),
      ),
    );

    expect(child?.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it("redacts credential-bearing URLs before a failed main writes stderr", async () => {
    const secret = "provider-api-key";
    const runtimeUrl = new URL("./effect-runtime.ts", import.meta.url).href;
    const source = `
      import { Effect } from "effect";
      import { runInterruptibleMain } from ${JSON.stringify(runtimeUrl)};
      const nested = new Error(${JSON.stringify(
        `fetch failed at https://reader:${secret}@rpc.example.test/v2/${secret}`,
      )});
      runInterruptibleMain(
        Effect.fail(new Error("History RPC request failed", { cause: nested })),
      );
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        cwd: new URL("..", import.meta.url),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let diagnostic = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      diagnostic += chunk;
    });
    const result = await new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    expect(result).toEqual({ code: 1, signal: null });
    expect(diagnostic).toContain("History RPC request failed");
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic).not.toContain("rpc.example.test");
    expect(diagnostic).toContain("[REDACTED_URL]");
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "runs scoped cleanup after receiving %s",
    async (signal) => {
      const runtimeUrl = new URL("./effect-runtime.ts", import.meta.url).href;
      const source = `
        import { Effect } from "effect";
        import { runInterruptibleMain } from ${JSON.stringify(runtimeUrl)};
        runInterruptibleMain(
          Effect.acquireUseRelease(
            Effect.sync(() => process.stdout.write("ready\\n")),
            () => Effect.never,
            () => Effect.sync(() => process.stdout.write("released\\n")),
          ),
        );
      `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", source],
        {
          cwd: new URL("..", import.meta.url),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      let signalSent = false;
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        output += chunk;
        if (!signalSent && output.includes("ready")) {
          signalSent = true;
          child.kill(signal);
        }
      });
      const result = await new Promise<{
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once("exit", (code, exitSignal) =>
          resolve({ code, signal: exitSignal }),
        );
      });

      expect(result).toEqual({ code: 0, signal: null });
      expect(output).toContain("released");
    },
  );
});
