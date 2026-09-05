import { Buffer } from "node:buffer";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { HistoryConfigurationError } from "./errors.ts";
import { loadHistoryRuntimeConfiguration } from "./runtime-configuration.ts";

const names = [
  "BASE_SEPOLIA_RPC_URL",
  "HISTORY_HOST",
  "HISTORY_PORT",
  "HISTORY_READ_API_TOKEN",
  "HISTORY_INGEST_API_TOKEN",
  "UNISWAP_V4_SUBGRAPH_URL",
  "UNISWAP_V4_SUBGRAPH_BEARER_TOKEN",
  "UNISWAP_V4_SUBGRAPH_TIMEOUT_MILLISECONDS",
  "UNISWAP_V4_SUBGRAPH_CACHE_SECONDS",
] as const;
const original = new Map(names.map((name) => [name, process.env[name]]));
const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const READ_TOKEN = historyCredentialFixture("read-v1");
const INGEST_TOKEN = historyCredentialFixture("ingest-v1");

const expectServiceConfigurationFailure = async (): Promise<void> => {
  const result = await Effect.runPromise(
    Effect.either(loadHistoryRuntimeConfiguration(process.cwd(), "service")),
  );
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left).toBeInstanceOf(HistoryConfigurationError);
  }
};

afterEach(() => {
  for (const name of names) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("history runtime configuration", () => {
  it("reports weak deployed credentials as a typed configuration failure", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
    process.env.HISTORY_READ_API_TOKEN = "weak";
    process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;

    const result = await Effect.runPromise(
      Effect.either(loadHistoryRuntimeConfiguration(process.cwd(), "service")),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(HistoryConfigurationError);
    }
  });

  it("resolves a literal loopback listener with a nondefault explicit port", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
    process.env.HISTORY_HOST = "127.0.0.1";
    process.env.HISTORY_PORT = "8787";
    process.env.HISTORY_READ_API_TOKEN = READ_TOKEN;
    process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;

    await expect(
      Effect.runPromise(
        loadHistoryRuntimeConfiguration(process.cwd(), "service"),
      ),
    ).resolves.toMatchObject({
      listener: {
        host: "127.0.0.1",
        readApiToken: READ_TOKEN,
        ingestApiToken: INGEST_TOKEN,
      },
      port: 8787,
    });
  });

  it.each(["localhost", "2130706433", "0.0.0.0"])(
    "rejects unsafe listener host %s",
    async (host) => {
      process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
      process.env.HISTORY_HOST = host;
      process.env.HISTORY_READ_API_TOKEN = READ_TOKEN;
      process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;

      await expectServiceConfigurationFailure();
    },
  );

  it.each(["0", "80", "65536"])(
    "rejects unsafe listener port %s",
    async (port) => {
      process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
      process.env.HISTORY_PORT = port;
      process.env.HISTORY_READ_API_TOKEN = READ_TOKEN;
      process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;

      await expectServiceConfigurationFailure();
    },
  );

  it.each([
    ["HISTORY_READ_API_TOKEN", `${READ_TOKEN}\n`],
    ["HISTORY_READ_API_TOKEN", `${READ_TOKEN.slice(0, -1)}9`],
    ["HISTORY_READ_API_TOKEN", Buffer.alloc(32).toString("base64url")],
    ["HISTORY_INGEST_API_TOKEN", ` ${INGEST_TOKEN}`],
    ["HISTORY_INGEST_API_TOKEN", `${INGEST_TOKEN.slice(0, -1)}B`],
    ["HISTORY_INGEST_API_TOKEN", Buffer.alloc(32, 0xa5).toString("base64url")],
  ] as const)("rejects unsafe deployed %s", async (name, value) => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
    process.env.HISTORY_READ_API_TOKEN = READ_TOKEN;
    process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;
    process.env[name] = value;

    await expectServiceConfigurationFailure();
  });

  it("keeps one-shot backfills independent of listener credentials", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
    delete process.env.HISTORY_READ_API_TOKEN;
    delete process.env.HISTORY_INGEST_API_TOKEN;

    await expect(
      Effect.runPromise(loadHistoryRuntimeConfiguration(process.cwd(), "once")),
    ).resolves.toMatchObject({ listener: undefined });
  });

  it("accepts a private server-side Uniswap v4 subgraph feed", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
    process.env.HISTORY_READ_API_TOKEN = READ_TOKEN;
    process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;
    process.env.UNISWAP_V4_SUBGRAPH_URL = "https://subgraph.example/graphql";
    process.env.UNISWAP_V4_SUBGRAPH_BEARER_TOKEN = "private-provider-token";
    process.env.UNISWAP_V4_SUBGRAPH_TIMEOUT_MILLISECONDS = "5000";
    process.env.UNISWAP_V4_SUBGRAPH_CACHE_SECONDS = "120";

    await expect(
      Effect.runPromise(
        loadHistoryRuntimeConfiguration(process.cwd(), "service"),
      ),
    ).resolves.toMatchObject({
      uniswapV4Subgraph: {
        bearerToken: "private-provider-token",
        cacheMilliseconds: 120_000,
        timeoutMilliseconds: 5_000,
      },
    });
  });

  it("rejects an orphaned subgraph credential and unsafe feed URL", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.example";
    process.env.HISTORY_READ_API_TOKEN = READ_TOKEN;
    process.env.HISTORY_INGEST_API_TOKEN = INGEST_TOKEN;
    process.env.UNISWAP_V4_SUBGRAPH_BEARER_TOKEN = "private-provider-token";
    await expectServiceConfigurationFailure();

    delete process.env.UNISWAP_V4_SUBGRAPH_BEARER_TOKEN;
    process.env.UNISWAP_V4_SUBGRAPH_URL = "http://subgraph.example/graphql";
    await expectServiceConfigurationFailure();
  });
});
