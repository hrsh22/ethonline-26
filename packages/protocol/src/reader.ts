import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import {
  formatUnits,
  keccak256,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  type Hex,
} from "viem";

import {
  createProtocolContracts,
  type ProtocolAbi,
  type ProtocolContractName,
} from "./contracts.js";
import {
  CANONICAL_MARKET_TOKEN_DECIMALS,
  deriveCanonicalMarketPrice,
  deriveCollectibleSnapshot,
  deriveLiquidTokenTransferMutationCapacity,
  deriveWalletSnapshot,
  validateMarketDiscoveryEvidence,
  type CollectibleSnapshot,
  type IdentityAttributes,
  type MarketDiscoveryEvidence,
  type WalletSnapshotInput,
} from "./domain.js";
import type {
  DiscoveryBatchObservation,
  DiscoveryRequestState,
} from "./discovery.js";
import {
  isUnknownIdentityRevert,
  normalizeProtocolError,
  type DomainProtocolError,
} from "./errors.js";
import {
  summarizeOperationalEvents,
  summarizeTrackOutcomes,
} from "./events.js";
import { deriveProtocolHealth, type ProtocolHealthInput } from "./health.js";
import type {
  PermanentIdentityCandidateWindow,
  ProtocolHistoryReader,
} from "./history.js";
import {
  DEFAULT_MINIMUM_OUTPUT_BPS,
  MINIMUM_REWARD_EPOCH_INTERVAL,
  minimumOutputFromQuote,
} from "./operator-policy.js";
import { createProtocolTransactionPreparer } from "./transactions.js";

type ReadFunctionName<Name extends ProtocolContractName> = ContractFunctionName<
  ProtocolAbi<Name>,
  "pure" | "view"
>;

type ReadArguments<
  Name extends ProtocolContractName,
  FunctionName extends ReadFunctionName<Name>,
> = ContractFunctionArgs<ProtocolAbi<Name>, "pure" | "view", FunctionName>;

type ContractReadRequestFor<Name extends ProtocolContractName> = {
  [FunctionName in ReadFunctionName<Name>]: {
    contract: Name;
    functionName: FunctionName;
  } & (ReadArguments<Name, FunctionName> extends readonly []
    ? { args?: ReadArguments<Name, FunctionName> }
    : { args: ReadArguments<Name, FunctionName> });
}[ReadFunctionName<Name>];

export type ContractReadRequest = {
  [Name in ProtocolContractName]: ContractReadRequestFor<Name>;
}[ProtocolContractName];

export type ContractReadValue<Request extends ContractReadRequest> =
  Request extends {
    contract: infer Name;
    functionName: infer FunctionName;
  }
    ? Name extends ProtocolContractName
      ? FunctionName extends ReadFunctionName<Name>
        ? ContractFunctionReturnType<
            ProtocolAbi<Name>,
            "pure" | "view",
            FunctionName
          >
        : never
      : never
    : never;

export type ContractReadResult<Value = unknown> =
  { status: "success"; value: Value } | { status: "failure"; error: unknown };

export type ContractReadResults<
  Requests extends readonly ContractReadRequest[],
> = {
  readonly [
    Index in keyof Requests
  ]: Requests[Index] extends ContractReadRequest
    ? ContractReadResult<ContractReadValue<Requests[Index]>>
    : never;
};

export type RewardTrack = 1 | 2 | 3 | 4;
type HealthTrack = RewardTrack;
const BYTECODE_READ_CONCURRENCY = 4;
const mapWithConcurrency = async <Item, Result>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item, index: number) => Promise<Result>,
) => {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};
const healthReadDefinition = <
  const Key extends string,
  const Request extends ContractReadRequest,
>(definition: {
  key: Key;
  request: Request;
  fallback: ContractReadValue<Request>;
}) => definition;

type CheckedHealthReadDefinitions<
  Definitions extends readonly {
    key: string;
    request: ContractReadRequest;
    fallback: unknown;
  }[],
> = {
  readonly [Index in keyof Definitions]: Definitions[Index] extends {
    request: infer Request extends ContractReadRequest;
    fallback: infer Fallback;
  }
    ? Fallback extends ContractReadValue<Request>
      ? Definitions[Index]
      : never
    : never;
};

const healthReadDefinitions = <
  const Definitions extends readonly {
    key: string;
    request: ContractReadRequest;
    fallback: unknown;
  }[],
>(
  definitions: Definitions & CheckedHealthReadDefinitions<Definitions>,
) => definitions;

const checkStatus = (passes: boolean) => (passes ? "pass" : "fail");

const observationStatus = (available: boolean) =>
  available ? ("observed" as const) : ("unknown" as const);

const whenAvailable = <Value>(available: boolean, value: Value) =>
  available ? value : undefined;

const formatOptionalUnits = (value: bigint | undefined, decimals: number) =>
  value === undefined ? undefined : formatUnits(value, decimals);

const mapOptional = <Value, Result>(
  value: Value | undefined,
  transform: (value: Value) => Result,
) => (value === undefined ? undefined : transform(value));

export type OperationalEventType =
  | "reward-epoch"
  | "track-execution"
  | "track-execution-unknown"
  | "conversion"
  | "retry"
  | "claim"
  | "pol-execution";

export interface ProtocolLiquidityGrowthObservation {
  cycleNumber: bigint;
  pulledWeth: bigint;
  consumedWeth: bigint;
  queuedWeth: bigint;
  permanentlyLockedWeth: bigint;
}

export interface RewardEpochObservation {
  epochNumber: bigint;
  openedWeth: bigint;
  equalTrackShare: bigint;
  finalTrackRemainder: bigint;
}

export interface TrackConversionObservation {
  spentWeth: bigint;
  stockReceived: bigint;
  remainingQueue: bigint;
}

export interface OperationalEvent {
  type: OperationalEventType;
  blockNumber: bigint;
  transactionIndex?: number;
  transactionHash: `0x${string}`;
  successful: boolean;
  track?: 1 | 2 | 3 | 4;
  liquidityGrowth?: ProtocolLiquidityGrowthObservation;
  rewardEpoch?: RewardEpochObservation;
  trackConversion?: TrackConversionObservation;
  explanation: string;
}

export type KeeperAttemptEvidenceState =
  "fresh" | "stale" | "incomplete" | "unavailable";

export interface KeeperAttemptEvidence {
  readonly source: "keeper-attempt-journal";
  readonly generation: string | undefined;
  readonly state: KeeperAttemptEvidenceState;
  readonly freshness: {
    readonly observedAt?: bigint;
    readonly recordedAt?: bigint;
    readonly ageSeconds?: bigint;
    readonly maximumAgeSeconds?: bigint;
  };
  readonly coverage: Readonly<Record<1 | 2 | 3 | 4, "complete" | "partial">>;
  readonly tracks: Readonly<
    Record<
      1 | 2 | 3 | 4,
      {
        readonly state: "fresh" | "retryable" | "unknown";
        readonly outcome?:
          | "preparing"
          | "not-required"
          | "simulated"
          | "failed-before-submission"
          | "pending"
          | "succeeded"
          | "reverted"
          | "reorged";
        readonly actionKind?:
          "reward-epoch" | "reward-track" | "protocol-liquidity";
        readonly failureClass?:
          | "quote-unavailable"
          | "preflight-rejected"
          | "submission-rejected"
          | "receipt-unavailable"
          | "execution-reverted"
          | "canonicality-uncertain";
        readonly transactionHash?: `0x${string}`;
        readonly observedBlock?: bigint;
        readonly observedAt?: bigint;
        readonly receipt?: {
          readonly blockNumber: bigint;
          readonly blockHash: `0x${string}`;
          readonly blockTimestamp: bigint;
        };
      }
    >
  >;
}

export interface OperationalEventWindow {
  events: readonly OperationalEvent[];
  trackAttemptCoverage: Readonly<Record<1 | 2 | 3 | 4, "complete" | "partial">>;
  trackAttemptState: Readonly<
    Record<1 | 2 | 3 | 4, "fresh" | "retryable" | "unknown">
  >;
  failureScanTruncated?: boolean;
  claimScanTruncated?: boolean;
  eventWindowTruncated?: boolean;
  keeperAttemptEvidence?: KeeperAttemptEvidence;
}

const unavailableKeeperAttemptEvidence = (): KeeperAttemptEvidence => ({
  source: "keeper-attempt-journal",
  generation: undefined,
  state: "unavailable",
  freshness: {},
  coverage: { 1: "partial", 2: "partial", 3: "partial", 4: "partial" },
  tracks: {
    1: { state: "unknown" },
    2: { state: "unknown" },
    3: { state: "unknown" },
    4: { state: "unknown" },
  },
});

interface RewardHistoryEventBase {
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
  readonly transactionIndex: number;
}

export type RewardHistoryEvent =
  | (RewardHistoryEventBase & {
      readonly type: "reward-epoch";
      readonly epoch: RewardEpochObservation;
    })
  | (RewardHistoryEventBase & {
      readonly type: "track-conversion";
      readonly track: RewardTrack;
      readonly conversion: TrackConversionObservation;
    })
  | (RewardHistoryEventBase & {
      readonly type: "reward-claim";
      readonly track: RewardTrack;
      readonly claim: {
        readonly amount: bigint;
        readonly currentOwner: Address;
        readonly identityId: number;
      };
    });

export interface RewardHistoryWindow {
  readonly events: readonly RewardHistoryEvent[];
  readonly fromBlock: bigint;
  readonly throughBlock: bigint;
  readonly coverage?: "complete" | "partial";
  readonly indexedThroughTime?: bigint;
}

const rewardHistoryTotals = (events: readonly RewardHistoryEvent[]) => {
  const epochNumbers = new Set<bigint>();
  const allocated = [0n, 0n, 0n, 0n];
  const spent = [0n, 0n, 0n, 0n];
  const converted = [0n, 0n, 0n, 0n];
  const claimed = [0n, 0n, 0n, 0n];
  let epochEventCount = 0;
  let epochsReconcile = true;
  for (const event of events) {
    if (event.type === "reward-epoch") {
      epochEventCount += 1;
      epochNumbers.add(event.epoch.epochNumber);
      const equal = event.epoch.equalTrackShare;
      const remainder = event.epoch.finalTrackRemainder;
      epochsReconcile &&= event.epoch.openedWeth === equal * 4n + remainder;
      allocated[0]! += equal;
      allocated[1]! += equal;
      allocated[2]! += equal;
      allocated[3]! += equal + remainder;
    }
    if (event.type === "track-conversion") {
      const index = event.track - 1;
      spent[index]! += event.conversion.spentWeth;
      converted[index]! += event.conversion.stockReceived;
    }
    if (event.type === "reward-claim") {
      claimed[event.track - 1]! += event.claim.amount;
    }
  }
  return {
    allocated,
    claimed,
    converted,
    epochEventCount,
    epochNumbers,
    epochsReconcile,
    spent,
  };
};

const rewardHistoryProvesComplete = (
  events: readonly RewardHistoryEvent[],
  epochCount: bigint | undefined,
  balances: readonly (bigint | undefined)[],
  queues: readonly (bigint | undefined)[],
) => {
  if (
    epochCount === undefined ||
    balances.some((value) => value === undefined) ||
    queues.some((value) => value === undefined)
  ) {
    return false;
  }
  const totals = rewardHistoryTotals(events);
  const epochNumbersAreValid = [...totals.epochNumbers].every(
    (epochNumber) => epochNumber >= 1n && epochNumber <= epochCount,
  );
  const queuesReconcile = totals.allocated.every(
    (allocated, index) =>
      allocated === totals.spent[index]! + (queues[index] ?? 0n),
  );
  const balancesReconcile = totals.converted.every((converted, index) => {
    const claimed = totals.claimed[index]!;
    return claimed <= converted && converted - claimed === balances[index];
  });
  return (
    BigInt(totals.epochNumbers.size) === epochCount &&
    BigInt(totals.epochEventCount) === epochCount &&
    epochNumbersAreValid &&
    totals.epochsReconcile &&
    queuesReconcile &&
    balancesReconcile
  );
};

export interface ProtocolReadTransport {
  getChainId(): Promise<number>;
  getBlock(blockNumber?: bigint): Promise<{
    hash: `0x${string}`;
    number: bigint;
    timestamp: bigint;
  }>;
  getBytecode(
    address: Address,
    blockNumber: bigint,
  ): Promise<`0x${string}` | undefined>;
  readMany<const Requests extends readonly ContractReadRequest[]>(
    requests: Requests,
    blockNumber: bigint,
  ): Promise<ContractReadResults<Requests>>;
  permanentIdentityIds(
    owner: Address,
    candidates: readonly number[],
    blockNumber: bigint,
  ): Promise<readonly number[]>;
  permanentIdentityCandidates?(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<PermanentIdentityCandidateWindow>;
  quoteExactInput(
    liquidTokenForWeth: boolean,
    amountIn: bigint,
    blockNumber: bigint,
    caller?: Address,
  ): Promise<readonly [bigint, bigint]>;
  /**
   * Quotes one hop of the sealed conversion route through the configured
   * venue. The reward-track route is WETH to the conversion asset, then the
   * conversion asset to the track's stock token.
   */
  quoteConversionHop?(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    blockNumber: bigint,
  ): Promise<bigint>;
  canonicalMarketState(
    poolId: `0x${string}`,
    blockNumber: bigint,
  ): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    protocolFee: number;
    lpFee: number;
    activeLiquidity: bigint;
  }>;
  recentOperationalEvents(
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
  ): Promise<OperationalEventWindow>;
  rewardHistory(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RewardHistoryWindow>;
}

export interface RewardTrackQuote {
  readonly observedBlock: bigint;
  readonly quotedOutput: bigint;
  readonly minimumOutput: bigint;
  readonly minimumOutputBps: number;
  readonly wethInput: bigint;
}

export interface ProtocolMarketQuote {
  readonly liquidTokenForWeth: boolean;
  readonly amountIn: bigint;
  readonly amountInFormatted: string;
  readonly amountOut: bigint;
  readonly amountOutFormatted: string;
  readonly tradingFee: bigint;
  readonly tradingFeeFormatted: string;
  readonly observedBlock: bigint;
  readonly expiresAtBlock: bigint;
  readonly tradingFeeBps: number;
  readonly marketLabel: string;
  readonly discovery?: MarketDiscoveryEvidence;
}

export interface WalletBoundProtocolMarketQuote extends ProtocolMarketQuote {
  readonly discovery: MarketDiscoveryEvidence;
}

/**
 * One identity read directly from the chain.
 *
 * An identity that has never been drawn has no owner, and the mirror says so
 * by reverting. That is an observation about the collection, not a failed
 * read, so it is its own result rather than a thrown query error: 4,428 of the
 * 4,444 identity pages were reporting an unreachable "retry" state for it.
 */
export interface DiscoveredCollectibleRead {
  readonly status: "discovered";
  readonly collectible: CollectibleSnapshot;
  readonly identityId: number;
  readonly observedAt: number;
  readonly observedBlock: bigint;
  readonly owner: Address;
  readonly partialFailures: readonly string[];
  readonly permanent: boolean;
}

export interface UndiscoveredCollectibleRead {
  readonly status: "not-discovered";
  readonly identityId: number;
  readonly observedAt: number;
  readonly observedBlock: bigint;
  readonly partialFailures: readonly string[];
}

export type CollectibleRead =
  DiscoveredCollectibleRead | UndiscoveredCollectibleRead;

export class ProtocolQueryError extends Error {
  override readonly name = "ProtocolQueryError";

  constructor(
    readonly operation: string,
    readonly domainError: DomainProtocolError,
  ) {
    super(domainError.message);
  }
}

const successful = <Value>(
  result: ContractReadResult | undefined,
  operation: string,
  identity: IdentityConfiguration,
): Value => {
  if (result?.status !== "success") {
    throw new ProtocolQueryError(
      operation,
      normalizeProtocolError(
        result?.status === "failure" ? result.error : undefined,
        identity,
      ),
    );
  }
  return result.value as Value;
};

const failureFor = (
  result: ContractReadResult | undefined,
  operation: string,
  identity: IdentityConfiguration,
): string | undefined => {
  if (result === undefined) {
    return createIdentityProtocolCopy(identity).reader.missingRpcResult(
      operation,
    );
  }
  return result.status === "failure"
    ? `${operation}: ${normalizeProtocolError(result.error, identity).message}`
    : undefined;
};

const executeRead = async <Value>(
  operation: string,
  read: () => Promise<Value>,
  identity: IdentityConfiguration,
): Promise<Value> => {
  try {
    return await read();
  } catch (cause) {
    if (cause instanceof ProtocolQueryError) throw cause;
    throw new ProtocolQueryError(
      operation,
      normalizeProtocolError(cause, identity),
    );
  }
};

const readWithRetry = async <Value>(read: () => Promise<Value>) => {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await read();
    } catch (cause) {
      lastFailure = cause;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }
  }
  throw lastFailure;
};

export interface ProtocolReaderOptions {
  manifest: ProtocolDeploymentManifest;
  identity: IdentityConfiguration;
  transport: ProtocolReadTransport;
  history?: Partial<
    Pick<
      ProtocolHistoryReader,
      | "permanentIdentityCandidates"
      | "recentOperationalEvents"
      | "rewardHistory"
    >
  >;
  maximumQuoteAgeBlocks?: bigint;
  recentEventBlockWindow?: bigint;
  recentEventLimit?: number;
}

export interface ProtocolHealthReadOptions {
  readonly includeOperationalHistory?: boolean;
  readonly includeRewardHistory?: boolean;
}

export const createProtocolReader = ({
  manifest,
  identity,
  transport,
  history,
  // A quote performs several pinned discovery-capacity reads before it reaches
  // the browser. Five Base Sepolia blocks could elapse inside that bounded
  // preflight and make a new quote dead on arrival. The UI still expires this
  // evidence after at most 29 seconds and submission retains its independent
  // deadline and slippage bound.
  maximumQuoteAgeBlocks = 30n,
  recentEventBlockWindow = 50_000n,
  recentEventLimit = 100,
}: ProtocolReaderOptions) => {
  const copy = createIdentityProtocolCopy(identity);
  const operationalHistoryReader = (
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
  ) =>
    history?.recentOperationalEvents === undefined
      ? transport.recentOperationalEvents(fromBlock, toBlock, limit)
      : history.recentOperationalEvents(fromBlock, toBlock, limit);
  const rewardHistoryReader = (fromBlock: bigint, toBlock: bigint) =>
    history?.rewardHistory === undefined
      ? transport.rewardHistory(fromBlock, toBlock)
      : history.rewardHistory(fromBlock, toBlock);
  const indexedPermanentIdentityCandidates =
    history?.permanentIdentityCandidates;
  const transportPermanentIdentityCandidateMethod =
    transport.permanentIdentityCandidates;
  const permanentIdentityCandidateReader =
    indexedPermanentIdentityCandidates !== undefined
      ? (fromBlock: bigint, toBlock: bigint) =>
          indexedPermanentIdentityCandidates.call(history, fromBlock, toBlock)
      : transportPermanentIdentityCandidateMethod === undefined
        ? undefined
        : (fromBlock: bigint, toBlock: bigint) =>
            transportPermanentIdentityCandidateMethod.call(
              transport,
              fromBlock,
              toBlock,
            );
  const contracts = createProtocolContracts(manifest);
  const prepareTransaction = createProtocolTransactionPreparer({
    manifest,
    identity,
    maximumQuoteAgeBlocks,
  });
  const recentFromBlock = (blockNumber: bigint) => {
    const launchBlock = BigInt(manifest.launch.blockNumber);
    const earliestWindowBlock =
      recentEventBlockWindow <= 1n
        ? blockNumber
        : blockNumber - (recentEventBlockWindow - 1n);
    return earliestWindowBlock > launchBlock
      ? earliestWindowBlock
      : launchBlock;
  };

  const readClaimAllowed = async (owner: Address, blockNumber: bigint) => {
    if (manifest.claimPolicy?.mode === "always-allow") return true;
    const result = await executeRead(
      copy.reader.walletSummary,
      () =>
        transport.readMany(
          [
            {
              contract: "claimGate",
              functionName: "isClaimAllowed",
              args: [owner],
            },
          ],
          blockNumber,
        ),
      identity,
    );
    return successful<boolean>(result[0], copy.labels.claimGate, identity);
  };

  const validateCollectibleIdentityId = (identityId: number) => {
    if (!Number.isInteger(identityId) || identityId < 1 || identityId > 4_444) {
      throw new RangeError(copy.reader.identityAttributes(identityId));
    }
  };

  const directPendingRewardEvidence = (
    result: ContractReadResult | undefined,
    identityId: number,
  ) => {
    if (result?.status === "success") {
      return {
        pendingRewards: result.value as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
        ],
        partialFailures: [] as string[],
        unavailablePendingRewardIdentityIds: new Set<number>(),
      };
    }
    const failure = failureFor(
      result,
      copy.reader.identityPendingRewards(identityId),
      identity,
    );
    return {
      pendingRewards: [0n, 0n, 0n, 0n] as const,
      partialFailures: failure === undefined ? [] : [failure],
      unavailablePendingRewardIdentityIds: new Set([identityId]),
    };
  };

  const directRewardActivationEvidence = (
    result: ContractReadResult | undefined,
    identityId: number,
  ) => {
    if (result?.status === "success") {
      return { active: result.value === true, partialFailures: [] as string[] };
    }
    const failure = failureFor(
      result,
      copy.reader.identityRewardActivation(identityId),
      identity,
    );
    return {
      active: false,
      partialFailures: failure === undefined ? [] : [failure],
    };
  };

  const verifyChain = async () => {
    const actual = await executeRead(
      copy.reader.network,
      () => transport.getChainId(),
      identity,
    );
    if (actual !== manifest.chainId) {
      throw new ProtocolQueryError(copy.reader.network, {
        code: "wrong-chain",
        message: copy.transactions.wrongChainObserved(manifest.chainId, actual),
      });
    }
    return actual;
  };

  const readWallet = async (owner: Address) => {
    await verifyChain();
    const latestBlock = await executeRead(
      copy.reader.walletBlock,
      () => transport.getBlock(),
      identity,
    );
    const launchBlock = BigInt(manifest.launch.blockNumber);
    const candidateWindow = await readWithRetry(async () => {
      if (permanentIdentityCandidateReader === undefined) {
        throw new Error("Indexed permanent identity history is unavailable");
      }
      const window = await permanentIdentityCandidateReader(
        launchBlock,
        latestBlock.number,
      );
      if (
        window.fromBlock !== launchBlock ||
        window.throughBlock < launchBlock ||
        window.throughBlock > latestBlock.number ||
        window.indexedThroughTime === undefined
      ) {
        throw new Error("Indexed permanent identity coverage is invalid");
      }
      return {
        ...window,
        indexedThroughTime: window.indexedThroughTime,
      };
    }).then(
      (window) => ({ status: "complete" as const, window }),
      (cause: unknown) => ({
        failure: `${copy.reader.walletPermanentCollectibles}: ${normalizeProtocolError(cause, identity).message}`,
        status: "unavailable" as const,
      }),
    );
    const block =
      candidateWindow.status === "complete"
        ? {
            number: candidateWindow.window.throughBlock,
            timestamp: candidateWindow.window.indexedThroughTime,
          }
        : latestBlock;
    const [base, claimGateAllows] = await Promise.all([
      executeRead(
        copy.reader.walletSummary,
        () =>
          transport.readMany(
            [
              {
                contract: "fuelCore",
                functionName: "balanceOf",
                args: [owner],
              },
              { contract: "weth", functionName: "balanceOf", args: [owner] },
              {
                contract: "fuelCore",
                functionName: "transientCount",
                args: [owner],
              },
              {
                contract: "fuelCore",
                functionName: "pendingDiscoveryCount",
                args: [owner],
              },
            ],
            block.number,
          ),
        identity,
      ),
      readClaimAllowed(owner, block.number),
    ]);
    const liquidBalanceWei = successful<bigint>(
      base[0],
      identity.liquidToken.displayName,
      identity,
    );
    const settlementBalanceWei = successful<bigint>(
      base[1],
      identity.terms.settlementAsset,
      identity,
    );
    const transientCount = Number(
      successful<bigint>(
        base[2],
        identity.terms.transientCollectible,
        identity,
      ),
    );
    const pendingDiscoveryCount = Number(
      successful<bigint>(base[3], identity.terms.pendingDiscovery, identity),
    );
    let pendingDiscoveryBatch: DiscoveryBatchObservation | undefined;
    let pendingDiscoveryFailure: string | undefined;
    if (pendingDiscoveryCount > 0) {
      try {
        const [pendingRequestResult] = await executeRead(
          copy.reader.walletCollectibles,
          () =>
            transport.readMany(
              [
                {
                  contract: "fuelCore",
                  functionName: "pendingDiscoveryAt",
                  args: [owner, 0n],
                },
              ],
              block.number,
            ),
          identity,
        );
        const protocolRequestId = successful<Hex>(
          pendingRequestResult,
          identity.terms.pendingDiscovery,
          identity,
        );
        const [vrfRequestResult] = await executeRead(
          copy.reader.walletCollectibles,
          () =>
            transport.readMany(
              [
                {
                  contract: "discoveryAdapter",
                  functionName: "vrfRequestForProtocolRequest",
                  args: [protocolRequestId],
                },
              ],
              block.number,
            ),
          identity,
        );
        const vrfRequestId = successful<bigint>(
          vrfRequestResult,
          identity.terms.pendingDiscovery,
          identity,
        );
        const [statusResult, delayedResult, sequenceResult] = await executeRead(
          copy.reader.walletCollectibles,
          () =>
            transport.readMany(
              [
                {
                  contract: "discoveryAdapter",
                  functionName: "requestStatus",
                  args: [vrfRequestId],
                },
                {
                  contract: "discoveryAdapter",
                  functionName: "isDelayed",
                  args: [vrfRequestId],
                },
                {
                  contract: "discoveryAdapter",
                  functionName: "requestSequence",
                  args: [vrfRequestId],
                },
              ],
              block.number,
            ),
          identity,
        );
        const [
          rawState,
          requestedAt,
          fulfilledAt,
          count,
          finalizedCount,
          delayReported,
        ] = successful<
          readonly [number, bigint, bigint, bigint, bigint, boolean]
        >(statusResult, identity.terms.pendingDiscovery, identity);
        const states: Readonly<
          Record<number, DiscoveryRequestState | undefined>
        > = {
          1: "awaiting-randomness",
          2: "ready",
          3: "finalized",
        };
        const state = states[rawState];
        if (state === undefined) {
          throw new TypeError(`Unknown discovery request state ${rawState}`);
        }
        pendingDiscoveryBatch = {
          vrfRequestId,
          sequence: successful<bigint>(
            sequenceResult,
            identity.terms.pendingDiscovery,
            identity,
          ),
          state,
          requestedAt,
          fulfilledAt: fulfilledAt === 0n ? undefined : fulfilledAt,
          count: Number(count),
          finalizedCount: Number(finalizedCount),
          delayReported,
          delayed: successful<boolean>(
            delayedResult,
            identity.terms.pendingDiscovery,
            identity,
          ),
          // Wallet reads sample one pending protocol request. The operator
          // independently verifies every request before skipping a batch.
          fullyCancelled: false,
        };
      } catch (cause) {
        pendingDiscoveryFailure = `${identity.terms.pendingDiscovery}: ${normalizeProtocolError(cause, identity).message}`;
      }
    }
    const transientReads = Array.from(
      { length: transientCount },
      (_, index) =>
        ({
          contract: "fuelCore",
          functionName: "transientIdentityAt",
          args: [owner, BigInt(index)],
        }) as const satisfies ContractReadRequest,
    );
    const transientResults = await executeRead(
      copy.reader.walletCollectibles,
      () => transport.readMany(transientReads, block.number),
      identity,
    );
    const transientIdentityIds = transientResults.map((result, index) =>
      Number(
        successful<bigint>(
          result,
          `${identity.terms.transientCollectible} ${index}`,
          identity,
        ),
      ),
    );
    const permanentHoldings =
      candidateWindow.status === "unavailable"
        ? {
            failure: candidateWindow.failure,
            identityIds: [] as number[],
            status: "unavailable" as const,
          }
        : await readWithRetry(() =>
            transport.permanentIdentityIds(
              owner,
              candidateWindow.window.identityIds,
              block.number,
            ),
          ).then(
            (identityIds) => ({
              identityIds: [...identityIds],
              status: "complete" as const,
            }),
            (cause: unknown) => ({
              failure: `${copy.reader.walletPermanentCollectibles}: ${normalizeProtocolError(cause, identity).message}`,
              identityIds: [] as number[],
              status: "unavailable" as const,
            }),
          );
    const permanentIdentityIds = permanentHoldings.identityIds;
    const allIdentityIds = [...transientIdentityIds, ...permanentIdentityIds];
    const detailReads = allIdentityIds.flatMap(
      (identityId): ContractReadRequest[] => [
        {
          contract: "attributeRegistry",
          functionName: "attributeOf",
          args: [identityId],
        },
        {
          contract: "rewardLedger",
          functionName: "pendingAll",
          args: [identityId],
        },
        {
          contract: "rewardLedger",
          functionName: "isActive",
          args: [identityId],
        },
      ],
    );
    const detailResults = await executeRead(
      copy.reader.walletCollectibleDetails,
      () => transport.readMany(detailReads, block.number),
      identity,
    );
    const attributesByIdentity: Record<number, IdentityAttributes> = {};
    const pendingRewardsByIdentity: WalletSnapshotInput["pendingRewardsByIdentity"] =
      {};
    const partialFailures: string[] = [
      ...(pendingDiscoveryFailure === undefined
        ? []
        : [pendingDiscoveryFailure]),
      ...("failure" in permanentHoldings ? [permanentHoldings.failure] : []),
    ];
    const unavailablePendingRewardIdentityIds = new Set<number>();
    allIdentityIds.forEach((identityId, index) => {
      const attributeResult = detailResults[index * 3];
      const [track, tier, weightHundredths, specialKind] = successful<
        readonly [number, number, number, number]
      >(attributeResult, copy.reader.identityAttributes(identityId), identity);
      attributesByIdentity[identityId] = {
        track,
        tier,
        weightHundredths,
        specialKind,
      };
      const pendingResult = detailResults[index * 3 + 1];
      if (pendingResult?.status === "success") {
        pendingRewardsByIdentity[identityId] = pendingResult.value as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
        ];
      } else {
        // The substituted zeros are not an observation. Record the identity so
        // the snapshot can say "unavailable" instead of "no rewards".
        pendingRewardsByIdentity[identityId] = [0n, 0n, 0n, 0n];
        unavailablePendingRewardIdentityIds.add(identityId);
        const failure = failureFor(
          pendingResult,
          copy.reader.identityPendingRewards(identityId),
          identity,
        );
        if (failure !== undefined) partialFailures.push(failure);
      }
    });
    const claimableIdentityIds = new Set<number>();
    permanentIdentityIds.forEach((identityId) => {
      const detailIndex = allIdentityIds.indexOf(identityId);
      const activeResult = detailResults[detailIndex * 3 + 2];
      if (activeResult?.status === "success") {
        if (claimGateAllows && activeResult.value === true) {
          claimableIdentityIds.add(identityId);
        }
      } else {
        const failure = failureFor(
          activeResult,
          copy.reader.identityRewardActivation(identityId),
          identity,
        );
        if (failure !== undefined) partialFailures.push(failure);
      }
    });
    const snapshot = deriveWalletSnapshot(
      {
        liquidBalanceWei,
        settlementBalanceWei,
        transientIdentityIds,
        permanentIdentityIds,
        permanentHoldingsStatus: permanentHoldings.status,
        pendingDiscoveryCount,
        ...(pendingDiscoveryBatch === undefined
          ? {}
          : { pendingDiscoveryBatch }),
        attributesByIdentity,
        pendingRewardsByIdentity,
        unavailablePendingRewardIdentityIds,
        claimableIdentityIds,
      },
      identity,
    );
    return {
      ...snapshot,
      observedBlock: block.number,
      observedAt: Number(block.timestamp),
      partialFailures,
    };
  };

  const readCollectible = async (
    identityId: number,
  ): Promise<CollectibleRead> => {
    validateCollectibleIdentityId(identityId);
    await verifyChain();
    const block = await executeRead(
      copy.reader.walletBlock,
      () => transport.getBlock(),
      identity,
    );
    const results = await executeRead(
      copy.reader.walletCollectibleDetails,
      () =>
        transport.readMany(
          [
            {
              contract: "fuelMirror",
              functionName: "ownerOf",
              args: [BigInt(identityId)],
            },
            {
              contract: "fuelCore",
              functionName: "isPermanentIdentity",
              args: [identityId],
            },
            {
              contract: "attributeRegistry",
              functionName: "attributeOf",
              args: [identityId],
            },
            {
              contract: "rewardLedger",
              functionName: "pendingAll",
              args: [identityId],
            },
            {
              contract: "rewardLedger",
              functionName: "isActive",
              args: [identityId],
            },
          ],
          block.number,
        ),
      identity,
    );
    const ownerResult = results[0];
    // A revert naming this exact identity is the mirror reporting that the
    // identity is still in the available pool. Any other failure -- including
    // a transport failure -- stays a failure.
    if (
      ownerResult?.status === "failure" &&
      isUnknownIdentityRevert(ownerResult.error, identityId)
    ) {
      return {
        status: "not-discovered",
        identityId,
        observedAt: Number(block.timestamp),
        observedBlock: block.number,
        partialFailures: [],
      };
    }
    const owner = successful<Address>(
      ownerResult,
      copy.reader.identityAttributes(identityId),
      identity,
    );
    const permanent = successful<boolean>(
      results[1],
      copy.reader.identityAttributes(identityId),
      identity,
    );
    const [track, tier, weightHundredths, specialKind] = successful<
      readonly [number, number, number, number]
    >(results[2], copy.reader.identityAttributes(identityId), identity);
    const pending = directPendingRewardEvidence(results[3], identityId);
    const activation = directRewardActivationEvidence(results[4], identityId);
    const partialFailures = [
      ...pending.partialFailures,
      ...activation.partialFailures,
    ];
    const claimAllowed =
      permanent && activation.active
        ? await readClaimAllowed(owner, block.number)
        : false;
    const snapshotInput: WalletSnapshotInput = {
      liquidBalanceWei: 0n,
      settlementBalanceWei: 0n,
      transientIdentityIds: permanent ? [] : [identityId],
      permanentIdentityIds: permanent ? [identityId] : [],
      permanentHoldingsStatus: "complete",
      pendingDiscoveryCount: 0,
      attributesByIdentity: {
        [identityId]: { track, tier, weightHundredths, specialKind },
      },
      pendingRewardsByIdentity: { [identityId]: pending.pendingRewards },
      unavailablePendingRewardIdentityIds:
        pending.unavailablePendingRewardIdentityIds,
      claimableIdentityIds: claimAllowed ? new Set([identityId]) : new Set(),
    };
    return {
      status: "discovered",
      collectible: deriveCollectibleSnapshot(
        snapshotInput,
        identity,
        identityId,
        permanent,
      ),
      identityId,
      observedAt: Number(block.timestamp),
      observedBlock: block.number,
      owner,
      partialFailures,
      permanent,
    };
  };

  async function quoteExactInput(
    liquidTokenForWeth: boolean,
    amountIn: bigint,
  ): Promise<ProtocolMarketQuote>;
  async function quoteExactInput(
    liquidTokenForWeth: boolean,
    amountIn: bigint,
    account: Address,
  ): Promise<WalletBoundProtocolMarketQuote>;
  async function quoteExactInput(
    liquidTokenForWeth: boolean,
    amountIn: bigint,
    account?: Address,
  ): Promise<ProtocolMarketQuote> {
    await verifyChain();
    const block = await executeRead(
      copy.reader.quoteBlock,
      () => transport.getBlock(),
      identity,
    );
    const quotePromise = executeRead(
      `${copy.labels.market} quote`,
      () =>
        transport.quoteExactInput(
          liquidTokenForWeth,
          amountIn,
          block.number,
          account,
        ),
      identity,
    );
    const marketManager = contracts.uniswapV4PoolManager.address;
    const senderAccount = liquidTokenForWeth ? account : marketManager;
    const recipientAccount = liquidTokenForWeth ? marketManager : account;
    const transferStatePromise =
      account === undefined
        ? undefined
        : executeRead(
            copy.reader.walletSummary,
            () =>
              transport.readMany(
                [
                  {
                    contract: "fuelCore",
                    functionName: "balanceOf",
                    args: [senderAccount!],
                  },
                  {
                    contract: "fuelCore",
                    functionName: "isDiscoveryExempt",
                    args: [senderAccount!],
                  },
                  {
                    contract: "fuelCore",
                    functionName: "balanceOf",
                    args: [recipientAccount!],
                  },
                  {
                    contract: "fuelCore",
                    functionName: "isDiscoveryExempt",
                    args: [recipientAccount!],
                  },
                  {
                    contract: "fuelCore",
                    functionName: "pendingDiscoveryCount",
                    args: [account],
                  },
                  {
                    contract: "fuelCore",
                    functionName: "transientCount",
                    args: [account],
                  },
                ],
                block.number,
              ),
            identity,
          );
    const [[amountOut, tradingFee], transferStateResults] = await Promise.all([
      quotePromise,
      transferStatePromise,
    ]);
    await executeRead(
      copy.reader.quoteBlock,
      async () => {
        const revalidated = await transport.getBlock(block.number);
        if (
          revalidated.number !== block.number ||
          revalidated.timestamp !== block.timestamp ||
          revalidated.hash.toLowerCase() !== block.hash.toLowerCase()
        ) {
          throw new Error("Canonical Market quote block identity changed");
        }
      },
      identity,
    );
    const discovery =
      account === undefined ||
      senderAccount === undefined ||
      recipientAccount === undefined ||
      transferStateResults === undefined
        ? undefined
        : (() => {
            try {
              const sender = {
                account: senderAccount,
                balance: successful<bigint>(
                  transferStateResults[0],
                  copy.reader.walletSummary,
                  identity,
                ),
                discoveryExempt: successful<boolean>(
                  transferStateResults[1],
                  copy.reader.walletSummary,
                  identity,
                ),
              };
              const recipient = {
                account: recipientAccount,
                balance: successful<bigint>(
                  transferStateResults[2],
                  copy.reader.walletSummary,
                  identity,
                ),
                discoveryExempt: successful<boolean>(
                  transferStateResults[3],
                  copy.reader.walletSummary,
                  identity,
                ),
              };
              const holdingCount = (index: 4 | 5): number => {
                const raw = successful<unknown>(
                  transferStateResults[index],
                  copy.reader.walletSummary,
                  identity,
                );
                if (typeof raw !== "bigint" || raw < 0n) {
                  throw new RangeError(
                    "Discovery holding count must be a nonnegative bigint",
                  );
                }
                const count = Number(raw);
                if (!Number.isSafeInteger(count)) {
                  throw new RangeError("Discovery holding count is too large");
                }
                return count;
              };
              const liquidTokenAmount = liquidTokenForWeth
                ? amountIn
                : amountOut;
              const capacity = deriveLiquidTokenTransferMutationCapacity({
                sender,
                recipient,
                liquidTokenAmount,
              });
              const evidence = {
                account,
                accountHoldings: {
                  pendingDiscoveryCount: holdingCount(4),
                  transientCollectibleCount: holdingCount(5),
                },
                sender: {
                  ...sender,
                  mutations: capacity.senderMutations,
                },
                recipient: {
                  ...recipient,
                  mutations: capacity.recipientMutations,
                },
                mutations: capacity.mutations,
                maximumMutations: capacity.maximumMutations,
                executable: capacity.executable,
                maximumLiquidTokenAmount: capacity.maximumLiquidTokenAmount,
              } as const;
              return validateMarketDiscoveryEvidence({
                account,
                evidence,
                liquidTokenAmount,
                liquidTokenForWeth,
              }).evidence;
            } catch (cause) {
              if (cause instanceof ProtocolQueryError) throw cause;
              throw new ProtocolQueryError(
                copy.reader.walletSummary,
                normalizeProtocolError(cause, identity),
              );
            }
          })();
    const quote = {
      liquidTokenForWeth,
      amountIn,
      amountInFormatted: formatUnits(amountIn, 18),
      amountOut,
      amountOutFormatted: formatUnits(amountOut, 18),
      tradingFee,
      tradingFeeFormatted: formatUnits(tradingFee, 18),
      observedBlock: block.number,
      expiresAtBlock: block.number + maximumQuoteAgeBlocks,
      tradingFeeBps: 300,
      marketLabel: copy.labels.market,
    } as const;
    return discovery === undefined ? quote : { ...quote, discovery };
  }

  const readExchangeAllowance = async (
    owner: Address,
    liquidTokenForWeth: boolean,
  ) => {
    await verifyChain();
    const block = await executeRead(
      copy.reader.quoteBlock,
      () => transport.getBlock(),
      identity,
    );
    const request: ContractReadRequest = liquidTokenForWeth
      ? {
          contract: "fuelCore",
          functionName: "allowance",
          args: [owner, contracts.canonicalRouter.address],
        }
      : {
          contract: "weth",
          functionName: "allowance",
          args: [owner, contracts.canonicalRouter.address],
        };
    const [result] = await executeRead(
      copy.reader.exchangeAllowance,
      () => transport.readMany([request], block.number),
      identity,
    );
    return {
      amount: successful<bigint>(
        result,
        copy.reader.exchangeAllowance,
        identity,
      ),
      observedBlock: block.number,
    } as const;
  };

  const readRecentOperations = async () => {
    await verifyChain();
    const block = await executeRead(
      copy.reader.operationsBlock,
      () => transport.getBlock(),
      identity,
    );
    const fromBlock = recentFromBlock(block.number);
    return executeRead(
      copy.reader.recentOperations,
      () => operationalHistoryReader(fromBlock, block.number, recentEventLimit),
      identity,
    );
  };

  const readOperationalStatus = async () => {
    const window = await readRecentOperations();
    return {
      events: window.events,
      summary: summarizeOperationalEvents(window.events),
      trackOutcomes: summarizeTrackOutcomes(window.events),
      retryableTracks: ([1, 2, 3, 4] as const).filter(
        (track) => window.trackAttemptState[track] === "retryable",
      ),
      trackAttemptCoverage: window.trackAttemptCoverage,
      trackAttemptState: window.trackAttemptState,
      keeperAttemptEvidence:
        window.keeperAttemptEvidence ?? unavailableKeeperAttemptEvidence(),
      failureScanTruncated: window.failureScanTruncated ?? false,
      claimScanTruncated: window.claimScanTruncated ?? false,
      eventWindowTruncated: window.eventWindowTruncated ?? false,
    } as const;
  };

  const stockContracts = [
    ["mockAaplc", 1],
    ["mockGooglc", 2],
    ["mockMetac", 3],
    ["mockNvdac", 4],
  ] as const;
  const adapterContracts = [
    "aaplcConversionAdapter",
    "googlcConversionAdapter",
    "metacConversionAdapter",
    "nvdacConversionAdapter",
  ] as const;

  const createHealthReadPlan = (connectedWallet: Address | undefined) => {
    const baseDefinitions = healthReadDefinitions([
      {
        key: "liquidSupply",
        request: { contract: "fuelCore", functionName: "totalSupply" },
        fallback: 0n,
      },
      {
        key: "permanentCount",
        request: { contract: "fuelCore", functionName: "permanentCount" },
        fallback: 0,
      },
      {
        key: "transientCount",
        request: {
          contract: "fuelCore",
          functionName: "totalTransientCount",
        },
        fallback: 0,
      },
      {
        key: "pendingCount",
        request: {
          contract: "fuelCore",
          functionName: "totalPendingDiscoveryCount",
        },
        fallback: 0n,
      },
      {
        key: "availableCount",
        request: {
          contract: "fuelCore",
          functionName: "availableIdentityCount",
        },
        fallback: 0,
      },
      {
        key: "fuelOwner",
        request: { contract: "fuelCore", functionName: "owner" },
        fallback: zeroAddress,
      },
      {
        key: "fuelPendingOwner",
        request: { contract: "fuelCore", functionName: "pendingOwner" },
        fallback: zeroAddress,
      },
      {
        key: "guardian",
        request: { contract: "fuelCore", functionName: "guardian" },
        fallback: zeroAddress,
      },
      {
        key: "recovery",
        request: { contract: "fuelCore", functionName: "recoveryAuthority" },
        fallback: zeroAddress,
      },
      {
        key: "fuelLedger",
        request: { contract: "fuelCore", functionName: "rewardLedger" },
        fallback: zeroAddress,
      },
      {
        key: "fuelRegistry",
        request: {
          contract: "fuelCore",
          functionName: "canonicalMarketRegistry",
        },
        fallback: zeroAddress,
      },
      {
        key: "launched",
        request: { contract: "fuelCore", functionName: "launched" },
        fallback: false,
      },
      {
        key: "fuelPaused",
        request: { contract: "fuelCore", functionName: "paused" },
        fallback: true,
      },
      {
        key: "connectedWalletFrozen",
        request: {
          contract: "fuelCore",
          functionName: "isFrozen",
          args: [connectedWallet ?? zeroAddress],
        },
        fallback: false,
      },
      {
        key: "mirrorCore",
        request: { contract: "fuelMirror", functionName: "core" },
        fallback: zeroAddress,
      },
      {
        key: "mirrorMetadata",
        request: { contract: "fuelMirror", functionName: "metadataRenderer" },
        fallback: zeroAddress,
      },
      {
        key: "metadataAttributes",
        request: {
          contract: "metadataRenderer",
          functionName: "attributeRegistry",
        },
        fallback: zeroAddress,
      },
      {
        key: "manifestHash",
        request: {
          contract: "attributeRegistry",
          functionName: "manifestCommitment",
        },
        fallback: zeroHash,
      },
      {
        key: "attributesSealed",
        request: { contract: "attributeRegistry", functionName: "isSealed" },
        fallback: false,
      },
      {
        key: "ledgerOwner",
        request: { contract: "rewardLedger", functionName: "owner" },
        fallback: zeroAddress,
      },
      {
        key: "ledgerPendingOwner",
        request: { contract: "rewardLedger", functionName: "pendingOwner" },
        fallback: zeroAddress,
      },
      {
        key: "ledgerFuel",
        request: { contract: "rewardLedger", functionName: "fuelCore" },
        fallback: zeroAddress,
      },
      {
        key: "ledgerAttributes",
        request: {
          contract: "rewardLedger",
          functionName: "attributeRegistry",
        },
        fallback: zeroAddress,
      },
      {
        key: "ledgerConverter",
        request: { contract: "rewardLedger", functionName: "epochConverter" },
        fallback: zeroAddress,
      },
      {
        key: "ledgerClaimGate",
        request: { contract: "rewardLedger", functionName: "claimGate" },
        fallback: zeroAddress,
      },
      {
        key: "rewardsPaused",
        request: {
          contract: "rewardLedger",
          functionName: "rewardNotificationsPaused",
        },
        fallback: true,
      },
      {
        key: "converterOwner",
        request: { contract: "epochConverter", functionName: "owner" },
        fallback: zeroAddress,
      },
      {
        key: "converterPendingOwner",
        request: { contract: "epochConverter", functionName: "pendingOwner" },
        fallback: zeroAddress,
      },
      {
        key: "converterWeth",
        request: { contract: "epochConverter", functionName: "weth" },
        fallback: zeroAddress,
      },
      {
        key: "converterLedger",
        request: {
          contract: "epochConverter",
          functionName: "rewardLedger",
        },
        fallback: zeroAddress,
      },
      {
        key: "keeper",
        request: { contract: "epochConverter", functionName: "keeper" },
        fallback: zeroAddress,
      },
      {
        key: "converterHook",
        request: {
          contract: "epochConverter",
          functionName: "canonicalFeeHook",
        },
        fallback: zeroAddress,
      },
      {
        key: "routesSealed",
        request: {
          contract: "epochConverter",
          functionName: "configurationSealed",
        },
        fallback: false,
      },
      {
        key: "converterPaused",
        request: { contract: "epochConverter", functionName: "paused" },
        fallback: true,
      },
      {
        key: "epochCount",
        request: {
          contract: "epochConverter",
          functionName: "rewardEpochCount",
        },
        fallback: 0n,
      },
      {
        key: "lastEpoch",
        request: {
          contract: "epochConverter",
          functionName: "lastRewardEpochAt",
        },
        fallback: 0n,
      },
      {
        key: "converterWethBalance",
        request: {
          contract: "weth",
          functionName: "balanceOf",
          args: [contracts.epochConverter.address],
        },
        fallback: 0n,
      },
      {
        key: "marketManager",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "manager",
        },
        fallback: zeroAddress,
      },
      {
        key: "marketFuel",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "fuel",
        },
        fallback: zeroAddress,
      },
      {
        key: "marketWeth",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "weth",
        },
        fallback: zeroAddress,
      },
      {
        key: "marketOwner",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "owner",
        },
        fallback: zeroAddress,
      },
      {
        key: "marketPendingOwner",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "pendingOwner",
        },
        fallback: zeroAddress,
      },
      {
        key: "marketRegistered",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "registered",
        },
        fallback: false,
      },
      {
        key: "marketPoolId",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "poolId",
        },
        fallback: zeroHash,
      },
      {
        key: "marketSealed",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "isSealed",
        },
        fallback: false,
      },
      {
        key: "marketHook",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "hook",
        },
        fallback: zeroAddress,
      },
      {
        key: "marketRouter",
        request: {
          contract: "canonicalMarketRegistry",
          functionName: "router",
        },
        fallback: zeroAddress,
      },
      {
        key: "hookManager",
        request: { contract: "canonicalFeeHook", functionName: "manager" },
        fallback: zeroAddress,
      },
      {
        key: "hookRegistry",
        request: { contract: "canonicalFeeHook", functionName: "registry" },
        fallback: zeroAddress,
      },
      {
        key: "hookWeth",
        request: { contract: "canonicalFeeHook", functionName: "weth" },
        fallback: zeroAddress,
      },
      {
        key: "feeBps",
        request: {
          contract: "canonicalFeeHook",
          functionName: "TOTAL_FEE_BPS",
        },
        fallback: 0n,
      },
      {
        key: "rewardPot",
        request: { contract: "canonicalFeeHook", functionName: "rewardPot" },
        fallback: 0n,
      },
      {
        key: "liquidityPot",
        request: {
          contract: "canonicalFeeHook",
          functionName: "liquidityPot",
        },
        fallback: 0n,
      },
      {
        key: "creatorPot",
        request: { contract: "canonicalFeeHook", functionName: "creatorPot" },
        fallback: 0n,
      },
      {
        key: "hookWethBalance",
        request: {
          contract: "weth",
          functionName: "balanceOf",
          args: [contracts.canonicalFeeHook.address],
        },
        fallback: 0n,
      },
      {
        key: "rewardDestination",
        request: {
          contract: "canonicalFeeHook",
          functionName: "rewardDestination",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityDestination",
        request: {
          contract: "canonicalFeeHook",
          functionName: "liquidityDestination",
        },
        fallback: zeroAddress,
      },
      {
        key: "creatorDestination",
        request: {
          contract: "canonicalFeeHook",
          functionName: "creatorDestination",
        },
        fallback: zeroAddress,
      },
      {
        key: "routerManager",
        request: { contract: "canonicalRouter", functionName: "manager" },
        fallback: zeroAddress,
      },
      {
        key: "routerRegistry",
        request: { contract: "canonicalRouter", functionName: "registry" },
        fallback: zeroAddress,
      },
      {
        key: "routerWeth",
        request: { contract: "canonicalRouter", functionName: "weth" },
        fallback: zeroAddress,
      },
      {
        key: "liquidityOwner",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "owner",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityPendingOwner",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "pendingOwner",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityRegistry",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "registry",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityManager",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "manager",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityFuel",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "fuel",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityWeth",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "weth",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquidityHook",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "canonicalFeeHook",
        },
        fallback: zeroAddress,
      },
      {
        key: "executor",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "executor",
        },
        fallback: zeroAddress,
      },
      {
        key: "liquiditySealed",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "configurationSealed",
        },
        fallback: false,
      },
      {
        key: "liquidityPaused",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "paused",
        },
        fallback: true,
      },
      {
        key: "queuedWeth",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "queuedWeth",
        },
        fallback: 0n,
      },
      {
        key: "liquidityWethBalance",
        request: {
          contract: "weth",
          functionName: "balanceOf",
          args: [contracts.protocolLiquidityVault.address],
        },
        fallback: 0n,
      },
      {
        key: "lockedWeth",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "permanentlyLockedWeth",
        },
        fallback: 0n,
      },
      {
        key: "liquidityCycles",
        request: {
          contract: "protocolLiquidityVault",
          functionName: "liquidityCycleCount",
        },
        fallback: 0n,
      },
      {
        key: "genesisRegistry",
        request: {
          contract: "genesisLiquidityVault",
          functionName: "registry",
        },
        fallback: zeroAddress,
      },
      {
        key: "genesisManager",
        request: {
          contract: "genesisLiquidityVault",
          functionName: "manager",
        },
        fallback: zeroAddress,
      },
      {
        key: "genesisFuel",
        request: {
          contract: "genesisLiquidityVault",
          functionName: "liquidToken",
        },
        fallback: zeroAddress,
      },
      {
        key: "genesisWeth",
        request: {
          contract: "genesisLiquidityVault",
          functionName: "weth",
        },
        fallback: zeroAddress,
      },
      {
        key: "venueManager",
        request: { contract: "testConversionVenue", functionName: "manager" },
        fallback: zeroAddress,
      },
      {
        key: "genesisSeeded",
        request: {
          contract: "genesisLiquidityVault",
          functionName: "seeded",
        },
        fallback: false,
      },
    ] as const);
    const trackDefinitions = ([1, 2, 3, 4] as const).flatMap(
      (track) =>
        [
          healthReadDefinition({
            key: `queue${track}`,
            request: {
              contract: "epochConverter",
              functionName: "trackQueue",
              args: [track],
            },
            fallback: 0n,
          }),
          healthReadDefinition({
            key: `liability${track}`,
            request: {
              contract: "rewardLedger",
              functionName: "totalLiability",
              args: [track],
            },
            fallback: 0n,
          }),
          healthReadDefinition({
            key: `activeWeight${track}`,
            request: {
              contract: "rewardLedger",
              functionName: "totalActiveWeight",
              args: [track],
            },
            fallback: 0n,
          }),
          healthReadDefinition({
            key: `unclaimedTrackPot${track}`,
            request: {
              contract: "rewardLedger",
              functionName: "unclaimedTrackPot",
              args: [track],
            },
            fallback: 0n,
          }),
          healthReadDefinition({
            key: `ledgerToken${track}`,
            request: {
              contract: "rewardLedger",
              functionName: "rewardToken",
              args: [track],
            },
            fallback: zeroAddress,
          }),
          healthReadDefinition({
            key: `trackConfiguration${track}`,
            request: {
              contract: "epochConverter",
              functionName: "trackConfiguration",
              args: [track],
            },
            fallback: [zeroAddress, zeroAddress],
          }),
        ] as const,
    );
    const balanceDefinitions = stockContracts.map(([contract, track]) =>
      healthReadDefinition({
        key: `balance${track}`,
        request: {
          contract,
          functionName: "balanceOf",
          args: [contracts.rewardLedger.address],
        },
        fallback: 0n,
      }),
    );
    const relicDefinitions = ([4_441, 4_442, 4_443, 4_444] as const).map(
      (identityId) =>
        healthReadDefinition({
          key: `relicPending${identityId}`,
          request: {
            contract: "rewardLedger",
            functionName: "pendingAll",
            args: [identityId],
          },
          fallback: [0n, 0n, 0n, 0n],
        }),
    );
    const adapterDefinitions = adapterContracts.flatMap((contract, index) => {
      const track = (index + 1) as HealthTrack;
      return [
        healthReadDefinition({
          key: `adapter${track}Track`,
          request: { contract, functionName: "configuredTrack" },
          fallback: 0,
        }),
        healthReadDefinition({
          key: `adapter${track}Converter`,
          request: { contract, functionName: "converter" },
          fallback: zeroAddress,
        }),
        healthReadDefinition({
          key: `adapter${track}Weth`,
          request: { contract, functionName: "weth" },
          fallback: zeroAddress,
        }),
        healthReadDefinition({
          key: `adapter${track}Usdc`,
          request: { contract, functionName: "usdc" },
          fallback: zeroAddress,
        }),
        healthReadDefinition({
          key: `adapter${track}Stock`,
          request: { contract, functionName: "stockToken" },
          fallback: zeroAddress,
        }),
        healthReadDefinition({
          key: `adapter${track}Ledger`,
          request: { contract, functionName: "rewardLedger" },
          fallback: zeroAddress,
        }),
        healthReadDefinition({
          key: `adapter${track}Venue`,
          request: { contract, functionName: "venue" },
          fallback: zeroAddress,
        }),
        healthReadDefinition({
          key: `adapter${track}WethPool`,
          request: { contract, functionName: "wethUsdcPoolId" },
          fallback: zeroHash,
        }),
        healthReadDefinition({
          key: `adapter${track}StockPool`,
          request: { contract, functionName: "usdcStockPoolId" },
          fallback: zeroHash,
        }),
      ] as const;
    });
    return [
      ...baseDefinitions,
      ...trackDefinitions,
      ...balanceDefinitions,
      ...relicDefinitions,
      ...adapterDefinitions,
    ] as const;
  };

  type HealthReadPlan = ReturnType<typeof createHealthReadPlan>;
  type Definition = HealthReadPlan[number];
  type HealthValueKey = Definition["key"];
  type MatchingDefinition<Candidate, Key> = Candidate extends {
    key: infer CandidateKey;
  }
    ? Key extends CandidateKey
      ? Candidate
      : never
    : never;
  type DefinitionFor<Key extends HealthValueKey> = MatchingDefinition<
    Definition,
    Key
  >;
  type HealthValue<Key extends HealthValueKey> = ContractReadValue<
    DefinitionFor<Key>["request"]
  >;

  const decodeHealthResults = (
    definitions: HealthReadPlan,
    results: readonly ContractReadResult[],
  ) => {
    const rpcFailures: string[] = [];
    const failedKeys = new Set<HealthValueKey>();
    const values = new Map<HealthValueKey, unknown>();
    definitions.forEach((definition, index) => {
      const result = results[index];
      if (result?.status === "success") {
        values.set(definition.key, result.value);
        return;
      }
      values.set(definition.key, definition.fallback);
      failedKeys.add(definition.key);
      rpcFailures.push(
        failureFor(result, copy.reader.protocolHealth, identity) ??
          copy.reader.missingRpcResult(copy.reader.protocolHealth),
      );
    });
    const value = <Key extends HealthValueKey>(key: Key): HealthValue<Key> =>
      values.get(key) as HealthValue<Key>;
    const available = (...keys: HealthValueKey[]) =>
      keys.every((key) => !failedKeys.has(key));
    const observed = <Key extends HealthValueKey>(
      key: Key,
    ): HealthValue<Key> | undefined =>
      available(key) ? value(key) : undefined;
    return { available, observed, rpcFailures, value };
  };

  const unavailableOperationalHistory = (failure?: string) => ({
    available: false as const,
    incomplete: false,
    events: [] as readonly OperationalEvent[],
    failure,
    trackAttemptCoverage: {
      1: "partial",
      2: "partial",
      3: "partial",
      4: "partial",
    } as const,
    trackAttemptState: {
      1: "unknown",
      2: "unknown",
      3: "unknown",
      4: "unknown",
    } as const,
    keeperAttemptEvidence: unavailableKeeperAttemptEvidence(),
  });

  const readHealthOperationalHistory = async (block: {
    readonly number: bigint;
  }) => {
    try {
      const eventWindow = await operationalHistoryReader(
        recentFromBlock(block.number),
        block.number,
        recentEventLimit,
      );
      return {
        available: true,
        incomplete:
          eventWindow.claimScanTruncated === true ||
          eventWindow.eventWindowTruncated === true ||
          // A budget-limited failure scan means reverted operations may be
          // missing from the window; reporting it "observed" presented an
          // incomplete failure record as a complete one.
          eventWindow.failureScanTruncated === true,
        events: eventWindow.events,
        failure: undefined,
        trackAttemptCoverage: eventWindow.trackAttemptCoverage,
        trackAttemptState: eventWindow.trackAttemptState,
        keeperAttemptEvidence:
          eventWindow.keeperAttemptEvidence ??
          unavailableKeeperAttemptEvidence(),
      } as const;
    } catch (cause) {
      return unavailableOperationalHistory(
        `${copy.reader.recentOperations}: ${normalizeProtocolError(cause, identity).message}`,
      );
    }
  };

  const unavailableRewardHistory = (failure?: string) => ({
    available: false as const,
    incomplete: false,
    events: [] as readonly RewardHistoryEvent[],
    failure,
  });

  const readHealthRewardHistory = async (block: {
    readonly number: bigint;
  }) => {
    try {
      const rewardWindow = await rewardHistoryReader(
        BigInt(manifest.launch.blockNumber),
        block.number,
      );
      return {
        available: true,
        incomplete: rewardWindow.coverage === "partial",
        events: rewardWindow.events,
        failure: undefined,
      } as const;
    } catch (cause) {
      return unavailableRewardHistory(
        `${copy.reader.recentOperations}: ${normalizeProtocolError(cause, identity).message}`,
      );
    }
  };

  const assembleHealthSnapshot = async ({
    block,
    connectedWallet,
    currentTime,
    decoded,
    maximumAgeSeconds,
    observedChainId,
    operationalHistory,
    rewardHistory,
  }: {
    readonly block: { readonly number: bigint; readonly timestamp: bigint };
    readonly connectedWallet: Address | undefined;
    readonly currentTime: number;
    readonly decoded: ReturnType<typeof decodeHealthResults>;
    readonly maximumAgeSeconds: number;
    readonly observedChainId: number;
    readonly operationalHistory: Awaited<
      ReturnType<typeof readHealthOperationalHistory>
    >;
    readonly rewardHistory: Awaited<ReturnType<typeof readHealthRewardHistory>>;
  }) => {
    const { available, observed, rpcFailures, value } = decoded;
    if (operationalHistory.failure !== undefined) {
      rpcFailures.push(operationalHistory.failure);
    }
    if (rewardHistory.failure !== undefined) {
      rpcFailures.push(rewardHistory.failure);
    }
    const operationalHistoryAvailable = operationalHistory.available;
    const operationalHistoryIncomplete = operationalHistory.incomplete;
    const recentEvents = operationalHistory.events;
    const rewardHistoryEvents = rewardHistory.events;
    const trackAttemptState = operationalHistory.trackAttemptState;
    const retryableTrackIds = new Set(
      ([1, 2, 3, 4] as const).filter(
        (track) => trackAttemptState[track] === "retryable",
      ),
    );
    const bytecode = await mapWithConcurrency(
      Object.entries(contracts),
      BYTECODE_READ_CONCURRENCY,
      async ([name, contract]) => {
        const displayName =
          copy.reader.contractLabels[
            name as keyof typeof copy.reader.contractLabels
          ];
        try {
          const code = await transport.getBytecode(
            contract.address,
            block.number,
          );
          return {
            name,
            displayName,
            address: contract.address,
            present: code !== undefined && code !== "0x",
            available: true,
          };
        } catch (cause) {
          rpcFailures.push(
            `${copy.reader.bytecodeRead(displayName)}: ${normalizeProtocolError(cause, identity).message}`,
          );
          return {
            name,
            displayName,
            address: contract.address,
            present: false,
            available: false,
          };
        }
      },
    );
    /**
     * Verifies the bound claim policy is the implementation the manifest
     * declared. A deployment that silently binds `always-allow` while claiming
     * to be configurable would make denied eligibility unexercisable, so this
     * compares the deployed codehash against the recorded one.
     */
    const claimPolicyCheck = await (async (): Promise<
      | {
          readonly declared: string;
          readonly mode: string;
          readonly observed: string | undefined;
        }
      | undefined
    > => {
      const policy = manifest.claimPolicy;
      if (policy === undefined) return undefined;
      try {
        const code = await transport.getBytecode(
          contracts.claimGate.address,
          block.number,
        );
        return {
          declared: policy.implementationCodehash,
          mode: policy.mode,
          observed: code === undefined ? undefined : keccak256(code),
        };
      } catch (cause) {
        rpcFailures.push(
          `${copy.reader.claimPolicy}: ${normalizeProtocolError(cause, identity).message}`,
        );
        return {
          declared: policy.implementationCodehash,
          mode: policy.mode,
          observed: undefined,
        };
      }
    })();
    /**
     * Verifies who can administer the configurable gate. The administrator can
     * deny or approve every collector's ability to claim accrued rewards, and
     * the gate is `TwoStepOwnable` like every module -- so its ownership needs
     * the same two observations the modules get: the owner must be the
     * recorded administrator, and no nomination may be outstanding, because
     * whoever holds one takes the gate by accepting it. The always-allow gate
     * has no owner at all, so this only reads when the policy is configurable.
     */
    const claimGateOwnershipCheck = await (async (): Promise<
      | {
          readonly administrator: string;
          readonly owner: string | undefined;
          readonly pendingOwner: string | undefined;
        }
      | undefined
    > => {
      const policy = manifest.claimPolicy;
      if (policy === undefined || policy.mode !== "configurable") {
        return undefined;
      }
      try {
        const results = await transport.readMany(
          [
            { contract: "claimGate", functionName: "owner" },
            { contract: "claimGate", functionName: "pendingOwner" },
          ] as const,
          block.number,
        );
        const observed = (index: number): string | undefined => {
          const result = results[index];
          return result?.status === "success"
            ? (result.value as string)
            : undefined;
        };
        return {
          administrator: policy.administrator,
          owner: observed(0),
          pendingOwner: observed(1),
        };
      } catch (cause) {
        rpcFailures.push(
          `${copy.reader.claimPolicy}: ${normalizeProtocolError(cause, identity).message}`,
        );
        return {
          administrator: policy.administrator,
          owner: undefined,
          pendingOwner: undefined,
        };
      }
    })();
    /**
     * Verifies every venue the manifest says this deployment blocked is still
     * blocked on chain. The blocklist is frozen at launch, so the recorded
     * inventory is final and any drift means the manifest is describing a
     * deployment that does not exist. Reads are batched into one call.
     */
    const blockedVenueChecks_ = await (async (): Promise<
      ReadonlyArray<{
        readonly label: string;
        readonly codehash: string;
        readonly blocked: boolean | undefined;
      }>
    > => {
      const inventory = manifest.blockedVenues ?? [];
      if (inventory.length === 0) return [];
      try {
        const results = await transport.readMany(
          inventory.map(
            (venue) =>
              ({
                contract: "fuelCore",
                functionName: "isBlockedVenueCodehash",
                args: [venue.codehash as Hex],
              }) as const,
          ),
          block.number,
        );
        return inventory.map((venue, index) => ({
          label: venue.label,
          codehash: venue.codehash,
          blocked:
            results[index]?.status === "success"
              ? (results[index]?.value as boolean)
              : undefined,
        }));
      } catch (cause) {
        rpcFailures.push(
          `${copy.reader.protocolHealth}: ${normalizeProtocolError(cause, identity).message}`,
        );
        return inventory.map((venue) => ({
          label: venue.label,
          codehash: venue.codehash,
          blocked: undefined,
        }));
      }
    })();
    const trackNames = [
      identity.rewardTrackLabels[1],
      identity.rewardTrackLabels[2],
      identity.rewardTrackLabels[3],
      identity.rewardTrackLabels[4],
    ] as const;
    const observedRoles = {
      owners: {
        liquidToken: observed("fuelOwner"),
        rewards: observed("ledgerOwner"),
        converter: observed("converterOwner"),
        liquidity: observed("liquidityOwner"),
      },
      guardian: observed("guardian"),
      recoveryAuthority: observed("recovery"),
      keeper: observed("keeper"),
      liquidityExecutor: observed("executor"),
      creator: observed("creatorDestination"),
    };
    // Each mutable module has its own owner. Checking them all against one
    // nominal address would pass a partial handover, so each is checked
    // against its own recorded owner when the manifest provides one.
    // Absent means it equals `roles.owner` -- the schema says so, and the
    // deployment script's rerun verifier defaults the same way. Falling back
    // to `governanceOwner` instead treated the handover *target* as evidence
    // of acceptance: against a governed manifest that predates `moduleOwners`,
    // health would demand the Safe own all five modules -- unsatisfiable by
    // construction for FuelCore, which is never offered -- while the deploy
    // script demanded the deployer. At most one could pass.
    const moduleOwner = (
      module: keyof NonNullable<ProtocolDeploymentManifest["moduleOwners"]>,
    ): Address =>
      (manifest.moduleOwners?.[module] as Address | undefined) ??
      (manifest.roles.owner as Address);
    // An absent nomination record on a governed manifest means the offer the
    // deployment always makes: the governance owner on the four mutable
    // modules, nobody on FuelCore. Defaulting to zero instead failed health
    // against a correct freshly governed deployment.
    const defaultPendingOwner = (
      module: keyof NonNullable<
        ProtocolDeploymentManifest["modulePendingOwners"]
      >,
    ): Address => {
      const governance = manifest.roles.governanceOwner as Address | undefined;
      if (
        module === "liquidToken" ||
        governance === undefined ||
        governance.toLowerCase() ===
          (manifest.roles.owner as Address).toLowerCase()
      ) {
        return zeroAddress;
      }
      return governance;
    };
    const roleBindings = (
      [
        [
          "owner",
          moduleOwner("liquidToken"),
          "fuelOwner",
          copy.health.roleLabels.liquidTokenOwner,
        ],
        [
          "ledgerOwner",
          moduleOwner("rewardLedger"),
          "ledgerOwner",
          copy.health.roleLabels.rewardLedgerOwner,
        ],
        [
          "converterOwner",
          moduleOwner("epochConverter"),
          "converterOwner",
          copy.health.roleLabels.rewardEpochOwner,
        ],
        [
          "marketOwner",
          moduleOwner("marketRegistry"),
          "marketOwner",
          copy.health.roleLabels.canonicalMarketOwner,
        ],
        [
          "liquidityOwner",
          moduleOwner("protocolLiquidityVault"),
          "liquidityOwner",
          copy.health.roleLabels.liquidityOwner,
        ],
        [
          "guardian",
          manifest.roles.guardian,
          "guardian",
          copy.health.roleLabels.guardian,
        ],
        [
          "recovery",
          manifest.roles.recoveryAuthority,
          "recovery",
          copy.health.roleLabels.recoveryAuthority,
        ],
        [
          "keeper",
          manifest.roles.keeper,
          "keeper",
          copy.health.roleLabels.keeper,
        ],
        [
          "executor",
          manifest.roles.liquidityExecutor,
          "executor",
          copy.health.roleLabels.liquidityExecutor,
        ],
        [
          "creator",
          manifest.roles.creator,
          "creatorDestination",
          copy.health.roleLabels.creator,
        ],
      ] as const
    ).map(([id, expected, key, label]) => ({
      id: `role.${id}`,
      expected: expected as Address,
      observed: value(key),
      available: available(key),
      explanation: copy.health.roleBinding(label),
    }));
    const pendingOwnerBindings = (
      [
        [
          "liquidToken",
          "fuelPendingOwner",
          copy.health.roleLabels.liquidTokenOwner,
        ],
        [
          "rewardLedger",
          "ledgerPendingOwner",
          copy.health.roleLabels.rewardLedgerOwner,
        ],
        [
          "epochConverter",
          "converterPendingOwner",
          copy.health.roleLabels.rewardEpochOwner,
        ],
        [
          "marketRegistry",
          "marketPendingOwner",
          copy.health.roleLabels.canonicalMarketOwner,
        ],
        [
          "protocolLiquidityVault",
          "liquidityPendingOwner",
          copy.health.roleLabels.liquidityOwner,
        ],
      ] as const
    ).map(([module, key, label]) => ({
      id: `pendingOwner.${module}`,
      expected:
        (manifest.modulePendingOwners?.[module] as Address | undefined) ??
        defaultPendingOwner(module),
      observed: value(key),
      available: available(key),
      explanation: copy.health.pendingOwnerBinding(label),
    }));
    const explainDeploymentBinding = (id: string) => {
      const [component, dependency] = id.split(".") as [
        keyof typeof copy.health.deploymentLabels,
        keyof typeof copy.health.deploymentLabels,
      ];
      return copy.health.deploymentBinding(
        copy.health.deploymentLabels[component],
        copy.health.deploymentLabels[dependency],
      );
    };
    const deploymentBindings = (
      [
        ["mirror.core", contracts.fuelCore.address, "mirrorCore"],
        [
          "mirror.metadataRenderer",
          contracts.metadataRenderer.address,
          "mirrorMetadata",
        ],
        [
          "metadata.attributeRegistry",
          contracts.attributeRegistry.address,
          "metadataAttributes",
        ],
        ["ledger.fuelCore", contracts.fuelCore.address, "ledgerFuel"],
        [
          "ledger.attributeRegistry",
          contracts.attributeRegistry.address,
          "ledgerAttributes",
        ],
        ["ledger.claimGate", contracts.claimGate.address, "ledgerClaimGate"],
        [
          "ledger.epochConverter",
          contracts.epochConverter.address,
          "ledgerConverter",
        ],
        ["converter.weth", contracts.weth.address, "converterWeth"],
        [
          "converter.rewardLedger",
          contracts.rewardLedger.address,
          "converterLedger",
        ],
        [
          "converter.feeHook",
          contracts.canonicalFeeHook.address,
          "converterHook",
        ],
        [
          "market.manager",
          contracts.uniswapV4PoolManager.address,
          "marketManager",
        ],
        ["market.fuel", contracts.fuelCore.address, "marketFuel"],
        ["market.weth", contracts.weth.address, "marketWeth"],
        ["market.owner", moduleOwner("marketRegistry"), "marketOwner"],
        ["market.hook", contracts.canonicalFeeHook.address, "marketHook"],
        ["market.router", contracts.canonicalRouter.address, "marketRouter"],
        ["hook.manager", contracts.uniswapV4PoolManager.address, "hookManager"],
        [
          "hook.registry",
          contracts.canonicalMarketRegistry.address,
          "hookRegistry",
        ],
        ["hook.weth", contracts.weth.address, "hookWeth"],
        [
          "hook.rewardDestination",
          contracts.epochConverter.address,
          "rewardDestination",
        ],
        [
          "hook.liquidityDestination",
          contracts.protocolLiquidityVault.address,
          "liquidityDestination",
        ],
        [
          "hook.creatorDestination",
          manifest.roles.creator,
          "creatorDestination",
        ],
        [
          "router.manager",
          contracts.uniswapV4PoolManager.address,
          "routerManager",
        ],
        [
          "router.registry",
          contracts.canonicalMarketRegistry.address,
          "routerRegistry",
        ],
        ["router.weth", contracts.weth.address, "routerWeth"],
        [
          "liquidity.registry",
          contracts.canonicalMarketRegistry.address,
          "liquidityRegistry",
        ],
        [
          "liquidity.manager",
          contracts.uniswapV4PoolManager.address,
          "liquidityManager",
        ],
        ["liquidity.fuel", contracts.fuelCore.address, "liquidityFuel"],
        ["liquidity.weth", contracts.weth.address, "liquidityWeth"],
        [
          "liquidity.feeHook",
          contracts.canonicalFeeHook.address,
          "liquidityHook",
        ],
        [
          "genesis.registry",
          contracts.canonicalMarketRegistry.address,
          "genesisRegistry",
        ],
        [
          "genesis.manager",
          contracts.uniswapV4PoolManager.address,
          "genesisManager",
        ],
        ["genesis.fuel", contracts.fuelCore.address, "genesisFuel"],
        ["genesis.weth", contracts.weth.address, "genesisWeth"],
        [
          "venue.manager",
          contracts.uniswapV4PoolManager.address,
          "venueManager",
        ],
      ] as const
    ).map(([id, expected, key]) => ({
      id: id as string,
      expected: expected as Address,
      observed: value(key),
      available: available(key),
      explanation: explainDeploymentBinding(id),
    }));
    const poolNames = ["aaplc", "googlc", "metac", "nvdac"] as const;
    const adapterBindings = adapterContracts.flatMap((_contract, index) => {
      const track = (index + 1) as HealthTrack;
      return [
        {
          id: `adapter${track}.converter`,
          expected: contracts.epochConverter.address,
          observed: value(`adapter${track}Converter`),
          available: available(`adapter${track}Converter`),
          explanation: copy.health.adapterConverter,
        },
        {
          id: `adapter${track}.weth`,
          expected: contracts.weth.address,
          observed: value(`adapter${track}Weth`),
          available: available(`adapter${track}Weth`),
          explanation: copy.health.adapterSettlement,
        },
        {
          id: `adapter${track}.usdc`,
          expected: contracts.usdc.address,
          observed: value(`adapter${track}Usdc`),
          available: available(`adapter${track}Usdc`),
          explanation: copy.health.adapterConversion,
        },
        {
          id: `adapter${track}.stock`,
          expected: contracts[stockContracts[index]![0]].address,
          observed: value(`adapter${track}Stock`),
          available: available(`adapter${track}Stock`),
          explanation: copy.health.adapterReward,
        },
        {
          id: `adapter${track}.ledger`,
          expected: contracts.rewardLedger.address,
          observed: value(`adapter${track}Ledger`),
          available: available(`adapter${track}Ledger`),
          explanation: copy.health.adapterLedger,
        },
        {
          id: `adapter${track}.venue`,
          expected: contracts.testConversionVenue.address,
          observed: value(`adapter${track}Venue`),
          available: available(`adapter${track}Venue`),
          explanation: copy.health.adapterVenue,
        },
      ];
    });
    const trackBindings = stockContracts.flatMap(
      ([stockContract, track], index) => {
        const [configuredStock, configuredAdapter] = value(
          `trackConfiguration${track}`,
        );
        return [
          {
            id: `ledger.track${track}.token`,
            expected: contracts[stockContract].address,
            observed: value(`ledgerToken${track}`),
            available: available(`ledgerToken${track}`),
            explanation: copy.health.ledgerTrack,
          },
          {
            id: `converter.track${track}.token`,
            expected: contracts[stockContract].address,
            observed: configuredStock,
            available: available(`trackConfiguration${track}`),
            explanation: copy.health.converterTrackToken,
          },
          {
            id: `converter.track${track}.adapter`,
            expected:
              contracts[adapterContracts[index] as keyof typeof contracts]
                .address,
            observed: configuredAdapter,
            available: available(`trackConfiguration${track}`),
            explanation: copy.health.converterTrackAdapter,
          },
        ];
      },
    );
    const adapterValues = adapterContracts.flatMap((_contract, index) => {
      const track = (index + 1) as HealthTrack;
      const pool =
        manifest.conversionPools[
          poolNames[index] as keyof typeof manifest.conversionPools
        ];
      return [
        {
          id: `adapter${track}.track`,
          expected: String(track),
          observed: String(value(`adapter${track}Track`)),
          available: available(`adapter${track}Track`),
          explanation: copy.health.adapterTrack,
        },
        {
          id: `adapter${track}.wethPool`,
          expected: manifest.conversionPools.wethUsdc?.poolId ?? "missing",
          observed: value(`adapter${track}WethPool`),
          available: available(`adapter${track}WethPool`),
          explanation: copy.health.firstHop,
        },
        {
          id: `adapter${track}.stockPool`,
          expected: pool?.poolId ?? "missing",
          observed: value(`adapter${track}StockPool`),
          available: available(`adapter${track}StockPool`),
          explanation: copy.health.secondHop,
        },
      ];
    });
    const readCanonicalMarket = async () => {
      const failures: string[] = [];
      let state:
        | Awaited<ReturnType<ProtocolReadTransport["canonicalMarketState"]>>
        | undefined;
      try {
        state = await transport.canonicalMarketState(
          manifest.canonicalPool.poolId as `0x${string}`,
          block.number,
        );
      } catch (cause) {
        failures.push(
          `${copy.labels.market} state: ${normalizeProtocolError(cause, identity).message}`,
        );
      }
      if (state === undefined) return { failures, price: undefined, state };
      try {
        const price = deriveCanonicalMarketPrice({
          sqrtPriceX96: state.sqrtPriceX96,
          currency0: manifest.canonicalPool.currency0 as Address,
          currency1: manifest.canonicalPool.currency1 as Address,
          liquidToken: contracts.fuelCore.address,
          identity,
          liquidTokenDecimals: CANONICAL_MARKET_TOKEN_DECIMALS.liquidToken,
          settlementTokenDecimals:
            CANONICAL_MARKET_TOKEN_DECIMALS.settlementToken,
        });
        return { failures, price, state };
      } catch (cause) {
        failures.push(
          `${copy.labels.market} price: ${cause instanceof Error ? cause.message : copy.health.rpcFailure}`,
        );
        return { failures, price: undefined, state };
      }
    };
    const canonicalMarket = await readCanonicalMarket();
    rpcFailures.push(...canonicalMarket.failures);
    const canonicalMarketState = canonicalMarket.state;
    const canonicalMarketPrice = canonicalMarket.price;
    type OperationalCheck = NonNullable<
      ProtocolHealthInput["operationalChecks"]
    >[number];
    const queueKeys = ["queue1", "queue2", "queue3", "queue4"] as const;
    const totalTrackQueue = queueKeys.reduce(
      (total, key) => total + value(key),
      0n,
    );
    const feePotTotal =
      value("rewardPot") + value("liquidityPot") + value("creatorPot");
    const baseOperationalChecks = (): readonly OperationalCheck[] => [
      {
        id: "market:active-liquidity",
        available: canonicalMarketState !== undefined,
        status: checkStatus(
          canonicalMarketState !== undefined &&
            canonicalMarketState.activeLiquidity > 0n,
        ),
        severity: "critical",
        expected: copy.health.positiveLiquidity,
        observed:
          canonicalMarketState === undefined
            ? copy.health.unavailable
            : canonicalMarketState.activeLiquidity.toString(),
        explanation: copy.health.marketLiquidity,
      },
      {
        id: "accounting:fee-pot-backing",
        available: available(
          "rewardPot",
          "liquidityPot",
          "creatorPot",
          "hookWethBalance",
        ),
        status: checkStatus(value("hookWethBalance") >= feePotTotal),
        severity: "critical",
        expected: copy.health.backingExpected(feePotTotal),
        observed: copy.health.backingObserved(
          feePotTotal,
          value("hookWethBalance"),
        ),
        explanation: copy.health.feePotReconciliation,
      },
      {
        id: "accounting:reward-queue-backing",
        available: available(...queueKeys, "converterWethBalance"),
        status: checkStatus(value("converterWethBalance") >= totalTrackQueue),
        severity: "critical",
        expected: copy.health.backingExpected(totalTrackQueue),
        observed: copy.health.backingObserved(
          totalTrackQueue,
          value("converterWethBalance"),
        ),
        explanation: copy.health.rewardQueueReconciliation,
      },
      {
        id: "accounting:liquidity-queue-backing",
        available: available("queuedWeth", "liquidityWethBalance"),
        status: checkStatus(
          value("liquidityWethBalance") >= value("queuedWeth"),
        ),
        severity: "critical",
        expected: copy.health.backingExpected(value("queuedWeth")),
        observed: copy.health.backingObserved(
          value("queuedWeth"),
          value("liquidityWethBalance"),
        ),
        explanation: copy.health.liquidityQueueReconciliation,
      },
    ];
    const rewardAccountingChecks = () =>
      trackNames.map((track, index): OperationalCheck => {
        const trackId = (index + 1) as HealthTrack;
        const accountingKeys = [
          `activeWeight${trackId}`,
          `unclaimedTrackPot${trackId}`,
          "relicPending4441",
          "relicPending4442",
          "relicPending4443",
          "relicPending4444",
        ] as const;
        const basketPot =
          value("relicPending4441")[index]! +
          value("relicPending4442")[index]! +
          value("relicPending4443")[index]!;
        return {
          id: `reward-accounting:${trackId}`,
          available: available(...accountingKeys),
          status: "pass",
          severity: "info",
          expected: copy.health.accountingSnapshotExpected,
          observed: copy.health.accountingSnapshot(
            value(`activeWeight${trackId}`),
            value(`unclaimedTrackPot${trackId}`),
            basketPot,
            value("relicPending4444")[index]!,
          ),
          explanation: copy.health.rewardAccountingSnapshot(track),
        };
      });
    const lockedLiquidityCheck = (): OperationalCheck => {
      const liquidityCycles = value("liquidityCycles");
      const lockedWeth = value("lockedWeth");
      const coherentPosition =
        (liquidityCycles === 0n && lockedWeth === 0n) ||
        (liquidityCycles > 0n && lockedWeth > 0n);
      return {
        id: "liquidity:locked-position",
        available: available("liquidityCycles", "lockedWeth"),
        status: checkStatus(coherentPosition),
        severity: "critical",
        expected: copy.health.lockedLiquidityExpected,
        observed: copy.health.lockedLiquidityObserved(
          liquidityCycles,
          lockedWeth,
        ),
        explanation: copy.health.lockedLiquidity,
      };
    };
    const pauseChecks = () =>
      (
        [
          ["liquidToken", "fuelPaused", identity.liquidToken.displayName],
          ["rewards", "rewardsPaused", copy.labels.rewardLedger],
          ["converter", "converterPaused", copy.labels.rewardEpoch],
          ["liquidity", "liquidityPaused", copy.labels.protocolOwnedLiquidity],
        ] as const
      ).map(([module, key, label]): OperationalCheck => {
        const paused = value(key);
        return {
          id: `pause:${module}`,
          available: available(key),
          status: checkStatus(!paused),
          severity: "warning",
          expected: copy.health.activeState,
          observed: paused ? copy.health.pausedState : copy.health.activeState,
          explanation: copy.health.modulePause(label),
        };
      });
    const trackProgressObservation = (
      queueClear: boolean,
      retryable: boolean,
    ) => {
      if (queueClear) return copy.health.clearTrack;
      if (retryable) return copy.health.deferredTrack;
      return copy.health.executableTrack;
    };
    const trackProgressChecks = () =>
      trackNames.map((track, index): OperationalCheck => {
        const trackId = (index + 1) as HealthTrack;
        const queueKey = `queue${trackId}` as const;
        const queueAvailable = available(queueKey);
        const attemptAvailable =
          operationalHistoryAvailable &&
          trackAttemptState[trackId] !== "unknown";
        const retryable = trackAttemptState[trackId] === "retryable";
        const queueClear = queueAvailable && value(queueKey) === 0n;
        return {
          id: `track:${trackId}`,
          available: queueAvailable && (queueClear || attemptAvailable),
          status: checkStatus(queueClear || !retryable),
          severity: "warning",
          expected: copy.health.progressingTrack,
          observed: trackProgressObservation(queueClear, retryable),
          explanation: copy.health.trackProgress(track),
        };
      });
    const connectedWalletFreezeChecks = (): readonly OperationalCheck[] => {
      if (connectedWallet === undefined) return [];
      const frozen = value("connectedWalletFrozen");
      return [
        {
          id: "freeze:connected-wallet",
          available: available("connectedWalletFrozen"),
          status: checkStatus(!frozen),
          severity: "warning",
          expected: copy.health.unfrozenState,
          observed: frozen
            ? copy.health.frozenState
            : copy.health.unfrozenState,
          explanation: copy.health.connectedWalletFreeze,
        },
      ];
    };
    /**
     * Fails when the bound claim policy is not the declared implementation. A
     * deployment that claims to be configurable while binding always-allow
     * would leave denied eligibility unexercisable and unnoticed.
     */
    const claimPolicyChecks = (): readonly OperationalCheck[] => {
      if (claimPolicyCheck === undefined) return [];
      const matched = claimPolicyCheck.observed === claimPolicyCheck.declared;
      return [
        {
          id: "claimPolicyImplementation",
          severity: "critical",
          status:
            claimPolicyCheck.observed === undefined
              ? "unknown"
              : matched
                ? "pass"
                : "fail",
          expected: `${claimPolicyCheck.mode} (${claimPolicyCheck.declared})`,
          observed: claimPolicyCheck.observed ?? copy.health.rpcFailure,
          explanation: copy.health.claimPolicyImplementation,
        },
      ];
    };

    const claimGateOwnershipChecks = (): readonly OperationalCheck[] => {
      if (claimGateOwnershipCheck === undefined) return [];
      const { administrator, owner, pendingOwner } = claimGateOwnershipCheck;
      const matchStatus = (
        observed: string | undefined,
        expected: string,
      ): "unknown" | "pass" | "fail" =>
        observed === undefined
          ? "unknown"
          : observed.toLowerCase() === expected.toLowerCase()
            ? "pass"
            : "fail";
      return [
        {
          id: "claimPolicyAdministratorBinding",
          severity: "critical" as const,
          status: matchStatus(owner, administrator),
          expected: administrator,
          observed: owner ?? copy.health.rpcFailure,
          explanation: copy.health.claimGateAdministrator,
        },
        {
          id: "claimPolicyPendingAdministrator",
          severity: "critical" as const,
          status: matchStatus(pendingOwner, zeroAddress),
          expected: zeroAddress,
          observed: pendingOwner ?? copy.health.rpcFailure,
          explanation: copy.health.claimGatePendingAdministrator,
        },
      ];
    };
    const blockedVenueChecks = (): readonly OperationalCheck[] =>
      blockedVenueChecks_.map((venue) => ({
        id: `blockedVenue:${venue.label}`,
        severity: "critical" as const,
        status:
          venue.blocked === undefined
            ? ("unknown" as const)
            : venue.blocked
              ? ("pass" as const)
              : ("fail" as const),
        expected: copy.health.venueBlockedExpected,
        observed:
          venue.blocked === undefined
            ? copy.health.rpcFailure
            : venue.blocked
              ? copy.health.venueBlockedObserved
              : copy.health.venueReachableObserved,
        explanation: copy.health.blockedVenue(venue.label, venue.codehash),
      }));
    const operationalChecks: NonNullable<
      ProtocolHealthInput["operationalChecks"]
    > = [
      ...baseOperationalChecks(),
      ...rewardAccountingChecks(),
      lockedLiquidityCheck(),
      ...pauseChecks(),
      ...trackProgressChecks(),
      ...connectedWalletFreezeChecks(),
      ...claimPolicyChecks(),
      ...claimGateOwnershipChecks(),
      ...blockedVenueChecks(),
    ];
    const health = deriveProtocolHealth(
      {
        observedBlock: block.number,
        observedAt: Number(block.timestamp),
        currentTime,
        maximumAgeSeconds,
        liquidSupplyWei: value("liquidSupply"),
        permanentCount: Number(value("permanentCount")),
        transientCount: Number(value("transientCount")),
        pendingDiscoveryCount: Number(value("pendingCount")),
        availableIdentityCount: Number(value("availableCount")),
        availability: {
          supplyInvariant: available("liquidSupply", "permanentCount"),
          collectionPartition: available(
            "permanentCount",
            "transientCount",
            "availableCount",
          ),
          identityManifest: available("manifestHash"),
        },
        expectedManifestCommitment: manifest.identity
          .manifestHash as `0x${string}`,
        observedManifestCommitment: value("manifestHash"),
        bindings: [
          ...roleBindings,
          ...pendingOwnerBindings,
          ...deploymentBindings,
          ...trackBindings,
          {
            id: "fuel.rewardLedger",
            expected: contracts.rewardLedger.address,
            observed: value("fuelLedger"),
            available: available("fuelLedger"),
            explanation: copy.health.fuelLedger,
          },
          {
            id: "fuel.marketRegistry",
            expected: contracts.canonicalMarketRegistry.address,
            observed: value("fuelRegistry"),
            available: available("fuelRegistry"),
            explanation: copy.health.fuelMarket,
          },
          ...adapterBindings,
        ],
        values: [
          {
            id: "chainId",
            expected: String(manifest.chainId),
            observed: String(observedChainId),
            explanation: copy.health.chain,
          },
          {
            id: "canonicalMarketRegistered",
            expected: "true",
            observed: String(value("marketRegistered")),
            available: available("marketRegistered"),
            explanation: copy.health.marketRegistered,
          },
          {
            id: "canonicalPool",
            expected: manifest.canonicalPool.poolId,
            observed: value("marketPoolId"),
            available: available("marketPoolId"),
            explanation: copy.health.marketPool,
          },
          {
            id: "canonicalPoolHook",
            expected: manifest.canonicalPool.hooks,
            observed: value("marketHook"),
            available: available("marketHook"),
            explanation: copy.health.marketHook,
          },
          ...adapterValues,
          {
            id: "launched",
            expected: "true",
            observed: String(value("launched")),
            available: available("launched"),
            explanation: copy.health.launched,
          },
          {
            id: "feeBps",
            expected: "300",
            observed: String(value("feeBps")),
            available: available("feeBps"),
            explanation: copy.health.marketFee,
          },
        ],
        bytecode,
        seals: [
          {
            id: "attributes",
            sealed: value("attributesSealed"),
            available: available("attributesSealed"),
            explanation: copy.health.attributesSealed,
          },
          {
            id: "canonicalMarket",
            sealed: value("marketSealed"),
            available: available("marketSealed"),
            explanation: copy.health.marketSealed,
          },
          {
            id: "conversionRoutes",
            sealed: value("routesSealed"),
            available: available("routesSealed"),
            explanation: copy.health.routesSealed,
          },
          {
            id: "feeDestinations",
            sealed: value("liquiditySealed"),
            available: available("liquiditySealed"),
            explanation: copy.health.liquiditySealed,
          },
          {
            id: "genesisLiquidity",
            sealed: value("genesisSeeded"),
            available: available("genesisSeeded"),
            explanation: copy.health.genesisSeeded,
          },
          {
            id: "discoveryExemptions",
            sealed: value("launched"),
            available: available("launched"),
            explanation: copy.health.discoveryExemptions,
          },
          {
            id: "metadata",
            sealed: value("launched"),
            available: available("launched"),
            explanation: copy.health.metadataSealed,
          },
        ],
        rewardTracks: trackNames.map((track, index) => {
          const trackId = (index + 1) as HealthTrack;
          return {
            track,
            tokenBalance: value(`balance${trackId}`),
            liability: value(`liability${trackId}`),
            available: available(`balance${trackId}`, `liability${trackId}`),
          };
        }),
        operationalChecks,
        rpcFailures,
      },
      identity,
    );
    const deriveConnectedCapabilities = () => {
      const same = (role: Address | undefined) =>
        role !== undefined &&
        connectedWallet?.toLowerCase() === role.toLowerCase();
      const ownerModules = {
        liquidToken: same(observedRoles.owners.liquidToken),
        rewards: same(observedRoles.owners.rewards),
        converter: same(observedRoles.owners.converter),
        liquidity: same(observedRoles.owners.liquidity),
      };
      return {
        connected: connectedWallet !== undefined,
        owner:
          ownerModules.liquidToken ||
          ownerModules.rewards ||
          ownerModules.converter ||
          ownerModules.liquidity,
        ownerModules,
        guardian: same(observedRoles.guardian),
        recovery: same(observedRoles.recoveryAuthority),
        keeper: same(observedRoles.keeper),
        liquidityExecutor: same(observedRoles.liquidityExecutor),
        creator: same(observedRoles.creator),
      };
    };
    const capabilities = deriveConnectedCapabilities();
    const converterPaused = observed("converterPaused");
    const liquidSupply = observed("liquidSupply");
    const rewardPot = observed("rewardPot");
    const liquidityPot = observed("liquidityPot");
    const creatorPot = observed("creatorPot");
    const epochCount = observed("epochCount");
    const lastEpoch = observed("lastEpoch");
    const createCollectionSnapshot = () => {
      const pendingCount = observed("pendingCount");
      return {
        liquidSupplyWei: liquidSupply,
        liquidSupplyFormatted: formatOptionalUnits(liquidSupply, 18),
        permanentCount: observed("permanentCount"),
        transientCount: observed("transientCount"),
        pendingDiscoveryCount: mapOptional(pendingCount, Number),
        availableIdentityCount: observed("availableCount"),
      };
    };
    const collection = createCollectionSnapshot();
    const deployment = {
      network: manifest.network,
      expectedChainId: manifest.chainId,
      observedChainId,
      observedBlock: block.number,
      observedAt: Number(block.timestamp),
      expectedManifestCommitment: manifest.identity.manifestHash,
      manifestCommitment: observed("manifestHash"),
      launched: observed("launched"),
      seals: {
        attributes: observed("attributesSealed"),
        canonicalMarket: observed("marketSealed"),
        conversionRoutes: observed("routesSealed"),
        feeDestinations: observed("liquiditySealed"),
        genesisLiquidity: observed("genesisSeeded"),
      },
      // The bound claim policy, so the console can offer eligibility controls
      // only where a policy can actually deny.
      claimPolicy: manifest.claimPolicy,
    };
    const createTransactionReadAvailability = () => {
      const epochAvailable = available("epochCount");
      const firstEpoch = value("epochCount") === 0n;
      return {
        launched: available("launched"),
        conversionConfigurationSealed: available("routesSealed"),
        liquidityConfigurationSealed: available("liquiditySealed"),
        pauses: {
          liquidToken: available("fuelPaused"),
          rewards: available("rewardsPaused"),
          converter: available("converterPaused"),
          liquidity: available("liquidityPaused"),
        },
        rewardPot: available("rewardPot"),
        creatorPot: available("creatorPot"),
        nextRewardEpoch:
          epochAvailable && (firstEpoch || available("lastEpoch")),
        trackQueues: {
          1: available("queue1"),
          2: available("queue2"),
          3: available("queue3"),
          4: available("queue4"),
        },
      };
    };
    const transactionReadAvailability = createTransactionReadAvailability();
    const market = {
      poolId: observed("marketPoolId"),
      tickSpacing: manifest.canonicalPool.tickSpacing,
      wethIsCurrency0:
        manifest.canonicalPool.currency0.toLowerCase() ===
        contracts.weth.address.toLowerCase(),
      tradingFeeBps: mapOptional(observed("feeBps"), Number),
      rewardPotWeth: rewardPot,
      rewardPotWethFormatted: formatOptionalUnits(rewardPot, 18),
      liquidityPotWeth: liquidityPot,
      liquidityPotWethFormatted: formatOptionalUnits(liquidityPot, 18),
      creatorPotWeth: creatorPot,
      creatorPotWethFormatted: formatOptionalUnits(creatorPot, 18),
      price: canonicalMarketPrice,
      sqrtPriceX96: canonicalMarketState?.sqrtPriceX96,
      currentTick: canonicalMarketState?.tick,
      protocolFee: canonicalMarketState?.protocolFee,
      lpFee: canonicalMarketState?.lpFee,
      activeLiquidity: canonicalMarketState?.activeLiquidity,
    };
    const rewards = {
      tracks: trackNames.map((track, index) => {
        const trackId = (index + 1) as HealthTrack;
        const tokenBalance = value(`balance${trackId}`);
        const liability = value(`liability${trackId}`);
        const isAvailable = available(
          `balance${trackId}`,
          `liability${trackId}`,
          `ledgerToken${trackId}`,
        );
        const accountingAvailable = available(
          `activeWeight${trackId}`,
          `unclaimedTrackPot${trackId}`,
          "relicPending4441",
          "relicPending4442",
          "relicPending4443",
          "relicPending4444",
        );
        const basketRelicPot =
          value("relicPending4441")[index]! +
          value("relicPending4442")[index]! +
          value("relicPending4443")[index]!;
        return {
          track,
          token: whenAvailable(isAvailable, value(`ledgerToken${trackId}`)),
          rawTokenBalance: whenAvailable(isAvailable, tokenBalance),
          rawLiability: whenAvailable(isAvailable, liability),
          solvent: whenAvailable(isAvailable, tokenBalance >= liability),
          status: observationStatus(isAvailable),
          activeWeight: whenAvailable(
            accountingAvailable,
            value(`activeWeight${trackId}`),
          ),
          unclaimedTrackPot: whenAvailable(
            accountingAvailable,
            value(`unclaimedTrackPot${trackId}`),
          ),
          basketRelicPot: whenAvailable(accountingAvailable, basketRelicPot),
          indicatorRelicPot: whenAvailable(
            accountingAvailable,
            value("relicPending4444")[index],
          ),
          accountingStatus: observationStatus(accountingAvailable),
        };
      }),
    };
    const historyStatus = () => {
      if (!operationalHistoryAvailable) return "unknown" as const;
      return !operationalHistoryIncomplete
        ? ("observed" as const)
        : ("partial" as const);
    };
    const rewardHistoryStatus = () => {
      if (!rewardHistory.available) return "unknown" as const;
      const observedEpochCount = BigInt(
        new Set(
          rewardHistoryEvents.flatMap((event) =>
            event.type === "reward-epoch"
              ? [event.epoch.epochNumber.toString()]
              : [],
          ),
        ).size,
      );
      if (epochCount !== undefined && observedEpochCount !== epochCount) {
        return "partial" as const;
      }
      const pointReadBalances = rewards.tracks.map(
        (track) => track.rawTokenBalance,
      );
      const pointReadQueues = ([1, 2, 3, 4] as const).map((track) =>
        whenAvailable(available(`queue${track}`), value(`queue${track}`)),
      );
      return rewardHistory.incomplete &&
        !rewardHistoryProvesComplete(
          rewardHistoryEvents,
          epochCount,
          pointReadBalances,
          pointReadQueues,
        )
        ? ("partial" as const)
        : ("complete" as const);
    };
    const nextRewardEpochAt = () => {
      if (epochCount === undefined) return undefined;
      if (epochCount === 0n) return 0n;
      if (lastEpoch === undefined) return undefined;
      // The epoch cadence lives in the operator policy; a duplicated `60n`
      // here silently split policy from health if the cadence ever changed.
      return lastEpoch + MINIMUM_REWARD_EPOCH_INTERVAL;
    };
    const deferredQueueState = (
      queueAvailable: boolean,
      weth: bigint,
      attemptHistoryAvailable: boolean,
      retryable: boolean,
    ) => {
      if (!queueAvailable) return undefined;
      if (weth === 0n) return false;
      return attemptHistoryAvailable ? retryable : undefined;
    };
    const queueStatus = (
      queueAvailable: boolean,
      weth: bigint,
      attemptHistoryAvailable: boolean,
      retryable: boolean,
    ) => {
      if (!queueAvailable) return "unknown" as const;
      if (weth === 0n) return "clear" as const;
      if (converterPaused === undefined) return "unknown" as const;
      if (converterPaused) return "paused" as const;
      if (!attemptHistoryAvailable) return "unknown" as const;
      return retryable ? ("retryable" as const) : ("ready" as const);
    };
    const trackQueues = trackNames.map((track, index) => {
      const trackId = (index + 1) as HealthTrack;
      const weth = value(`queue${trackId}`);
      const queueAvailable = available(`queue${trackId}`);
      const retryable = retryableTrackIds.has(trackId);
      const attemptHistoryAvailable =
        operationalHistoryAvailable && trackAttemptState[trackId] !== "unknown";
      const canConnectedWalletExecute =
        attemptHistoryAvailable &&
        queueAvailable &&
        capabilities.keeper &&
        converterPaused === false &&
        weth > 0n;
      return {
        track,
        trackId,
        weth: whenAvailable(queueAvailable, weth),
        wethFormatted: whenAvailable(queueAvailable, formatUnits(weth, 18)),
        queueAvailable,
        attemptHistoryAvailable,
        deferred: deferredQueueState(
          queueAvailable,
          weth,
          attemptHistoryAvailable,
          retryable,
        ),
        status: queueStatus(
          queueAvailable,
          weth,
          attemptHistoryAvailable,
          retryable,
        ),
        canConnectedWalletExecute,
      };
    });
    const deferredTrackBudgets = trackNames.flatMap((track, index) => {
      const trackId = (index + 1) as HealthTrack;
      const weth = value(`queue${trackId}`);
      const isDeferred =
        available(`queue${trackId}`) &&
        operationalHistoryAvailable &&
        trackAttemptState[trackId] !== "unknown" &&
        weth > 0n &&
        retryableTrackIds.has(trackId);
      return isDeferred
        ? [{ track, trackId, weth, wethFormatted: formatUnits(weth, 18) }]
        : [];
    });
    const operations = {
      recentEvents,
      rewardHistory: rewardHistoryEvents,
      rewardHistoryStatus: rewardHistoryStatus(),
      summary: summarizeOperationalEvents(recentEvents),
      trackOutcomes: summarizeTrackOutcomes(recentEvents),
      historyStatus: historyStatus(),
      keeperAttemptEvidence: operationalHistory.keeperAttemptEvidence,
      rewardEpochCount: epochCount,
      lastRewardEpochAt: lastEpoch,
      nextRewardEpochAt: nextRewardEpochAt(),
      trackQueues,
      deferredTrackBudgets,
      protocolOwnedLiquidity: {
        queuedWeth: observed("queuedWeth"),
        queuedWethFormatted: formatOptionalUnits(observed("queuedWeth"), 18),
        permanentlyLockedWeth: observed("lockedWeth"),
        permanentlyLockedWethFormatted: formatOptionalUnits(
          observed("lockedWeth"),
          18,
        ),
        cycleCount: observed("liquidityCycles"),
      },
    };
    return {
      health,
      collection,
      deployment,
      roles: observedRoles,
      capabilities,
      transactionReadAvailability,
      market,
      rewards,
      operations,
      pauses: {
        liquidToken: observed("fuelPaused"),
        rewards: observed("rewardsPaused"),
        converter: observed("converterPaused"),
        liquidity: observed("liquidityPaused"),
      },
      connectedWalletFrozen: whenAvailable(
        connectedWallet !== undefined,
        observed("connectedWalletFrozen"),
      ),
    };
  };

  const readHealth = async (
    connectedWallet?: Address,
    currentTime = Math.floor(Date.now() / 1_000),
    maximumAgeSeconds = 30,
    options: ProtocolHealthReadOptions = {},
  ) => {
    const observedChainId = await verifyChain();
    const block = await executeRead(
      copy.reader.healthBlock,
      () => transport.getBlock(),
      identity,
    );
    const definitions = createHealthReadPlan(connectedWallet);

    const operationalHistoryRead =
      options.includeOperationalHistory === false
        ? Promise.resolve(unavailableOperationalHistory())
        : readHealthOperationalHistory(block);
    const rewardHistoryRead =
      options.includeRewardHistory === false
        ? Promise.resolve(unavailableRewardHistory())
        : readHealthRewardHistory(block);
    const [results, operationalHistory, rewardHistory] = await Promise.all([
      executeRead(
        copy.reader.protocolHealth,
        () =>
          transport.readMany(
            definitions.map((definition) => definition.request),
            block.number,
          ),
        identity,
      ),
      operationalHistoryRead,
      rewardHistoryRead,
    ]);
    const decoded = decodeHealthResults(definitions, results);
    return assembleHealthSnapshot({
      block,
      connectedWallet,
      currentTime,
      decoded,
      maximumAgeSeconds,
      observedChainId,
      operationalHistory,
      rewardHistory,
    });
  };

  /**
   * Quotes a reward track's sealed conversion route at a pinned block and
   * applies the same protective minimum the automated runner uses, so the
   * admin console cannot submit a weaker minimum than the operator would.
   */
  async function quoteRewardTrack(
    track: 1 | 2 | 3 | 4,
    wethInput: bigint,
    minimumOutputBps: number = DEFAULT_MINIMUM_OUTPUT_BPS,
  ): Promise<RewardTrackQuote> {
    await verifyChain();
    if (transport.quoteConversionHop === undefined) {
      throw new ProtocolQueryError(
        copy.reader.trackQuote,
        normalizeProtocolError(
          new Error("Conversion-route quoting is unavailable"),
          identity,
        ),
      );
    }
    const hop = transport.quoteConversionHop;
    const block = await executeRead(
      copy.reader.quoteBlock,
      () => transport.getBlock(),
      identity,
    );
    const adapterContract = adapterContracts[track - 1];
    if (adapterContract === undefined) {
      throw new ProtocolQueryError(
        copy.reader.trackQuote,
        normalizeProtocolError(
          new Error(`Track ${track} has no configured adapter`),
          identity,
        ),
      );
    }
    const [stockToken] = await executeRead(
      copy.reader.trackQuote,
      () =>
        transport.readMany(
          [{ contract: adapterContract, functionName: "stockToken" }],
          block.number,
        ),
      identity,
    );
    if (stockToken?.status !== "success") {
      throw new ProtocolQueryError(
        copy.reader.trackQuote,
        normalizeProtocolError(
          new Error("The track stock token could not be read"),
          identity,
        ),
      );
    }
    const conversionOutput = await executeRead(
      copy.reader.trackQuote,
      () =>
        hop(
          contracts.weth.address,
          contracts.usdc.address,
          wethInput,
          block.number,
        ),
      identity,
    );
    const quotedOutput = await executeRead(
      copy.reader.trackQuote,
      () =>
        hop(
          contracts.usdc.address,
          stockToken.value as Address,
          conversionOutput,
          block.number,
        ),
      identity,
    );
    return {
      observedBlock: block.number,
      quotedOutput,
      minimumOutput: minimumOutputFromQuote(quotedOutput, minimumOutputBps),
      minimumOutputBps,
      wethInput,
    };
  }

  return {
    contracts,
    identity,
    manifest,
    verifyChain,
    readWallet,
    readCollectible,
    readExchangeAllowance,
    quoteExactInput,
    quoteRewardTrack,
    readRecentOperations,
    readOperationalStatus,
    readHealth,
    prepareTransaction,
  } as const;
};

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const zeroHash = `0x${"0".repeat(64)}` as `0x${string}`;
