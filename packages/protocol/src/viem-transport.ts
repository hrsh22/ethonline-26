import {
  decodeFunctionData,
  getAbiItem,
  encodeAbiParameters,
  keccak256,
  toFunctionSelector,
  toHex,
  type Address,
  type PublicClient,
  type Transaction,
} from "viem";

import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";

import { createProtocolContracts, protocolAbis } from "./contracts.js";
import {
  classifyTrackAttempts,
  retainOperationalSummaryEvents,
} from "./events.js";
import type {
  ContractReadRequest,
  ContractReadResult,
  ContractReadResults,
  OperationalEvent,
  OperationalEventType,
  ProtocolReadTransport,
  RewardHistoryEvent,
  RewardHistoryWindow,
  RewardTrack,
} from "./reader.js";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";

const RPC_LOG_BLOCK_RANGE = 10_000n;
const MAX_FAILED_OPERATION_BLOCKS = 500n;
const MAX_FAILED_OPERATION_CANDIDATES = 500;
const MAX_FAILED_CLAIM_IDENTITIES = 100;
const MAX_FAILED_CLAIM_IDENTITY_READS = 2_000;
const OPERATION_LOG_CONCURRENCY = 4;
const OPERATION_REORG_OVERLAP = 12n;
const OPERATION_BLOCK_BATCH = 4;
const MULTICALL_READ_BATCH = 250;
const MULTICALL_RETRY_BATCH = 50;
const MULTICALL_READ_ATTEMPTS = 3;
export const publicQuoteCaller =
  "0x0000000000000000000000000000000000004444" as const satisfies Address;
const MAX_OPERATION_EVENT_BLOCKS = 50_000n;

type TaskLimiter = <Result>(task: () => Promise<Result>) => Promise<Result>;

const createTaskLimiter = (maximumConcurrency: number): TaskLimiter => {
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async () => {
    if (active < maximumConcurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });
  };
  const release = () => {
    const next = waiters.shift();
    if (next === undefined) {
      active -= 1;
      return;
    }
    active -= 1;
    next();
  };
  return async <Result>(task: () => Promise<Result>) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
};

const bigintArgument = (
  args: Record<string, unknown> | undefined,
  key: string,
): bigint | undefined => {
  const value = args?.[key];
  return typeof value === "bigint" ? value : undefined;
};

const liquidityGrowthFrom = (
  type: OperationalEventType,
  args: Record<string, unknown> | undefined,
): OperationalEvent["liquidityGrowth"] => {
  if (type !== "pol-execution") return undefined;
  const cycleNumber = bigintArgument(args, "cycleNumber");
  const pulledWeth = bigintArgument(args, "pulledWeth");
  const consumedWeth = bigintArgument(args, "consumedWeth");
  const queuedWeth = bigintArgument(args, "queuedWeth");
  const permanentlyLockedWeth = bigintArgument(args, "permanentlyLockedWeth");
  if (
    cycleNumber === undefined ||
    pulledWeth === undefined ||
    consumedWeth === undefined ||
    queuedWeth === undefined ||
    permanentlyLockedWeth === undefined
  ) {
    return undefined;
  }
  return {
    cycleNumber,
    pulledWeth,
    consumedWeth,
    queuedWeth,
    permanentlyLockedWeth,
  };
};

const rewardEpochFrom = (
  type: OperationalEventType,
  args: Record<string, unknown> | undefined,
): OperationalEvent["rewardEpoch"] => {
  if (type !== "reward-epoch") return undefined;
  const epochNumber = bigintArgument(args, "epochNumber");
  const openedWeth = bigintArgument(args, "openedAmount");
  const equalTrackShare = bigintArgument(args, "equalTrackShare");
  const finalTrackRemainder = bigintArgument(args, "finalTrackRemainder");
  if (
    epochNumber === undefined ||
    openedWeth === undefined ||
    equalTrackShare === undefined ||
    finalTrackRemainder === undefined
  ) {
    return undefined;
  }
  return { epochNumber, openedWeth, equalTrackShare, finalTrackRemainder };
};

const trackConversionFrom = (
  type: OperationalEventType,
  args: Record<string, unknown> | undefined,
): OperationalEvent["trackConversion"] => {
  if (type !== "track-execution") return undefined;
  const spentWeth = bigintArgument(args, "wethInput");
  const stockReceived = bigintArgument(args, "measuredStockOutput");
  const remainingQueue = bigintArgument(args, "deferredTrackBudget");
  if (
    spentWeth === undefined ||
    stockReceived === undefined ||
    remainingQueue === undefined
  ) {
    return undefined;
  }
  return { spentWeth, stockReceived, remainingQueue };
};

const trackFrom = (
  type: OperationalEventType,
  args: Record<string, unknown> | undefined,
): OperationalEvent["track"] => {
  if (type !== "track-execution" || args?.track === undefined) {
    return undefined;
  }
  const track = Number(args.track);
  return track >= 1 && track <= 4 ? (track as 1 | 2 | 3 | 4) : undefined;
};

const successfulEventFromLog = (
  definition: {
    readonly type: OperationalEventType;
    readonly explanation: string;
  },
  log: Record<string, unknown>,
): OperationalEvent => {
  const args = log.args as Record<string, unknown> | undefined;
  const track = trackFrom(definition.type, args);
  const liquidityGrowth = liquidityGrowthFrom(definition.type, args);
  const rewardEpoch = rewardEpochFrom(definition.type, args);
  const trackConversion = trackConversionFrom(definition.type, args);
  return {
    type: definition.type,
    blockNumber: BigInt(log.blockNumber as bigint),
    transactionIndex: Number(log.transactionIndex ?? 0),
    transactionHash: log.transactionHash as `0x${string}`,
    successful: true,
    ...(track === undefined ? {} : { track }),
    ...(liquidityGrowth === undefined ? {} : { liquidityGrowth }),
    ...(rewardEpoch === undefined ? {} : { rewardEpoch }),
    ...(trackConversion === undefined ? {} : { trackConversion }),
    explanation: definition.explanation,
  };
};

type RewardHistoryDefinition = {
  readonly contract: "epochConverter" | "rewardLedger";
  readonly event: ReturnType<typeof getAbiItem>;
  readonly type: RewardHistoryEvent["type"];
};

const rewardHistoryDefinitions = [
  {
    contract: "epochConverter",
    event: getAbiItem({
      abi: protocolAbis.epochConverter,
      name: "RewardEpochOpened",
    }),
    type: "reward-epoch",
  },
  {
    contract: "epochConverter",
    event: getAbiItem({
      abi: protocolAbis.epochConverter,
      name: "TrackExecuted",
    }),
    type: "track-conversion",
  },
  {
    contract: "rewardLedger",
    event: getAbiItem({
      abi: protocolAbis.rewardLedger,
      name: "RewardClaimed",
    }),
    type: "reward-claim",
  },
] as const satisfies readonly RewardHistoryDefinition[];

const decodedRewardTrack = (value: unknown): RewardTrack | undefined => {
  const track = Number(value);
  return track >= 1 && track <= 4 ? (track as RewardTrack) : undefined;
};

type RewardHistoryEventBase = Pick<
  RewardHistoryEvent,
  "blockNumber" | "logIndex" | "transactionHash" | "transactionIndex"
>;

const rewardHistoryEventBase = (
  log: Record<string, unknown>,
): RewardHistoryEventBase => ({
  blockNumber: BigInt(log.blockNumber as bigint),
  logIndex: Number(log.logIndex ?? 0),
  transactionHash: log.transactionHash as `0x${string}`,
  transactionIndex: Number(log.transactionIndex ?? 0),
});

const rewardEpochHistoryEvent = (
  base: RewardHistoryEventBase,
  args: Record<string, unknown> | undefined,
): RewardHistoryEvent | undefined => {
  const epoch = rewardEpochFrom("reward-epoch", args);
  return epoch === undefined
    ? undefined
    : { ...base, type: "reward-epoch", epoch };
};

const trackConversionHistoryEvent = (
  base: RewardHistoryEventBase,
  args: Record<string, unknown> | undefined,
): RewardHistoryEvent | undefined => {
  const track = decodedRewardTrack(args?.track);
  const conversion = trackConversionFrom("track-execution", args);
  if (track === undefined || conversion === undefined) return undefined;
  return { ...base, type: "track-conversion", track, conversion };
};

const rewardClaimHistoryEvent = (
  base: RewardHistoryEventBase,
  args: Record<string, unknown> | undefined,
): RewardHistoryEvent | undefined => {
  const track = decodedRewardTrack(args?.track);
  const amount = bigintArgument(args, "amount");
  const currentOwner = args?.currentOwner;
  const identityId = args?.identityId;
  if (
    track === undefined ||
    amount === undefined ||
    typeof currentOwner !== "string" ||
    identityId === undefined
  ) {
    return undefined;
  }
  return {
    ...base,
    type: "reward-claim",
    track,
    claim: {
      amount,
      currentOwner: currentOwner as Address,
      identityId: Number(identityId),
    },
  };
};

const rewardHistoryEventFromLog = (
  type: RewardHistoryEvent["type"],
  log: Record<string, unknown>,
): RewardHistoryEvent | undefined => {
  const args = log.args as Record<string, unknown> | undefined;
  const base = rewardHistoryEventBase(log);
  if (type === "reward-epoch") {
    return rewardEpochHistoryEvent(base, args);
  }
  if (type === "track-conversion") {
    return trackConversionHistoryEvent(base, args);
  }
  return rewardClaimHistoryEvent(base, args);
};

const sortRewardHistory = (
  events: readonly RewardHistoryEvent[],
): RewardHistoryEvent[] =>
  [...events].sort(
    (left, right) =>
      Number(left.blockNumber - right.blockNumber) ||
      left.transactionIndex - right.transactionIndex ||
      left.logIndex - right.logIndex,
  );

const deduplicateRewardHistory = (
  events: readonly RewardHistoryEvent[],
): RewardHistoryEvent[] => {
  const seen = new Set<string>();
  return sortRewardHistory(events).filter((event) => {
    const key = `${event.transactionHash}:${event.logIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const rewardLogRanges = (fromBlock: bigint, toBlock: bigint) => {
  const ranges: Array<readonly [bigint, bigint]> = [];
  for (
    let cursor = fromBlock;
    cursor <= toBlock;
    cursor += RPC_LOG_BLOCK_RANGE
  ) {
    const candidateEnd = cursor + RPC_LOG_BLOCK_RANGE - 1n;
    ranges.push([cursor, candidateEnd < toBlock ? candidateEnd : toBlock]);
  }
  return ranges;
};

const usableRewardHistoryCache = (
  cache: RewardHistoryWindow | undefined,
  fromBlock: bigint,
  toBlock: bigint,
) => {
  if (cache === undefined) return undefined;
  if (cache.fromBlock > fromBlock) return undefined;
  if (cache.throughBlock < fromBlock) return undefined;
  if (cache.throughBlock > toBlock) return undefined;
  return cache;
};

const rewardHistoryScanFrom = (
  prior: RewardHistoryWindow | undefined,
  fromBlock: bigint,
) => {
  if (prior === undefined) return fromBlock;
  if (prior.throughBlock < OPERATION_REORG_OVERLAP - 1n) return fromBlock;
  const overlapFrom = prior.throughBlock - OPERATION_REORG_OVERLAP + 1n;
  return overlapFrom > fromBlock ? overlapFrom : fromBlock;
};

const preservedRewardHistory = (
  prior: RewardHistoryWindow | undefined,
  fromBlock: bigint,
  scanFrom: bigint,
) => {
  if (prior === undefined) return [];
  return prior.events.filter(
    (event) => event.blockNumber >= fromBlock && event.blockNumber < scanFrom,
  );
};

const decodeRewardHistoryLogs = (
  definition: RewardHistoryDefinition,
  logs: readonly Record<string, unknown>[],
) =>
  logs.map((log) => {
    const event = rewardHistoryEventFromLog(definition.type, log);
    if (event === undefined) {
      throw new Error(`Could not decode ${definition.type} history event`);
    }
    return event;
  });

const scanRewardHistoryDefinition = async ({
  client,
  contracts,
  definition,
  rangeFrom,
  rangeTo,
  runLogRead,
}: {
  readonly client: PublicClient;
  readonly contracts: ReturnType<typeof createProtocolContracts>;
  readonly definition: RewardHistoryDefinition;
  readonly rangeFrom: bigint;
  readonly rangeTo: bigint;
  readonly runLogRead: TaskLimiter;
}) => {
  const logs = await runLogRead(() =>
    client.getLogs({
      address: contracts[definition.contract].address,
      event: definition.event,
      fromBlock: rangeFrom,
      toBlock: rangeTo,
      strict: true,
    } as never),
  );
  return decodeRewardHistoryLogs(
    definition,
    logs as unknown as Array<Record<string, unknown>>,
  );
};

const createRewardHistoryScanner = ({
  client,
  contracts,
  runLogRead,
}: {
  readonly client: PublicClient;
  readonly contracts: ReturnType<typeof createProtocolContracts>;
  readonly runLogRead: TaskLimiter;
}): ProtocolReadTransport["rewardHistory"] => {
  let cache: RewardHistoryWindow | undefined;
  return async (fromBlock, toBlock) => {
    if (fromBlock > toBlock) {
      return { events: [], fromBlock, throughBlock: toBlock };
    }
    const prior = usableRewardHistoryCache(cache, fromBlock, toBlock);
    const scanFrom = rewardHistoryScanFrom(prior, fromBlock);
    const ranges = rewardLogRanges(scanFrom, toBlock);
    const scanned = await Promise.all(
      rewardHistoryDefinitions.flatMap((definition) =>
        ranges.map(([rangeFrom, rangeTo]) =>
          scanRewardHistoryDefinition({
            client,
            contracts,
            definition,
            rangeFrom,
            rangeTo,
            runLogRead,
          }),
        ),
      ),
    );
    const preserved = preservedRewardHistory(prior, fromBlock, scanFrom);
    cache = {
      events: deduplicateRewardHistory([...preserved, ...scanned.flat()]),
      fromBlock,
      throughBlock: toBlock,
    };
    return cache;
  };
};

type TrackAttemptState = Readonly<
  Record<1 | 2 | 3 | 4, "fresh" | "retryable" | "unknown">
>;

const unknownTrackAttemptState = (): TrackAttemptState => ({
  1: "unknown",
  2: "unknown",
  3: "unknown",
  4: "unknown",
});

const freshTrackAttemptState = (): TrackAttemptState => ({
  1: "fresh",
  2: "fresh",
  3: "fresh",
  4: "fresh",
});

const applyTrackAttempts = (
  initial: TrackAttemptState,
  events: readonly OperationalEvent[],
): TrackAttemptState => {
  const state = { ...initial };
  for (const event of [...events].sort(
    (left, right) =>
      Number(left.blockNumber - right.blockNumber) ||
      (left.transactionIndex ?? 0) - (right.transactionIndex ?? 0),
  )) {
    if (event.type === "track-execution" && event.track !== undefined) {
      state[event.track] = event.successful ? "fresh" : "retryable";
    }
  }
  return state;
};

type ProtocolReadMany = ProtocolReadTransport["readMany"];

const createOperationalEventScanner = ({
  client,
  contracts,
  identity,
  manifest,
  readMany,
  runLogRead,
  scanFailedTransactions,
}: {
  readonly client: PublicClient;
  readonly contracts: ReturnType<typeof createProtocolContracts>;
  readonly identity: IdentityConfiguration;
  readonly manifest: ProtocolDeploymentManifest;
  readonly readMany: ProtocolReadMany;
  readonly runLogRead: TaskLimiter;
  readonly scanFailedTransactions: boolean;
}) => {
  const copy = createIdentityProtocolCopy(identity);
  const successEventDefinitions = [
    {
      contract: "epochConverter" as const,
      event: getAbiItem({
        abi: protocolAbis.epochConverter,
        name: "RewardEpochOpened",
      }),
      type: "reward-epoch",
      explanation: copy.events.rewardEpochSucceeded,
    },
    {
      contract: "epochConverter" as const,
      event: getAbiItem({
        abi: protocolAbis.epochConverter,
        name: "TrackExecuted",
      }),
      type: "track-execution",
      explanation: copy.events.conversionSucceeded,
    },
    {
      contract: "rewardLedger" as const,
      event: getAbiItem({
        abi: protocolAbis.rewardLedger,
        name: "RewardClaimed",
      }),
      type: "claim",
      explanation: copy.events.claimSucceeded,
    },
    {
      contract: "protocolLiquidityVault" as const,
      event: getAbiItem({
        abi: protocolAbis.protocolLiquidityVault,
        name: "ProtocolLiquidityAdded",
      }),
      type: "pol-execution",
      explanation: copy.events.liquiditySucceeded,
    },
  ] as const;

  const failedSelectors = new Map<
    string,
    {
      type: OperationalEventType;
      explanation: string;
      authorization: "keeper" | "claimant" | "liquidity-executor";
    }
  >([
    [
      `${contracts.epochConverter.address.toLowerCase()}:${toFunctionSelector("openRewardEpoch()")}`,
      {
        type: "reward-epoch",
        explanation: copy.events.rewardEpochFailed,
        authorization: "keeper",
      },
    ],
    [
      `${contracts.epochConverter.address.toLowerCase()}:${toFunctionSelector("executeTrack(uint8,uint256,uint256)")}`,
      {
        type: "track-execution",
        explanation: copy.events.conversionFailed,
        authorization: "keeper",
      },
    ],
    [
      `${contracts.rewardLedger.address.toLowerCase()}:${toFunctionSelector("claim(uint16[])")}`,
      {
        type: "claim",
        explanation: copy.events.claimFailed,
        authorization: "claimant",
      },
    ],
    [
      `${contracts.protocolLiquidityVault.address.toLowerCase()}:${toFunctionSelector("addLiquidityCycle(int24,int24,uint128,uint256,uint256)")}`,
      {
        type: "pol-execution",
        explanation: copy.events.liquidityFailed,
        authorization: "liquidity-executor",
      },
    ],
  ]);
  const operationalTargets = new Set([
    contracts.epochConverter.address.toLowerCase(),
    contracts.rewardLedger.address.toLowerCase(),
    contracts.protocolLiquidityVault.address.toLowerCase(),
  ]);
  const authorizationMutationTargets = {
    keeper: new Set([
      `${contracts.epochConverter.address.toLowerCase()}:${toFunctionSelector("setKeeper(address)")}`,
    ]),
    "liquidity-executor": new Set([
      `${contracts.protocolLiquidityVault.address.toLowerCase()}:${toFunctionSelector("setExecutor(address)")}`,
    ]),
    claimant: new Set([
      `${contracts.fuelMirror.address.toLowerCase()}:${toFunctionSelector("transferFrom(address,address,uint256)")}`,
      `${contracts.fuelMirror.address.toLowerCase()}:${toFunctionSelector("safeTransferFrom(address,address,uint256)")}`,
      `${contracts.fuelMirror.address.toLowerCase()}:${toFunctionSelector("safeTransferFrom(address,address,uint256,bytes)")}`,
      `${contracts.fuelCore.address.toLowerCase()}:${toFunctionSelector("recoverCollectible(address,address,uint16)")}`,
    ]),
  } as const;
  let operationalCache:
    | {
        fromBlock: bigint;
        throughBlock: bigint;
        successful: readonly OperationalEvent[];
        failed: readonly OperationalEvent[];
        failureCoverageFrom: bigint;
        windowInitialTrackAttemptState: TrackAttemptState;
        failureScanTruncatedAt?: bigint;
        claimScanTruncatedAt?: bigint;
      }
    | undefined;

  const recentOperationalEvents = async (
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
  ) => {
    const eventWindowTruncated =
      toBlock - fromBlock + 1n > MAX_OPERATION_EVENT_BLOCKS;
    fromBlock = eventWindowTruncated
      ? toBlock - MAX_OPERATION_EVENT_BLOCKS + 1n
      : fromBlock;
    const claimReadBudgetExceeded = Symbol("claim-read-budget-exceeded");
    let claimIdentityReadCount = 0;
    if (fromBlock > toBlock) {
      return {
        events: [],
        trackAttemptCoverage: {
          1: "complete",
          2: "complete",
          3: "complete",
          4: "complete",
        },
        trackAttemptState: {
          1: "fresh",
          2: "fresh",
          3: "fresh",
          4: "fresh",
        },
        failureScanTruncated: false,
        claimScanTruncated: false,
        eventWindowTruncated,
      } as const;
    }
    const selectPrior = () => {
      if (operationalCache === undefined) return undefined;
      const reusable =
        fromBlock >= operationalCache.fromBlock &&
        toBlock >= operationalCache.throughBlock;
      return reusable ? operationalCache : undefined;
    };
    const overlapStart = (
      prior: NonNullable<typeof operationalCache> | undefined,
    ) => {
      if (prior === undefined) return fromBlock;
      if (prior.throughBlock < OPERATION_REORG_OVERLAP - 1n) return fromBlock;
      return prior.throughBlock - OPERATION_REORG_OVERLAP + 1n;
    };
    const failedScanStart = (
      prior: NonNullable<typeof operationalCache> | undefined,
      canContinue: boolean,
      overlapFrom: bigint,
    ) => {
      if (prior !== undefined && canContinue) return overlapFrom;
      const boundedFrom = toBlock - MAX_FAILED_OPERATION_BLOCKS + 1n;
      return toBlock - fromBlock + 1n > MAX_FAILED_OPERATION_BLOCKS
        ? boundedFrom
        : fromBlock;
    };
    const activeTruncation = (blockNumber: bigint | undefined) => {
      if (blockNumber === undefined) return undefined;
      return blockNumber >= fromBlock ? blockNumber : undefined;
    };
    const createScanPlan = () => {
      const prior = selectPrior();
      const incrementalGap =
        prior === undefined ? undefined : toBlock - prior.throughBlock;
      const canContinueFailureScan =
        incrementalGap !== undefined &&
        incrementalGap <= MAX_FAILED_OPERATION_BLOCKS;
      const overlapFrom = overlapStart(prior);
      const successScanFrom = prior === undefined ? fromBlock : overlapFrom;
      const failedScanFrom = failedScanStart(
        prior,
        canContinueFailureScan,
        overlapFrom,
      );
      const failureCoverageFrom =
        prior !== undefined && canContinueFailureScan
          ? prior.failureCoverageFrom
          : failedScanFrom;
      return {
        canContinueFailureScan,
        failedScanFrom,
        failureCoverageFrom,
        prior,
        priorClaimTruncation: activeTruncation(prior?.claimScanTruncatedAt),
        priorFailureTruncation: activeTruncation(prior?.failureScanTruncatedAt),
        successScanFrom,
      };
    };
    const scanPlan = createScanPlan();
    const {
      canContinueFailureScan,
      failedScanFrom,
      failureCoverageFrom,
      prior,
      priorClaimTruncation,
      priorFailureTruncation,
      successScanFrom,
    } = scanPlan;
    const decodeClaimIdentityIds = (input: `0x${string}`) => {
      try {
        const decoded = decodeFunctionData({
          abi: protocolAbis.rewardLedger,
          data: input,
        });
        return decoded.args?.[0] as readonly (number | bigint)[] | undefined;
      } catch {
        return undefined;
      }
    };
    const thirdUnsignedArgument = (input: `0x${string}`) => {
      const encoded = input.slice(10 + 64 * 2, 10 + 64 * 3);
      return encoded.length === 64 ? BigInt(`0x${encoded}`) : undefined;
    };
    const roleCache = new Map<string, Promise<unknown>>();
    const roleAt = (role: "keeper" | "executor", blockNumber: bigint) => {
      const key = `${role}:${blockNumber}`;
      const cached = roleCache.get(key);
      if (cached !== undefined) return cached;
      const read = client.readContract({
        ...(role === "keeper"
          ? contracts.epochConverter
          : contracts.protocolLiquidityVault),
        functionName: role,
        blockNumber,
      } as never);
      roleCache.set(key, read);
      return read;
    };
    type AuthorizationResult = "authorized" | "unauthorized" | "ambiguous";
    const authorizationResult = (
      sender: Address,
      before: unknown,
      after: unknown,
    ): AuthorizationResult => {
      const beforeAddress = String(before).toLowerCase();
      const afterAddress = String(after).toLowerCase();
      const senderAddress = sender.toLowerCase();
      if (beforeAddress === afterAddress) {
        return beforeAddress === senderAddress ? "authorized" : "unauthorized";
      }
      return [beforeAddress, afterAddress].includes(senderAddress)
        ? "ambiguous"
        : "unauthorized";
    };
    const authorizeRole = async (
      sender: Address,
      role: "keeper" | "executor",
      stateBlock: bigint,
      blockNumber: bigint,
    ) => {
      const [before, after] = await Promise.all([
        roleAt(role, stateBlock),
        roleAt(role, blockNumber),
      ]);
      return authorizationResult(sender, before, after);
    };
    const classifyOwnerAuthorizations = (
      sender: Address,
      ownersBefore: readonly ContractReadResult[],
      ownersAfter: readonly ContractReadResult[],
    ): AuthorizationResult => {
      let ambiguous = false;
      for (const [index, ownerBefore] of ownersBefore.entries()) {
        const ownerAfter = ownersAfter[index];
        if (
          ownerBefore?.status !== "success" ||
          ownerAfter?.status !== "success"
        ) {
          ambiguous = true;
          continue;
        }
        const result = authorizationResult(
          sender,
          ownerBefore.value,
          ownerAfter.value,
        );
        if (result === "unauthorized") return "unauthorized";
        if (result === "ambiguous") ambiguous = true;
      }
      return ambiguous ? "ambiguous" : "authorized";
    };
    const authorizeClaimant = async (
      sender: Address,
      input: `0x${string}`,
      stateBlock: bigint,
      blockNumber: bigint,
    ): Promise<AuthorizationResult> => {
      const identityIds = decodeClaimIdentityIds(input);
      const validClaim =
        identityIds !== undefined &&
        identityIds.length > 0 &&
        identityIds.length <= MAX_FAILED_CLAIM_IDENTITIES;
      if (!validClaim) return "unauthorized";
      const readsPerIdentity = stateBlock === blockNumber ? 1 : 2;
      const claimReadCount = identityIds.length * readsPerIdentity;
      if (
        claimIdentityReadCount + claimReadCount >
        MAX_FAILED_CLAIM_IDENTITY_READS
      ) {
        throw claimReadBudgetExceeded;
      }
      const ownerRequests = identityIds.map(
        (identityId) =>
          ({
            contract: "fuelMirror",
            functionName: "ownerOf",
            args: [BigInt(identityId)],
          }) as const,
      );
      claimIdentityReadCount += claimReadCount;
      const ownersBefore = await readMany(ownerRequests, stateBlock);
      const ownersAfter =
        readsPerIdentity === 1
          ? ownersBefore
          : await readMany(ownerRequests, blockNumber);
      return classifyOwnerAuthorizations(sender, ownersBefore, ownersAfter);
    };
    const authorizedFailedSender = async ({
      authorization,
      sender,
      input,
      blockNumber,
    }: {
      authorization: "keeper" | "claimant" | "liquidity-executor";
      sender: Address;
      input: `0x${string}`;
      blockNumber: bigint;
    }) => {
      const stateBlock = blockNumber === 0n ? 0n : blockNumber - 1n;
      if (authorization === "keeper") {
        return authorizeRole(sender, "keeper", stateBlock, blockNumber);
      }
      if (authorization === "liquidity-executor") {
        return authorizeRole(sender, "executor", stateBlock, blockNumber);
      }
      return authorizeClaimant(sender, input, stateBlock, blockNumber);
    };
    const scanSuccessfulLogs = async () => {
      const ranges: Array<readonly [bigint, bigint]> = [];
      for (
        let cursor = successScanFrom;
        cursor <= toBlock;
        cursor += RPC_LOG_BLOCK_RANGE
      ) {
        const rangeEnd = cursor + RPC_LOG_BLOCK_RANGE - 1n;
        ranges.push([cursor, rangeEnd < toBlock ? rangeEnd : toBlock]);
      }
      return Promise.all(
        successEventDefinitions.flatMap((definition) =>
          ranges.map(async ([rangeFrom, rangeTo]) => {
            const logs = await runLogRead(() =>
              client.getLogs({
                address: contracts[definition.contract].address,
                event: definition.event,
                fromBlock: rangeFrom,
                toBlock: rangeTo,
                strict: true,
              } as never),
            );
            return (logs as unknown as Array<Record<string, unknown>>).map(
              (log) => successfulEventFromLog(definition, log),
            );
          }),
        ),
      );
    };
    const successfulLogs = await scanSuccessfulLogs();
    type FailedOperation = NonNullable<ReturnType<typeof failedSelectors.get>>;
    type IncludedTransaction = Transaction<bigint, number, false>;
    const operationalCandidate = (
      transaction: `0x${string}` | IncludedTransaction,
    ) => {
      if (typeof transaction === "string") return undefined;
      if (transaction.to === null) return undefined;
      if (!operationalTargets.has(transaction.to.toLowerCase()))
        return undefined;
      const operation = failedSelectors.get(
        `${transaction.to.toLowerCase()}:${transaction.input.slice(0, 10)}`,
      );
      return operation === undefined ? undefined : { operation, transaction };
    };
    const claimedIdentitySet = (
      operation: FailedOperation,
      input: `0x${string}`,
    ) => {
      if (operation.authorization !== "claimant") return undefined;
      return new Set(
        (decodeClaimIdentityIds(input) ?? []).map((identityId) =>
          BigInt(identityId),
        ),
      );
    };
    const transactionSelector = (
      transaction: `0x${string}` | IncludedTransaction,
    ) => {
      if (typeof transaction === "string") return undefined;
      if (transaction.to === null) return undefined;
      return `${transaction.to.toLowerCase()}:${transaction.input.slice(0, 10)}`;
    };
    const hasAuthorizationMutation = (
      transactions: readonly (`0x${string}` | IncludedTransaction)[],
      operation: FailedOperation,
      claimedIdentityIds: ReadonlySet<bigint> | undefined,
    ) =>
      transactions.some((candidate) => {
        const selector = transactionSelector(candidate);
        if (selector === undefined) return false;
        const matchesMutation =
          authorizationMutationTargets[operation.authorization].has(selector);
        if (!matchesMutation) return false;
        if (operation.authorization !== "claimant") return true;
        const identityId =
          typeof candidate === "string"
            ? undefined
            : thirdUnsignedArgument(candidate.input);
        return (
          identityId !== undefined &&
          claimedIdentityIds?.has(identityId) === true
        );
      });
    const latestTruncation = (
      current: bigint | undefined,
      candidate: bigint,
    ) => {
      if (current === undefined) return candidate;
      return candidate > current ? candidate : current;
    };
    type FailedScanState = {
      claimBudgetExhausted: boolean;
      claimTruncatedAt: bigint | undefined;
      failedCandidateCount: number;
      failureTruncatedAt: bigint | undefined;
    };
    const resolveFailedAuthorization = async (
      transaction: IncludedTransaction,
      operation: FailedOperation,
      blockNumber: bigint,
      sameBlockMutation: boolean,
    ): Promise<AuthorizationResult | "claim-budget-exhausted"> => {
      if (sameBlockMutation) return "ambiguous";
      try {
        return await authorizedFailedSender({
          authorization: operation.authorization,
          sender: transaction.from,
          input: transaction.input,
          blockNumber,
        });
      } catch (cause) {
        if (cause === claimReadBudgetExceeded) return "claim-budget-exhausted";
        throw cause;
      }
    };
    const recordAmbiguousScan = (
      state: FailedScanState,
      authorization: FailedOperation["authorization"],
      blockNumber: bigint,
    ) => {
      if (authorization === "claimant") {
        state.claimTruncatedAt = latestTruncation(
          state.claimTruncatedAt,
          blockNumber,
        );
        return;
      }
      state.failureTruncatedAt = latestTruncation(
        state.failureTruncatedAt,
        blockNumber,
      );
    };
    const decodedFailedTrack = (
      operation: FailedOperation,
      input: `0x${string}`,
    ) => {
      if (operation.type !== "track-execution") return undefined;
      const encodedTrack = input.slice(10, 74);
      if (encodedTrack.length !== 64) return undefined;
      const decodedTrack = Number(BigInt(`0x${encodedTrack}`));
      if (decodedTrack < 1 || decodedTrack > 4) return undefined;
      return decodedTrack as 1 | 2 | 3 | 4;
    };
    const readFailedEvent = async (
      transaction: IncludedTransaction,
      operation: FailedOperation,
      blockNumber: bigint,
    ): Promise<OperationalEvent | undefined> => {
      const receipt = await client.getTransactionReceipt({
        hash: transaction.hash,
      });
      if (receipt.status !== "reverted") return undefined;
      const track = decodedFailedTrack(operation, transaction.input);
      return {
        type: operation.type,
        explanation: operation.explanation,
        blockNumber,
        transactionIndex: transaction.transactionIndex,
        transactionHash: transaction.hash,
        successful: false,
        ...(track === undefined ? {} : { track }),
      };
    };
    const scanFailedOperations = async () => {
      const failed: OperationalEvent[] = [
        ...(prior !== undefined && canContinueFailureScan
          ? prior.failed.filter((event) => event.blockNumber < failedScanFrom)
          : []),
      ];
      const state: FailedScanState = {
        claimBudgetExhausted: false,
        claimTruncatedAt: priorClaimTruncation,
        failedCandidateCount: 0,
        failureTruncatedAt: priorFailureTruncation,
      };
      const processTransaction = async (
        transaction: `0x${string}` | IncludedTransaction,
        transactions: readonly (`0x${string}` | IncludedTransaction)[],
        blockNumber: bigint,
      ) => {
        const candidate = operationalCandidate(transaction);
        if (candidate === undefined) return "continue" as const;
        const { operation } = candidate;
        if (
          operation.authorization === "claimant" &&
          state.claimBudgetExhausted
        ) {
          return "continue" as const;
        }
        const claimedIdentityIds = claimedIdentitySet(
          operation,
          candidate.transaction.input,
        );
        const sameBlockMutation = hasAuthorizationMutation(
          transactions,
          operation,
          claimedIdentityIds,
        );
        const authorization = await resolveFailedAuthorization(
          candidate.transaction,
          operation,
          blockNumber,
          sameBlockMutation,
        );
        if (authorization === "claim-budget-exhausted") {
          state.claimBudgetExhausted = true;
          state.claimTruncatedAt = latestTruncation(
            state.claimTruncatedAt,
            blockNumber,
          );
          return "continue" as const;
        }
        if (authorization === "ambiguous") {
          recordAmbiguousScan(state, operation.authorization, blockNumber);
          return "continue" as const;
        }
        if (authorization === "unauthorized") return "continue" as const;
        if (operation.authorization !== "claimant") {
          state.failedCandidateCount += 1;
          if (state.failedCandidateCount > MAX_FAILED_OPERATION_CANDIDATES) {
            state.failureTruncatedAt = blockNumber;
            return "stop" as const;
          }
        }
        const event = await readFailedEvent(
          candidate.transaction,
          operation,
          blockNumber,
        );
        if (event !== undefined) failed.push(event);
        return "continue" as const;
      };
      const failedBlockNumbers: bigint[] = [];
      for (
        let blockNumber = toBlock;
        blockNumber >= failedScanFrom;
        blockNumber -= 1n
      ) {
        failedBlockNumbers.push(blockNumber);
        if (blockNumber === 0n) break;
      }
      operationScan: for (
        let batchStart = 0;
        batchStart < failedBlockNumbers.length;
        batchStart += OPERATION_BLOCK_BATCH
      ) {
        const batchNumbers = failedBlockNumbers.slice(
          batchStart,
          batchStart + OPERATION_BLOCK_BATCH,
        );
        const blocks = await Promise.all(
          batchNumbers.map((blockNumber) =>
            client.getBlock({ blockNumber, includeTransactions: true }),
          ),
        );
        for (const [blockIndex, block] of blocks.entries()) {
          const blockNumber = batchNumbers[blockIndex]!;
          for (const transaction of [...block.transactions].reverse()) {
            const result = await processTransaction(
              transaction,
              block.transactions,
              blockNumber,
            );
            if (result === "stop") break operationScan;
          }
        }
      }
      return { failed, state };
    };
    const failedScan = scanFailedTransactions
      ? await scanFailedOperations()
      : {
          failed: [] as OperationalEvent[],
          state: {
            claimBudgetExhausted: false,
            claimTruncatedAt: toBlock,
            failedCandidateCount: 0,
            failureTruncatedAt: toBlock,
          },
        };
    const { failed } = failedScan;
    const claimScanTruncatedAt = failedScan.state.claimTruncatedAt;
    const failureScanTruncatedAt = failedScan.state.failureTruncatedAt;
    const finalizeOperationalWindow = () => {
      const successful = [
        ...(prior?.successful.filter(
          (event) => event.blockNumber < successScanFrom,
        ) ?? []),
        ...successfulLogs.flat(),
      ];
      const allAttempts = [...successful, ...failed].filter(
        (event) =>
          event.type === "track-execution" && event.track !== undefined,
      );
      const deriveWindowInitialState = () => {
        const statePrior =
          prior !== undefined && canContinueFailureScan ? prior : undefined;
        const startsAtLaunch =
          failureCoverageFrom <= BigInt(manifest.launch.blockNumber) &&
          fromBlock <= BigInt(manifest.launch.blockNumber);
        const initialStateBase =
          statePrior?.windowInitialTrackAttemptState ??
          (startsAtLaunch
            ? freshTrackAttemptState()
            : unknownTrackAttemptState());
        if (statePrior === undefined) return initialStateBase;
        if (
          statePrior.failureScanTruncatedAt !== undefined &&
          fromBlock > statePrior.failureScanTruncatedAt
        ) {
          return applyTrackAttempts(
            unknownTrackAttemptState(),
            allAttempts.filter(
              (event) =>
                event.blockNumber > statePrior.failureScanTruncatedAt! &&
                event.blockNumber < fromBlock,
            ),
          );
        }
        return applyTrackAttempts(
          initialStateBase,
          allAttempts.filter(
            (event) =>
              event.blockNumber >= statePrior.fromBlock &&
              event.blockNumber < fromBlock,
          ),
        );
      };
      const windowInitialTrackAttemptState = deriveWindowInitialState();
      const windowAttempts = allAttempts.filter(
        (event) => event.blockNumber >= fromBlock,
      );
      const stateAtWindowStart =
        failureScanTruncatedAt === undefined
          ? windowInitialTrackAttemptState
          : unknownTrackAttemptState();
      const reliableWindowAttempts = windowAttempts.filter((event) => {
        const beyondCoverageStart = event.blockNumber >= failureCoverageFrom;
        const beyondTruncation =
          failureScanTruncatedAt === undefined ||
          event.blockNumber > failureScanTruncatedAt;
        return beyondCoverageStart && beyondTruncation;
      });
      const trackAttemptState = applyTrackAttempts(
        stateAtWindowStart,
        reliableWindowAttempts,
      );
      const windowSuccessful = successful.filter(
        (event) => event.blockNumber >= fromBlock,
      );
      const windowFailed = failed.filter(
        (event) => event.blockNumber >= fromBlock,
      );
      operationalCache = {
        fromBlock,
        throughBlock: toBlock,
        successful: windowSuccessful,
        failed: windowFailed,
        failureCoverageFrom,
        windowInitialTrackAttemptState,
        ...(failureScanTruncatedAt === undefined
          ? {}
          : { failureScanTruncatedAt }),
        ...(claimScanTruncatedAt === undefined ? {} : { claimScanTruncatedAt }),
      };
      const classified = classifyTrackAttempts(
        [...windowSuccessful, ...windowFailed],
        identity,
        {
          fromBlock: failureCoverageFrom,
          completeFromStart:
            failureCoverageFrom <= BigInt(manifest.launch.blockNumber),
          truncated: failureScanTruncatedAt !== undefined,
          ...(failureScanTruncatedAt === undefined
            ? {}
            : { truncatedAt: failureScanTruncatedAt }),
          initialTrackState: windowInitialTrackAttemptState,
        },
      );
      const coverageFor = (track: 1 | 2 | 3 | 4) =>
        trackAttemptState[track] === "unknown"
          ? ("partial" as const)
          : ("complete" as const);
      return {
        events: retainOperationalSummaryEvents(classified, limit),
        trackAttemptCoverage: {
          1: coverageFor(1),
          2: coverageFor(2),
          3: coverageFor(3),
          4: coverageFor(4),
        },
        trackAttemptState: {
          1: trackAttemptState[1],
          2: trackAttemptState[2],
          3: trackAttemptState[3],
          4: trackAttemptState[4],
        },
        failureScanTruncated: failureScanTruncatedAt !== undefined,
        claimScanTruncated: claimScanTruncatedAt !== undefined,
        eventWindowTruncated,
      };
    };
    return finalizeOperationalWindow();
  };
  return recentOperationalEvents;
};

export const makeViemProtocolTransport = (
  client: PublicClient,
  manifest: ProtocolDeploymentManifest,
  identity: IdentityConfiguration,
  quoteCaller: Address = publicQuoteCaller,
  options: { readonly scanFailedTransactions?: boolean } = {},
): ProtocolReadTransport => {
  if (identity.key !== manifest.identity.key) {
    throw new RangeError(
      createIdentityProtocolCopy(identity).transactions.identityMismatch(
        identity.key,
        manifest.identity.key,
      ),
    );
  }
  const contracts = createProtocolContracts(manifest);
  const runLogRead = createTaskLimiter(OPERATION_LOG_CONCURRENCY);
  const readMany = async <
    const Requests extends readonly ContractReadRequest[],
  >(
    requests: Requests,
    blockNumber: bigint,
  ): Promise<ContractReadResults<Requests>> => {
    const calls = requests.map((request) => {
      const contract = contracts[request.contract];
      return {
        address: contract.address,
        abi: contract.abi,
        functionName: request.functionName,
        args: request.args,
      };
    });
    const mappedResults: ContractReadResult[] = [];
    for (
      let offset = 0;
      offset < calls.length;
      offset += MULTICALL_READ_BATCH
    ) {
      const callBatch = calls.slice(offset, offset + MULTICALL_READ_BATCH);
      const requestBatch = requests.slice(
        offset,
        offset + MULTICALL_READ_BATCH,
      );
      const results = (await client.multicall({
        allowFailure: true,
        blockNumber,
        contracts: callBatch,
      } as never)) as unknown as Array<
        | { status: "success"; result: unknown }
        | { status: "failure"; error: unknown }
      >;
      requestBatch.forEach((_request, index) => {
        const result = results[index];
        mappedResults.push(
          result === undefined
            ? {
                status: "failure",
                error: new Error(
                  "Multicall result missing for requested contract read",
                ),
              }
            : result.status === "success"
              ? { status: "success", value: result.result }
              : { status: "failure", error: result.error },
        );
      });
    }

    for (let attempt = 1; attempt < MULTICALL_READ_ATTEMPTS; attempt += 1) {
      const failedIndexes = mappedResults.flatMap((result, index) =>
        result.status === "failure" ? [index] : [],
      );
      if (failedIndexes.length === 0) break;

      for (
        let offset = 0;
        offset < failedIndexes.length;
        offset += MULTICALL_RETRY_BATCH
      ) {
        const retryIndexes = failedIndexes.slice(
          offset,
          offset + MULTICALL_RETRY_BATCH,
        );
        const results = (await client.multicall({
          allowFailure: true,
          blockNumber,
          contracts: retryIndexes.map((index) => calls[index]),
        } as never)) as unknown as Array<
          | { status: "success"; result: unknown }
          | { status: "failure"; error: unknown }
        >;
        retryIndexes.forEach((requestIndex, retryIndex) => {
          const result = results[retryIndex];
          mappedResults[requestIndex] =
            result === undefined
              ? {
                  status: "failure",
                  error: new Error(
                    "Multicall result missing for requested contract read",
                  ),
                }
              : result.status === "success"
                ? { status: "success", value: result.result }
                : { status: "failure", error: result.error };
        });
      }
    }
    return mappedResults as ContractReadResults<Requests>;
  };

  const permanentIdentityIds = async (
    owner: Address,
    candidates: readonly number[],
    blockNumber: bigint,
  ) => {
    if (
      candidates.length > 4_444 ||
      candidates.some((identityId) => identityId < 1 || identityId > 4_444)
    ) {
      throw new RangeError("Permanent identity candidate set is out of bounds");
    }
    const states = await readMany(
      candidates.flatMap((identityId) => [
        {
          contract: "fuelMirror" as const,
          functionName: "ownerOf" as const,
          args: [BigInt(identityId)] as const,
        },
        {
          contract: "fuelCore" as const,
          functionName: "isPermanentIdentity" as const,
          args: [identityId] as const,
        },
      ]),
      blockNumber,
    );
    const failedState = states.find((state) => state?.status === "failure");
    if (failedState?.status === "failure") throw failedState.error;
    return candidates.filter((_identityId, index) => {
      const ownerState = states[index * 2];
      const permanentState = states[index * 2 + 1];
      return (
        ownerState?.status === "success" &&
        typeof ownerState.value === "string" &&
        ownerState.value.toLowerCase() === owner.toLowerCase() &&
        permanentState?.status === "success" &&
        permanentState.value === true
      );
    });
  };

  const recentOperationalEvents = createOperationalEventScanner({
    client,
    contracts,
    identity,
    manifest,
    readMany,
    runLogRead,
    scanFailedTransactions: options.scanFailedTransactions ?? true,
  });
  const rewardHistory = createRewardHistoryScanner({
    client,
    contracts,
    runLogRead,
  });

  return {
    getChainId: () => client.getChainId(),
    getBlock: async (blockNumber) => {
      const block =
        blockNumber === undefined
          ? await client.getBlock()
          : await client.getBlock({ blockNumber });
      if (block.hash === null) {
        throw new Error("Canonical block hash is unavailable");
      }
      return {
        hash: block.hash,
        number: block.number,
        timestamp: block.timestamp,
      };
    },
    getBytecode: (address, blockNumber) =>
      client.getCode({ address, blockNumber }),
    readMany,
    permanentIdentityIds,
    quoteExactInput: async (
      liquidTokenForWeth,
      amountIn,
      blockNumber,
      caller,
    ) => {
      const simulation = await client.simulateContract({
        account: caller ?? quoteCaller,
        address: contracts.canonicalRouter.address,
        abi: contracts.canonicalRouter.abi,
        functionName: "quoteExactInput",
        args: [liquidTokenForWeth, amountIn],
        blockNumber,
      } as never);
      return simulation.result as unknown as readonly [bigint, bigint];
    },
    quoteConversionHop: async (tokenIn, tokenOut, amountIn, blockNumber) => {
      const simulation = await client.simulateContract({
        account: quoteCaller,
        address: contracts.testConversionVenue.address,
        abi: contracts.testConversionVenue.abi,
        functionName: "quoteExactInput",
        args: [tokenIn, tokenOut, amountIn],
        blockNumber,
      } as never);
      return simulation.result as unknown as bigint;
    },
    canonicalMarketState: async (poolId, blockNumber) => {
      const stateSlot = BigInt(
        keccak256(
          encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }],
            [poolId, 6n],
          ),
        ),
      );
      const [slot0, liquidityWord] = await Promise.all([
        client.readContract({
          address: contracts.uniswapV4PoolManager.address,
          abi: contracts.uniswapV4PoolManager.abi,
          functionName: "extsload",
          args: [toHex(stateSlot, { size: 32 })],
          blockNumber,
        } as never),
        client.readContract({
          address: contracts.uniswapV4PoolManager.address,
          abi: contracts.uniswapV4PoolManager.abi,
          functionName: "extsload",
          args: [toHex(stateSlot + 3n, { size: 32 })],
          blockNumber,
        } as never),
      ]);
      const packed = BigInt(slot0 as `0x${string}`);
      const rawTick = Number((packed >> 160n) & 0xff_ffffn);
      return {
        sqrtPriceX96: packed & ((1n << 160n) - 1n),
        tick: rawTick >= 0x80_0000 ? rawTick - 0x100_0000 : rawTick,
        protocolFee: Number((packed >> 184n) & 0xff_ffffn),
        lpFee: Number((packed >> 208n) & 0xff_ffffn),
        activeLiquidity:
          BigInt(liquidityWord as `0x${string}`) & ((1n << 128n) - 1n),
      };
    },
    recentOperationalEvents,
    rewardHistory,
  };
};
