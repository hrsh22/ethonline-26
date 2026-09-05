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
const observedHash = `0x${"ab".repeat(32)}` as Hex;

describe("Base Sepolia operator state snapshots", () => {
  it("pins every contract read to the fetched observation block", async () => {
    const observedBlock = 123_456n;
    const observedAt = 1_800_000_000n;
    const blockRequests: Array<bigint | undefined> = [];
    const reads: Array<{
      readonly address: Address;
      readonly functionName: string;
      readonly args?: readonly unknown[];
      readonly blockNumber?: bigint;
    }> = [];
    const readKey = (
      request: Pick<
        (typeof reads)[number],
        "address" | "functionName" | "args"
      >,
    ) =>
      `${request.address}:${request.functionName}:${request.args?.map(String).join(",") ?? ""}`;
    const values = new Map<string, unknown>([
      [
        readKey({
          address: contracts.epochConverter.address,
          functionName: "keeper",
        }),
        keeper,
      ],
      [
        readKey({
          address: contracts.epochConverter.address,
          functionName: "configurationSealed",
        }),
        true,
      ],
      [
        readKey({
          address: contracts.epochConverter.address,
          functionName: "paused",
        }),
        false,
      ],
      [
        readKey({
          address: contracts.epochConverter.address,
          functionName: "rewardEpochCount",
        }),
        7n,
      ],
      [
        readKey({
          address: contracts.epochConverter.address,
          functionName: "lastRewardEpochAt",
        }),
        1_700n,
      ],
      ...([1, 2, 3, 4] as const).map(
        (track) =>
          [
            readKey({
              address: contracts.epochConverter.address,
              functionName: "trackQueue",
              args: [track],
            }),
            BigInt(track) * 10n,
          ] satisfies readonly [string, unknown],
      ),
      ...(
        [
          [
            1,
            contracts.mockAaplc.address,
            contracts.aaplcConversionAdapter.address,
          ],
          [
            2,
            contracts.mockGooglc.address,
            contracts.googlcConversionAdapter.address,
          ],
          [
            3,
            contracts.mockMetac.address,
            contracts.metacConversionAdapter.address,
          ],
          [
            4,
            contracts.mockNvdac.address,
            contracts.nvdacConversionAdapter.address,
          ],
        ] as const
      ).map(
        ([track, stockToken, adapter]) =>
          [
            readKey({
              address: contracts.epochConverter.address,
              functionName: "trackConfiguration",
              args: [track],
            }),
            [stockToken, adapter],
          ] satisfies readonly [string, unknown],
      ),
      [
        readKey({
          address: contracts.canonicalFeeHook.address,
          functionName: "rewardPot",
        }),
        500n,
      ],
      [
        readKey({
          address: contracts.canonicalFeeHook.address,
          functionName: "liquidityPot",
        }),
        600n,
      ],
      [
        readKey({
          address: contracts.protocolLiquidityVault.address,
          functionName: "executor",
        }),
        liquidityExecutor,
      ],
      [
        readKey({
          address: contracts.protocolLiquidityVault.address,
          functionName: "configurationSealed",
        }),
        true,
      ],
      [
        readKey({
          address: contracts.protocolLiquidityVault.address,
          functionName: "paused",
        }),
        false,
      ],
      [
        readKey({
          address: contracts.protocolLiquidityVault.address,
          functionName: "queuedWeth",
        }),
        700n,
      ],
    ]);
    const clients = {
      publicClient: {
        getBlock: async (request: { readonly blockNumber?: bigint } = {}) => {
          blockRequests.push(request.blockNumber);
          return {
            number: observedBlock,
            hash: observedHash,
            timestamp: observedAt,
          };
        },
        readContract: async (request: (typeof reads)[number]) => {
          reads.push(request);
          const key = readKey(request);
          if (request.functionName === "extsload") {
            return 123n << 160n;
          }
          if (!values.has(key)) throw new Error(`Unexpected read ${key}`);
          return values.get(key);
        },
      },
      roles: {
        keeper: { account: undefined, walletClient: undefined },
        "liquidity-executor": {
          account: undefined,
          walletClient: undefined,
        },
      },
    } as unknown as Parameters<typeof createViemOperatorChain>[0]["clients"];
    const chain = createViemOperatorChain({ clients, contracts, manifest });

    await expect(chain.observe()).resolves.toEqual({
      block: {
        number: observedBlock,
        hash: observedHash,
        timestamp: observedAt,
      },
      keeper,
      liquidityExecutor,
      converterConfigurationSealed: true,
      converterPaused: false,
      rewardEpochCount: 7n,
      lastRewardEpochAt: 1_700n,
      rewardPotWeth: 500n,
      trackQueues: { 1: 10n, 2: 20n, 3: 30n, 4: 40n },
      trackConfigurations: {
        1: {
          stockToken: contracts.mockAaplc.address,
          adapter: contracts.aaplcConversionAdapter.address,
        },
        2: {
          stockToken: contracts.mockGooglc.address,
          adapter: contracts.googlcConversionAdapter.address,
        },
        3: {
          stockToken: contracts.mockMetac.address,
          adapter: contracts.metacConversionAdapter.address,
        },
        4: {
          stockToken: contracts.mockNvdac.address,
          adapter: contracts.nvdacConversionAdapter.address,
        },
      },
      liquidityConfigurationSealed: true,
      liquidityPaused: false,
      liquidityPotWeth: 600n,
      queuedLiquidityWeth: 700n,
      currentTick: 123,
    });
    expect(reads).toHaveLength(20);
    expect(reads.map(({ blockNumber }) => blockNumber)).toEqual(
      Array.from({ length: 20 }, () => observedBlock),
    );
    expect(blockRequests).toEqual([undefined, observedBlock]);
  });
});
