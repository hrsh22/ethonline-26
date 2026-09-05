import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  encodeFunctionData,
  toFunctionSelector,
  type PublicClient,
} from "viem";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";

import { protocolAbis } from "../src/contracts.js";
import {
  makeViemProtocolTransport,
  publicQuoteCaller,
} from "../src/viem-transport.js";

const owner = "0x0000000000000000000000000000000000000001" as const;
const other = "0x0000000000000000000000000000000000000002" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
const identity = selectIdentityConfiguration("orbit-4444");
const hash = `0x${"1".padStart(64, "0")}` as const;

describe("bounded collectible ownership derivation", () => {
  it("derives permanent holdings from indexed candidates and current onchain state", async () => {
    const client = {
      getLogs: async () =>
        Promise.reject(new Error("wallet reads must not scan logs")),
      multicall: async ({
        contracts,
      }: {
        contracts: ReadonlyArray<{ readonly functionName: string }>;
      }) =>
        contracts.map((contract) => ({
          status: "success",
          result: contract.functionName === "ownerOf" ? owner : true,
        })),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.permanentIdentityIds(owner, [42], 120n),
    ).resolves.toEqual([42]);
  });

  it("chunks large read batches sequentially and preserves result ordering", async () => {
    const batchSizes: number[] = [];
    let nextResult = 0;
    const client = {
      multicall: async ({ contracts }: { contracts: readonly unknown[] }) => {
        batchSizes.push(contracts.length);
        return contracts.map(() => ({
          status: "success",
          result: BigInt(nextResult++),
        }));
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);
    const requests = Array.from({ length: 501 }, () => ({
      contract: "fuelCore" as const,
      functionName: "balanceOf" as const,
      args: [owner] as const,
    }));

    const results = await transport.readMany(requests, 10n);

    expect(batchSizes).toEqual([250, 250, 1]);
    expect(results).toHaveLength(501);
    expect(results[0]).toEqual({ status: "success", value: 0n });
    expect(results[500]).toEqual({ status: "success", value: 500n });
  });

  it("retries only failed multicall slots at the observed block", async () => {
    const calls: Array<{ size: number; blockNumber: bigint }> = [];
    let attempt = 0;
    const client = {
      multicall: async ({
        contracts,
        blockNumber,
      }: {
        contracts: readonly unknown[];
        blockNumber: bigint;
      }) => {
        calls.push({ size: contracts.length, blockNumber });
        attempt += 1;
        return attempt === 1
          ? [
              { status: "success", result: 10n },
              { status: "failure", error: new Error("transient RPC slot") },
              { status: "success", result: 30n },
            ]
          : [{ status: "success", result: 20n }];
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);
    const requests = Array.from({ length: 3 }, () => ({
      contract: "fuelCore" as const,
      functionName: "balanceOf" as const,
      args: [owner] as const,
    }));

    await expect(transport.readMany(requests, 10n)).resolves.toEqual([
      { status: "success", value: 10n },
      { status: "success", value: 20n },
      { status: "success", value: 30n },
    ]);
    expect(calls).toEqual([
      { size: 3, blockNumber: 10n },
      { size: 1, blockNumber: 10n },
    ]);
  });

  it("excludes candidates that the wallet does not currently own", async () => {
    const client = {
      multicall: async ({
        contracts,
      }: {
        contracts: ReadonlyArray<{ readonly functionName: string }>;
      }) =>
        contracts.map((contract, index) => ({
          status: "success",
          result:
            contract.functionName === "ownerOf"
              ? index === 0
                ? owner
                : other
              : true,
        })),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.permanentIdentityIds(owner, [42, 43], 120n),
    ).resolves.toEqual([42]);
  });

  it("fails closed when a permanent-membership multicall omits a result slot", async () => {
    const client = {
      multicall: async () => [],
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.permanentIdentityIds(owner, [42], 10n),
    ).rejects.toThrow("Multicall result missing");
  });
});

describe("canonical market quote simulation", () => {
  it("uses a nonzero public caller and permits construction-time or per-quote wallet overrides", async () => {
    const observedAccounts: string[] = [];
    const client = {
      simulateContract: async ({ account }: { account: string }) => {
        if (account === zero) throw new Error("InvalidSwapContext");
        observedAccounts.push(account);
        return { result: [97n, 3n] };
      },
    } as unknown as PublicClient;

    const publicTransport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
    );
    const walletTransport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      owner,
    );

    await expect(
      publicTransport.quoteExactInput(true, 100n, 10n),
    ).resolves.toEqual([97n, 3n]);
    await expect(
      publicTransport.quoteExactInput(true, 100n, 10n, owner),
    ).resolves.toEqual([97n, 3n]);
    await expect(
      walletTransport.quoteExactInput(true, 100n, 10n),
    ).resolves.toEqual([97n, 3n]);
    expect(observedAccounts).toEqual([publicQuoteCaller, owner, owner]);
    expect(publicQuoteCaller).not.toBe(zero);
  });
});

describe("Protocol-Owned Liquidity growth evidence", () => {
  it("retains exact Reward Epoch and stock-conversion amounts", async () => {
    const client = {
      getLogs: async ({ event }: { event: { name: string } }) => {
        if (event.name === "RewardEpochOpened") {
          return [
            {
              args: {
                epochNumber: 3n,
                openedAmount: 40n,
                equalTrackShare: 10n,
                finalTrackRemainder: 0n,
              },
              blockNumber: 10n,
              transactionIndex: 0,
              transactionHash: hash,
            },
          ];
        }
        if (event.name === "TrackExecuted") {
          return [
            {
              args: {
                track: 1n,
                wethInput: 10n,
                measuredStockOutput: 100n,
                deferredTrackBudget: 0n,
              },
              blockNumber: 11n,
              transactionIndex: 0,
              transactionHash: `0x${"2".padStart(64, "0")}`,
            },
          ];
        }
        return [];
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      undefined,
      { scanFailedTransactions: false },
    );

    const window = await transport.recentOperationalEvents(10n, 11n, 10);

    expect(window.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reward-epoch",
          rewardEpoch: {
            epochNumber: 3n,
            openedWeth: 40n,
            equalTrackShare: 10n,
            finalTrackRemainder: 0n,
          },
        }),
        expect.objectContaining({
          track: 1,
          trackConversion: {
            spentWeth: 10n,
            stockReceived: 100n,
            remainingQueue: 0n,
          },
        }),
      ]),
    );
  });

  it("retains exact cumulative WETH values from successful cycle logs", async () => {
    const client = {
      getLogs: async ({ event }: { event: { name: string } }) =>
        event.name === "ProtocolLiquidityAdded"
          ? [
              {
                args: {
                  cycleNumber: 3n,
                  pulledWeth: 8n,
                  consumedWeth: 7n,
                  queuedWeth: 1n,
                  permanentlyLockedWeth: 21n,
                },
                blockNumber: 10n,
                transactionIndex: 0,
                transactionHash: hash,
              },
            ]
          : [],
      getBlock: async () => ({ transactions: [] }),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    const window = await transport.recentOperationalEvents(10n, 10n, 10);

    expect(window.events).toContainEqual(
      expect.objectContaining({
        type: "pol-execution",
        liquidityGrowth: {
          cycleNumber: 3n,
          pulledWeth: 8n,
          consumedWeth: 7n,
          queuedWeth: 1n,
          permanentlyLockedWeth: 21n,
        },
      }),
    );
  });
});

describe("bounded failed-operation derivation", () => {
  it("can skip transaction-by-transaction failure scans for public dashboards", async () => {
    let blockReads = 0;
    const client = {
      getLogs: async () => [],
      getBlock: async () => {
        blockReads += 1;
        return { transactions: [] };
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      undefined,
      { scanFailedTransactions: false },
    );

    await expect(
      transport.recentOperationalEvents(10n, 510n, 10),
    ).resolves.toMatchObject({
      failureScanTruncated: true,
      claimScanTruncated: true,
      trackAttemptCoverage: {
        1: "partial",
        2: "partial",
        3: "partial",
        4: "partial",
      },
    });
    expect(blockReads).toBe(0);
  });

  it("ignores a reverted operator call from an unauthorized sender", async () => {
    const unauthorized = other;
    const client = {
      getLogs: async () => [],
      getBlock: async () => ({
        transactions: [
          {
            to: manifest.contracts.epochConverter,
            from: unauthorized,
            input: encodeFunctionData({
              abi: protocolAbis.epochConverter,
              functionName: "openRewardEpoch",
            }),
            hash,
            transactionIndex: 0,
          },
        ],
      }),
      getTransactionReceipt: async () => ({ status: "reverted" }),
      readContract: async () => manifest.roles.keeper,
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(10n, 10n, 10),
    ).resolves.toMatchObject({ events: [] });
  });

  it("skips an invalid failed claim without aborting the operation scan", async () => {
    const invalidClaimInput = encodeFunctionData({
      abi: protocolAbis.rewardLedger,
      functionName: "claim",
      args: [[4_444]],
    });
    const client = {
      getLogs: async () => [],
      getBlock: async () => ({
        transactions: [
          {
            to: manifest.contracts.rewardLedger,
            from: owner,
            input: invalidClaimInput,
            hash,
            transactionIndex: 0,
          },
        ],
      }),
      getTransactionReceipt: async () => ({ status: "reverted" }),
      multicall: async () => [
        { status: "failure", error: new Error("ERC721 nonexistent token") },
      ],
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(10n, 10n, 10),
    ).resolves.toMatchObject({ events: [] });
  });

  it("skips malformed failed-claim calldata without aborting the scan", async () => {
    const validClaimInput = encodeFunctionData({
      abi: protocolAbis.rewardLedger,
      functionName: "claim",
      args: [[42]],
    });
    const client = {
      getLogs: async () => [],
      getBlock: async () => ({
        transactions: [
          {
            to: manifest.contracts.rewardLedger,
            from: owner,
            input: validClaimInput.slice(0, 10),
            hash,
            transactionIndex: 0,
          },
        ],
      }),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(10n, 10n, 10),
    ).resolves.toMatchObject({ events: [] });
  });

  it("does not make a failed claim ambiguous for an unrelated same-block transfer", async () => {
    const claimInput = encodeFunctionData({
      abi: protocolAbis.rewardLedger,
      functionName: "claim",
      args: [[42]],
    });
    const unrelatedTransferInput = encodeFunctionData({
      abi: protocolAbis.fuelMirror,
      functionName: "safeTransferFrom",
      args: [owner, other, 43n],
    });
    const client = {
      getLogs: async () => [],
      getBlock: async () => ({
        transactions: [
          {
            to: manifest.contracts.fuelMirror,
            from: owner,
            input: unrelatedTransferInput,
            hash: `0x${"5".padStart(64, "0")}`,
            transactionIndex: 0,
          },
          {
            to: manifest.contracts.rewardLedger,
            from: owner,
            input: claimInput,
            hash,
            transactionIndex: 1,
          },
        ],
      }),
      multicall: async ({ contracts }: { contracts: readonly unknown[] }) =>
        contracts.map(() => ({ status: "success", result: owner })),
      getTransactionReceipt: async () => ({ status: "reverted" }),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(10n, 10n, 10),
    ).resolves.toMatchObject({
      events: [expect.objectContaining({ type: "claim", successful: false })],
      claimScanTruncated: false,
    });
  });

  it("bounds total failed-claim ownership reads and surfaces truncation", async () => {
    const claimInput = encodeFunctionData({
      abi: protocolAbis.rewardLedger,
      functionName: "claim",
      args: [Array.from({ length: 100 }, (_, index) => index + 1)],
    });
    let multicalls = 0;
    let includeClaims = true;
    const client = {
      getLogs: async () => [],
      getBlock: async () => ({
        transactions: includeClaims
          ? Array.from({ length: 21 }, (_, index) => ({
              to: manifest.contracts.rewardLedger,
              from: owner,
              input: claimInput,
              hash: `0x${String(index + 1).padStart(64, "0")}`,
              transactionIndex: index,
            }))
          : [],
      }),
      multicall: async ({ contracts }: { contracts: readonly unknown[] }) => {
        multicalls += 1;
        return contracts.map(() => ({ status: "success", result: owner }));
      },
      getTransactionReceipt: async () => ({ status: "reverted" }),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(10n, 10n, 10),
    ).resolves.toMatchObject({
      failureScanTruncated: false,
      claimScanTruncated: true,
    });
    expect(multicalls).toBe(20);

    includeClaims = false;
    await expect(
      transport.recentOperationalEvents(10n, 11n, 10),
    ).resolves.toMatchObject({ claimScanTruncated: true });
  });

  it("reports partial track-attempt coverage when the failed-call window is truncated", async () => {
    const client = {
      getLogs: async () => [],
      getBlock: async () => ({ transactions: [] }),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(
        BigInt(manifest.launch.blockNumber),
        BigInt(manifest.launch.blockNumber) + 500n,
        10,
      ),
    ).resolves.toMatchObject({
      events: [],
      trackAttemptCoverage: {
        1: "partial",
        2: "partial",
        3: "partial",
        4: "partial",
      },
    });
  });

  it("chunks event logs and advances a reorg-aware failed-call cursor", async () => {
    let blockReads = 0;
    const logRanges: Array<readonly [bigint, bigint]> = [];
    const client = {
      getLogs: async ({
        fromBlock,
        toBlock,
      }: {
        fromBlock: bigint;
        toBlock: bigint;
      }) => {
        logRanges.push([fromBlock, toBlock]);
        if (toBlock - fromBlock + 1n > 10_000n) {
          throw new Error("provider log range exceeds 10,000 blocks");
        }
        return [];
      },
      getBlock: async () => {
        blockReads += 1;
        return { transactions: [] };
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await transport.recentOperationalEvents(1n, 20_001n, 10);
    const initialBlockReads = blockReads;
    await transport.recentOperationalEvents(2n, 20_002n, 10);

    expect(initialBlockReads).toBe(500);
    expect(blockReads - initialBlockReads).toBeLessThanOrEqual(13);
    expect(logRanges.every(([from, to]) => to - from < 10_000n)).toBe(true);
  });

  it("keeps complete reward history with provider-sized chunks and a reorg overlap", async () => {
    const launch = BigInt(manifest.launch.blockNumber);
    const tip = launch + 75_000n;
    const epochBlock = launch + 10n;
    const conversionBlock = launch + 20n;
    const claimBlock = launch + 30n;
    const claimHash = `0x${"9".padStart(64, "0")}` as const;
    const logRanges: Array<readonly [bigint, bigint]> = [];
    const inRange = (block: bigint, from: bigint, to: bigint) =>
      block >= from && block <= to;
    const client = {
      getLogs: async ({
        event,
        fromBlock,
        toBlock,
      }: {
        event: { name?: string };
        fromBlock: bigint;
        toBlock: bigint;
      }) => {
        logRanges.push([fromBlock, toBlock]);
        if (
          event.name === "RewardEpochOpened" &&
          inRange(epochBlock, fromBlock, toBlock)
        ) {
          return [
            {
              args: {
                epochNumber: 1n,
                openedAmount: 40n,
                equalTrackShare: 10n,
                finalTrackRemainder: 0n,
              },
              blockNumber: epochBlock,
              logIndex: 0,
              transactionHash: hash,
              transactionIndex: 0,
            },
          ];
        }
        if (
          event.name === "TrackExecuted" &&
          inRange(conversionBlock, fromBlock, toBlock)
        ) {
          return [
            {
              args: {
                track: 1,
                wethInput: 10n,
                measuredStockOutput: 100n,
                deferredTrackBudget: 0n,
              },
              blockNumber: conversionBlock,
              logIndex: 0,
              transactionHash: `0x${"8".padStart(64, "0")}`,
              transactionIndex: 0,
            },
          ];
        }
        if (
          event.name === "RewardClaimed" &&
          inRange(claimBlock, fromBlock, toBlock)
        ) {
          return [2n, 3n].map((logIndex) => ({
            args: {
              currentOwner: owner,
              identityId: 300n + logIndex,
              track: 1,
              amount: 25n,
            },
            blockNumber: claimBlock,
            logIndex: Number(logIndex),
            transactionHash: claimHash,
            transactionIndex: 0,
          }));
        }
        return [];
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      undefined,
      {
        scanFailedTransactions: false,
      },
    );

    await expect(transport.rewardHistory(launch, tip)).resolves.toMatchObject({
      events: [
        expect.objectContaining({ type: "reward-epoch" }),
        expect.objectContaining({ type: "track-conversion", track: 1 }),
        expect.objectContaining({
          type: "reward-claim",
          claim: expect.objectContaining({ amount: 25n }),
        }),
        expect.objectContaining({
          type: "reward-claim",
          claim: expect.objectContaining({ amount: 25n }),
        }),
      ],
      fromBlock: launch,
      throughBlock: tip,
    });
    expect(logRanges.every(([from, to]) => to - from < 10_000n)).toBe(true);
    expect(logRanges).toContainEqual([launch, launch + 9_999n]);

    logRanges.length = 0;
    await transport.rewardHistory(launch, tip + 1n);
    expect(logRanges).toEqual(
      Array.from({ length: 3 }, () => [tip - 11n, tip + 1n]),
    );
  });

  it("shares a bounded RPC log-read budget across concurrent history scans", async () => {
    const launch = BigInt(manifest.launch.blockNumber);
    let activeReads = 0;
    let maximumReads = 0;
    const client = {
      getLogs: async () => {
        activeReads += 1;
        maximumReads = Math.max(maximumReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeReads -= 1;
        return [];
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      undefined,
      { scanFailedTransactions: false },
    );

    await Promise.all([
      transport.recentOperationalEvents(launch, launch + 20_000n, 10),
      transport.rewardHistory(launch, launch + 20_000n),
    ]);

    expect(maximumReads).toBeLessThanOrEqual(4);
  });

  it("carries retry state across a rolling presentation window", async () => {
    const launch = BigInt(manifest.launch.blockNumber);
    const failedBlock = launch + 1n;
    const firstTip = launch + 20n;
    const retryBlock = firstTip + 1n;
    const failedHash = `0x${"2".padStart(64, "0")}` as const;
    const retryHash = `0x${"3".padStart(64, "0")}` as const;
    const executeInput = encodeFunctionData({
      abi: protocolAbis.epochConverter,
      functionName: "executeTrack",
      args: [1, 1n, 9_999n],
    });
    let phase = 1;
    const client = {
      getLogs: async ({
        event,
        fromBlock,
        toBlock,
      }: {
        event: { name?: string };
        fromBlock: bigint;
        toBlock: bigint;
      }) =>
        phase === 2 &&
        event.name === "TrackExecuted" &&
        retryBlock >= fromBlock &&
        retryBlock <= toBlock
          ? [
              {
                args: { track: 1n },
                blockNumber: retryBlock,
                transactionIndex: 0,
                transactionHash: retryHash,
              },
            ]
          : [],
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        transactions:
          phase === 1 && blockNumber === failedBlock
            ? [
                {
                  to: manifest.contracts.epochConverter,
                  from: manifest.roles.keeper,
                  input: executeInput,
                  hash: failedHash,
                  transactionIndex: 0,
                },
              ]
            : [],
      }),
      readContract: async () => manifest.roles.keeper,
      getTransactionReceipt: async () => ({ status: "reverted" }),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(launch, firstTip, 0),
    ).resolves.toMatchObject({
      events: [],
      trackAttemptState: { 1: "retryable" },
    });

    phase = 2;
    await expect(
      transport.recentOperationalEvents(launch + 2n, retryBlock, 10),
    ).resolves.toMatchObject({
      events: [expect.objectContaining({ type: "retry", successful: true })],
      trackAttemptState: { 1: "fresh" },
    });

    await expect(
      transport.recentOperationalEvents(retryBlock + 1n, retryBlock + 600n, 10),
    ).resolves.toMatchObject({
      events: [],
      trackAttemptState: { 1: "unknown" },
      trackAttemptCoverage: { 1: "partial" },
    });
  });

  it("marks a same-block role change as partial instead of guessing authorization", async () => {
    const blockNumber = BigInt(manifest.launch.blockNumber) + 1n;
    const input = encodeFunctionData({
      abi: protocolAbis.epochConverter,
      functionName: "executeTrack",
      args: [1, 1n, 9_999n],
    });
    const client = {
      getLogs: async () => [],
      getBlock: async ({
        blockNumber: requested,
      }: {
        blockNumber: bigint;
      }) => ({
        transactions:
          requested === blockNumber
            ? [
                {
                  to: manifest.contracts.epochConverter,
                  from: manifest.roles.owner,
                  input: toFunctionSelector("setKeeper(address)"),
                  hash: `0x${"4".padStart(64, "0")}`,
                  transactionIndex: 0,
                },
                {
                  to: manifest.contracts.epochConverter,
                  from: manifest.roles.keeper,
                  input,
                  hash,
                  transactionIndex: 1,
                },
              ]
            : [],
      }),
      readContract: async () => manifest.roles.keeper,
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.recentOperationalEvents(blockNumber, blockNumber, 10),
    ).resolves.toMatchObject({
      events: [],
      failureScanTruncated: true,
      trackAttemptCoverage: { 1: "partial" },
    });
  });

  it("rejects a transport identity that does not match its manifest", () => {
    expect(() =>
      makeViemProtocolTransport(
        {} as PublicClient,
        manifest,
        selectIdentityConfiguration("neutral-test"),
      ),
    ).toThrow("does not match deployment");
  });
});
