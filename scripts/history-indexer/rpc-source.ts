import { Effect } from "effect";
import {
  InternalRpcError,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import { redactDiagnostic } from "../effect-runtime.ts";
import type { HistoryIndexConfiguration } from "./configuration.ts";
import { HistoryDecodeError, HistoryRpcError } from "./errors.ts";
import type {
  CanonicalHeader,
  HistoryEventName,
  HistoryPayload,
  HistoryPayloadValue,
  IndexedHistoryEvent,
} from "./model.ts";
import type { HistoryChainSource } from "./synchronize.ts";

const eventAbis = {
  "discovery-requested": parseAbiItem(
    "event DiscoveryRequested(address indexed account,bytes32 indexed requestId)",
  ),
  "discovery-fulfilled": parseAbiItem(
    "event DiscoveryFulfilled(address indexed account,bytes32 indexed requestId,uint16 indexed identityId)",
  ),
  "discovery-cancelled": parseAbiItem(
    "event DiscoveryCancelled(address indexed account,bytes32 indexed requestId)",
  ),
  swap: parseAbiItem(
    "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
  ),
  "fee-accrued": parseAbiItem(
    "event FeeAccrued(address indexed trader,uint256 wethVolume,uint256 totalFee,uint256 rewardAmount,uint256 liquidityAmount,uint256 creatorAmount)",
  ),
  "protocol-liquidity-added": parseAbiItem(
    "event ProtocolLiquidityAdded(uint256 indexed cycleNumber,bytes32 indexed positionSalt,uint256 pulledWeth,uint256 consumedWeth,uint256 queuedWeth,uint256 permanentlyLockedWeth,int24 tickLower,int24 tickUpper,uint128 liquidity)",
  ),
  "permanent-commitment": parseAbiItem(
    "event Committed(address indexed account,uint16 indexed identityId)",
  ),
  "reward-epoch-opened": parseAbiItem(
    "event RewardEpochOpened(uint256 indexed epochNumber,uint256 openedAmount,uint256 equalTrackShare,uint256 finalTrackRemainder)",
  ),
  "track-executed": parseAbiItem(
    "event TrackExecuted(uint8 indexed track,uint256 wethInput,uint256 measuredStockOutput,uint256 deferredTrackBudget)",
  ),
  "reward-notified": parseAbiItem(
    "event RewardNotified(uint8 indexed track,address indexed token,uint256 amount,uint256 ordinaryAllocation,uint256 basketRelicAllocation,uint256 indicatorRelicAllocation)",
  ),
  "reward-claimed": parseAbiItem(
    "event RewardClaimed(address indexed currentOwner,uint16 indexed identityId,uint8 indexed track,uint256 amount)",
  ),
  "auction-bid-submitted": parseAbiItem(
    "event BidSubmitted(uint256 indexed id,address indexed owner,uint256 priceQ96,uint128 amount)",
  ),
  "auction-bid-exited": parseAbiItem(
    "event BidExited(uint256 indexed bidId,address indexed owner,uint256 tokensFilled,uint256 currencyRefunded)",
  ),
  "auction-tokens-claimed": parseAbiItem(
    "event TokensClaimed(uint256 indexed bidId,address indexed owner,uint256 tokensFilled)",
  ),
  "cca-migration-succeeded": parseAbiItem(
    "event Migrated(address indexed initializer,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) indexed key,uint160 initialSqrtPriceX96,bytes plan)",
  ),
  "cca-migration-failed": parseAbiItem(
    "event MigrationFailed(address indexed initializer,bytes reason)",
  ),
  "cca-funds-recovered": parseAbiItem(
    "event FundsRecovered(address indexed initializer,address indexed recipient,uint256 amount)",
  ),
  "cca-activated": parseAbiItem(
    "event FuelActivated(address indexed governanceOwner)",
  ),
  "cca-escrow-withdrawal": parseAbiItem(
    "event Withdrawal(address indexed token,address indexed beneficiary,uint256 amount)",
  ),
} as const satisfies Readonly<Record<HistoryEventName, AbiEvent>>;

const escrowDeployedEvent = parseAbiItem(
  "event EscrowDeployed(address indexed beneficiary,address indexed escrow)",
);

export interface HistoryEventDefinition {
  readonly eventName: HistoryEventName;
  readonly address: Address;
  readonly event: AbiEvent;
  readonly indexedArguments?: Readonly<Record<string, unknown>>;
  readonly fixtureArguments: Readonly<Record<string, unknown>>;
  readonly startBlock?: bigint;
}

export interface DecodedHistoryLog {
  readonly address: Address;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly removed?: boolean;
  readonly args: Readonly<Record<string, unknown>>;
}

export type HistoryLogRequest = Omit<HistoryEventDefinition, "address"> & {
  readonly address: Address | readonly Address[];
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly strict: true;
};

export interface HistoryPublicClient {
  readonly getChainId: () => Promise<number>;
  readonly getBlock: (parameters?: {
    readonly blockNumber?: bigint;
  }) => Promise<CanonicalHeader>;
  readonly getLogs: (
    request: HistoryLogRequest,
  ) => Promise<readonly DecodedHistoryLog[]>;
}

const addressFixture = "0x0000000000000000000000000000000000000001";
const hashFixture = `0x${"1".repeat(64)}`;

export const historyEventDefinitions = (
  configuration: HistoryIndexConfiguration,
): readonly HistoryEventDefinition[] => [
  ...(
    [
      "discovery-requested",
      "discovery-fulfilled",
      "discovery-cancelled",
    ] as const
  ).map((eventName) => ({
    eventName,
    address: configuration.sources.fuelCore,
    event: eventAbis[eventName],
    fixtureArguments: {
      account: addressFixture,
      requestId: hashFixture,
      ...(eventName === "discovery-fulfilled" ? { identityId: 1 } : {}),
    },
  })),
  {
    eventName: "swap",
    address: configuration.sources.poolManager,
    event: eventAbis.swap,
    indexedArguments: { id: configuration.canonicalPool.poolId },
    fixtureArguments: {
      id: configuration.canonicalPool.poolId,
      sender: addressFixture,
      amount0: -1n,
      amount1: 2n,
      sqrtPriceX96: 3n,
      liquidity: 4n,
      tick: 5,
      fee: 3_000,
    },
  },
  {
    eventName: "fee-accrued",
    address: configuration.sources.canonicalFeeHook,
    event: eventAbis["fee-accrued"],
    fixtureArguments: {
      trader: addressFixture,
      wethVolume: 10n,
      totalFee: 3n,
      rewardAmount: 2n,
      liquidityAmount: 1n,
      creatorAmount: 0n,
    },
  },
  {
    eventName: "protocol-liquidity-added",
    address: configuration.sources.protocolLiquidityVault,
    event: eventAbis["protocol-liquidity-added"],
    fixtureArguments: {
      cycleNumber: 1n,
      positionSalt: hashFixture,
      pulledWeth: 10n,
      consumedWeth: 9n,
      queuedWeth: 1n,
      permanentlyLockedWeth: 9n,
      tickLower: 60,
      tickUpper: 120,
      liquidity: 100n,
    },
  },
  {
    eventName: "reward-epoch-opened",
    address: configuration.sources.epochConverter,
    event: eventAbis["reward-epoch-opened"],
    fixtureArguments: {
      epochNumber: 1n,
      openedAmount: 40n,
      equalTrackShare: 10n,
      finalTrackRemainder: 0n,
    },
  },
  {
    eventName: "permanent-commitment",
    address: configuration.sources.fuelCore,
    event: eventAbis["permanent-commitment"],
    fixtureArguments: {
      account: addressFixture,
      identityId: 1,
    },
  },
  {
    eventName: "track-executed",
    address: configuration.sources.epochConverter,
    event: eventAbis["track-executed"],
    fixtureArguments: {
      track: 1,
      wethInput: 10n,
      measuredStockOutput: 20n,
      deferredTrackBudget: 0n,
    },
  },
  {
    eventName: "reward-notified",
    address: configuration.sources.rewardLedger,
    event: eventAbis["reward-notified"],
    fixtureArguments: {
      track: 1,
      token: addressFixture,
      amount: 20n,
      ordinaryAllocation: 18n,
      basketRelicAllocation: 1n,
      indicatorRelicAllocation: 1n,
    },
  },
  {
    eventName: "reward-claimed",
    address: configuration.sources.rewardLedger,
    event: eventAbis["reward-claimed"],
    fixtureArguments: {
      currentOwner: addressFixture,
      identityId: 1,
      track: 1,
      amount: 2n,
    },
  },
  ...(configuration.sources.cca === undefined || configuration.cca === undefined
    ? []
    : ([
        {
          eventName: "auction-bid-submitted",
          address: configuration.sources.cca.auction,
          event: eventAbis["auction-bid-submitted"],
          startBlock: configuration.cca.startBlock,
          fixtureArguments: {
            id: 1n,
            owner: addressFixture,
            priceQ96: 2n,
            amount: 3n,
          },
        },
        {
          eventName: "auction-bid-exited",
          address: configuration.sources.cca.auction,
          event: eventAbis["auction-bid-exited"],
          startBlock: configuration.cca.startBlock,
          fixtureArguments: {
            bidId: 1n,
            owner: addressFixture,
            tokensFilled: 2n,
            currencyRefunded: 3n,
          },
        },
        {
          eventName: "auction-tokens-claimed",
          address: configuration.sources.cca.auction,
          event: eventAbis["auction-tokens-claimed"],
          startBlock: configuration.cca.claimBlock,
          fixtureArguments: {
            bidId: 1n,
            owner: addressFixture,
            tokensFilled: 2n,
          },
        },
        {
          eventName: "cca-migration-succeeded",
          address: configuration.sources.cca.strategy,
          event: eventAbis["cca-migration-succeeded"],
          startBlock: configuration.cca.migrationBlock,
          fixtureArguments: {
            initializer: addressFixture,
            key: hashFixture,
            initialSqrtPriceX96: 2n,
            plan: "0x01",
          },
        },
        {
          eventName: "cca-migration-failed",
          address: configuration.sources.cca.strategy,
          event: eventAbis["cca-migration-failed"],
          startBlock: configuration.cca.migrationBlock,
          fixtureArguments: { initializer: addressFixture, reason: "0x01" },
        },
        {
          eventName: "cca-funds-recovered",
          address: configuration.sources.cca.strategy,
          event: eventAbis["cca-funds-recovered"],
          startBlock: configuration.cca.migrationBlock,
          fixtureArguments: {
            initializer: addressFixture,
            recipient: addressFixture,
            amount: 1n,
          },
        },
        {
          eventName: "cca-activated",
          address: configuration.sources.cca.launchCoordinator,
          event: eventAbis["cca-activated"],
          startBlock: configuration.cca.migrationBlock,
          fixtureArguments: { governanceOwner: addressFixture },
        },
      ] satisfies readonly HistoryEventDefinition[])),
];

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const errorStatus = (cause: unknown): number | undefined => {
  if (typeof cause !== "object" || cause === null || !("status" in cause)) {
    return undefined;
  }
  const status = cause.status;
  return typeof status === "number" ? status : undefined;
};

const rangeFailure = (message: string): boolean =>
  /(block range|range.{0,20}(large|limit)|response.{0,20}(large|limit)|too many results)/iu.test(
    message,
  );

const retryableFailure = (cause: unknown, message: string): boolean => {
  const status = errorStatus(cause);
  return (
    cause instanceof InternalRpcError ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /(rate limit|throttl|compute units?.{0,20}per second.{0,20}capacity|timeout|timed out|temporar|fetch failed|network|connection reset|socket hang up|econnreset|econnrefused|enotfound|eai_again)/iu.test(
      message,
    )
  );
};

const rpcFailure = (message: string, cause: unknown): HistoryRpcError => {
  const detail = errorMessage(cause);
  const status = errorStatus(cause);
  return new HistoryRpcError({
    message: `${message}: ${redactDiagnostic(detail)}`,
    retryable: retryableFailure(cause, detail),
    rangeTooLarge: rangeFailure(detail),
    cause: {
      kind: cause instanceof Error ? cause.name : typeof cause,
      ...(status === undefined ? {} : { status }),
    },
  });
};

const rpc = <Value>(message: string, operation: () => Promise<Value>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => rpcFailure(message, cause),
  });

const payloadValue = (value: unknown): HistoryPayloadValue => {
  if (typeof value === "bigint") return value.toString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  throw new TypeError(`Unsupported history payload value ${String(value)}`);
};

const payloadFrom = (args: Readonly<Record<string, unknown>>): HistoryPayload =>
  Object.fromEntries(
    Object.entries(args)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, payloadValue(value)]),
  );

const matchingIndexedArguments = (
  definition: HistoryEventDefinition,
  log: DecodedHistoryLog,
): boolean =>
  Object.entries(definition.indexedArguments ?? {}).every(
    ([key, expected]) =>
      String(log.args[key]).toLowerCase() === String(expected).toLowerCase(),
  );

const eventFromLog = (
  definition: HistoryEventDefinition,
  log: DecodedHistoryLog,
  block: CanonicalHeader,
): IndexedHistoryEvent => {
  if (log.address.toLowerCase() !== definition.address.toLowerCase()) {
    throw new TypeError(
      `${definition.eventName} log did not match its manifest source address`,
    );
  }
  if (!matchingIndexedArguments(definition, log)) {
    throw new TypeError(
      `${definition.eventName} log did not match its canonical indexed arguments`,
    );
  }
  if (
    block.blockNumber !== log.blockNumber ||
    block.blockHash !== log.blockHash
  ) {
    throw new TypeError(
      `${definition.eventName} log did not match its canonical block header`,
    );
  }
  return {
    ...block,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    sourceAddress: log.address,
    eventName: definition.eventName,
    payload: payloadFrom(log.args),
    removed: log.removed ?? false,
  };
};

const sortAndDeduplicate = (
  events: readonly IndexedHistoryEvent[],
): readonly IndexedHistoryEvent[] => {
  const seen = new Set<string>();
  return [...events]
    .sort(
      (left, right) =>
        Number(left.blockNumber - right.blockNumber) ||
        left.transactionIndex - right.transactionIndex ||
        left.logIndex - right.logIndex ||
        left.blockHash.localeCompare(right.blockHash),
    )
    .filter((item) => {
      const key = `${item.blockHash}:${item.logIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const decodeLogs = ({
  client,
  definitionsAndLogs,
  rpcConcurrency,
}: {
  readonly client: HistoryPublicClient;
  readonly definitionsAndLogs: readonly (readonly [
    HistoryEventDefinition,
    readonly DecodedHistoryLog[],
  ])[];
  readonly rpcConcurrency: number;
}) =>
  Effect.gen(function* () {
    const blockNumbers = [
      ...new Set(
        definitionsAndLogs.flatMap(([, logs]) =>
          logs.map((log) => log.blockNumber),
        ),
      ),
    ];
    const headers = yield* Effect.forEach(
      blockNumbers,
      (blockNumber) =>
        rpc(`Could not read block ${blockNumber}`, () =>
          client.getBlock({ blockNumber }),
        ),
      { concurrency: rpcConcurrency },
    );
    const byNumber = new Map(headers.map((item) => [item.blockNumber, item]));
    return yield* Effect.try({
      try: () =>
        sortAndDeduplicate(
          definitionsAndLogs.flatMap(([definition, logs]) =>
            logs.map((log) => {
              const block = byNumber.get(log.blockNumber);
              if (block === undefined) {
                throw new Error(`Missing block header ${log.blockNumber}`);
              }
              return eventFromLog(definition, log, block);
            }),
          ),
        ),
      catch: (cause) =>
        new HistoryDecodeError({
          message: "Could not strictly decode canonical history logs",
          cause,
        }),
    });
  });

export const createHistoryChainSource = (
  client: HistoryPublicClient,
  configuration: HistoryIndexConfiguration,
): HistoryChainSource => {
  const definitions = historyEventDefinitions(configuration);
  const knownEscrows = new Map<string, Address>();
  let escrowFactoryScannedThrough: bigint | undefined;
  const requestedRange = (
    definition: HistoryEventDefinition,
    fromBlock: bigint,
    toBlock: bigint,
  ): readonly [bigint, bigint] | undefined => {
    const effectiveFrom =
      definition.startBlock !== undefined && definition.startBlock > fromBlock
        ? definition.startBlock
        : fromBlock;
    return effectiveFrom > toBlock ? undefined : [effectiveFrom, toBlock];
  };
  const escrowWithdrawals = (fromBlock: bigint, toBlock: bigint) => {
    const cca = configuration.cca;
    const sources = configuration.sources.cca;
    if (cca === undefined || sources === undefined || toBlock < cca.endBlock) {
      return Effect.succeed(undefined);
    }
    const factoryStartBlock =
      configuration.launchBlock < cca.startBlock
        ? configuration.launchBlock
        : cca.startBlock;
    const rescanFrom =
      escrowFactoryScannedThrough === undefined
        ? factoryStartBlock
        : fromBlock < escrowFactoryScannedThrough + 1n
          ? fromBlock
          : escrowFactoryScannedThrough + 1n;
    const discoveryFrom =
      rescanFrom < factoryStartBlock ? factoryStartBlock : rescanFrom;
    const ranges: Array<readonly [bigint, bigint]> = [];
    for (let start = discoveryFrom; start <= toBlock;) {
      const candidateEnd = start + configuration.batchBlocks - 1n;
      const end = candidateEnd < toBlock ? candidateEnd : toBlock;
      ranges.push([start, end]);
      start = end + 1n;
    }
    return Effect.forEach(
      ranges,
      ([rangeFrom, rangeTo]) =>
        rpc("Could not discover CCA bid escrows", () =>
          client.getLogs({
            eventName: "cca-escrow-withdrawal",
            address: sources.bidEscrowFactory,
            event: escrowDeployedEvent,
            fixtureArguments: {
              beneficiary: addressFixture,
              escrow: addressFixture,
            },
            fromBlock: rangeFrom,
            toBlock: rangeTo,
            strict: true,
          }),
        ),
      { concurrency: 1 },
    ).pipe(
      Effect.map((batches) => batches.flat()),
      Effect.flatMap((deployments) =>
        Effect.try({
          try: () => {
            for (const deployment of deployments) {
              if (
                deployment.address.toLowerCase() !==
                sources.bidEscrowFactory.toLowerCase()
              ) {
                throw new TypeError(
                  "Escrow deployment did not match the manifest factory",
                );
              }
              const escrow = String(deployment.args.escrow);
              if (!/^0x[0-9a-fA-F]{40}$/u.test(escrow)) {
                throw new TypeError(
                  "Escrow deployment did not contain an address",
                );
              }
              knownEscrows.set(escrow.toLowerCase(), escrow as Address);
            }
            escrowFactoryScannedThrough = toBlock;
            return [...knownEscrows.values()];
          },
          catch: (cause) =>
            new HistoryDecodeError({
              message: "Could not decode manifest-bound CCA bid escrows",
              cause,
            }),
        }),
      ),
      Effect.flatMap((addresses) => {
        if (addresses.length === 0) return Effect.succeed(undefined);
        const baseDefinition: HistoryEventDefinition = {
          eventName: "cca-escrow-withdrawal",
          address: addresses[0]!,
          event: eventAbis["cca-escrow-withdrawal"],
          startBlock: cca.endBlock,
          fixtureArguments: {
            token: addressFixture,
            beneficiary: addressFixture,
            amount: 1n,
          },
        };
        const [effectiveFrom, effectiveTo] = requestedRange(
          baseDefinition,
          fromBlock,
          toBlock,
        )!;
        return rpc("Could not read cca-escrow-withdrawal logs", () =>
          client.getLogs({
            ...baseDefinition,
            address: addresses,
            fromBlock: effectiveFrom,
            toBlock: effectiveTo,
            strict: true,
          }),
        ).pipe(
          Effect.map((logs) =>
            addresses.map((address) => {
              const definition = { ...baseDefinition, address };
              return [
                definition,
                logs.filter(
                  (log) => log.address.toLowerCase() === address.toLowerCase(),
                ),
              ] as const;
            }),
          ),
        );
      }),
    );
  };
  return {
    getChainId: rpc("Could not read history RPC chain ID", client.getChainId),
    getHead: rpc("Could not read history RPC head", () => client.getBlock()),
    getHeader: (blockNumber) =>
      rpc(`Could not read history block ${blockNumber}`, () =>
        client.getBlock({ blockNumber }),
      ),
    getEvents: (fromBlock, toBlock) =>
      Effect.forEach(
        definitions,
        (definition) => {
          const range = requestedRange(definition, fromBlock, toBlock);
          if (range === undefined) {
            return Effect.succeed([definition, []] as const);
          }
          return rpc(`Could not read ${definition.eventName} logs`, () =>
            client.getLogs({
              ...definition,
              fromBlock: range[0],
              toBlock: range[1],
              strict: true,
            }),
          ).pipe(Effect.map((logs) => [definition, logs] as const));
        },
        { concurrency: configuration.rpcConcurrency },
      ).pipe(
        Effect.flatMap((staticLogs) =>
          escrowWithdrawals(fromBlock, toBlock).pipe(
            Effect.map(
              (withdrawalLogs) => [staticLogs, withdrawalLogs] as const,
            ),
          ),
        ),
        Effect.flatMap(([staticLogs, withdrawalLogs]) =>
          decodeLogs({
            client,
            definitionsAndLogs:
              withdrawalLogs === undefined
                ? staticLogs
                : [...staticLogs, ...withdrawalLogs],
            rpcConcurrency: configuration.rpcConcurrency,
          }),
        ),
      ),
  };
};
