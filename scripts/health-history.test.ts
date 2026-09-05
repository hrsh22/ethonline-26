import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { sha256, stringToHex } from "viem";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectedIdentityConfiguration } from "@orbit/config/identity";
import type {
  ContractReadRequest,
  ContractReadResults,
  ProtocolReadTransport,
} from "@orbit/protocol/reader";

import { createBaseSepoliaHealthReader } from "./health-history.ts";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("deployments/84532.json", "utf8")) as unknown,
);
const block = BigInt(manifest.launch.blockNumber) + 100n;
const timestamp = 1_700_000_100n;
const historyOrigin = "http://127.0.0.1:9876";
const historyToken = "test-history-token";

const manifestEnvelope = {
  chainId: manifest.chainId,
  network: manifest.network,
  fingerprint: sha256(stringToHex(JSON.stringify(manifest))),
  commitment: manifest.identity.manifestHash,
  launchBlock: manifest.launch.blockNumber.toString(),
  canonicalPool: manifest.canonicalPool,
  sources: {
    poolManager: manifest.contracts.uniswapV4PoolManager,
    canonicalFeeHook: manifest.contracts.canonicalFeeHook,
    protocolLiquidityVault: manifest.contracts.protocolLiquidityVault,
    epochConverter: manifest.contracts.epochConverter,
    fuelCore: manifest.contracts.fuelCore,
    rewardLedger: manifest.contracts.rewardLedger,
  },
};

const pageResponse = (url: URL) => {
  const fromBlock = url.searchParams.get("fromBlock") ?? "0";
  const toBlock = url.searchParams.get("toBlock") ?? block.toString();
  return {
    manifest: manifestEnvelope,
    snapshot: {
      generation: "health-history-test",
      canonicalRevision: 0,
      blockNumber: toBlock,
      blockHash: `0x${"1".repeat(64)}`,
    },
    items: [],
    page: { hasMore: false },
    status: {
      state: "complete",
      requested: { fromBlock, toBlock },
      coverage: {
        fromBlock: manifest.launch.blockNumber.toString(),
        indexedThroughBlock: toBlock,
        indexedThroughTime: timestamp.toString(),
      },
      head: { observedBlock: toBlock, lagBlocks: "0" },
    },
  };
};

const keeperAttemptResponse = {
  manifest: manifestEnvelope,
  evidence: {
    source: "keeper-attempt-journal",
    generation: "keeper-health-test",
    state: "fresh",
    freshness: {
      observedAt: timestamp.toString(),
      recordedAt: timestamp.toString(),
      ageSeconds: "0",
      maximumAgeSeconds: "900",
    },
    coverage: { 1: "complete", 2: "complete", 3: "complete", 4: "complete" },
    tracks: {
      1: {
        state: "fresh",
        latest: {
          actionKind: "reward-track",
          track: 1,
          observedBlock: block.toString(),
          observedAt: timestamp.toString(),
          outcome: "not-required",
        },
      },
      2: {
        state: "fresh",
        latest: {
          actionKind: "reward-track",
          track: 2,
          observedBlock: block.toString(),
          observedAt: timestamp.toString(),
          outcome: "not-required",
        },
      },
      3: {
        state: "retryable",
        latest: {
          actionKind: "reward-track",
          track: 3,
          observedBlock: block.toString(),
          observedAt: timestamp.toString(),
          outcome: "failed-before-submission",
          failureClass: "quote-unavailable",
        },
      },
      4: {
        state: "fresh",
        latest: {
          actionKind: "reward-track",
          track: 4,
          observedBlock: block.toString(),
          observedAt: timestamp.toString(),
          outcome: "not-required",
        },
      },
    },
  },
};

const transport: ProtocolReadTransport = {
  getChainId: async () => manifest.chainId,
  getBlock: async () => ({ hash: "0x01", number: block, timestamp }),
  getBytecode: async () => "0x01",
  readMany: async <const Requests extends readonly ContractReadRequest[]>(
    requests: Requests,
  ): Promise<ContractReadResults<Requests>> =>
    requests.map((request) => {
      if (request.functionName === "trackQueue") {
        return {
          status: "success",
          value: request.args?.[0] === 3 ? 5n : 0n,
        };
      }
      if (
        request.contract === "epochConverter" &&
        request.functionName === "paused"
      ) {
        return { status: "success", value: false };
      }
      return { status: "failure", error: new Error("not needed by test") };
    }) as ContractReadResults<Requests>,
  permanentIdentityIds: async () => [],
  quoteExactInput: async () => [0n, 0n],
  canonicalMarketState: async () => ({
    sqrtPriceX96: 1n,
    tick: 0,
    protocolFee: 0,
    lpFee: 0,
    activeLiquidity: 1n,
  }),
  recentOperationalEvents: async () => {
    throw new Error("direct RPC operation scanning must not be used");
  },
  rewardHistory: async () => {
    throw new Error("direct RPC reward scanning must not be used");
  },
};

describe("Base Sepolia health indexed history", () => {
  it("classifies a non-empty queue from authenticated keeper-journal evidence", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        url: url.href,
      });
      const body = url.pathname.endsWith("/keeper-attempts")
        ? keeperAttemptResponse
        : pageResponse(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const reader = createBaseSepoliaHealthReader({
      fetcher,
      historyReadApiToken: historyToken,
      historyIndexUrl: historyOrigin,
      identity: selectedIdentityConfiguration,
      manifest,
      transport,
    });

    const snapshot = await reader.readHealth(undefined, Number(timestamp), 30);

    expect(snapshot.operations.trackQueues[2]).toMatchObject({
      trackId: 3,
      weth: 5n,
      status: "retryable",
      deferred: true,
      attemptHistoryAvailable: true,
    });
    expect(snapshot.operations.keeperAttemptEvidence.tracks[3]).toMatchObject({
      state: "retryable",
      outcome: "failed-before-submission",
      failureClass: "quote-unavailable",
    });
    expect(requests.map(({ url }) => url)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:9876\/v1\/protocol\/operations\?/u,
        ),
        `${historyOrigin}/v1/protocol/keeper-attempts`,
        expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:9876\/v1\/protocol\/rewards\?/u,
        ),
      ]),
    );
    expect(
      requests.every(
        ({ authorization }) => authorization === `Bearer ${historyToken}`,
      ),
    ).toBe(true);
  });
});
