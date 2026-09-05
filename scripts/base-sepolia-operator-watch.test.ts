import { spawn } from "node:child_process";

import { Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import {
  createOperatorWatchChildEnvironment,
  operatorWatchAnnouncement,
  resolveOperatorWatchEnvironment,
  runOperatorWatch,
  runOperatorWatchCycle,
} from "./base-sepolia-operator-watch.ts";
import { runManagedProcess } from "./effect-runtime.ts";

describe("Base Sepolia operator watch", () => {
  it("starts each bounded run without unrelated or deployment secrets", () => {
    expect(
      createOperatorWatchChildEnvironment({
        DEPLOYER_PRIVATE_KEY: "deployer-secret",
        HISTORY_API_TOKEN: "legacy-history-token",
        HISTORY_INGEST_API_TOKEN: "history-ingest-token",
        HISTORY_READ_API_TOKEN: "history-read-token",
        NODE_OPTIONS: "--require=/sentinel/forbidden.cjs",
        OPERATOR_EXECUTE: "true",
        OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
        OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
        OPERATOR_PRIVATE_KEY: "operator-secret",
        TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
      }),
    ).toEqual({
      HISTORY_INGEST_API_TOKEN: "history-ingest-token",
      OPERATOR_EXECUTE: "true",
      OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
      OPERATOR_PRIVATE_KEY: "operator-secret",
    });
  });

  it("defaults to an explicit five-minute dry-run schedule", () => {
    expect(resolveOperatorWatchEnvironment({})).toEqual({
      execute: false,
      intervalMilliseconds: 300_000,
    });
  });

  it("rejects invalid execution and interval settings", () => {
    expect(() =>
      resolveOperatorWatchEnvironment({ OPERATOR_EXECUTE: "yes" }),
    ).toThrow(/OPERATOR_EXECUTE must be true or false/);
    expect(() =>
      resolveOperatorWatchEnvironment({ OPERATOR_INTERVAL_SECONDS: "59" }),
    ).toThrow(/at least 60 seconds/);
  });

  it("makes execution risk unmistakable before recurring work begins", () => {
    expect(
      operatorWatchAnnouncement({
        controlDatabasePath: undefined,
        controlSurface: undefined,
        execute: true,
        intervalMilliseconds: 300_000,
      }),
    ).toBe(
      "WARNING: Base Sepolia operator watch started every 300s in EXECUTE mode; eligible transactions will be signed.\n",
    );
    expect(
      operatorWatchAnnouncement({
        controlDatabasePath: undefined,
        controlSurface: undefined,
        execute: false,
        intervalMilliseconds: 300_000,
      }),
    ).toContain("DRY-RUN mode; no transactions will be submitted");
  });

  it("retries a failed bounded run without overlapping the next run", async () => {
    const failures: string[] = [];
    let activeRuns = 0;
    let maximumActiveRuns = 0;
    let runs = 0;
    const runOnce = Effect.gen(function* () {
      runs += 1;
      activeRuns += 1;
      maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
      yield* Effect.promise(
        () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
      );
      activeRuns -= 1;
      if (runs === 1) return yield* Effect.fail(new Error("rpc unavailable"));
    });
    const waitForNextRun = Effect.suspend(() =>
      runs >= 2 ? Effect.fail("test-complete" as const) : Effect.void,
    );

    const exit = await Effect.runPromiseExit(
      runOperatorWatch({
        reportFailure: (message) =>
          Effect.sync(() => {
            failures.push(message);
          }),
        runOnce,
        waitForNextRun,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(runs).toBe(2);
    expect(maximumActiveRuns).toBe(1);
    expect(failures).toEqual(["rpc unavailable"]);
  });

  it("reports hostile provider failures safely without escaping the watch cycle", async () => {
    const hostile = Object.create(null);
    Object.defineProperties(hostile, {
      shortMessage: {
        get: () => {
          throw new Error("short message getter failed");
        },
      },
      message: {
        get: () => {
          throw new Error("message getter failed");
        },
      },
      cause: {
        get: () => {
          throw new Error("cause getter failed");
        },
      },
    });
    const failures: string[] = [];

    await Effect.runPromise(
      runOperatorWatchCycle({
        reportFailure: (message) =>
          Effect.sync(() => {
            failures.push(message);
          }),
        runOnce: Effect.fail(hostile),
      }),
    );

    expect(failures).toEqual(["Operator run failed"]);
  });

  it("redacts and bounds nested provider diagnostics before reporting them", async () => {
    const secret = "watch-provider-secret";
    const failures: string[] = [];

    await Effect.runPromise(
      runOperatorWatchCycle({
        reportFailure: (message) =>
          Effect.sync(() => {
            failures.push(message);
          }),
        runOnce: Effect.fail(
          new Error("Operator child failed", {
            cause: new Error(
              `request to https://rpc.example.test/${secret} failed token=${secret} ${"x".repeat(4_096)}`,
            ),
          }),
        ),
      }),
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Operator child failed");
    expect(failures[0]).toContain("[REDACTED_URL]");
    expect(failures[0]).toContain("token=[REDACTED]");
    expect(failures[0]).not.toContain(secret);
    expect(failures[0]?.length).toBeLessThanOrEqual(512);
  });

  it("interrupts and terminates an in-flight operator child", async () => {
    let releaseStart: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let child: ReturnType<typeof spawn> | undefined;
    const runOnce = runManagedProcess("operator test", () => {
      child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      child.once("spawn", () => {
        releaseStart?.();
      });
      return child;
    });
    const fiber = Effect.runFork(
      runOperatorWatch({
        reportFailure: () => Effect.void,
        runOnce,
        waitForNextRun: Effect.never,
      }),
    );

    await started;
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(child?.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});

describe("control-plane aware announcement", () => {
  it("does not claim a mode the stored policy will override", () => {
    const announcement = operatorWatchAnnouncement({
      controlDatabasePath: "/tmp/control.sqlite",
      controlSurface: undefined,
      execute: true,
      intervalMilliseconds: 300_000,
    });
    // A startup default of execute must not be announced as EXECUTE mode when
    // a stored `stopped` policy governs the first cycle.
    expect(announcement).not.toContain("EXECUTE mode");
    expect(announcement).toContain("control-plane policy");
    expect(announcement).toContain("fails closed");
  });

  it("keeps the startup announcement when no control ledger is configured", () => {
    expect(
      operatorWatchAnnouncement({
        controlDatabasePath: undefined,
        controlSurface: undefined,
        execute: true,
        intervalMilliseconds: 300_000,
      }),
    ).toContain("EXECUTE mode");
  });
});
