import { readFileSync } from "node:fs";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import { createViemOperatorChain } from "./base-sepolia-operator.ts";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("deployments/84532.json", "utf8")) as unknown,
);
const contracts = createProtocolContracts(manifest);
const keeper = "0x0000000000000000000000000000000000000001" as Address;
const liquidityExecutor =
  "0x0000000000000000000000000000000000000002" as Address;
const timestampBase = 1_800_000_000n;
const blockHash = (byte: string): Hex => `0x${byte.repeat(64)}` as Hex;

interface ScriptedBlockObservation {
  readonly head: {
    readonly number: bigint;
    readonly hash: Hex;
    readonly timestamp: bigint;
  };
  readonly canonical?: {
    readonly number: bigint;
    readonly hash: Hex;
    readonly timestamp: bigint;
  };
  readonly readFailure?: string;
  readonly headFailure?: string;
  readonly canonicalFailure?: string;
  readonly headOverride?: unknown;
}

const observation = (
  number: bigint,
  headHash: Hex = blockHash("a"),
  canonicalHash: Hex = headHash,
): ScriptedBlockObservation => ({
  head: { number, hash: headHash, timestamp: timestampBase + number },
  canonical: {
    number,
    hash: canonicalHash,
    timestamp: timestampBase + number,
  },
});

interface ExternalContractRead {
  readonly args?: readonly unknown[];
  readonly blockNumber?: bigint;
  readonly functionName: string;
}

const externalViemHarness = (
  observations: readonly ScriptedBlockObservation[],
) => {
  let observationCount = 0;
  let activeObservation: ScriptedBlockObservation | undefined;
  const readBlocks: Array<bigint | undefined> = [];
  const values = new Map<string, unknown>([
    ["keeper", keeper],
    ["executor", liquidityExecutor],
    ["configurationSealed", true],
    ["paused", false],
    ["rewardEpochCount", 7n],
    ["lastRewardEpochAt", 1_700n],
    ["rewardPot", 500n],
    ["liquidityPot", 600n],
    ["queuedWeth", 700n],
  ]);
  const clients = {
    publicClient: {
      getBlock: async (request: { readonly blockNumber?: bigint } = {}) => {
        if (request.blockNumber !== undefined) {
          if (activeObservation === undefined) {
            throw new Error("Unexpected canonicality check");
          }
          expect(request.blockNumber).toBe(activeObservation.head.number);
          if (activeObservation.canonicalFailure !== undefined) {
            throw new Error(activeObservation.canonicalFailure);
          }
          return activeObservation.canonical ?? activeObservation.head;
        }
        const next = observations[observationCount];
        if (next === undefined) throw new Error("Unexpected observation");
        observationCount += 1;
        activeObservation = next;
        if (next.headFailure !== undefined) throw new Error(next.headFailure);
        return next.headOverride ?? next.head;
      },
      readContract: async (request: ExternalContractRead) => {
        readBlocks.push(request.blockNumber);
        if (activeObservation?.readFailure === request.functionName) {
          throw new Error(
            `Scripted partial read failure: ${request.functionName}`,
          );
        }
        if (request.functionName === "extsload") return 123n << 160n;
        if (request.functionName === "trackQueue") {
          return BigInt(request.args?.[0] as number) * 10n;
        }
        if (request.functionName === "trackConfiguration") {
          const track = request.args?.[0] as 1 | 2 | 3 | 4;
          const routes = {
            1: [
              contracts.mockAaplc.address,
              contracts.aaplcConversionAdapter.address,
            ],
            2: [
              contracts.mockGooglc.address,
              contracts.googlcConversionAdapter.address,
            ],
            3: [
              contracts.mockMetac.address,
              contracts.metacConversionAdapter.address,
            ],
            4: [
              contracts.mockNvdac.address,
              contracts.nvdacConversionAdapter.address,
            ],
          } as const;
          return routes[track];
        }
        const value = values.get(request.functionName);
        if (value === undefined) {
          throw new Error(`Unexpected read ${request.functionName}`);
        }
        return value;
      },
    },
    roles: {
      keeper: { account: undefined, walletClient: undefined },
      "liquidity-executor": { account: undefined, walletClient: undefined },
    },
  } as unknown as Parameters<typeof createViemOperatorChain>[0]["clients"];

  return {
    chain: createViemOperatorChain({ clients, contracts, manifest }),
    observationCount: () => observationCount,
    readBlocks,
  };
};

const pinnedReads = (blocks: readonly bigint[]) =>
  blocks.flatMap((block) => Array.from({ length: 20 }, () => block));

describe("Base Sepolia operator production chain adapter", () => {
  it("retries whole lagging snapshots until the receipt block floor is reached", async () => {
    const harness = externalViemHarness([
      observation(203n),
      observation(204n),
      observation(205n),
    ]);

    const state = await harness.chain.observe({ minimumBlock: 205n });

    expect({
      observedBlock: state.block.number,
      observationCount: harness.observationCount(),
      readBlocks: harness.readBlocks,
    }).toEqual({
      observedBlock: 205n,
      observationCount: 3,
      readBlocks: pinnedReads([203n, 204n, 205n]),
    });
  });

  it("rejects boundedly when every snapshot remains below the receipt block floor", async () => {
    const harness = externalViemHarness([
      observation(203n),
      observation(204n),
      observation(204n),
    ]);

    await expect(harness.chain.observe({ minimumBlock: 205n })).rejects.toThrow(
      "Operator RPC remained behind confirmed block 205",
    );
    expect({
      observationCount: harness.observationCount(),
      readBlocks: harness.readBlocks,
    }).toEqual({
      observationCount: 3,
      readBlocks: pinnedReads([203n, 204n, 204n]),
    });
  });

  it("discards a same-height reorg and repeats every planning read", async () => {
    const beforeReorg = blockHash("a");
    const afterReorg = blockHash("b");
    const harness = externalViemHarness([
      observation(300n, beforeReorg, afterReorg),
      observation(300n, afterReorg),
    ]);

    const state = await harness.chain.observe();

    expect(state.block).toEqual({
      number: 300n,
      hash: afterReorg,
      timestamp: timestampBase + 300n,
    });
    expect(harness.observationCount()).toBe(2);
    expect(harness.readBlocks).toEqual(pinnedReads([300n, 300n]));
  });

  it("discards a partial batch and retries every constituent read", async () => {
    const failed = {
      ...observation(310n),
      readFailure: "rewardPot",
    } satisfies ScriptedBlockObservation;
    const harness = externalViemHarness([failed, observation(311n)]);

    const state = await harness.chain.observe();

    expect(state.block.number).toBe(311n);
    expect(harness.observationCount()).toBe(2);
    expect(harness.readBlocks).toEqual(pinnedReads([310n, 311n]));
  });

  it("retries unavailable and malformed candidate headers before reading", async () => {
    const unavailable = {
      ...observation(320n),
      headFailure: "header not found",
    } satisfies ScriptedBlockObservation;
    const malformed = {
      ...observation(321n),
      headOverride: {
        number: 321n,
        hash: "0x1234",
        timestamp: timestampBase + 321n,
      },
    } satisfies ScriptedBlockObservation;
    const harness = externalViemHarness([
      unavailable,
      malformed,
      observation(322n),
    ]);

    const state = await harness.chain.observe();

    expect(state.block.number).toBe(322n);
    expect(harness.readBlocks).toEqual(pinnedReads([322n]));
  });

  it.each([
    ["number", { number: "350", hash: blockHash("c"), timestamp: 350n }],
    ["hash", { number: 350n, hash: "0x1234", timestamp: 350n }],
    ["timestamp", { number: 350n, hash: blockHash("c"), timestamp: -1n }],
  ] as const)(
    "discards a header with a malformed %s",
    async (_field, header) => {
      const malformed = {
        ...observation(350n),
        headOverride: header,
      } satisfies ScriptedBlockObservation;
      const harness = externalViemHarness([malformed, observation(351n)]);

      const state = await harness.chain.observe();

      expect(state.block.number).toBe(351n);
      expect(harness.readBlocks).toEqual(pinnedReads([351n]));
    },
  );

  it("retries when the post-batch canonical header is unavailable", async () => {
    const unavailable = {
      ...observation(330n),
      canonicalFailure: "canonical header unavailable",
    } satisfies ScriptedBlockObservation;
    const harness = externalViemHarness([unavailable, observation(331n)]);

    const state = await harness.chain.observe();

    expect(state.block.number).toBe(331n);
    expect(harness.readBlocks).toEqual(pinnedReads([330n, 331n]));
  });

  it("fails closed after exhausting whole-snapshot retries", async () => {
    const failed = (number: bigint): ScriptedBlockObservation => ({
      ...observation(number),
      readFailure: "queuedWeth",
    });
    const harness = externalViemHarness([
      failed(340n),
      failed(341n),
      failed(342n),
    ]);

    await expect(harness.chain.observe()).rejects.toThrow(
      "Operator canonical snapshot failed after 3 attempts",
    );
    expect(harness.readBlocks).toEqual(pinnedReads([340n, 341n, 342n]));
  });
});
