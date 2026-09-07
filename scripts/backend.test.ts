import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { Effect, Either, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import {
  acquireBackendInstance,
  foundationalBackendServices,
  operatorBackendService,
  createBackendLaunchPlan,
  createBackendServiceEnvironment,
  ensureBackendBindingsAvailable,
  resolveBackendConfiguration,
  resolveHistoryReadinessConfiguration,
  runBackendServices,
  waitForHistoryReadiness,
  type BackendService,
} from "./backend.ts";

const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const HISTORY_READ_API_TOKEN = historyCredentialFixture("read-v1");
const HISTORY_INGEST_API_TOKEN = historyCredentialFixture("ingest-v1");

const testServices = (count: number): readonly BackendService[] =>
  foundationalBackendServices.slice(0, count);

const persistentChild = (): ChildProcess =>
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });

describe("combined backend", () => {
  it("hands backend ownership to a new supervisor", async () => {
    const socketPath = join(
      "/tmp",
      `orbit-${process.pid}-${crypto.randomUUID()}.sock`,
    );
    const firstRelease: { current?: () => Promise<void> } = {};
    const first = await acquireBackendInstance({
      socketPath,
      shutdownCurrent: () => void firstRelease.current?.(),
    });
    firstRelease.current = first.release;

    const second = await acquireBackendInstance({ socketPath });

    await second.release();
  });
  it("keeps ownership until delayed worker cleanup releases it", async () => {
    const socketPath = join(
      "/tmp",
      `orbit-${process.pid}-${crypto.randomUUID()}.sock`,
    );
    let shutdownCount = 0;
    const shutdownRequested = Promise.withResolvers<void>();
    const first = await acquireBackendInstance({
      socketPath,
      shutdownCurrent: () => {
        shutdownCount += 1;
        shutdownRequested.resolve();
      },
    });
    let acquired = false;
    const secondPromise = acquireBackendInstance({ socketPath }).then(
      (instance) => {
        acquired = true;
        return instance;
      },
    );
    try {
      await shutdownRequested.promise;
      // Simulate workers still releasing their listeners after SIGTERM.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(acquired).toBe(false);
      expect(shutdownCount).toBe(1);
    } finally {
      await first.release();
      const second = await secondPromise;
      await second.release();
    }
  });
  it("projects a launch plan without retaining the combined source environment", () => {
    const plan = createBackendLaunchPlan({
      AWS_SECRET_ACCESS_KEY: "sentinel-cloud-secret",
      DEPLOYER_PRIVATE_KEY: "sentinel-deployer-secret",
      HISTORY_API_TOKEN: "sentinel-legacy-history-secret",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
      HISTORY_READ_API_TOKEN,
      NODE_OPTIONS: "--require=/sentinel/forbidden.cjs",
      OPERATOR_PRIVATE_KEY: "operator-secret",
      PATH: "/usr/bin",
      PUBLIC_API_PORT: "8800",
      TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
    });

    expect(plan.supervisorEnvironment).toEqual({ PATH: "/usr/bin" });
    expect(plan.serviceEnvironments.api).not.toHaveProperty(
      "OPERATOR_PRIVATE_KEY",
    );
    expect(plan.serviceEnvironments.api).toMatchObject({
      HISTORY_READ_API_TOKEN,
    });
    expect(plan.serviceEnvironments.api).not.toHaveProperty(
      "HISTORY_INGEST_API_TOKEN",
    );
    expect(plan.serviceEnvironments.history).toMatchObject({
      HISTORY_INGEST_API_TOKEN,
      HISTORY_READ_API_TOKEN,
    });
    expect(plan.serviceEnvironments.operator).toMatchObject({
      HISTORY_INGEST_API_TOKEN,
      OPERATOR_PRIVATE_KEY: "operator-secret",
    });
    expect(plan.serviceEnvironments.operator).not.toHaveProperty(
      "HISTORY_READ_API_TOKEN",
    );
    expect(plan.serviceEnvironments.funding).toMatchObject({
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
    });
    expect(JSON.stringify(plan)).not.toContain("sentinel-cloud-secret");
    expect(JSON.stringify(plan)).not.toContain("sentinel-deployer-secret");
    expect(JSON.stringify(plan)).not.toContain(
      "sentinel-legacy-history-secret",
    );
    expect(JSON.stringify(plan)).not.toContain("/sentinel/forbidden.cjs");
  });

  it("gives the public API only its explicit runtime configuration", () => {
    const environment = createBackendServiceEnvironment("api", {
      DEPLOYER_PRIVATE_KEY: "deployer-secret",
      OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
      OPERATOR_PRIVATE_KEY: "operator-secret",
      PUBLIC_API_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
      PUBLIC_API_PORT: "8800",
      HISTORY_API_TOKEN: "legacy-history-secret",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
      HISTORY_READ_API_TOKEN,
      TESTNET_FUNDING_API_TOKEN: "funding-secret",
      TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-signer-secret",
    });

    expect(environment).toMatchObject({
      PUBLIC_API_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
      PUBLIC_API_PORT: "8800",
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
      HISTORY_READ_API_TOKEN,
      TESTNET_FUNDING_API_TOKEN: "funding-secret",
      TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
    });
    expect(environment).not.toHaveProperty("DEPLOYER_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("OPERATOR_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("HISTORY_API_TOKEN");
    expect(environment).not.toHaveProperty("HISTORY_INGEST_API_TOKEN");
    expect(environment).not.toHaveProperty("OPERATOR_KEEPER_PRIVATE_KEY");
    expect(environment).not.toHaveProperty(
      "OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY",
    );
    expect(environment).not.toHaveProperty(
      "TESTNET_FUNDING_SIGNER_PRIVATE_KEY",
    );
  });

  it("gives the history worker only read-model configuration", () => {
    const environment = createBackendServiceEnvironment("history", {
      BASE_SEPOLIA_RPC_URL: "https://shared-rpc.invalid",
      DEPLOYER_PRIVATE_KEY: "deployer-secret",
      HISTORY_API_TOKEN: "legacy-history-secret",
      HISTORY_BATCH_BLOCKS: "2000",
      HISTORY_DATABASE_PATH: ".data/history.sqlite",
      HISTORY_HOST: "127.0.0.1",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_READ_API_TOKEN,
      OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
      OPERATOR_PRIVATE_KEY: "operator-secret",
      PUBLIC_API_PORT: "8800",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
    });

    expect(environment).toEqual({
      BASE_SEPOLIA_RPC_URL: "https://shared-rpc.invalid",
      HISTORY_BATCH_BLOCKS: "2000",
      HISTORY_DATABASE_PATH: ".data/history.sqlite",
      HISTORY_HOST: "127.0.0.1",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_READ_API_TOKEN,
    });
  });

  it("gives the funding launcher only its dedicated signer boundary", () => {
    const environment = createBackendServiceEnvironment("funding", {
      DEPLOYER_PRIVATE_KEY: "deployer-secret",
      HISTORY_API_TOKEN: "legacy-history-secret",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_READ_API_TOKEN,
      OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
      OPERATOR_PRIVATE_KEY: "operator-secret",
      RPC_URL: "https://funding-rpc.invalid",
      TESTNET_FUNDING_API_TOKEN: "funding-token",
      TESTNET_FUNDING_ENABLED: "true",
      TESTNET_FUNDING_ENV_PATH: "/run/secrets/orbit-funding.env",
      TESTNET_FUNDING_SIGNER_ADDRESS:
        "0x1000000000000000000000000000000000000001",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
    });

    expect(environment).toEqual({
      RPC_URL: "https://funding-rpc.invalid",
      TESTNET_FUNDING_API_TOKEN: "funding-token",
      TESTNET_FUNDING_ENABLED: "true",
      TESTNET_FUNDING_ENV_PATH: "/run/secrets/orbit-funding.env",
      TESTNET_FUNDING_SIGNER_ADDRESS:
        "0x1000000000000000000000000000000000000001",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
    });
  });

  it("gives operator watch only bounded operator configuration", () => {
    const environment = createBackendServiceEnvironment("operator", {
      BASE_SEPOLIA_RPC_URL: "https://operator-rpc.invalid",
      DEPLOYER_PRIVATE_KEY: "deployer-secret",
      HISTORY_API_TOKEN: "legacy-history-secret",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
      HISTORY_READ_API_TOKEN,
      KEEPER_ATTEMPT_OUTBOX_PATH: ".data/operator-outbox.sqlite",
      OPERATOR_EXECUTE: "true",
      OPERATOR_INTERVAL_SECONDS: "300",
      OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
      OPERATOR_PRIVATE_KEY: "operator-secret",
      OPERATOR_POL_TARGET_WETH_PER_CYCLE: "0.025",
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
    });

    expect(environment).toEqual({
      BASE_SEPOLIA_RPC_URL: "https://operator-rpc.invalid",
      HISTORY_INGEST_API_TOKEN,
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
      KEEPER_ATTEMPT_OUTBOX_PATH: ".data/operator-outbox.sqlite",
      OPERATOR_EXECUTE: "true",
      OPERATOR_INTERVAL_SECONDS: "300",
      OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
      OPERATOR_PRIVATE_KEY: "operator-secret",
      OPERATOR_POL_TARGET_WETH_PER_CYCLE: "0.025",
    });
  });

  it("maps the self-funded staging deployer only into an unconfigured live operator", () => {
    const environment = {
      DEPLOYER_PRIVATE_KEY: "development-single-signer",
      DEPLOYMENT_ENVIRONMENT: "staging",
      OPERATOR_EXECUTE: "true",
      SELF_FUNDED_TEST_ASSETS: "true",
    };

    expect(createBackendServiceEnvironment("operator", environment)).toEqual({
      OPERATOR_EXECUTE: "true",
      OPERATOR_PRIVATE_KEY: "development-single-signer",
    });
    for (const service of [
      "api",
      "funding",
      "history",
      "replenisher",
    ] as const) {
      expect(
        createBackendServiceEnvironment(service, environment),
      ).not.toHaveProperty("OPERATOR_PRIVATE_KEY");
      expect(
        createBackendServiceEnvironment(service, environment),
      ).not.toHaveProperty("DEPLOYER_PRIVATE_KEY");
    }

    expect(
      createBackendServiceEnvironment("operator", {
        ...environment,
        OPERATOR_PRIVATE_KEY: "dedicated-operator",
      }).OPERATOR_PRIVATE_KEY,
    ).toBe("dedicated-operator");
    expect(
      createBackendServiceEnvironment("operator", {
        ...environment,
        DEPLOYMENT_ENVIRONMENT: "production",
      }),
    ).not.toHaveProperty("OPERATOR_PRIVATE_KEY");
  });

  it("starts backend children with their isolated environment", async () => {
    const apiProbe: BackendService = {
      id: "api",
      label: "public API environment probe",
      command: process.execPath,
      arguments: [
        "-e",
        `process.exit(
          process.env.PUBLIC_API_PORT === "8800" &&
          process.env.DEPLOYER_PRIVATE_KEY === undefined
            ? 0
            : 70,
        )`,
      ],
    };
    const result = await Effect.runPromise(
      Effect.either(
        runBackendServices({
          environment: {
            DEPLOYER_PRIVATE_KEY: "sentinel-deployer-secret",
            PUBLIC_API_PORT: "8800",
          },
          foundationalServices: [apiProbe],
          operatorService: operatorBackendService,
          waitForOperatorDependency: Effect.never,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "SubprocessError" });
      expect(result.left.cause).toMatchObject({ code: 0 });
    }
  });

  it("pipes every service so its output can be attributed", () => {
    // The default and the real entry point are separate spawn call sites, and
    // an inherited stream cannot be tagged. Updating one and not the other is
    // how five services shared one anonymous stream.
    const source = readFileSync(
      new URL("./backend.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain('stdio: "inherit"');
    expect(source.match(/stdio: \["ignore", "pipe", "pipe"\]/gu)).toHaveLength(
      2,
    );
  });

  it("uses authenticated history readiness without exposing the token in its URL", async () => {
    const configuration = resolveHistoryReadinessConfiguration({
      HISTORY_READ_API_TOKEN,
      HISTORY_INGEST_API_TOKEN: "ingestion-secret-must-not-be-used",
      HISTORY_API_TOKEN: "legacy-secret-must-not-be-used",
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
    });
    const requests: Array<{
      readonly input: string;
      readonly authorization: string | null;
      readonly redirect: RequestRedirect | undefined;
    }> = [];
    let checks = 0;

    await Effect.runPromise(
      waitForHistoryReadiness(configuration, {
        fetcher: async (input, init) => {
          checks += 1;
          requests.push({
            input: input.toString(),
            authorization: new Headers(init?.headers).get("authorization"),
            redirect: init?.redirect,
          });
          return new Response(undefined, { status: checks === 1 ? 503 : 200 });
        },
        pollMilliseconds: 1,
      }),
    );

    expect(requests).toEqual([
      {
        input: "http://127.0.0.1:8787/readyz",
        authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
        redirect: "error",
      },
      {
        input: "http://127.0.0.1:8787/readyz",
        authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
        redirect: "error",
      },
    ]);
    expect(configuration.url.href).not.toContain("history-read-secret");
    expect(configuration).not.toHaveProperty("ingestApiToken");
    expect(Object.values(configuration)).not.toContain(
      "ingestion-secret-must-not-be-used",
    );
    expect(Object.values(configuration)).not.toContain(
      "legacy-secret-must-not-be-used",
    );
  });

  it.each([
    "https://127.0.0.1:8787",
    "http://localhost:8787",
    "http://2130706433:8787",
    "http://history.example:8787",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:80",
    "http://user:password@127.0.0.1:8787",
    "http://127.0.0.1:8787/private",
    "http://127.0.0.1:8787?token=value",
    "http://127.0.0.1:8787#fragment",
    " http://127.0.0.1:8787",
  ])("refuses to send the history token to unsafe URL %s", (url) => {
    expect(() =>
      resolveHistoryReadinessConfiguration({
        HISTORY_READ_API_TOKEN,
        HISTORY_INDEX_URL: url,
      }),
    ).toThrow(/exact root http:\/\/127\.0\.0\.1:<port>/u);
  });

  it.each([
    "weak",
    `${HISTORY_READ_API_TOKEN}\n`,
    ` ${HISTORY_READ_API_TOKEN}`,
    `${HISTORY_READ_API_TOKEN.slice(0, -1)}9`,
    Buffer.alloc(32).toString("base64url"),
  ])("rejects unsafe history readiness credential", (readApiToken) => {
    expect(() =>
      resolveHistoryReadinessConfiguration({
        HISTORY_INDEX_URL: "http://127.0.0.1:8787",
        HISTORY_READ_API_TOKEN: readApiToken,
      }),
    ).toThrow(/HISTORY_READ_API_TOKEN/u);
  });

  it("resolves distinct loopback bindings for every server", () => {
    expect(
      resolveBackendConfiguration({
        HISTORY_INDEX_URL: "http://127.0.0.1:8787",
        HISTORY_READ_API_TOKEN,
        PUBLIC_API_PORT: "8800",
        TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
      }).bindings,
    ).toEqual([
      { host: "127.0.0.1", label: "history worker", port: 8787 },
      { host: "127.0.0.1", label: "funding worker", port: 8790 },
      { host: "127.0.0.1", label: "public API", port: 8800 },
    ]);
  });

  it("preflights the operator control listener whenever it is configured", () => {
    const environment = {
      HISTORY_INDEX_URL: "http://127.0.0.1:8787",
      HISTORY_READ_API_TOKEN,
      OPERATOR_CONTROL_PORT: "8795",
      PUBLIC_API_PORT: "8800",
      TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
    };
    // Without this the supervisor starts three servers and then loses the
    // whole group to the operator's bind failure.
    expect(resolveBackendConfiguration(environment).bindings).toContainEqual({
      host: "127.0.0.1",
      label: "operator control surface",
      port: 8795,
    });
    expect(() =>
      resolveBackendConfiguration({
        ...environment,
        OPERATOR_CONTROL_PORT: "8800",
      }),
    ).toThrow(/distinct/u);
    expect(() =>
      resolveBackendConfiguration({
        ...environment,
        OPERATOR_CONTROL_PORT: "0",
      }),
    ).toThrow(/OPERATOR_CONTROL_PORT/u);
  });

  it("does not start any worker or operator when a configured listener is occupied", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(0, "127.0.0.1", resolve);
    });
    const address = occupied.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test listener did not expose a TCP port");
    }
    let starts = 0;
    try {
      const result = await Effect.runPromise(
        Effect.either(
          runBackendServices({
            foundationalServices: testServices(3),
            operatorService: operatorBackendService,
            preflight: ensureBackendBindingsAvailable([
              {
                host: "127.0.0.1",
                label: "history worker",
                port: address.port,
              },
            ]),
            startService: () => {
              starts += 1;
              return persistentChild();
            },
            waitForOperatorDependency: Effect.void,
          }),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      expect(starts).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((cause) => {
          if (cause === undefined) resolve();
          else reject(cause);
        });
      });
    }
  });

  it("starts operator watch only after history is ready and cleans up every service", async () => {
    const started: BackendService["id"][] = [];
    const children: ChildProcess[] = [];
    let markFoundationsStarted: (() => void) | undefined;
    const foundationsStarted = new Promise<void>((resolve) => {
      markFoundationsStarted = resolve;
    });
    let markOperatorStarted: (() => void) | undefined;
    const operatorStarted = new Promise<void>((resolve) => {
      markOperatorStarted = resolve;
    });
    let markReady: (() => void) | undefined;
    let markReadinessWaiting: (() => void) | undefined;
    const readinessWaiting = new Promise<void>((resolve) => {
      markReadinessWaiting = resolve;
    });
    const readiness = Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          markReady = resolve;
          markReadinessWaiting?.();
        }),
    );
    const fiber = Effect.runFork(
      runBackendServices({
        foundationalServices: testServices(3),
        operatorService: operatorBackendService,
        startService: (service) => {
          started.push(service.id);
          const child = persistentChild();
          children.push(child);
          if (started.length === 3) markFoundationsStarted?.();
          if (service.id === "operator") markOperatorStarted?.();
          return child;
        },
        waitForOperatorDependency: readiness,
      }),
    );

    await foundationsStarted;
    expect(started).toEqual(["history", "funding", "api"]);
    await readinessWaiting;
    markReady?.();
    await operatorStarted;
    expect(started).toEqual(["history", "funding", "api", "operator"]);

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(
      children.every(
        (child) => child.exitCode !== null || child.signalCode !== null,
      ),
    ).toBe(true);
  });

  it.each([0, 7])(
    "tears down sibling services when one exits unexpectedly with code %i",
    async (exitCode) => {
      const children: ChildProcess[] = [];
      let starts = 0;
      const result = await Effect.runPromise(
        Effect.either(
          runBackendServices({
            foundationalServices: testServices(3),
            operatorService: operatorBackendService,
            startService: () => {
              starts += 1;
              const child = spawn(
                process.execPath,
                [
                  "-e",
                  starts === 1
                    ? `setTimeout(() => process.exit(${exitCode}), 25)`
                    : "setInterval(() => {}, 1000)",
                ],
                { stdio: "ignore" },
              );
              children.push(child);
              return child;
            },
            waitForOperatorDependency: Effect.never,
          }),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "SubprocessError" });
      }
      expect(starts).toBe(3);
      expect(
        children.every(
          (child) => child.exitCode !== null || child.signalCode !== null,
        ),
      ).toBe(true);
    },
  );
});
