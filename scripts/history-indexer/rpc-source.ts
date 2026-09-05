import { Effect } from "effect";
import { parseAbiItem, type AbiEvent, type Address, type Hex } from "viem";

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
} as const satisfies Readonly<Record<HistoryEventName, AbiEvent>>;

export interface HistoryEventDefinition {
  readonly eventName: HistoryEventName;
  readonly address: Address;
  readonly event: AbiEvent;
  readonly indexedArguments?: Readonly<Record<string, unknown>>;
  readonly fixtureArguments: Readonly<Record<string, unknown>>;
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

export interface HistoryLogRequest extends HistoryEventDefinition {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly strict: true;
}

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
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /(rate limit|throttl|timeout|timed out|temporar|fetch failed|network|connection reset|socket hang up|econnreset|econnrefused|enotfound|eai_again)/iu.test(
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
        (definition) =>
          rpc(`Could not read ${definition.eventName} logs`, () =>
            client.getLogs({
              ...definition,
              fromBlock,
              toBlock,
              strict: true,
            }),
          ).pipe(Effect.map((logs) => [definition, logs] as const)),
        { concurrency: configuration.rpcConcurrency },
      ).pipe(
        Effect.flatMap((definitionsAndLogs) =>
          decodeLogs({
            client,
            definitionsAndLogs,
            rpcConcurrency: configuration.rpcConcurrency,
          }),
        ),
      ),
  };
};
