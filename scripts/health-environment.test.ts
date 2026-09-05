import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadHealthEnvironment } from "./health-environment.ts";

const HISTORY_READ_API_TOKEN = Buffer.from(
  "base-quotron-test:read-v1".padEnd(32, "."),
).toString("base64url");

const environmentKeys = [
  "RPC_URL",
  "BASE_SEPOLIA_RPC_URL",
  "DEPLOYMENT_MANIFEST_PATH",
  "HEALTH_EVIDENCE_PATH",
  "DEPLOYER_ADDRESS",
  "HISTORY_INDEX_URL",
  "HISTORY_READ_API_TOKEN",
  "HISTORY_INGEST_API_TOKEN",
  "HISTORY_API_TOKEN",
] as const;

const originalEnvironment = new Map<string, string | undefined>();
const temporaryDirectories: string[] = [];

const makeRepository = (contents?: string): string => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "base-quotron-health-"));
  temporaryDirectories.push(repositoryRoot);
  if (contents !== undefined) {
    writeFileSync(join(repositoryRoot, ".env"), contents);
  }
  return repositoryRoot;
};

beforeEach(() => {
  for (const key of environmentKeys) {
    originalEnvironment.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of environmentKeys) {
    const original = originalEnvironment.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  originalEnvironment.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Base Sepolia health environment", () => {
  it("loads RPC and evidence configuration from the root dotenv file", async () => {
    const repositoryRoot = makeRepository(
      [
        "BASE_SEPOLIA_RPC_URL=https://dotenv.example",
        "HEALTH_EVIDENCE_PATH=.scratch/base-sepolia-health.json",
        "HISTORY_INDEX_URL=http://127.0.0.1:9876",
        `HISTORY_READ_API_TOKEN=${HISTORY_READ_API_TOKEN}`,
        "HISTORY_INGEST_API_TOKEN=ingestion-secret-must-not-be-loaded",
        "HISTORY_API_TOKEN=legacy-secret-must-not-be-loaded",
      ].join("\n"),
    );

    const configuration = await Effect.runPromise(
      loadHealthEnvironment(repositoryRoot),
    );

    expect(configuration).toMatchObject({
      rpcUrl: "https://dotenv.example",
      manifestPath: join(repositoryRoot, "deployments/84532.json"),
      evidencePath: join(repositoryRoot, ".scratch/base-sepolia-health.json"),
      historyIndexUrl: "http://127.0.0.1:9876",
      historyReadApiToken: HISTORY_READ_API_TOKEN,
    });
    expect(configuration).not.toHaveProperty("historyIngestApiToken");
    expect(Object.values(configuration)).not.toContain(
      "ingestion-secret-must-not-be-loaded",
    );
    expect(Object.values(configuration)).not.toContain(
      "legacy-secret-must-not-be-loaded",
    );
  });

  it("defaults indexed history to the loopback worker and rejects non-loopback URLs", async () => {
    const defaultRepository = makeRepository(
      `BASE_SEPOLIA_RPC_URL=https://rpc.example\nHISTORY_READ_API_TOKEN=${HISTORY_READ_API_TOKEN}\n`,
    );

    await expect(
      Effect.runPromise(loadHealthEnvironment(defaultRepository)),
    ).resolves.toMatchObject({
      historyIndexUrl: "http://127.0.0.1:8787",
      historyReadApiToken: HISTORY_READ_API_TOKEN,
    });

    const unsafeRepository = makeRepository(
      [
        "BASE_SEPOLIA_RPC_URL=https://rpc.example",
        "HISTORY_INDEX_URL=https://history.example",
      ].join("\n"),
    );

    await expect(
      Effect.runPromise(loadHealthEnvironment(unsafeRepository)),
    ).rejects.toThrow("HISTORY_INDEX_URL is invalid");
  });

  it("preserves explicit shell configuration over dotenv values", async () => {
    const repositoryRoot = makeRepository("RPC_URL=https://dotenv.example\n");
    process.env.RPC_URL = "https://shell.example";
    process.env.HISTORY_READ_API_TOKEN = HISTORY_READ_API_TOKEN;

    const configuration = await Effect.runPromise(
      loadHealthEnvironment(repositoryRoot),
    );

    expect(configuration.rpcUrl).toBe("https://shell.example");
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
  ])("rejects unsafe history endpoint %s", async (historyIndexUrl) => {
    const repositoryRoot = makeRepository(
      `BASE_SEPOLIA_RPC_URL=https://rpc.example\nHISTORY_READ_API_TOKEN=${HISTORY_READ_API_TOKEN}\n`,
    );
    process.env.HISTORY_INDEX_URL = historyIndexUrl;

    await expect(
      Effect.runPromise(loadHealthEnvironment(repositoryRoot)),
    ).rejects.toThrow("HISTORY_INDEX_URL is invalid");
  });

  it.each([
    "weak",
    `${HISTORY_READ_API_TOKEN}\n`,
    ` ${HISTORY_READ_API_TOKEN}`,
    `${HISTORY_READ_API_TOKEN.slice(0, -1)}9`,
    Buffer.alloc(32).toString("base64url"),
  ])("rejects unsafe history read credential", async (readApiToken) => {
    const repositoryRoot = makeRepository(
      "BASE_SEPOLIA_RPC_URL=https://rpc.example\n",
    );
    process.env.HISTORY_READ_API_TOKEN = readApiToken;

    await expect(
      Effect.runPromise(loadHealthEnvironment(repositoryRoot)),
    ).rejects.toThrow(/HISTORY_READ_API_TOKEN/u);
  });

  it("fails clearly when the root dotenv file is absent", async () => {
    const repositoryRoot = makeRepository();

    await expect(
      Effect.runPromise(loadHealthEnvironment(repositoryRoot)),
    ).rejects.toThrow("Unable to load the root .env");
  });
});
