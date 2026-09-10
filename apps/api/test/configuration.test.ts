import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";

import { resolvePublicApiConfiguration } from "../src/configuration.js";

const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const HISTORY_READ_API_TOKEN = historyCredentialFixture("read-v1");

const thrownMessage = (operation: () => unknown): string => {
  try {
    operation();
    return "";
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
};

const validEnvironment = () => ({
  ADMIN_AUTH_APP_ORIGIN: "https://orbit.example",
  ADMIN_AUTH_DATABASE_PATH: "/var/lib/orbit/admin-auth/admin-auth.sqlite",
  ADMIN_AUTH_MANIFEST_PATH: "deployments/84532.json",
  ADMIN_AUTH_RPC_URL: "https://sepolia.base.org",
  HISTORY_READ_API_TOKEN,
  HISTORY_INGEST_API_TOKEN: "ingestion-secret-must-not-enter-public-api",
  HISTORY_INDEX_URL: "http://127.0.0.1:8787",
  PUBLIC_API_ALLOWED_ORIGINS:
    "https://orbit.example,http://localhost:3000,http://127.0.0.1:3000",
  TESTNET_FUNDING_API_TOKEN: "f".repeat(32),
  TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
});

describe("public API configuration", () => {
  it("resolves loopback workers, exact origins, and bounded defaults", () => {
    const configuration = resolvePublicApiConfiguration(validEnvironment());

    expect(configuration).toMatchObject({
      adminAuth: {
        appOrigin: "https://orbit.example",
        challengeTtlMilliseconds: 300_000,
        databasePath: "/var/lib/orbit/admin-auth/admin-auth.sqlite",
        manifestPath: "deployments/84532.json",
        rpcUrl: new URL("https://sepolia.base.org"),
        sessionTtlMilliseconds: 900_000,
      },
      historyReadApiToken: HISTORY_READ_API_TOKEN,
      host: "127.0.0.1",
      maximumRequestBodyBytes: 2_048,
      port: 8_800,
      trustProxy: false,
      upstreamTimeoutMilliseconds: 10_000,
    });
    expect([...configuration.allowedOrigins]).toEqual([
      "https://orbit.example",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    expect(configuration).not.toHaveProperty("historyIngestApiToken");
    expect(JSON.stringify(configuration)).not.toContain("ingestion-secret");
  });

  it.each([
    ["TESTNET_FUNDING_SERVICE_URL", "http://localhost:8790"],
    ["TESTNET_FUNDING_SERVICE_URL", "http://127.0.0.1:8790/private"],
  ])("rejects a non-loopback or non-root %s", (name, value) => {
    expect(() =>
      resolvePublicApiConfiguration({ ...validEnvironment(), [name]: value }),
    ).toThrow(/127\.0\.0\.1/u);
  });

  it.each([
    "https://127.0.0.1:8787",
    "http://0.0.0.0:8787",
    "http://localhost:8787",
    "http://2130706433:8787",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:80",
    "http://user:password@127.0.0.1:8787",
    "http://127.0.0.1:8787/private",
    "http://127.0.0.1:8787?token=value",
    "http://127.0.0.1:8787#fragment",
    " http://127.0.0.1:8787",
  ])("rejects unsafe exact history endpoint %s", (historyIndexUrl) => {
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        HISTORY_INDEX_URL: historyIndexUrl,
      }),
    ).toThrow(/exact root http:\/\/127\.0\.0\.1:<port>/u);
  });

  it.each([
    "*",
    "http://orbit.example",
    "https://orbit.example/path",
    "https://user:secret@orbit.example",
  ])("rejects unsafe browser origin %s", (origin) => {
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        PUBLIC_API_ALLOWED_ORIGINS: origin,
      }),
    ).toThrow(/origins/u);
  });

  it("rejects public binding, duplicate origins, and weak credentials", () => {
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        PUBLIC_API_HOST: "0.0.0.0",
      }),
    ).toThrow(/PUBLIC_API_HOST/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        PUBLIC_API_ALLOWED_ORIGINS:
          "https://orbit.example,https://orbit.example/",
      }),
    ).toThrow(/duplicates/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        HISTORY_READ_API_TOKEN: "weak",
      }),
    ).toThrow(/43 to 512 unpadded base64url/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        HISTORY_READ_API_TOKEN: `${HISTORY_READ_API_TOKEN}\n`,
      }),
    ).toThrow(/unpadded base64url/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        HISTORY_READ_API_TOKEN: ` ${HISTORY_READ_API_TOKEN}`,
      }),
    ).toThrow(/unpadded base64url/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        HISTORY_READ_API_TOKEN: `${HISTORY_READ_API_TOKEN.slice(0, -1)}9`,
      }),
    ).toThrow(/canonical form/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        HISTORY_READ_API_TOKEN: Buffer.alloc(32).toString("base64url"),
      }),
    ).toThrow(/nontrivial random material/u);
  });

  it("rejects malformed booleans and out-of-range integers", () => {
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        PUBLIC_API_TRUST_PROXY: "yes",
      }),
    ).toThrow(/true or false/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        PUBLIC_API_PORT: "0",
      }),
    ).toThrow(/PUBLIC_API_PORT/u);
  });

  it.each([
    ["ADMIN_AUTH_APP_ORIGIN", "http://orbit.example"],
    ["ADMIN_AUTH_APP_ORIGIN", "https://other.example"],
    ["ADMIN_AUTH_RPC_URL", "http://sepolia.base.org"],
    ["ADMIN_AUTH_RPC_URL", "https://user:secret@sepolia.base.org"],
    ["ADMIN_AUTH_DATABASE_PATH", ""],
    ["ADMIN_AUTH_MANIFEST_PATH", ""],
  ])("rejects unsafe admin auth setting %s", (name, value) => {
    expect(() =>
      resolvePublicApiConfiguration({ ...validEnvironment(), [name]: value }),
    ).toThrow(/ADMIN_AUTH|allowed origin/u);
  });

  it.each(["https://admin", "http://[::1]:3000"])(
    "rejects SIWE-incompatible admin app origin %s during configuration",
    (origin) => {
      expect(() =>
        resolvePublicApiConfiguration({
          ...validEnvironment(),
          ADMIN_AUTH_APP_ORIGIN: origin,
          PUBLIC_API_ALLOWED_ORIGINS: origin,
        }),
      ).toThrow(/ADMIN_AUTH_APP_ORIGIN/u);
    },
  );

  it("accepts loopback HTTP auth endpoints and bounds both auth lifetimes", () => {
    const configuration = resolvePublicApiConfiguration({
      ...validEnvironment(),
      ADMIN_AUTH_APP_ORIGIN: "http://127.0.0.1:3000",
      ADMIN_AUTH_CHALLENGE_TTL_SECONDS: "60",
      ADMIN_AUTH_RPC_URL: "http://127.0.0.1:8545",
      ADMIN_AUTH_SESSION_TTL_SECONDS: "300",
    });
    expect(configuration.adminAuth).toMatchObject({
      appOrigin: "http://127.0.0.1:3000",
      challengeTtlMilliseconds: 60_000,
      sessionTtlMilliseconds: 300_000,
    });
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        ADMIN_AUTH_CHALLENGE_TTL_SECONDS: "59",
      }),
    ).toThrow(/ADMIN_AUTH_CHALLENGE_TTL_SECONDS/u);
    expect(
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        ADMIN_AUTH_CHALLENGE_TTL_SECONDS: "600",
      }).adminAuth.challengeTtlMilliseconds,
    ).toBe(600_000);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        ADMIN_AUTH_CHALLENGE_TTL_SECONDS: "601",
      }),
    ).toThrow(/ADMIN_AUTH_CHALLENGE_TTL_SECONDS/u);
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        ADMIN_AUTH_SESSION_TTL_SECONDS: "3601",
      }),
    ).toThrow(/ADMIN_AUTH_SESSION_TTL_SECONDS/u);
  });

  it.each([
    "admin-auth.sqlite",
    ".data/admin-auth.sqlite",
    "/admin-auth.sqlite",
    "/",
    ":memory:",
  ])("rejects an unsafe admin auth database path %s", (databasePath) => {
    expect(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        ADMIN_AUTH_DATABASE_PATH: databasePath,
      }),
    ).toThrow(/ADMIN_AUTH_DATABASE_PATH/u);
  });

  it("normalizes an absolute admin database path without changing its parent", () => {
    const databasePath = resolve("/var/lib/orbit/auth/../auth/admin.sqlite");
    expect(
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        ADMIN_AUTH_DATABASE_PATH: "/var/lib/orbit/auth/../auth/admin.sqlite",
      }).adminAuth.databasePath,
    ).toBe(databasePath);
  });

  it("decodes an explicit keyed record without exposing rejected values", () => {
    const secret = "schema-rejected-api-secret";
    const malformed = {
      ...validEnvironment(),
      PUBLIC_API_PORT: { secret },
    } as unknown as Readonly<Record<string, string | undefined>>;
    const message = thrownMessage(() =>
      resolvePublicApiConfiguration(malformed),
    );

    expect(message).toBe(
      "Public API environment must contain only string values",
    );
    expect(message).not.toContain(secret);
  });

  it.each([
    [
      "ADMIN_AUTH_RPC_URL",
      "https://api-user:credential-in-url@sepolia.base.org",
    ],
    [
      "TESTNET_FUNDING_SERVICE_URL",
      "http://api-user:credential-in-url@127.0.0.1:8790",
    ],
    [
      "GRAPH_STUDIO_QUERY_URL",
      "https://api-user:credential-in-url@api.studio.thegraph.com/query/1/orbit/v1",
    ],
  ])("does not echo a credential-bearing %s", (name, value) => {
    const message = thrownMessage(() =>
      resolvePublicApiConfiguration({
        ...validEnvironment(),
        [name]: value,
      }),
    );

    expect(message).not.toContain("credential-in-url");
    expect(message).not.toContain(value);
  });
});
