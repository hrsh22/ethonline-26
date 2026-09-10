import { Buffer } from "node:buffer";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  decodeProtocolDeploymentManifest,
  type ProtocolDeploymentManifestV3,
} from "@orbit/config/deployment-manifest";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  deriveHistoryIndexConfiguration,
  type HistoryIndexConfiguration,
  validateHistoryIndexConfiguration,
} from "./history-indexer/configuration.ts";
import { createHistoryAvailability } from "./history-indexer/availability.ts";
import {
  DeepReorgError,
  HistoryCanonicalityError,
  HistoryRpcError,
} from "./history-indexer/errors.ts";
import {
  createHistoryChainSource,
  historyEventDefinitions,
  type HistoryPublicClient,
} from "./history-indexer/rpc-source.ts";
import { acquireHistoryHttpServer } from "./history-indexer/http-server.ts";
import type {
  CanonicalHeader,
  IndexedHistoryEvent,
} from "./history-indexer/model.ts";
import {
  openHistoryStore,
  type HistoryStore,
} from "./history-indexer/sqlite-store.ts";
import {
  synchronizeHistory,
  type HistoryChainSource,
} from "./history-indexer/synchronize.ts";
import { selectInitialSynchronization } from "./history-indexer.ts";
import { createViemHistoryPublicClient } from "./history-indexer/viem-client.ts";

const fixtureManifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("deployments/31337.json", "utf8")) as unknown,
);
const requireCcaManifest = (
  manifest: ReturnType<typeof decodeProtocolDeploymentManifest>,
): ProtocolDeploymentManifestV3 => {
  if (manifest.schemaVersion !== 3)
    throw new TypeError("Expected CCA manifest");
  return manifest;
};
const ccaFixtureContracts: Record<string, string> = {
  ...fixtureManifest.contracts,
};
delete ccaFixtureContracts.genesisLiquidityVault;
const ccaFixtureManifest = requireCcaManifest(
  decodeProtocolDeploymentManifest({
    ...fixtureManifest,
    schemaVersion: 3,
    phase: "cca",
    contracts: {
      ...ccaFixtureContracts,
      ccaBidEscrowFactory: "0x000000000000000000000000000000000000a001",
      ccaBidValidationHook: "0x000000000000000000000000000000000000a002",
      ccaCanonicalLaunchReadiness: "0x000000000000000000000000000000000000a003",
      ccaLaunchCoordinator: "0x000000000000000000000000000000000000a004",
      ccaRecoverySeeder: "0x000000000000000000000000000000000000a005",
      ccaStrategy: "0x000000000000000000000000000000000000a006",
      continuousClearingAuction: "0x000000000000000000000000000000000000a007",
      continuousClearingAuctionFactory:
        "0x000000000000000000000000000000000000a008",
      permanentPositionRecipient: "0x000000000000000000000000000000000000a009",
      permit2: "0x000000000000000000000000000000000000a00a",
      uniswapV4PositionManager: "0x000000000000000000000000000000000000a00b",
      ccaCreate2Deployer: "0x000000000000000000000000000000000000a00c",
      ccaLaunchFunding: "0x000000000000000000000000000000000000a00d",
      liquidityLauncher: "0x000000000000000000000000000000000000a00e",
    },
    canonicalPool: {
      ...fixtureManifest.canonicalPool,
      seedSqrtPriceX96: "0",
      activeLiquidity: "0",
    },
    cca: {
      provenance: {
        continuousClearingAuction: {
          commit: "a56d42231e7bf048136d9d88fa61e8518c10c5ff",
          version: "v2.1.0",
        },
        liquidityLauncher: {
          commit: "873cbb23c5019a795193c5ad561edff2f78ba5a3",
          version: "v3.0.0",
        },
        lbpStrategy: {
          commit: "873cbb23c5019a795193c5ad561edff2f78ba5a3",
          version: "v3.1.0",
        },
      },
      economics: {
        totalFuelSupply: "4444000000000000000000",
        auctionSupply: "3000000000000000000000",
        liquidityReserve: "1444000000000000000000",
        minimumRaise: "1000000000000000000",
        floorPriceQ96: "9903520314283042199192993792",
        tickSpacingQ96: "618970019642690137449562112",
      },
      lifecycle: {
        startBlock: "100",
        endBlock: "110",
        claimBlock: "111",
        migrationBlock: "111",
      },
    },
  }),
);
const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const HISTORY_READ_API_TOKEN = historyCredentialFixture("read-v1");
const HISTORY_INGEST_API_TOKEN = historyCredentialFixture("ingest-v1");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-history-"));
  temporaryDirectories.push(directory);
  return join(directory, "history.sqlite");
};

const hash = (blockNumber: bigint, branch = "a"): `0x${string}` =>
  `0x${branch.charCodeAt(0).toString(16).padStart(2, "0")}${blockNumber
    .toString(16)
    .padStart(62, "0")}`;

const header = (blockNumber: bigint, branch = "a"): CanonicalHeader => ({
  blockNumber,
  blockHash: hash(blockNumber, branch),
  parentHash:
    blockNumber === 0n ? hash(0n, branch) : hash(blockNumber - 1n, branch),
  blockTimestamp: 1_700_000_000n + blockNumber,
});

const event = ({
  blockNumber,
  eventName = "reward-epoch-opened",
  logIndex = 0,
  removed = false,
  branch = "a",
}: {
  readonly blockNumber: bigint;
  readonly eventName?: IndexedHistoryEvent["eventName"];
  readonly logIndex?: number;
  readonly removed?: boolean;
  readonly branch?: string;
}): IndexedHistoryEvent => ({
  ...header(blockNumber, branch),
  transactionHash: hash(blockNumber * 100n + BigInt(logIndex), branch),
  transactionIndex: 0,
  logIndex,
  sourceAddress: fixtureManifest.contracts.epochConverter! as `0x${string}`,
  eventName,
  payload: { epochNumber: blockNumber.toString() },
  removed,
});

const configuration = (
  overrides: Partial<HistoryIndexConfiguration> = {},
): HistoryIndexConfiguration => ({
  ...deriveHistoryIndexConfiguration(fixtureManifest),
  batchBlocks: 4n,
  confirmationBlocks: 0n,
  overlapBlocks: 3n,
  retryBaseDelayMilliseconds: 1,
  retryMaximumAttempts: 3,
  ...overrides,
});

class FakeChainSource implements HistoryChainSource {
  readonly branches = new Map<bigint, string>();
  readonly events: IndexedHistoryEvent[] = [];
  readonly attempts: Array<readonly [bigint, bigint]> = [];
  headBlock = 20n;
  maximumRange = 1_000n;
  retryFailures = 0;
  onGetEvents: ((fromBlock: bigint, toBlock: bigint) => void) | undefined;
  onGetHeader: ((blockNumber: bigint) => void) | undefined;

  constructor(readonly chainId: number) {}

  branchAt(blockNumber: bigint): string {
    return this.branches.get(blockNumber) ?? "a";
  }

  canonicalHeader(blockNumber: bigint): CanonicalHeader {
    const current = this.branchAt(blockNumber);
    const parent =
      blockNumber === 0n ? current : this.branchAt(blockNumber - 1n);
    return {
      ...header(blockNumber, current),
      parentHash:
        blockNumber === 0n ? hash(0n, current) : hash(blockNumber - 1n, parent),
    };
  }

  getChainId = Effect.sync(() => this.chainId);

  getHead = Effect.sync(() => this.canonicalHeader(this.headBlock));

  getHeader = (blockNumber: bigint) =>
    Effect.sync(() => {
      this.onGetHeader?.(blockNumber);
      return this.canonicalHeader(blockNumber);
    });

  getEvents = (fromBlock: bigint, toBlock: bigint) =>
    Effect.suspend(() => {
      this.attempts.push([fromBlock, toBlock]);
      this.onGetEvents?.(fromBlock, toBlock);
      if (this.retryFailures > 0) {
        this.retryFailures -= 1;
        return Effect.fail(
          new HistoryRpcError({
            message: "provider throttled",
            retryable: true,
            rangeTooLarge: false,
            cause: { status: 429 },
          }),
        );
      }
      if (toBlock - fromBlock + 1n > this.maximumRange) {
        return Effect.fail(
          new HistoryRpcError({
            message: "range is too large",
            retryable: false,
            rangeTooLarge: true,
            cause: { fromBlock, toBlock },
          }),
        );
      }
      return Effect.succeed(
        this.events
          .filter(
            (item) =>
              item.blockNumber >= fromBlock && item.blockNumber <= toBlock,
          )
          .map((item) => {
            const branch = this.branchAt(item.blockNumber);
            return branch === "a"
              ? item
              : {
                  ...item,
                  ...this.canonicalHeader(item.blockNumber),
                  transactionHash: hash(
                    item.blockNumber * 100n + BigInt(item.logIndex),
                    branch,
                  ),
                };
          }),
      );
    });
}

const runSync = (
  store: HistoryStore,
  source: HistoryChainSource,
  config = configuration(),
) =>
  Effect.runPromise(
    synchronizeHistory({ configuration: config, source, store }),
  );

describe("history index configuration", () => {
  it("keeps one-shot backfill on the finite synchronization path", async () => {
    let finiteRuns = 0;
    let workerRuns = 0;
    const result = await Effect.runPromise(
      selectInitialSynchronization(
        true,
        Effect.sync(() => {
          finiteRuns += 1;
          return "finite" as const;
        }),
        Effect.sync(() => {
          workerRuns += 1;
          return "worker" as const;
        }),
      ),
    );

    expect(result).toBe("finite");
    expect(finiteRuns).toBe(1);
    expect(workerRuns).toBe(0);
  });

  it.each([2n, 3n])(
    "rejects synchronization batch %s when the reorg overlap is 3",
    (batchBlocks) => {
      expect(() =>
        validateHistoryIndexConfiguration(
          configuration({ batchBlocks, overlapBlocks: 3n }),
        ),
      ).toThrow("HISTORY_BATCH_BLOCKS must be greater than");
    },
  );

  it("derives every canonical source and market identity from the manifest", () => {
    const result = deriveHistoryIndexConfiguration(fixtureManifest);

    expect(result).toMatchObject({
      chainId: fixtureManifest.chainId,
      launchBlock: BigInt(fixtureManifest.launch.blockNumber),
      canonicalPool: {
        poolId: fixtureManifest.canonicalPool.poolId,
        currency0: fixtureManifest.canonicalPool.currency0,
        currency1: fixtureManifest.canonicalPool.currency1,
      },
      sources: {
        canonicalFeeHook: fixtureManifest.contracts.canonicalFeeHook,
        epochConverter: fixtureManifest.contracts.epochConverter,
        fuelCore: fixtureManifest.contracts.fuelCore,
        poolManager: fixtureManifest.contracts.uniswapV4PoolManager,
        protocolLiquidityVault:
          fixtureManifest.contracts.protocolLiquidityVault,
        rewardLedger: fixtureManifest.contracts.rewardLedger,
      },
    });
    expect(result.manifestFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("derives CCA sources and lifecycle blocks only for a v3 manifest", () => {
    const result = deriveHistoryIndexConfiguration(ccaFixtureManifest);

    expect(result.cca).toEqual({
      startBlock: 100n,
      endBlock: 110n,
      claimBlock: 111n,
      migrationBlock: 111n,
    });
    expect(result.sources.cca).toEqual({
      auction: ccaFixtureManifest.contracts.continuousClearingAuction,
      bidEscrowFactory: ccaFixtureManifest.contracts.ccaBidEscrowFactory,
      launchCoordinator: ccaFixtureManifest.contracts.ccaLaunchCoordinator,
      strategy: ccaFixtureManifest.contracts.ccaStrategy,
    });
    expect(
      deriveHistoryIndexConfiguration(fixtureManifest).cca,
    ).toBeUndefined();
    expect(
      historyEventDefinitions(result)
        .filter(
          (definition) =>
            definition.eventName.startsWith("auction-") ||
            definition.eventName.startsWith("cca-"),
        )
        .map((definition) => [definition.eventName, definition.startBlock]),
    ).toEqual([
      ["auction-bid-submitted", 100n],
      ["auction-bid-exited", 100n],
      ["auction-tokens-claimed", 111n],
      ["cca-migration-succeeded", 111n],
      ["cca-migration-failed", 111n],
      ["cca-funds-recovered", 111n],
      ["cca-activated", 111n],
    ]);
  });
});

describe("canonical RPC event source", () => {
  it("filters the singleton PoolManager by the exact canonical Pool ID", () => {
    const config = configuration();
    const swap = historyEventDefinitions(config).find(
      (definition) => definition.eventName === "swap",
    );

    expect(swap).toMatchObject({
      address: config.sources.poolManager,
      indexedArguments: { id: config.canonicalPool.poolId },
    });
  });

  it("reads all required sources with bounded concurrency and strict decoding", async () => {
    const config = configuration({ rpcConcurrency: 2 });
    let active = 0;
    let maximumActive = 0;
    const calls: Array<{
      readonly address: string;
      readonly eventName: string;
      readonly indexedArguments?: Readonly<Record<string, unknown>>;
    }> = [];
    const client: HistoryPublicClient = {
      getChainId: async () => config.chainId,
      getBlock: async ({ blockNumber } = {}) => header(blockNumber ?? 20n),
      getLogs: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const address = Array.isArray(request.address)
          ? request.address[0]!
          : request.address;
        calls.push({
          address,
          eventName: request.eventName,
          ...(request.indexedArguments === undefined
            ? {}
            : { indexedArguments: request.indexedArguments }),
        });
        const logIndex = calls.length;
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return [
          {
            address,
            blockHash: hash(12n),
            blockNumber: 12n,
            transactionHash: hash(1_200n),
            transactionIndex: 0,
            logIndex,
            removed: false,
            args: request.fixtureArguments,
          },
        ];
      },
    };

    const source = createHistoryChainSource(client, config);
    const events = await Effect.runPromise(source.getEvents(10n, 20n));

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(events.map((item) => item.eventName).sort()).toEqual(
      [
        "discovery-requested",
        "discovery-fulfilled",
        "discovery-cancelled",
        "fee-accrued",
        "protocol-liquidity-added",
        "permanent-commitment",
        "reward-claimed",
        "reward-epoch-opened",
        "reward-notified",
        "swap",
        "track-executed",
      ].sort(),
    );
    expect(
      calls.find((call) => call.eventName === "swap")?.indexedArguments,
    ).toEqual({ id: config.canonicalPool.poolId });
  });

  it("indexes v3 lifecycle events and withdrawals only from factory-created escrows", async () => {
    const config = {
      ...deriveHistoryIndexConfiguration(ccaFixtureManifest),
      rpcConcurrency: 2,
    };
    const escrow = "0x000000000000000000000000000000000000b001" as const;
    const requests: Array<{
      name: string;
      address: unknown;
      fromBlock: bigint;
    }> = [];
    const client: HistoryPublicClient = {
      getChainId: async () => config.chainId,
      getBlock: async ({ blockNumber } = {}) => header(blockNumber ?? 110n),
      getLogs: async (request) => {
        requests.push({
          name: request.event.name,
          address: request.address,
          fromBlock: request.fromBlock,
        });
        if (request.event.name === "EscrowDeployed") {
          return [
            {
              address: config.sources.cca!.bidEscrowFactory,
              blockHash: hash(99n),
              blockNumber: 99n,
              transactionHash: hash(9_900n),
              transactionIndex: 0,
              logIndex: 0,
              args: { beneficiary: escrow, escrow },
            },
          ];
        }
        if (request.event.name === "Withdrawal") {
          return [
            {
              address: escrow,
              blockHash: hash(110n),
              blockNumber: 110n,
              transactionHash: hash(11_000n),
              transactionIndex: 0,
              logIndex: 1,
              args: {
                token: ccaFixtureManifest.contracts.weth,
                beneficiary: escrow,
                amount: 12n,
              },
            },
          ];
        }
        return [];
      },
    };

    const events = await Effect.runPromise(
      createHistoryChainSource(client, config).getEvents(90n, 110n),
    );

    expect(events).toMatchObject([
      {
        eventName: "cca-escrow-withdrawal",
        sourceAddress: escrow,
        payload: { amount: "12" },
      },
    ]);
    expect(
      requests.find((request) => request.name === "TokensClaimed")?.fromBlock,
    ).toBeUndefined();
    expect(
      requests.find((request) => request.name === "Withdrawal")?.fromBlock,
    ).toBe(110n);
    expect(
      requests.find((request) => request.name === "Withdrawal")?.address,
    ).toEqual([escrow]);
  });

  it.each([
    { status: 503, code: -32603, recoverable: true },
    { status: 429, code: -32603, recoverable: true },
    { status: 200, code: -32603, recoverable: true },
    { status: 200, code: -32602, recoverable: false },
  ])(
    "synchronizes after transient HTTP $status / RPC $code failures, but rejects invalid requests",
    async ({ status, code, recoverable }) => {
      const config = configuration({ launchBlock: 20n });
      const store = openHistoryStore(temporaryDatabasePath(), config);
      let rejectNextRequest = true;
      const server = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const rpcRequest = JSON.parse(body) as {
          id: number;
          method: string;
        };
        const rejected = rejectNextRequest;
        rejectNextRequest = false;
        response.writeHead(rejected ? status : 200, {
          "content-type": "application/json",
        });
        const block = header(20n);
        response.end(
          JSON.stringify({
            id: rpcRequest.id,
            jsonrpc: "2.0",
            ...(rejected
              ? {
                  error:
                    status === 200
                      ? { code, message: "Provider request failed" }
                      : "Provider request failed",
                }
              : {
                  result:
                    rpcRequest.method === "eth_chainId"
                      ? `0x${config.chainId.toString(16)}`
                      : rpcRequest.method === "eth_getLogs"
                        ? []
                        : {
                            number: "0x14",
                            hash: block.blockHash,
                            parentHash: block.parentHash,
                            timestamp: `0x${block.blockTimestamp.toString(16)}`,
                          },
                }),
          }),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const source = createHistoryChainSource(
          createViemHistoryPublicClient(url, config),
          config,
        );
        const result = await Effect.runPromise(
          Effect.either(
            synchronizeHistory({ configuration: config, source, store }),
          ),
        );
        if (recoverable) {
          expect(result).toMatchObject({
            _tag: "Right",
            right: { indexedThroughBlock: 20n, state: "complete" },
          });
          expect(store.readCheckpoint()?.blockNumber).toBe(20n);
        } else {
          expect(result).toMatchObject({
            _tag: "Left",
            left: { _tag: "HistoryRpcError", retryable: false },
          });
          expect(store.readCheckpoint()).toBeUndefined();
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        store.close();
      }
    },
  );

  it("classifies an ordinary fetch outage as retryable", async () => {
    const config = configuration();
    const client: HistoryPublicClient = {
      getChainId: async () => config.chainId,
      getBlock: async ({ blockNumber } = {}) => header(blockNumber ?? 20n),
      getLogs: async () => Promise.reject(new Error("Details: fetch failed")),
    };

    const result = await Effect.runPromise(
      Effect.either(
        createHistoryChainSource(client, config).getEvents(10n, 20n),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({
        _tag: "HistoryRpcError",
        retryable: true,
      });
    }
  });
});

describe("SQLite history store", () => {
  it("rotates the served generation across restart and backup restore", () => {
    const databasePath = temporaryDatabasePath();
    const backupPath = `${databasePath}.backup`;
    const config = configuration();
    let store = openHistoryStore(databasePath, config);
    const firstGeneration = store.readIndexSnapshot().generation;
    store.close();
    copyFileSync(databasePath, backupPath);

    store = openHistoryStore(databasePath, config);
    const restartedGeneration = store.readIndexSnapshot().generation;
    expect(store.readIndexSnapshot()).toMatchObject({
      canonicalRevision: 0,
      blockNumber: undefined,
      blockHash: undefined,
    });
    expect(restartedGeneration).not.toBe(firstGeneration);
    store.close();

    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
    copyFileSync(backupPath, databasePath);
    store = openHistoryStore(databasePath, config);
    const restoredGeneration = store.readIndexSnapshot().generation;
    expect(restoredGeneration).not.toBe(firstGeneration);
    expect(restoredGeneration).not.toBe(restartedGeneration);
    store.close();
  });

  it("persists a checkpoint and sparse history across process restarts", () => {
    const databasePath = temporaryDatabasePath();
    const config = configuration();
    let store = openHistoryStore(databasePath, config);

    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(config.launchBlock + 5n),
      observedHead: header(config.launchBlock + 5n),
      retainedHeaders: [header(config.launchBlock + 5n)],
      events: [event({ blockNumber: config.launchBlock + 2n })],
    });
    store.close();

    store = openHistoryStore(databasePath, config);
    expect(store.readCheckpoint()?.blockNumber).toBe(config.launchBlock + 5n);
    expect(
      store.queryEvents({
        eventNames: ["reward-epoch-opened"],
        fromBlock: config.launchBlock,
        toBlock: config.launchBlock + 5n,
        limit: 10,
      }),
    ).toMatchObject({
      items: [{ blockNumber: config.launchBlock + 2n }],
      status: { state: "complete" },
    });
    store.close();
  });

  it("deduplicates logs, honors removals, and paginates by a stable cursor", () => {
    const config = configuration();
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const first = event({ blockNumber: config.launchBlock, logIndex: 0 });
    const second = event({ blockNumber: config.launchBlock, logIndex: 1 });
    const third = event({ blockNumber: config.launchBlock + 1n, logIndex: 0 });

    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(config.launchBlock + 1n),
      observedHead: header(config.launchBlock + 1n),
      retainedHeaders: [
        header(config.launchBlock),
        header(config.launchBlock + 1n),
      ],
      events: [first, first, second, third],
    });
    const pageOne = store.queryEvents({
      eventNames: ["reward-epoch-opened"],
      fromBlock: config.launchBlock,
      toBlock: config.launchBlock + 1n,
      limit: 2,
    });
    const pageTwo = store.queryEvents({
      eventNames: ["reward-epoch-opened"],
      fromBlock: config.launchBlock,
      toBlock: config.launchBlock + 1n,
      limit: 2,
      cursor: pageOne.page.nextCursor!,
    });

    expect(pageOne.items.map((item) => item.logIndex)).toEqual([0, 1]);
    expect(pageOne.page).toMatchObject({ hasMore: true });
    expect(pageTwo.items).toEqual([third]);
    expect(pageTwo.page).toEqual({ hasMore: false, nextCursor: undefined });
    expect(
      store
        .queryEvents({
          eventNames: ["reward-epoch-opened"],
          fromBlock: config.launchBlock,
          toBlock: config.launchBlock + 1n,
          limit: 3,
          order: "desc",
        })
        .items.map((item) => [item.blockNumber, item.logIndex]),
    ).toEqual([
      [config.launchBlock + 1n, 0],
      [config.launchBlock, 1],
      [config.launchBlock, 0],
    ]);

    store.replaceCanonicalRange({
      fromBlock: config.launchBlock + 1n,
      through: header(config.launchBlock + 1n),
      observedHead: header(config.launchBlock + 1n),
      retainedHeaders: [header(config.launchBlock + 1n)],
      events: [{ ...third, removed: true }],
    });
    expect(
      store.queryEvents({
        eventNames: ["reward-epoch-opened"],
        fromBlock: config.launchBlock,
        toBlock: config.launchBlock + 1n,
        limit: 10,
      }).items,
    ).toEqual([first, second]);
    store.close();
  });

  it("refuses to reuse a database for a different manifest", () => {
    const databasePath = temporaryDatabasePath();
    const store = openHistoryStore(databasePath, configuration());
    store.close();

    expect(() =>
      openHistoryStore(
        databasePath,
        configuration({ manifestFingerprint: hash(999n) }),
      ),
    ).toThrow("manifest");
  });

  it("refuses missing metadata in a populated database", () => {
    const databasePath = temporaryDatabasePath();
    const config = configuration();
    const checkpoint = header(config.launchBlock);
    const store = openHistoryStore(databasePath, config);
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: checkpoint,
      observedHead: checkpoint,
      retainedHeaders: [checkpoint],
      events: [event({ blockNumber: config.launchBlock })],
    });
    store.close();
    const database = new DatabaseSync(databasePath);
    database
      .prepare("DELETE FROM index_metadata WHERE key = ?")
      .run("manifest_fingerprint");
    database.close();

    expect(() => openHistoryStore(databasePath, config)).toThrow(
      "metadata key manifest_fingerprint is missing",
    );
  });

  it("refuses a checkpoint whose retained canonical header is missing", () => {
    const databasePath = temporaryDatabasePath();
    const config = configuration();
    const checkpoint = header(config.launchBlock);
    const store = openHistoryStore(databasePath, config);
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: checkpoint,
      observedHead: checkpoint,
      retainedHeaders: [checkpoint],
      events: [],
    });
    store.close();
    const database = new DatabaseSync(databasePath);
    database.exec("DELETE FROM canonical_headers");
    database.close();

    expect(() => openHistoryStore(databasePath, config)).toThrow(
      "checkpoint canonical header",
    );
  });

  it("rejects an internally inconsistent canonical header window atomically", () => {
    const config = configuration();
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const first = header(config.launchBlock);
    const disconnected = header(config.launchBlock + 1n, "b");

    expect(() =>
      store.replaceCanonicalRange({
        fromBlock: config.launchBlock,
        through: disconnected,
        observedHead: disconnected,
        retainedHeaders: [first, disconnected],
        events: [],
      }),
    ).toThrow("canonical header");
    expect(store.readCheckpoint()).toBeUndefined();
    store.close();
  });

  it("keeps a continuation on its original snapshot while indexing appends", () => {
    const config = configuration();
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const first = event({ blockNumber: config.launchBlock });
    const second = event({ blockNumber: config.launchBlock + 1n });
    const appended = event({ blockNumber: config.launchBlock + 2n });
    const query = {
      eventNames: ["reward-epoch-opened"] as const,
      fromBlock: config.launchBlock,
      toBlock: config.launchBlock + 3n,
      limit: 1,
      order: "desc" as const,
    };
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(config.launchBlock + 1n),
      observedHead: header(config.launchBlock + 1n),
      retainedHeaders: [
        header(config.launchBlock),
        header(config.launchBlock + 1n),
      ],
      events: [first, second],
    });
    const pageOne = store.queryEvents(query);

    store.replaceCanonicalRange({
      fromBlock: config.launchBlock + 2n,
      through: header(config.launchBlock + 3n),
      observedHead: header(config.launchBlock + 3n),
      retainedHeaders: [
        header(config.launchBlock + 2n),
        header(config.launchBlock + 3n),
      ],
      events: [appended],
    });
    const pageTwo = store.queryEvents({
      ...query,
      cursor: pageOne.page.nextCursor!,
    });

    expect(pageOne.items).toEqual([second]);
    expect(pageTwo.items).toEqual([first]);
    expect(pageTwo.items).not.toContainEqual(appended);
    expect(pageTwo.status).toMatchObject({
      state: "partial",
      coverage: { indexedThroughBlock: config.launchBlock + 1n },
    });
    expect(pageTwo.snapshot).toEqual(pageOne.snapshot);
    expect(store.readIndexSnapshot().blockNumber).toBe(config.launchBlock + 3n);
    store.close();
  });

  it("bounds retained snapshots and explicitly expires an old cursor", () => {
    const config = {
      ...configuration({ launchBlock: 10n, overlapBlocks: 3n }),
      cursorSnapshotRetention: 2,
    } as HistoryIndexConfiguration;
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const query = {
      eventNames: ["reward-epoch-opened"] as const,
      fromBlock: 10n,
      toBlock: 10n,
      limit: 1,
    };
    store.replaceCanonicalRange({
      fromBlock: 10n,
      through: header(10n),
      observedHead: header(10n),
      retainedHeaders: [header(10n)],
      events: [
        event({ blockNumber: 10n }),
        event({ blockNumber: 10n, logIndex: 1 }),
      ],
    });
    const firstPage = store.queryEvents(query);
    expect(firstPage.page.nextCursor).toBeDefined();
    for (const blockNumber of [11n, 12n]) {
      store.replaceCanonicalRange({
        fromBlock: blockNumber,
        through: header(blockNumber),
        observedHead: header(blockNumber),
        retainedHeaders: [header(blockNumber)],
        events: [],
      });
    }

    expect(() =>
      store.queryEvents({
        ...query,
        cursor: firstPage.page.nextCursor!,
      }),
    ).toThrow("restart pagination");
    store.close();
  });

  it("rejects a continuation after its canonical revision is rewound", () => {
    const config = configuration();
    const store = openHistoryStore(temporaryDatabasePath(), config);
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(config.launchBlock + 1n),
      observedHead: header(config.launchBlock + 1n),
      retainedHeaders: [
        header(config.launchBlock),
        header(config.launchBlock + 1n),
      ],
      events: [
        event({ blockNumber: config.launchBlock }),
        event({ blockNumber: config.launchBlock + 1n }),
      ],
    });
    const query = {
      eventNames: ["reward-epoch-opened"] as const,
      fromBlock: config.launchBlock,
      toBlock: config.launchBlock + 1n,
      limit: 1,
    };
    const pageOne = store.queryEvents(query);

    store.rewindCanonicalHistory(
      header(config.launchBlock),
      header(config.launchBlock + 1n, "b"),
    );

    expect(store.readIndexSnapshot()).toMatchObject({
      generation: pageOne.snapshot.generation,
      canonicalRevision: 1,
      blockNumber: config.launchBlock,
      blockHash: header(config.launchBlock).blockHash,
    });

    expect(() =>
      store.queryEvents({ ...query, cursor: pageOne.page.nextCursor! }),
    ).toThrow("restart pagination");
    store.close();
  });
});

describe("history HTTP boundary", () => {
  it("serves explicit CCA lifecycle routes with manifest-bound source evidence", async () => {
    const config = {
      ...deriveHistoryIndexConfiguration(ccaFixtureManifest),
      launchBlock: 90n,
      confirmationBlocks: 0n,
    };
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const availability = createHistoryAvailability();
    availability.markReady();
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(111n),
      observedHead: header(111n),
      retainedHeaders: [header(111n)],
      events: [
        {
          ...event({ blockNumber: 111n, eventName: "cca-activated" }),
          sourceAddress: config.sources.cca!.launchCoordinator,
          payload: { governanceOwner: ccaFixtureManifest.roles.owner },
        },
      ],
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquireHistoryHttpServer({
            readApiToken: HISTORY_READ_API_TOKEN,
            ingestApiToken: undefined,
            availability,
            configuration: config,
            host: "127.0.0.1",
            port: 0,
            store,
          });
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/protocol/cca-activations`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            manifest: {
              cca: ccaFixtureManifest.cca.lifecycle,
              sources: { cca: config.sources.cca },
            },
            items: [{ eventName: "cca-activated" }],
          });
        }),
      ),
    );
    store.close();
  });

  it("serves authenticated domain pages with explicit coverage and no secret", async () => {
    const config = configuration();
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const availability = createHistoryAvailability();
    availability.markReady();
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(config.launchBlock + 1n),
      observedHead: header(config.launchBlock + 2n),
      retainedHeaders: [header(config.launchBlock + 1n)],
      events: [
        event({ blockNumber: config.launchBlock }),
        {
          ...event({
            blockNumber: config.launchBlock,
            eventName: "permanent-commitment",
            logIndex: 1,
          }),
          sourceAddress: config.sources.fuelCore,
          payload: { identityId: 1493 },
        },
      ],
    });
    const expectedSnapshot = store.readIndexSnapshot();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquireHistoryHttpServer({
            readApiToken: HISTORY_READ_API_TOKEN,
            ingestApiToken: undefined,
            availability,
            configuration: config,
            host: "127.0.0.1",
            port: 0,
            store,
          });
          const unauthorized = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/protocol/rewards`),
          );
          expect(unauthorized.status).toBe(401);

          const candles = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/market/candles`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          expect(candles.status).toBe(200);
          expect(yield* Effect.promise(() => candles.json())).toMatchObject({
            manifest: { canonicalPool: config.canonicalPool },
            feed: {
              source: "uniswap-v4-subgraph",
              state: "unconfigured",
            },
          });

          const response = yield* Effect.promise(() =>
            fetch(
              `${server.url}/v1/protocol/rewards?fromBlock=${config.launchBlock}&toBlock=${config.launchBlock + 1n}&limit=1`,
              {
                headers: {
                  authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
                },
              },
            ),
          );
          const body = (yield* Effect.promise(() => response.json())) as Record<
            string,
            unknown
          >;

          expect(response.status).toBe(200);
          expect(body).toMatchObject({
            manifest: {
              chainId: config.chainId,
              commitment: config.manifestCommitment,
              fingerprint: config.manifestFingerprint,
              canonicalPool: config.canonicalPool,
              sources: config.sources,
            },
            snapshot: {
              generation: expectedSnapshot.generation,
              canonicalRevision: 0,
              blockNumber: (config.launchBlock + 1n).toString(),
              blockHash: header(config.launchBlock + 1n).blockHash,
            },
            items: [
              {
                blockNumber: config.launchBlock.toString(),
                eventName: "reward-epoch-opened",
              },
            ],
            status: {
              state: "complete",
              coverage: {
                indexedThroughBlock: (config.launchBlock + 1n).toString(),
              },
              head: { lagBlocks: "1" },
            },
          });
          expect(JSON.stringify(body)).not.toContain(HISTORY_READ_API_TOKEN);

          const commitments = yield* Effect.promise(() =>
            fetch(
              `${server.url}/v1/protocol/permanent-commitments?fromBlock=${config.launchBlock}&toBlock=${config.launchBlock + 1n}`,
              {
                headers: {
                  authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
                },
              },
            ),
          );
          expect(commitments.status).toBe(200);
          expect(yield* Effect.promise(() => commitments.json())).toMatchObject(
            {
              items: [
                {
                  eventName: "permanent-commitment",
                  payload: { identityId: 1493 },
                },
              ],
            },
          );

          const statusResponse = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/status`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          const statusResponseBody = yield* Effect.promise(() =>
            statusResponse.json(),
          );
          expect(statusResponseBody).toMatchObject({
            snapshot: {
              generation: expectedSnapshot.generation,
              canonicalRevision: 0,
              blockNumber: (config.launchBlock + 1n).toString(),
            },
          });

          const invalid = yield* Effect.promise(() =>
            fetch(
              `${server.url}/v1/protocol/rewards?fromBlock=${config.launchBlock - 1n}`,
              {
                headers: {
                  authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
                },
              },
            ),
          );
          expect(invalid.status).toBe(400);
          const invalidBody = yield* Effect.promise(() => invalid.json());
          expect(invalidBody).toMatchObject({
            snapshot: {
              generation: expectedSnapshot.generation,
              canonicalRevision: 0,
              blockNumber: (config.launchBlock + 1n).toString(),
            },
            status: {
              state: "error",
              requested: {
                fromBlock: (config.launchBlock - 1n).toString(),
              },
              coverage: {
                indexedThroughBlock: (config.launchBlock + 1n).toString(),
              },
              head: { observedBlock: (config.launchBlock + 2n).toString() },
              error: { code: "invalid-query" },
            },
          });
        }),
      ),
    );
    store.close();
  });

  it("gates readiness and queries after detecting a post-commit reorg", async () => {
    const config = configuration({ launchBlock: 10n, batchBlocks: 8n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    source.headBlock = 13n;
    await runSync(store, source, config);
    const availability = createHistoryAvailability();
    availability.markReady();
    source.headBlock = 17n;
    let terminalReads = 0;
    source.onGetHeader = (blockNumber) => {
      if (blockNumber !== 17n) return;
      terminalReads += 1;
      if (terminalReads === 4) source.branches.set(17n, "b");
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquireHistoryHttpServer({
            readApiToken: HISTORY_READ_API_TOKEN,
            ingestApiToken: HISTORY_INGEST_API_TOKEN,
            availability,
            configuration: config,
            host: "127.0.0.1",
            port: 0,
            store,
          });
          const synchronization = yield* Effect.either(
            synchronizeHistory({ configuration: config, source, store }),
          );
          expect(synchronization._tag).toBe("Left");
          if (synchronization._tag === "Left") {
            expect(synchronization.left).toBeInstanceOf(
              HistoryCanonicalityError,
            );
          }
          availability.markFailed({
            code: "history-canonicality-check-failed",
            message: "Canonical history is being replayed",
          });

          const ready = yield* Effect.promise(() =>
            fetch(`${server.url}/readyz`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          const page = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/protocol/rewards?fromBlock=10&toBlock=17`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          expect(ready.status).toBe(503);
          expect(page.status).toBe(503);
          const pageBody = yield* Effect.promise(() => page.json());
          expect(pageBody).toMatchObject({
            items: [],
            status: {
              state: "error",
              error: { code: "history-canonicality-check-failed" },
            },
          });
        }),
      ),
    );
    store.close();
  });

  it("gates known-orphan history while searching for a common ancestor", async () => {
    const config = configuration({ launchBlock: 10n, overlapBlocks: 3n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    source.events.push(event({ blockNumber: 20n }));
    await runSync(store, source, config);
    source.branches.set(19n, "b");
    source.branches.set(20n, "b");
    const availability = createHistoryAvailability();
    availability.markReady();
    let releaseLookup: (() => void) | undefined;
    const lookupRelease = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    let announceLookup: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      announceLookup = resolve;
    });
    let checkpointReads = 0;
    const pausingSource: HistoryChainSource = {
      getChainId: source.getChainId,
      getHead: source.getHead,
      getEvents: source.getEvents,
      getHeader: (blockNumber) => {
        if (blockNumber !== 20n) return source.getHeader(blockNumber);
        checkpointReads += 1;
        if (checkpointReads === 1) return source.getHeader(blockNumber);
        return Effect.promise(async () => {
          announceLookup?.();
          await lookupRelease;
          return source.canonicalHeader(blockNumber);
        });
      },
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquireHistoryHttpServer({
            readApiToken: HISTORY_READ_API_TOKEN,
            ingestApiToken: HISTORY_INGEST_API_TOKEN,
            availability,
            configuration: config,
            host: "127.0.0.1",
            port: 0,
            store,
          });
          const synchronization = Effect.runPromise(
            synchronizeHistory({
              configuration: config,
              source: pausingSource,
              store,
              onCanonicalityUncertain: () =>
                Effect.sync(() => {
                  availability.markFailed({
                    code: "history-canonicality-check-failed",
                    message: "A persisted checkpoint is no longer canonical",
                  });
                }),
            }),
          );
          yield* Effect.promise(() => lookupStarted);

          const ready = yield* Effect.promise(() =>
            fetch(`${server.url}/readyz`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          const page = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/protocol/rewards?fromBlock=10&toBlock=20`, {
              headers: {
                authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
              },
            }),
          );
          expect(ready.status).toBe(503);
          expect(page.status).toBe(503);
          const pageBody = yield* Effect.promise(() => page.json());
          expect(pageBody).toMatchObject({
            items: [],
            status: {
              state: "error",
              error: { code: "history-canonicality-check-failed" },
            },
          });

          releaseLookup?.();
          yield* Effect.promise(() => synchronization);
        }),
      ),
    );
    store.close();
  });

  it("never exposes internal synchronization diagnostics", async () => {
    const config = configuration({ launchBlock: 10n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    store.replaceCanonicalRange({
      fromBlock: config.launchBlock,
      through: header(config.launchBlock),
      observedHead: header(config.launchBlock),
      retainedHeaders: [header(config.launchBlock)],
      events: [],
    });
    const availability = createHistoryAvailability();
    const secret = "rpc-password";
    availability.markFailed({
      code: "history-rpc-unavailable",
      message: `fetch failed for https://reader:${secret}@rpc.example.test`,
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquireHistoryHttpServer({
            readApiToken: HISTORY_READ_API_TOKEN,
            ingestApiToken: HISTORY_INGEST_API_TOKEN,
            availability,
            configuration: config,
            host: "127.0.0.1",
            port: 0,
            store,
          });
          const responses = yield* Effect.forEach(
            [
              `${server.url}/readyz`,
              `${server.url}/v1/status`,
              `${server.url}/v1/protocol/rewards?fromBlock=10&toBlock=10`,
            ],
            (url) =>
              Effect.promise(() =>
                fetch(url, {
                  headers: {
                    authorization: `Bearer ${HISTORY_READ_API_TOKEN}`,
                  },
                }),
              ),
          );
          for (const response of responses) {
            expect(response.status).toBe(503);
            const serialized = yield* Effect.promise(() => response.text());
            expect(serialized).not.toContain(secret);
            expect(serialized).not.toContain("rpc.example.test");
            expect(serialized).toContain("history-rpc-unavailable");
          }
        }),
      ),
    );
    store.close();
  });
});

describe("durable synchronization", () => {
  it("rejects a wrong-chain RPC as non-retryable before writing", async () => {
    const config = configuration({ launchBlock: 10n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId + 1);

    const result = await Effect.runPromise(
      Effect.either(
        synchronizeHistory({ configuration: config, source, store }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({
        _tag: "HistoryRpcError",
        retryable: false,
      });
    }
    expect(store.readCheckpoint()).toBeUndefined();
    store.close();
  });

  it("fails a batch if the canonical chain changes during its source reads", async () => {
    const config = configuration({ launchBlock: 10n, batchBlocks: 4n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    source.events.push(event({ blockNumber: 15n }));
    source.onGetEvents = (fromBlock) => {
      if (fromBlock !== 14n) return;
      source.onGetEvents = undefined;
      for (let blockNumber = 14n; blockNumber <= 20n; blockNumber += 1n) {
        source.branches.set(blockNumber, "b");
      }
      source.events.splice(
        0,
        source.events.length,
        event({ blockNumber: 16n, eventName: "track-executed" }),
      );
    };

    const interrupted = await Effect.runPromise(
      Effect.either(
        synchronizeHistory({ configuration: config, source, store }),
      ),
    );

    expect(interrupted._tag).toBe("Left");
    if (interrupted._tag === "Left") {
      expect(interrupted.left).toBeInstanceOf(HistoryCanonicalityError);
    }
    expect(store.readCheckpoint()?.blockNumber).toBe(13n);

    await runSync(store, source, config);
    expect(
      store.queryEvents({
        eventNames: ["reward-epoch-opened", "track-executed"],
        fromBlock: 10n,
        toBlock: 20n,
        limit: 10,
      }).items,
    ).toMatchObject([{ blockNumber: 16n, eventName: "track-executed" }]);
    store.close();
  });

  it("backfills, resumes from overlap, and splits provider-limited ranges", async () => {
    const config = configuration({ launchBlock: 10n, batchBlocks: 8n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    source.maximumRange = 2n;
    source.retryFailures = 1;
    source.events.push(
      event({ blockNumber: 11n }),
      event({ blockNumber: 19n }),
    );

    const first = await runSync(store, source, config);
    expect(first).toMatchObject({
      indexedThroughBlock: 20n,
      state: "complete",
    });
    expect(source.attempts).toContainEqual([10n, 17n]);
    expect(source.attempts).toContainEqual([10n, 13n]);
    expect(source.attempts).toContainEqual([10n, 11n]);

    source.attempts.length = 0;
    source.headBlock = 22n;
    await runSync(store, source, config);
    expect(source.attempts[0]?.[0]).toBe(18n);
    expect(store.readCheckpoint()?.blockNumber).toBe(22n);
    store.close();
  });

  it("fails closed without mutating history when the confirmed target regresses", async () => {
    const config = configuration({ launchBlock: 10n, overlapBlocks: 3n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    source.events.push(
      event({ blockNumber: 19n }),
      event({ blockNumber: 20n }),
    );
    await runSync(store, source, config);
    const firstPage = store.queryEvents({
      eventNames: ["reward-epoch-opened"],
      fromBlock: 10n,
      toBlock: 20n,
      limit: 1,
    });
    expect(firstPage.page.nextCursor).toBeDefined();
    const checkpointBefore = store.readCheckpoint();
    const revisionBefore = store.readCanonicalRevision();

    source.headBlock = 19n;
    const result = await Effect.runPromise(
      Effect.either(
        synchronizeHistory({ configuration: config, source, store }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(HistoryCanonicalityError);
      expect(result.left.message).toContain("regressed");
    }
    expect(store.readCheckpoint()).toEqual(checkpointBefore);
    expect(store.readCanonicalRevision()).toBe(revisionBefore);
    expect(
      store
        .queryEvents({
          eventNames: ["reward-epoch-opened"],
          fromBlock: 10n,
          toBlock: 20n,
          limit: 1,
          cursor: firstPage.page.nextCursor!,
        })
        .items.map((item) => item.blockNumber),
    ).toEqual([20n]);
    store.close();
  });

  it("rewinds to a retained common ancestor and replaces reorged events", async () => {
    const config = configuration({ launchBlock: 10n, overlapBlocks: 5n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    source.events.push(
      event({ blockNumber: 18n, eventName: "track-executed" }),
      event({ blockNumber: 20n, eventName: "reward-epoch-opened" }),
    );
    await runSync(store, source, config);

    source.branches.set(19n, "b");
    source.branches.set(20n, "b");
    source.events.splice(
      0,
      source.events.length,
      event({ blockNumber: 19n, eventName: "protocol-liquidity-added" }),
    );
    await runSync(store, source, config);

    const result = store.queryEvents({
      eventNames: [
        "track-executed",
        "reward-epoch-opened",
        "protocol-liquidity-added",
      ],
      fromBlock: 10n,
      toBlock: 20n,
      limit: 10,
    });
    expect(result.items.map((item) => item.eventName)).toEqual([
      "track-executed",
      "protocol-liquidity-added",
    ]);
    expect(store.readCheckpoint()?.blockHash).toBe(hash(20n, "b"));
    store.close();
  });

  it("fails closed when a reorg is deeper than retained history", async () => {
    const config = configuration({ launchBlock: 10n, overlapBlocks: 3n });
    const store = openHistoryStore(temporaryDatabasePath(), config);
    const source = new FakeChainSource(config.chainId);
    await runSync(store, source, config);
    const checkpointBefore = store.readCheckpoint();

    source.branches.set(18n, "b");
    source.branches.set(19n, "b");
    source.branches.set(20n, "b");

    const result = await Effect.runPromise(
      Effect.either(
        synchronizeHistory({ configuration: config, source, store }),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(DeepReorgError);
    }
    expect(store.readCheckpoint()).toEqual(checkpointBefore);
    store.close();
  });
});

it("filters canonical discovery outcomes by account and binds pagination to that account", async () => {
  const config = configuration({ launchBlock: 0n });
  const store = openHistoryStore(temporaryDatabasePath(), config);
  const chain = new FakeChainSource(config.chainId);
  const account = "0x0000000000000000000000000000000000000001";
  chain.events.push(
    ...[1n, 2n, 3n].map((blockNumber) => ({
      ...event({ blockNumber, eventName: "discovery-requested" }),
      sourceAddress: config.sources.fuelCore,
      payload: {
        account:
          blockNumber === 2n
            ? "0x0000000000000000000000000000000000000002"
            : account,
        requestId: hash(blockNumber),
      },
    })),
  );
  await Effect.runPromise(
    synchronizeHistory({ configuration: config, source: chain, store }),
  );
  const query = {
    eventNames: ["discovery-requested"] as const,
    account,
    fromBlock: config.launchBlock,
    toBlock: chain.headBlock,
    limit: 1,
  };
  const page = store.queryEvents(query);
  expect(page.items.map((item) => item.blockNumber)).toEqual([1n]);
  expect(
    store
      .queryEvents({ ...query, cursor: page.page.nextCursor! })
      .items.map((item) => item.blockNumber),
  ).toEqual([3n]);
  expect(() =>
    store.queryEvents({
      ...query,
      account: "0x0000000000000000000000000000000000000002",
      cursor: page.page.nextCursor!,
    }),
  ).toThrow("different query");
  store.close();
});

it("replays old checkpoints once when discovery events enter the tracked set", async () => {
  const config = configuration({ launchBlock: 0n });
  const path = temporaryDatabasePath();
  let store = openHistoryStore(path, config);
  const chain = new FakeChainSource(config.chainId);
  await Effect.runPromise(
    synchronizeHistory({ configuration: config, source: chain, store }),
  );
  store.close();
  const oldDatabase = new DatabaseSync(path);
  oldDatabase.exec(
    "DELETE FROM index_metadata WHERE key = 'tracked_event_revision'",
  );
  oldDatabase.close();
  store = openHistoryStore(path, config);
  expect(store.readCheckpoint()).toBeUndefined();
  expect(
    store.queryEvents({
      eventNames: ["discovery-requested"],
      fromBlock: 0n,
      toBlock: 20n,
      limit: 10,
    }).status.state,
  ).toBe("partial");
  await Effect.runPromise(
    synchronizeHistory({ configuration: config, source: chain, store }),
  );
  store.close();
  store = openHistoryStore(path, config);
  expect(store.readCheckpoint()?.blockNumber).toBe(20n);
  store.close();
});
