import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { DEFAULT_POL_BUDGET_POLICY } from "@orbit/protocol/pol-planner";

import { resolveOperatorEnvironment as resolveOperatorEnvironmentRaw } from "./base-sepolia-operator.ts";

const INGEST_TOKEN = Buffer.from(
  "base-quotron-test:ingest-v1".padEnd(32, "."),
).toString("base64url");
const resolveOperatorEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  root: string,
) =>
  resolveOperatorEnvironmentRaw(
    { HISTORY_INGEST_API_TOKEN: INGEST_TOKEN, ...environment },
    root,
  );

const SHARED_OPERATOR_KEY = `0x${"11".repeat(32)}` as const;
const KEEPER_OPERATOR_KEY = `0x${"22".repeat(32)}` as const;
const LIQUIDITY_EXECUTOR_OPERATOR_KEY = `0x${"33".repeat(32)}` as const;

describe("Base Sepolia operator environment", () => {
  it("refuses controlled execution without the watch's durable run grant", () => {
    const environment = {
      BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
      OPERATOR_EXECUTE: "true",
      OPERATOR_PRIVATE_KEY: SHARED_OPERATOR_KEY,
      OPERATOR_CONTROL_DATABASE_PATH: ".data/control.sqlite",
    };
    expect(() =>
      resolveOperatorEnvironment(environment, "/repository"),
    ).toThrow("supervisor-issued run grant");
    expect(
      resolveOperatorEnvironment(
        {
          ...environment,
          OPERATOR_CONTROL_RUN_ID: "11111111-1111-4111-8111-111111111111",
        },
        "/repository",
      ).controlGrant,
    ).toEqual({
      databasePath: "/repository/.data/control.sqlite",
      runId: "11111111-1111-4111-8111-111111111111",
    });
  });
  it("rejects a missing ingestion credential even in dry-run mode", () => {
    expect(() =>
      resolveOperatorEnvironmentRaw(
        { BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example" },
        "/repository",
      ),
    ).toThrow("HISTORY_INGEST_API_TOKEN");
  });

  it("treats blank optional template bindings as absent in dry-run mode", () => {
    expect(
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          RPC_URL: "",
          DEPLOYMENT_MANIFEST_PATH: "",
          OPERATOR_EVIDENCE_PATH: ".scratch/base-sepolia-operator.json",
          HISTORY_INDEX_URL: "http://127.0.0.1:8787",
          HISTORY_API_TOKEN: "legacy-shared-token-must-be-ignored",
          KEEPER_ATTEMPT_OUTBOX_PATH: "",
          OPERATOR_EXECUTE: "false",
          OPERATOR_MINIMUM_OUTPUT_BPS: "9900",
          OPERATOR_POL_MINIMUM_QUEUE_WETH: "",
          OPERATOR_POL_TARGET_WETH_PER_CYCLE: "",
          OPERATOR_POL_MAXIMUM_WETH_PER_CYCLE: "",
          OPERATOR_POL_STALE_QUEUE_SECONDS: "",
          OPERATOR_PRIVATE_KEY: "",
          DEPLOYER_PRIVATE_KEY: "",
        },
        "/repository",
      ),
    ).toEqual({
      rpcUrl: "https://base-sepolia.example",
      manifestPath: "/repository/deployments/84532.json",
      evidencePath: "/repository/.scratch/base-sepolia-operator.json",
      historyIndexUrl: "http://127.0.0.1:8787",
      historyIngestApiToken: INGEST_TOKEN,
      keeperAttemptOutboxPath:
        "/repository/.data/operator/base-sepolia-keeper-attempt-outbox.sqlite",
      execute: false,
      minimumOutputBps: 9900,
      polPolicy: DEFAULT_POL_BUDGET_POLICY,
      polStaleQueueSeconds: 900n,
      keeperPrivateKey: undefined,
      liquidityExecutorPrivateKey: undefined,
    });
  });

  it("configures only the ingestion credential for keeper-attempt writes", () => {
    const environment = resolveOperatorEnvironment(
      {
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        HISTORY_INGEST_API_TOKEN: INGEST_TOKEN,
        HISTORY_READ_API_TOKEN: "read-token-must-not-be-used",
        HISTORY_API_TOKEN: "legacy-shared-token-must-not-be-used",
      },
      "/repository",
    );

    expect(environment.historyIngestApiToken).toBe(INGEST_TOKEN);
    expect(environment).not.toHaveProperty("historyApiToken");
    expect(Object.values(environment)).not.toContain(
      "read-token-must-not-be-used",
    );
    expect(Object.values(environment)).not.toContain(
      "legacy-shared-token-must-not-be-used",
    );
  });

  it.each([
    "https://127.0.0.1:8787",
    "http://localhost:8787",
    "http://2130706433:8787",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:80",
    "http://user:password@127.0.0.1:8787",
    "http://127.0.0.1:8787/private",
    "http://127.0.0.1:8787?token=value",
    " http://127.0.0.1:8787",
  ])("rejects unsafe history endpoint %s", (historyIndexUrl) => {
    expect(() =>
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          HISTORY_INDEX_URL: historyIndexUrl,
        },
        "/repository",
      ),
    ).toThrow(/exact root http:\/\/127\.0\.0\.1:<port>/u);
  });

  it.each([
    "weak",
    `${INGEST_TOKEN}\n`,
    ` ${INGEST_TOKEN}`,
    `${INGEST_TOKEN.slice(0, -1)}B`,
    Buffer.alloc(32, 0xa5).toString("base64url"),
  ])("rejects unsafe history ingestion credential", (ingestApiToken) => {
    expect(() =>
      resolveOperatorEnvironmentRaw(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          HISTORY_INGEST_API_TOKEN: ingestApiToken,
        },
        "/repository",
      ),
    ).toThrow(/HISTORY_INGEST_API_TOKEN/u);
  });

  it("parses validated decimal WETH policy overrides", () => {
    expect(
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          OPERATOR_POL_MINIMUM_QUEUE_WETH: "0.01",
          OPERATOR_POL_TARGET_WETH_PER_CYCLE: "0.1",
          OPERATOR_POL_MAXIMUM_WETH_PER_CYCLE: "0.05",
          OPERATOR_POL_STALE_QUEUE_SECONDS: "1200",
        },
        "/repository",
      ).polPolicy,
    ).toEqual({
      minimumQueueWeth: 10_000_000_000_000_000n,
      targetWethPerCycle: 100_000_000_000_000_000n,
      maximumWethPerCycle: 50_000_000_000_000_000n,
    });
    expect(
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          OPERATOR_POL_STALE_QUEUE_SECONDS: "1200",
        },
        "/repository",
      ).polStaleQueueSeconds,
    ).toBe(1_200n);
    expect(() =>
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          OPERATOR_POL_MINIMUM_QUEUE_WETH: "0.02",
          OPERATOR_POL_TARGET_WETH_PER_CYCLE: "0.01",
        },
        "/repository",
      ),
    ).toThrow("target WETH");
  });

  it("still requires a real signing key when execute mode is enabled", () => {
    expect(() =>
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          OPERATOR_EXECUTE: "true",
          OPERATOR_PRIVATE_KEY: " ",
          DEPLOYER_PRIVATE_KEY: "",
        },
        "/repository",
      ),
    ).toThrow(/OPERATOR_EXECUTE=true requires OPERATOR_PRIVATE_KEY/u);
  });

  it("does not accept the deployment key as an operator signing key", () => {
    expect(() =>
      resolveOperatorEnvironment(
        {
          BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
          OPERATOR_EXECUTE: "true",
          DEPLOYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        },
        "/repository",
      ),
    ).toThrow(/OPERATOR_EXECUTE=true requires OPERATOR_PRIVATE_KEY/u);
  });

  it.each([
    {
      name: "OPERATOR_PRIVATE_KEY",
      environment: { OPERATOR_PRIVATE_KEY: "invalid-shared-key" },
    },
    {
      name: "OPERATOR_KEEPER_PRIVATE_KEY",
      environment: { OPERATOR_KEEPER_PRIVATE_KEY: "invalid-keeper-key" },
    },
    {
      name: "OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY",
      environment: {
        OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "invalid-executor-key",
      },
    },
  ] as const)(
    "identifies an invalid $name binding",
    ({ environment, name }) => {
      expect(() =>
        resolveOperatorEnvironment(
          {
            BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
            ...environment,
          },
          "/repository",
        ),
      ).toThrow(`${name} is invalid`);
    },
  );

  it("binds the dedicated shared key to both operational roles", () => {
    const environment = resolveOperatorEnvironment(
      {
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        OPERATOR_EXECUTE: "true",
        OPERATOR_PRIVATE_KEY: SHARED_OPERATOR_KEY,
      },
      "/repository",
    );

    expect({
      keeperPrivateKey: environment.keeperPrivateKey,
      liquidityExecutorPrivateKey: environment.liquidityExecutorPrivateKey,
    }).toEqual({
      keeperPrivateKey: SHARED_OPERATOR_KEY,
      liquidityExecutorPrivateKey: SHARED_OPERATOR_KEY,
    });
  });

  it("accepts independently configured operational role keys", () => {
    const environment = resolveOperatorEnvironment(
      {
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        OPERATOR_EXECUTE: "true",
        OPERATOR_KEEPER_PRIVATE_KEY: KEEPER_OPERATOR_KEY,
        OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY:
          LIQUIDITY_EXECUTOR_OPERATOR_KEY,
      },
      "/repository",
    );

    expect({
      keeperPrivateKey: environment.keeperPrivateKey,
      liquidityExecutorPrivateKey: environment.liquidityExecutorPrivateKey,
    }).toEqual({
      keeperPrivateKey: KEEPER_OPERATOR_KEY,
      liquidityExecutorPrivateKey: LIQUIDITY_EXECUTOR_OPERATOR_KEY,
    });
  });

  it.each([
    { OPERATOR_KEEPER_PRIVATE_KEY: KEEPER_OPERATOR_KEY },
    {
      OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: LIQUIDITY_EXECUTOR_OPERATOR_KEY,
    },
  ])(
    "requires both operational role keys when no shared key is configured",
    (roleEnvironment) => {
      expect(() =>
        resolveOperatorEnvironment(
          {
            BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
            OPERATOR_EXECUTE: "true",
            ...roleEnvironment,
          },
          "/repository",
        ),
      ).toThrow(
        /both OPERATOR_KEEPER_PRIVATE_KEY and OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY/u,
      );
    },
  );

  it("allows one operational role to rotate away from the shared key", () => {
    const environment = resolveOperatorEnvironment(
      {
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        OPERATOR_EXECUTE: "true",
        OPERATOR_PRIVATE_KEY: SHARED_OPERATOR_KEY,
        OPERATOR_KEEPER_PRIVATE_KEY: KEEPER_OPERATOR_KEY,
      },
      "/repository",
    );

    expect({
      keeperPrivateKey: environment.keeperPrivateKey,
      liquidityExecutorPrivateKey: environment.liquidityExecutorPrivateKey,
    }).toEqual({
      keeperPrivateKey: KEEPER_OPERATOR_KEY,
      liquidityExecutorPrivateKey: SHARED_OPERATOR_KEY,
    });
  });
});
