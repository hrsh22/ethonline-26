"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  encodeFunctionData,
  formatUnits,
  type Address,
  type WalletClient as ViemWalletClient,
} from "viem";
import { useConnection, useWalletClient } from "wagmi";

import { createProtocolReader } from "@orbit/protocol/reader";
import type {
  ProtocolAction,
  TransactionRuntimeContext,
} from "@orbit/protocol/transactions";
import { TransactionPreparationError } from "@orbit/protocol/transactions";
import { normalizeProtocolError } from "@orbit/protocol/errors";
import { createIndexedHistoryReaders } from "@orbit/protocol/history";
import { createCanonicalMarketHistoryReader } from "@orbit/protocol/market-history";
import { makeViemProtocolTransport } from "@orbit/protocol/viem-transport";
import { bindReadSignal, runPublicRead } from "@orbit/protocol/read-lifetime";
import { PUBLIC_API_PATHS } from "@orbit/config/public-api";
import { deploymentManifestFingerprint } from "@orbit/config/deployment-manifest";

import {
  readCollectorTransaction,
  readCompletedCollectorTransactions,
  type CompletedCollectorTransaction,
  writeCollectorTransaction,
  type CollectorTransactionMetadata,
  type SubmittedTransactionPhase,
} from "@/lib/collector-transaction-record";

import {
  getCollectorAccessState,
  type CollectorAccessState,
} from "@/lib/collector-access";
import { AdminActionAuthorizationDeniedError } from "@/lib/admin-action-authorization";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { applicationCopy, identity } from "@/lib/identity";
import {
  deriveIndexedMarketHistoryRead,
  type IndexedMarketHistoryRead,
} from "@/lib/market-history-state";
import { publicApiUrl } from "@/lib/public-api";
import {
  ADMIN_SESSION_ENDED_EVENT,
  adminProtectedFetch,
} from "@/lib/admin-protected-fetch";
import {
  isTransientPreSubmissionRpcFailure,
  retryPreSubmissionPublicRpc,
} from "@/lib/pre-submission-rpc";
import {
  getProtocolHealthReadScope,
  shouldLoadMarketHistory,
  shouldLoadPublicStatus,
} from "@/lib/protocol-read-scope";
import {
  derivePublicStatusModel,
  type PublicStatusModel,
} from "@/lib/protocol-status-model";
import {
  readPublicEvidenceCache,
  writePublicEvidenceCache,
} from "@/lib/public-evidence-cache";
import { webProtocolQueryRetryCount } from "@/lib/web-rpc-policy";
import {
  executeProtocolTransaction,
  type ExecutedProtocolTransaction,
  refetchUntilObservedBlock,
  RevertedProtocolTransactionError,
  ReplacedProtocolTransactionError,
  UnknownProtocolTransactionOutcomeError,
} from "@/lib/transaction-execution";
import {
  protocolChain,
  createProtocolReadClient,
  protocolReadClient,
  protocolTransactionClient,
} from "@/lib/wagmi";
import {
  bindProtocolActionToWallet,
  isSameTransactionScope,
  transactionAttemptForScope,
  type ScopedTransactionAttempt,
  type TransactionScope,
} from "@/lib/transaction-retry";
import {
  advanceTransaction,
  createTransactionState,
  isTransactionInFlight,
  type TransactionState,
} from "@/lib/transaction-state";

type ProtocolReader = ReturnType<typeof createProtocolReader>;
type ProtocolHistory = ReturnType<
  typeof createIndexedHistoryReaders
>["protocol"];
type HealthSnapshot = Awaited<ReturnType<ProtocolReader["readHealth"]>>;
type WalletSnapshot = Awaited<ReturnType<ProtocolReader["readWallet"]>>;
type DirectCollectibleSnapshot = Awaited<
  ReturnType<ProtocolReader["readCollectible"]>
>;
type DiscoveredCollectibleSnapshot = Extract<
  DirectCollectibleSnapshot,
  { readonly status: "discovered" }
>;
type Track = 1 | 2 | 3 | 4;
type BlockedCollectorAccessState = Exclude<CollectorAccessState, "ready">;
type TransactionAuthorization = (action: ProtocolAction) => Promise<void>;

type ProtocolWalletRead =
  | {
      readonly status: "blocked";
      readonly accessState: BlockedCollectorAccessState;
    }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: Error }
  | {
      readonly status: "loaded";
      readonly snapshot: WalletSnapshot;
      readonly stale?: true;
      readonly error?: Error;
    };

type ProtocolNativeBalanceRead =
  | {
      readonly status: "blocked";
      readonly accessState: BlockedCollectorAccessState;
    }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: Error }
  | {
      readonly status: "loaded";
      readonly balance: {
        readonly formatted: string;
        readonly observedBlock: bigint;
        readonly rawWei: bigint;
      };
    };

const tracks = [1, 2, 3, 4] as const;
const adminHistoryBasePath = "/api/admin/history";

const canLoadPublicStatus = (
  reader: ProtocolReader | undefined,
  pathname: string,
  connected: boolean,
): boolean =>
  reader !== undefined &&
  (shouldLoadPublicStatus(pathname) ||
    (!connected && !isProtectedAdminPath(pathname)));

const canLoadWallet = (
  reader: ProtocolReader | undefined,
  connection: ReturnType<typeof useConnection>,
  publicStatusEnabled: boolean,
): boolean =>
  !publicStatusEnabled &&
  reader !== undefined &&
  connection.status === "connected" &&
  connection.chainId === protocolChain.id;

export const isProtectedAdminPath = (pathname: string): boolean =>
  pathname !== "/admin/sign-in" &&
  (pathname === "/admin" || pathname.startsWith("/admin/"));

export const composeAdminProtocolHistory = (
  publicHistory: ProtocolHistory,
  protectedHistory: ProtocolHistory,
): ProtocolHistory => ({
  ...publicHistory,
  recentOperationalEvents: protectedHistory.recentOperationalEvents,
});

const walletCollectibles = (
  wallet: WalletSnapshot | undefined,
  state: "transient" | "permanent",
) => wallet?.collectibles[state] ?? [];

const trackRecord = <Value,>(
  health: HealthSnapshot,
  select: (
    queue: HealthSnapshot["operations"]["trackQueues"][number] | undefined,
  ) => Value,
): Record<Track, Value> => {
  const queues = new Map(
    health.operations.trackQueues.map((queue) => [queue.trackId, queue]),
  );
  return Object.fromEntries(
    tracks.map((track) => [track, select(queues.get(track))]),
  ) as Record<Track, Value>;
};

const runtimePauses = (health: HealthSnapshot) => ({
  liquidToken: health.pauses.liquidToken ?? true,
  rewards: health.pauses.rewards ?? true,
  converter: health.pauses.converter ?? true,
  liquidity: health.pauses.liquidity ?? true,
});

const createTransactionRuntime = ({
  health,
  wallet,
  chainId,
  address,
  directCollectibles = [],
}: {
  readonly health: HealthSnapshot;
  readonly wallet: WalletSnapshot | undefined;
  readonly chainId: number;
  readonly address: Address;
  readonly directCollectibles?: readonly DirectCollectibleSnapshot[];
}): TransactionRuntimeContext => {
  const transient = walletCollectibles(wallet, "transient");
  const permanent = walletCollectibles(wallet, "permanent");
  // An identity that was never discovered has no owner to compare against.
  const directlyOwned = directCollectibles.filter(
    (item): item is DiscoveredCollectibleSnapshot =>
      item.status === "discovered" &&
      item.owner.toLowerCase() === address.toLowerCase(),
  );
  return {
    connectedChainId: chainId,
    currentBlock: health.deployment.observedBlock,
    currentTimestamp: BigInt(health.deployment.observedAt),
    connectedWallet: address,
    roles: health.roles,
    launched: health.deployment.launched ?? false,
    sealed: health.deployment.seals.conversionRoutes ?? false,
    liquidityConfigurationSealed:
      health.deployment.seals.feeDestinations ?? false,
    pauses: runtimePauses(health),
    rewardPotWeth: health.market.rewardPotWeth ?? 0n,
    creatorPotWeth: health.market.creatorPotWeth ?? 0n,
    nextRewardEpochAt: health.operations.nextRewardEpochAt ?? 0n,
    // Without this the console rendered the eligibility controls -- the
    // manifest says the policy is configurable -- while preparation always
    // threw the "fixed gate" error, making the deniable-claim flow unreachable
    // from the UI on the exact deployment that exists to exercise it.
    claimPolicyAdministrator:
      health.deployment.claimPolicy?.mode === "configurable"
        ? (health.deployment.claimPolicy.administrator as Address)
        : undefined,
    trackQueues: trackRecord(health, (queue) => queue?.weth ?? 0n),
    trackAttemptHistoryAvailable: trackRecord(
      health,
      (queue) => queue?.attemptHistoryAvailable ?? false,
    ),
    retryableTracks: new Set(
      health.operations.trackQueues
        .filter((item) => item.status === "retryable")
        .map((item) => item.trackId),
    ),
    ownedTransientIdentityIds: new Set([
      ...transient.map((item) => item.identityId),
      ...directlyOwned
        .filter((item) => !item.permanent)
        .map((item) => item.collectible.identityId),
    ]),
    ownedPermanentIdentityIds: new Set([
      ...permanent.map((item) => item.identityId),
      ...directlyOwned
        .filter((item) => item.permanent)
        .map((item) => item.collectible.identityId),
    ]),
    claimableIdentityIds: new Set(
      [...permanent, ...directlyOwned.map((item) => item.collectible)]
        .filter((item) => item.claimEligible)
        .map((item) => item.identityId),
    ),
    readAvailability: health.transactionReadAvailability,
  };
};

type ProtocolClientContextValue = {
  readonly accessState: CollectorAccessState;
  readonly address: Address | undefined;
  readonly chainId: number | undefined;
  readonly connected: boolean;
  readonly deploymentAvailable: boolean;
  readonly reader: ProtocolReader | undefined;
  readonly readerForSignal: (signal: AbortSignal) => ProtocolReader | undefined;
  readonly health: HealthSnapshot | undefined;
  readonly healthPending: boolean;
  readonly healthRefreshing: boolean;
  readonly healthError: Error | null;
  readonly publicStatus: PublicStatusModel | undefined;
  readonly publicStatusPending: boolean;
  readonly publicStatusRefreshing: boolean;
  readonly publicStatusError: Error | null;
  readonly marketHistory: IndexedMarketHistoryRead;
  readonly exchangeQuoteRevision: number;
  /** A confirmed transaction is ahead of a wallet balance or holdings read. */
  readonly walletSynchronizing: boolean;
  /** Session-scoped receipt floor for direct identity ownership/reward evidence. */
  readonly minimumCollectibleBlock?: bigint | undefined;
  readonly walletRead: ProtocolWalletRead;
  readonly nativeBalanceRead: ProtocolNativeBalanceRead;
  readonly transaction: TransactionState;
  readonly transactionPersistenceAvailable?: boolean;
  readonly completedTransactions?: readonly CompletedCollectorTransaction[];
  readonly transactionMetadata?:
    | {
        readonly operationId: string;
        readonly identityIds: readonly number[];
        readonly actionType: string;
        readonly createdAt: number;
      }
    | undefined;
  readonly clearTransaction?: () => void;
  /**
   * A bare refresh reads once. A caller that knows a balance or holding changed
   * passes its block so direct balances and indexed holdings retry together,
   * a bounded number of times, until every observation has caught up.
   */
  readonly refresh: (minimumWalletBlock?: bigint) => Promise<void>;
  /** Refreshes wallet-scoped balances and holdings without rereading protocol health. */
  readonly refreshWallet: (minimumWalletBlock?: bigint) => Promise<void>;
  readonly refreshMarketHistory: () => Promise<void>;
  readonly getActionState: (action: ProtocolAction) => {
    readonly enabled: boolean;
    readonly reason: string | undefined;
  };
  readonly execute: (
    action: ProtocolAction,
    label: string,
    authorize?: TransactionAuthorization,
  ) => Promise<TransactionState>;
  readonly retry: (
    authorize?: TransactionAuthorization,
  ) => Promise<TransactionState>;
};

const ProtocolClientContext = createContext<ProtocolClientContextValue | null>(
  null,
);

const getError = (error: unknown) =>
  error instanceof Error
    ? error
    : error === null
      ? null
      : new Error(String(error));

export { runPublicRead as withPublicReadTimeout } from "@orbit/protocol/read-lifetime";

export { isPublicStatusModel } from "@orbit/protocol/public-status-codec";

export const deriveCurrentHealth = (
  snapshot: HealthSnapshot | undefined,
  error: unknown,
  failClosed = false,
): HealthSnapshot | undefined => {
  return failClosed && getError(error) !== null ? undefined : snapshot;
};

const deriveScopedHealthRead = ({
  deploymentAvailable,
  health,
  healthError,
  healthPending,
  healthRefreshing,
  healthFailClosed,
  publicStatus,
  publicStatusEnabled,
  publicStatusError,
  publicStatusPending,
  publicStatusRefreshing,
}: {
  readonly deploymentAvailable: boolean;
  readonly health: HealthSnapshot | undefined;
  readonly healthError: unknown;
  readonly healthPending: boolean;
  readonly healthRefreshing: boolean;
  readonly healthFailClosed: boolean;
  readonly publicStatus: PublicStatusModel | undefined;
  readonly publicStatusEnabled: boolean;
  readonly publicStatusError: unknown;
  readonly publicStatusPending: boolean;
  readonly publicStatusRefreshing: boolean;
}) => {
  if (publicStatusEnabled) {
    const error = getError(publicStatusError);
    return {
      health: undefined,
      healthError: null,
      healthPending: false,
      healthRefreshing: false,
      publicStatus,
      publicStatusError: error,
      publicStatusPending,
      publicStatusRefreshing,
    } as const;
  }
  return {
    health: deriveCurrentHealth(health, healthError, healthFailClosed),
    healthError: getError(healthError),
    healthPending: healthPending && deploymentAvailable,
    healthRefreshing: healthRefreshing && deploymentAvailable,
    publicStatus: undefined,
    publicStatusError: null,
    publicStatusPending: false,
    publicStatusRefreshing: false,
  } as const;
};

const canRetainWalletAfterFailure = (error: Error): boolean => {
  try {
    let cause: unknown = error;
    let transient = false;
    for (let depth = 0; depth < 8 && cause instanceof Error; depth += 1) {
      if (cause.name === "IndexedHistoryError") {
        if (!("code" in cause) || cause.code !== "history-rpc-unavailable")
          return false;
        transient = true;
      }
      if (cause.name === "PublicReadTimeoutError") transient = true;
      cause = cause.cause;
    }
    return transient || isTransientPreSubmissionRpcFailure(error);
  } catch {
    return false;
  }
};

export const deriveWalletRead = ({
  accessState,
  error,
  fetching,
  minimumBlock,
  pending,
  snapshot,
}: {
  readonly accessState: CollectorAccessState;
  readonly error: unknown;
  readonly fetching: boolean;
  readonly minimumBlock?: bigint | undefined;
  readonly pending: boolean;
  readonly snapshot: WalletSnapshot | undefined;
}): ProtocolWalletRead => {
  if (accessState !== "ready") {
    return { status: "blocked", accessState };
  }
  const walletError = getError(error);
  if (walletError !== null) {
    return snapshot !== undefined && canRetainWalletAfterFailure(walletError)
      ? { status: "loaded", snapshot, stale: true, error: walletError }
      : { status: "failed", error: walletError };
  }
  if (snapshot !== undefined) {
    if (
      walletSnapshotIsSynchronizing(
        minimumBlock,
        snapshot.collectibles.permanentObservedBlock,
      )
    ) {
      return {
        status: "loaded",
        snapshot: {
          ...snapshot,
          collectibles: {
            ...snapshot.collectibles,
            permanentHoldingsStatus: "unavailable",
          },
        },
      };
    }
    return { status: "loaded", snapshot };
  }
  if (pending || fetching) return { status: "loading" };
  return { status: "loading" };
};

export const deriveNativeBalanceRead = ({
  accessState,
  balance,
  error,
  fetching,
  pending,
}: {
  readonly accessState: CollectorAccessState;
  readonly balance:
    | {
        readonly formatted: string;
        readonly observedBlock: bigint;
        readonly rawWei: bigint;
      }
    | undefined;
  readonly error: unknown;
  readonly fetching: boolean;
  readonly pending: boolean;
}): ProtocolNativeBalanceRead => {
  if (accessState !== "ready") {
    return { status: "blocked", accessState };
  }
  const balanceError = getError(error);
  if (balanceError !== null) return { status: "failed", error: balanceError };
  if (balance !== undefined) return { status: "loaded", balance };
  if (pending || fetching) return { status: "loading" };
  return { status: "loading" };
};

export const walletSnapshotIsSynchronizing = (
  minimumBlock: bigint | undefined,
  observedBlock: bigint | undefined,
): boolean =>
  minimumBlock !== undefined &&
  (observedBlock === undefined || observedBlock < minimumBlock);

const walletObservation = (
  snapshot: WalletSnapshot | undefined,
  nativeBalance: { readonly observedBlock: bigint } | undefined,
) => {
  const permanentBlock = snapshot?.collectibles.permanentObservedBlock;
  if (
    snapshot === undefined ||
    permanentBlock === undefined ||
    nativeBalance === undefined
  )
    return;
  return {
    observedBlock: [
      snapshot.observedBlock,
      permanentBlock,
      nativeBalance.observedBlock,
    ].reduce((oldest, block) => (block < oldest ? block : oldest)),
  };
};

const knownCollectibleIds = (snapshot: WalletSnapshot | undefined): number[] =>
  snapshot === undefined
    ? []
    : [
        ...snapshot.collectibles.transient,
        ...snapshot.collectibles.permanent,
      ].map((craft) => craft.identityId);

type WalletClient = ViemWalletClient;
type PreparedTransaction = ReturnType<ProtocolReader["prepareTransaction"]>;
type SwapAction = Extract<ProtocolAction, { type: "swap-exact-input" }>;
type SwapQuoteRead = Awaited<ReturnType<ProtocolReader["quoteExactInput"]>>;
type ExchangeApprovalAsset = "liquid-token" | "weth";

const requireWalletBoundSwapQuote = (
  quote: SwapQuoteRead,
): SwapAction["quote"] => {
  const discovery = "discovery" in quote ? quote.discovery : undefined;
  if (discovery === undefined) {
    throw new TransactionPreparationError(
      "discovery-evidence-invalid",
      applicationCopy.exchange.discoveryEvidenceUnavailable,
    );
  }
  return { ...quote, discovery };
};

const sameAddress = (left: Address, right: Address): boolean =>
  left.toLowerCase() === right.toLowerCase();

const discoveryLegMatches = (
  reviewed: SwapAction["quote"]["discovery"]["sender"],
  current: SwapAction["quote"]["discovery"]["sender"],
): boolean =>
  sameAddress(reviewed.account, current.account) &&
  reviewed.balance === current.balance &&
  reviewed.discoveryExempt === current.discoveryExempt &&
  reviewed.mutations === current.mutations;

const discoveryHoldingsMatch = (
  reviewed: SwapAction["quote"]["discovery"]["accountHoldings"],
  current: SwapAction["quote"]["discovery"]["accountHoldings"],
): boolean =>
  reviewed.pendingDiscoveryCount === current.pendingDiscoveryCount &&
  reviewed.transientCollectibleCount === current.transientCollectibleCount;

const discoveryCapacitySummaryMatches = (
  reviewed: SwapAction["quote"]["discovery"],
  current: SwapAction["quote"]["discovery"],
): boolean =>
  reviewed.mutations === current.mutations &&
  reviewed.maximumMutations === current.maximumMutations &&
  reviewed.executable === current.executable &&
  reviewed.maximumLiquidTokenAmount === current.maximumLiquidTokenAmount;

const materiallyMatchesReviewedSwapQuote = (
  reviewed: SwapAction["quote"],
  current: SwapAction["quote"],
): boolean =>
  reviewed.liquidTokenForWeth === current.liquidTokenForWeth &&
  reviewed.amountIn === current.amountIn &&
  sameAddress(reviewed.discovery.account, current.discovery.account) &&
  discoveryHoldingsMatch(
    reviewed.discovery.accountHoldings,
    current.discovery.accountHoldings,
  ) &&
  discoveryLegMatches(reviewed.discovery.sender, current.discovery.sender) &&
  discoveryLegMatches(
    reviewed.discovery.recipient,
    current.discovery.recipient,
  ) &&
  discoveryCapacitySummaryMatches(reviewed.discovery, current.discovery);

const requireReviewedSwapQuote = (
  reviewed: SwapAction["quote"],
  current: SwapAction["quote"],
): void => {
  if (!materiallyMatchesReviewedSwapQuote(reviewed, current)) {
    throw new TransactionPreparationError(
      "quote-review-changed",
      applicationCopy.exchange.quoteReviewChanged,
    );
  }
};

const refreshWalletBoundSwapAction = ({
  action,
  quote,
  recipient,
  renewDeadline,
}: {
  readonly action: SwapAction;
  readonly quote: SwapAction["quote"];
  readonly recipient: Address;
  readonly renewDeadline: boolean;
}): SwapAction => ({
  ...action,
  quote,
  recipient,
  ...(renewDeadline
    ? { deadline: BigInt(Math.floor(Date.now() / 1_000)) + 600n }
    : {}),
});

class TransactionScopeChangedError extends Error {
  constructor() {
    super("Transaction scope changed before submission");
    this.name = "TransactionScopeChangedError";
  }
}

const retriableTransactionFailureCodes = new Set([
  "wallet-rejected",
  "stale-quote",
  "deadline-expired",
  "rpc-failure",
  "transaction-outcome-unknown",
]);

const normalizeTransactionFailure = (cause: unknown, failureStep: string) => {
  try {
    if (cause instanceof ReplacedProtocolTransactionError) {
      return { code: "transaction-replaced", message: cause.message };
    }
    if (cause instanceof AdminActionAuthorizationDeniedError) {
      return { code: "admin-action-forbidden", message: cause.message };
    }
    if (cause instanceof TransactionPreparationError) {
      return { code: cause.code, message: cause.message };
    }
    if (cause instanceof RevertedProtocolTransactionError) {
      return {
        code: "transaction-reverted",
        message: applicationCopy.transaction.reverted,
      };
    }
    if (cause instanceof UnknownProtocolTransactionOutcomeError) {
      return {
        code: "transaction-outcome-unknown",
        message: applicationCopy.transaction.outcomeUnknownMessage,
      };
    }
  } catch {
    // Hostile providers can reject with proxies whose prototype/property
    // access throws. Fall through to the bounded, fail-closed normalizer.
  }
  const error = normalizeProtocolError(cause, identity);
  return error.code === "rpc-failure" &&
    failureStep.endsWith("wallet submission")
    ? { ...error, message: applicationCopy.transaction.walletSubmissionFailed }
    : error;
};

const isTransactionScopeChangedError = (cause: unknown): boolean => {
  try {
    return cause instanceof TransactionScopeChangedError;
  } catch {
    return false;
  }
};

const transactionSurvivesScopeChange = (state: TransactionState): boolean =>
  state.status === "submitted" || state.status === "outcome-unknown";

const discardBeforeSubmittedHash = (
  scopeCurrent: boolean,
  state: TransactionState,
): boolean => !scopeCurrent && !("hash" in state);

const discardSettledScopedState = (
  scopeCurrent: boolean,
  state: TransactionState,
): boolean => !scopeCurrent && !transactionSurvivesScopeChange(state);

const releaseExecutionLock = (
  activeExecution: symbol | undefined,
  executionId: symbol,
  state: TransactionState,
): boolean =>
  activeExecution === executionId &&
  state.status !== "outcome-unknown" &&
  state.status !== "submission-unknown";

interface TransactionExecutionBoundary {
  readonly privacyIsCurrent: () => boolean;
  readonly scopeIsCurrent: () => boolean;
  readonly persistUncertainSubmission: (state: TransactionState) => void;
}

const uncertainWalletSubmission = (
  state: TransactionState,
  failureStep: string,
  code: string,
  cause: unknown,
): TransactionState | undefined =>
  failureStep.endsWith("wallet submission") &&
  state.status === "simulated" &&
  code !== "wallet-rejected" &&
  !isTransactionScopeChangedError(cause)
    ? {
        status: "submission-unknown",
        label: state.label,
        message:
          "The app did not receive a transaction hash from your wallet. Check your wallet activity before trying again; the transaction may have been sent.",
      }
    : undefined;

const publishSubmissionUncertainty = (
  boundary: TransactionExecutionBoundary,
  state: TransactionState,
  update: (state: TransactionState) => void,
): void => {
  if (boundary.privacyIsCurrent()) update(state);
  else boundary.persistUncertainSubmission(state);
};

const handleTransactionExecutionFailure = ({
  boundary,
  cause,
  currentTransaction,
  executionState,
  failureStep,
  invalidateExchangeQuote,
  submittedPhase,
  updateTransaction,
}: {
  readonly boundary: TransactionExecutionBoundary;
  readonly cause: unknown;
  readonly currentTransaction: () => TransactionState;
  readonly executionState: { current: TransactionState };
  readonly failureStep: string;
  readonly invalidateExchangeQuote: () => void;
  readonly submittedPhase: {
    current: SubmittedTransactionPhase | undefined;
  };
  readonly updateTransaction: (state: TransactionState) => void;
}): TransactionState => {
  const domainError = normalizeTransactionFailure(cause, failureStep);
  const uncertain = uncertainWalletSubmission(
    executionState.current,
    failureStep,
    domainError.code,
    cause,
  );
  if (uncertain !== undefined) {
    executionState.current = uncertain;
    publishSubmissionUncertainty(boundary, uncertain, updateTransaction);
    return uncertain;
  }
  if (!boundary.privacyIsCurrent()) {
    submittedPhase.current = undefined;
    return createTransactionState();
  }
  const scopeCurrent = boundary.scopeIsCurrent();
  if (discardBeforeSubmittedHash(scopeCurrent, executionState.current)) {
    const idle = createTransactionState();
    updateTransaction(idle);
    return idle;
  }
  if (isTransactionScopeChangedError(cause)) {
    submittedPhase.current = undefined;
    if (executionState.current.status === "confirmed") {
      const idle = createTransactionState();
      updateTransaction(idle);
      return idle;
    }
    return currentTransaction();
  }
  if (domainError.code === "quote-review-changed" && scopeCurrent) {
    invalidateExchangeQuote();
  }
  console.warn(
    `Protocol transaction failed during ${failureStep} (${domainError.code})`,
  );
  const failed = advanceTransaction(executionState.current, {
    type: "fail",
    message: domainError.message,
    retriable: retriableTransactionFailureCodes.has(domainError.code),
  });
  if (discardSettledScopedState(scopeCurrent, failed)) {
    submittedPhase.current = undefined;
    const idle = createTransactionState();
    updateTransaction(idle);
    return idle;
  }
  if (failed.status !== "outcome-unknown") {
    submittedPhase.current = undefined;
  }
  updateTransaction(failed);
  return failed;
};

const releaseTransactionExecution = ({
  activeExecution,
  boundary,
  executionId,
  state,
}: {
  readonly activeExecution: { current: symbol | undefined };
  readonly boundary: TransactionExecutionBoundary;
  readonly executionId: symbol;
  readonly state: TransactionState;
}): void => {
  if (activeExecution.current !== executionId) return;
  if (
    boundary.privacyIsCurrent() &&
    !releaseExecutionLock(activeExecution.current, executionId, state)
  ) {
    return;
  }
  activeExecution.current = undefined;
};

const replacementFailure = (
  state: TransactionState,
): ReplacedProtocolTransactionError | undefined =>
  (state.status === "outcome-unknown" || state.status === "submitted") &&
  state.replacement !== undefined
    ? new ReplacedProtocolTransactionError(state.hash, state.replacement)
    : undefined;

const reconcileUnknownTransaction = async ({
  refresh,
  state,
  onState,
}: {
  readonly refresh: (minimumWalletBlock?: bigint) => Promise<void>;
  readonly state: Extract<TransactionState, { status: "outcome-unknown" }>;
  readonly onState: (state: TransactionState) => void;
}): Promise<TransactionState> => {
  let observedState: TransactionState = state;
  let receipt: Awaited<
    ReturnType<typeof protocolTransactionClient.waitForTransactionReceipt>
  >;
  try {
    receipt = await protocolTransactionClient.waitForTransactionReceipt({
      hash: state.hash,
      timeout: 30_000,
      retryCount: 1,
      pollingInterval: 4_000,
      onReplaced: ({ transaction, reason }) => {
        observedState = advanceTransaction(observedState, {
          type: "replace",
          hash: transaction.hash,
          reason,
        });
        onState(observedState);
      },
    });
  } catch (cause) {
    const domainError = normalizeProtocolError(cause, identity);
    console.warn(
      `Protocol transaction reconciliation failed (${domainError.code})`,
    );
    const outcomeUnknown = advanceTransaction(observedState, {
      type: "fail",
      message: applicationCopy.transaction.outcomeUnknownMessage,
      retriable: true,
    });
    return outcomeUnknown;
  }
  let receiptStatus: "success" | "reverted";
  let blockNumber: bigint;
  try {
    const observedStatus = receipt.status;
    const observedBlockNumber = receipt.blockNumber;
    if (observedStatus !== "success" && observedStatus !== "reverted") {
      throw new TypeError("Transaction receipt status is invalid");
    }
    if (typeof observedBlockNumber !== "bigint" || observedBlockNumber < 0n) {
      throw new TypeError("Transaction receipt block number is invalid");
    }
    receiptStatus = observedStatus;
    blockNumber = observedBlockNumber;
  } catch (cause) {
    const domainError = normalizeProtocolError(cause, identity);
    console.error(
      `Protocol transaction reconciliation returned invalid receipt evidence (${domainError.code})`,
    );
    return advanceTransaction(observedState, {
      type: "fail",
      message: applicationCopy.transaction.outcomeUnknownMessage,
      retriable: true,
    });
  }
  const replacement = replacementFailure(observedState);
  if (replacement !== undefined) {
    return advanceTransaction(observedState, {
      type: "fail",
      message: replacement.message,
      retriable: false,
    });
  }
  if (receiptStatus === "reverted") {
    const failed = advanceTransaction(observedState, {
      type: "fail",
      message: applicationCopy.transaction.reverted,
      retriable: false,
    });
    return failed;
  }
  const confirmed = advanceTransaction(observedState, { type: "confirm" });
  try {
    await refresh(blockNumber);
  } catch (cause) {
    const domainError = normalizeProtocolError(cause, identity);
    console.warn(
      `Protocol transaction post-confirmation refresh failed (${domainError.code})`,
    );
  }
  return confirmed;
};

const freshOperatorActionTypes = new Set<ProtocolAction["type"]>([
  "open-reward-epoch",
  "execute-track",
  "retry-track",
  "execute-pol",
  "set-pause",
  "configure-conversion-track",
]);

const ownershipActionTypes = new Set<ProtocolAction["type"]>([
  "claim",
  "commit-collectible",
  "direct-collectible-transfer",
]);

const requireTransactionClients = ({
  address,
  chainId,
  reader,
  walletClient,
}: {
  readonly address: Address | undefined;
  readonly chainId: number | undefined;
  readonly reader: ProtocolReader | undefined;
  readonly walletClient: WalletClient | undefined;
}) => {
  if (
    reader === undefined ||
    walletClient === undefined ||
    address === undefined ||
    chainId === undefined
  ) {
    throw new Error("Protocol transaction client is not ready");
  }
  return { address, chainId, reader, walletClient };
};

const readPreflightSnapshots = async ({
  action,
  address,
  cachedHealth,
  cachedWallet,
  failureStep,
  reader,
}: {
  readonly action: ProtocolAction;
  readonly address: Address;
  readonly cachedHealth: HealthSnapshot | undefined;
  readonly cachedWallet: WalletSnapshot | undefined;
  readonly failureStep: { current: string };
  readonly reader: ProtocolReader;
}) => {
  const freshOperatorHealth = freshOperatorActionTypes.has(action.type);
  failureStep.current = "protocol health preflight";
  const health = freshOperatorHealth
    ? await reader.readHealth(address, undefined, undefined, {
        includeOperationalHistory: true,
        includeRewardHistory: false,
      })
    : (cachedHealth ??
      (await reader.readHealth(address, undefined, undefined, {
        includeBytecodeInventory: false,
        includeOperationalHistory: false,
        includeRewardHistory: false,
      })));
  const directIdentityIds =
    action.type === "claim"
      ? action.identityIds
      : action.type === "direct-collectible-transfer"
        ? [action.identityId]
        : [];
  failureStep.current = "wallet ownership preflight";
  const [wallet, directCollectibles] = await Promise.all([
    ownershipActionTypes.has(action.type)
      ? reader.readWallet(address, knownCollectibleIds(cachedWallet))
      : Promise.resolve(cachedWallet),
    Promise.all(
      directIdentityIds.map((identityId) => reader.readCollectible(identityId)),
    ),
  ]);
  return { directCollectibles, freshOperatorHealth, health, wallet };
};

const updateRuntimeBlock = async (
  runtime: TransactionRuntimeContext,
  freshOperatorHealth: boolean,
): Promise<TransactionRuntimeContext> => {
  if (freshOperatorHealth) return runtime;
  const block = await protocolTransactionClient.getBlock();
  return {
    ...runtime,
    currentBlock: block.number,
    currentTimestamp: block.timestamp,
  };
};

const sendPreparedTransaction = async ({
  address,
  assertActiveScope,
  failureStep,
  label,
  onState,
  prepared,
  walletClient,
}: {
  readonly address: Address;
  readonly assertActiveScope: () => void;
  readonly failureStep: { current: string };
  readonly label: string;
  readonly onState: (state: TransactionState) => void;
  readonly prepared: PreparedTransaction;
  readonly walletClient: WalletClient;
}): Promise<ExecutedProtocolTransaction> => {
  const data = encodeFunctionData({
    abi: prepared.abi,
    functionName: prepared.functionName,
    args: prepared.args,
  });
  const request = {
    account: address,
    to: prepared.to,
    data,
    value: prepared.value,
  } as const;
  return executeProtocolTransaction({
    estimateGas: async () => {
      return retryPreSubmissionPublicRpc({
        assertActive: assertActiveScope,
        request: () => protocolTransactionClient.estimateGas(request),
      });
    },
    failureStep,
    label,
    onState,
    outcomeUnknownMessage: applicationCopy.transaction.outcomeUnknownMessage,
    simulate: async () => {
      await retryPreSubmissionPublicRpc({
        assertActive: assertActiveScope,
        request: () => protocolTransactionClient.call(request),
      });
    },
    submit: (gas) => {
      assertActiveScope();
      return walletClient.sendTransaction({
        ...request,
        chain: protocolChain,
        gas,
      });
    },
    waitForReceipt: async (hash, onReplacement) => {
      const receipt = await protocolTransactionClient.waitForTransactionReceipt(
        {
          hash,
          timeout: 30_000,
          retryCount: 1,
          pollingInterval: 4_000,
          onReplaced: ({ transaction, reason }) =>
            onReplacement(transaction.hash, reason),
        },
      );
      return {
        blockNumber: receipt.blockNumber,
        status: receipt.status,
      };
    },
  });
};

const readRequiredExchangeApprovalAsset = async ({
  action,
  address,
  failureStep,
  reader,
}: {
  readonly action: ProtocolAction;
  readonly address: Address;
  readonly failureStep: { current: string };
  readonly reader: ProtocolReader;
}): Promise<ExchangeApprovalAsset | undefined> => {
  if (action.type !== "swap-exact-input") return undefined;
  if (action.useNative && !action.liquidTokenForWeth) return undefined;
  const asset = action.liquidTokenForWeth ? "liquid-token" : "weth";
  failureStep.current = "exchange allowance preflight";
  const allowance = await reader.readExchangeAllowance(
    address,
    action.liquidTokenForWeth,
  );
  return allowance.amount >= action.exactAmountIn ? undefined : asset;
};

const refreshWalletBoundActionForExecution = async ({
  action,
  address,
  failureStep,
  reader,
  renewDeadline,
}: {
  readonly action: ProtocolAction;
  readonly address: Address;
  readonly failureStep: { current: string };
  readonly reader: ProtocolReader;
  readonly renewDeadline: boolean;
}): Promise<ProtocolAction> => {
  if (action.type !== "swap-exact-input") return action;
  failureStep.current = "latest wallet-bound exchange quote";
  return refreshWalletBoundSwapAction({
    action,
    quote: requireWalletBoundSwapQuote(
      await reader.quoteExactInput(
        action.liquidTokenForWeth,
        action.exactAmountIn,
        address,
      ),
    ),
    recipient: address,
    renewDeadline,
  });
};

const requireReviewedSwapAction = (
  reviewed: ProtocolAction,
  current: ProtocolAction,
): void => {
  if (
    reviewed.type !== "swap-exact-input" ||
    current.type !== "swap-exact-input"
  ) {
    return;
  }
  requireReviewedSwapQuote(reviewed.quote, current.quote);
};

const prepareReviewedTransaction = ({
  action,
  reader,
  reviewedAction,
  runtime,
}: {
  readonly action: ProtocolAction;
  readonly reader: ProtocolReader;
  readonly reviewedAction: ProtocolAction;
  readonly runtime: TransactionRuntimeContext;
}): PreparedTransaction => {
  let prepared: PreparedTransaction;
  try {
    prepared = reader.prepareTransaction(action, runtime);
  } catch (cause) {
    if (
      cause instanceof TransactionPreparationError &&
      cause.code === "stale-quote"
    ) {
      requireReviewedSwapAction(reviewedAction, action);
    }
    throw cause;
  }
  requireReviewedSwapAction(reviewedAction, action);
  return prepared;
};

const finalizePreparedSwapAfterApproval = async ({
  action,
  address,
  assertActiveScope,
  cachedWallet,
  chainId,
  failureStep,
  onApprovalConfirmed,
  prepared,
  reader,
  refresh,
  requiredApprovalAsset,
  reviewedAction,
  runtime,
  send,
}: {
  readonly action: ProtocolAction;
  readonly address: Address;
  readonly assertActiveScope: () => void;
  readonly cachedWallet: WalletSnapshot | undefined;
  readonly chainId: number;
  readonly failureStep: { current: string };
  readonly onApprovalConfirmed: () => void;
  readonly prepared: PreparedTransaction;
  readonly reader: ProtocolReader;
  readonly refresh: (minimumWalletBlock?: bigint) => Promise<void>;
  readonly requiredApprovalAsset: "liquid-token" | "weth" | undefined;
  readonly reviewedAction: ProtocolAction;
  readonly runtime: TransactionRuntimeContext;
  readonly send: (
    prepared: PreparedTransaction,
    label: string,
    phase?: SubmittedTransactionPhase,
  ) => Promise<ExecutedProtocolTransaction>;
}): Promise<PreparedTransaction> => {
  if (
    requiredApprovalAsset === undefined ||
    reviewedAction.type !== "swap-exact-input" ||
    action.type !== "swap-exact-input"
  ) {
    return prepared;
  }
  const approval = reader.prepareTransaction(
    {
      type: "approve-exchange-input",
      asset: requiredApprovalAsset,
      amount: action.exactAmountIn,
    },
    runtime,
  );
  const approvalResult = await send(
    approval,
    applicationCopy.transaction.approval(
      requiredApprovalAsset === "weth"
        ? applicationCopy.exchange.wrappedEth
        : applicationCopy.exchange.token,
    ),
    { kind: "approval" },
  );
  assertActiveScope();
  onApprovalConfirmed();
  await refresh(approvalResult.blockNumber);
  assertActiveScope();

  const postApprovalSnapshots = await readPreflightSnapshots({
    action,
    address,
    cachedHealth: undefined,
    cachedWallet,
    failureStep,
    reader,
  });
  assertActiveScope();
  const postApprovalRuntime = createTransactionRuntime({
    health: postApprovalSnapshots.health,
    wallet: postApprovalSnapshots.wallet,
    chainId,
    address,
  });
  failureStep.current = "post-approval wallet-bound exchange quote";
  const postApprovalAction = refreshWalletBoundSwapAction({
    action,
    quote: requireWalletBoundSwapQuote(
      await reader.quoteExactInput(
        action.liquidTokenForWeth,
        action.exactAmountIn,
        address,
      ),
    ),
    recipient: address,
    renewDeadline: false,
  });
  assertActiveScope();
  failureStep.current = "post-approval block preflight";
  const postApprovalCurrentRuntime = await updateRuntimeBlock(
    postApprovalRuntime,
    postApprovalSnapshots.freshOperatorHealth,
  );
  assertActiveScope();
  failureStep.current = "post-approval transaction preparation";
  return prepareReviewedTransaction({
    action: postApprovalAction,
    reader,
    reviewedAction,
    runtime: postApprovalCurrentRuntime,
  });
};

type ProtocolClientRuntime = {
  readonly adminReader: ProtocolReader;
  readonly adminTransactionReader: ProtocolReader;
  readonly publicReader: ProtocolReader;
  readonly publicTransactionReader: ProtocolReader;
};

const healthWalletScope = (
  includeConnectedWallet: boolean,
  address: Address | undefined,
): Address | undefined => (includeConnectedWallet ? address : undefined);

const healthQueryRetryForPath = (pathname: string) =>
  isProtectedAdminPath(pathname) ? webProtocolQueryRetryCount : false;

export const readersForPath = (
  runtime: ProtocolClientRuntime | undefined,
  pathname: string,
): {
  readonly reader: ProtocolReader | undefined;
  readonly transactionReader: ProtocolReader | undefined;
} => {
  if (runtime === undefined) {
    return { reader: undefined, transactionReader: undefined };
  }
  if (isProtectedAdminPath(pathname)) {
    return {
      reader: runtime.adminReader,
      transactionReader: runtime.adminTransactionReader,
    };
  }
  return {
    reader: runtime.publicReader,
    transactionReader: runtime.publicTransactionReader,
  };
};

const createProtocolRuntime = (signal?: AbortSignal) => {
  if (protocolDeploymentManifest === undefined) return undefined;
  const readClient =
    signal === undefined
      ? protocolReadClient
      : createProtocolReadClient(signal);
  const publicHistory = createIndexedHistoryReaders({
    basePath: publicApiUrl(PUBLIC_API_PATHS.history.root),
    fetcher: signal === undefined ? fetch : bindReadSignal(fetch, signal),
    identity,
    manifest: protocolDeploymentManifest,
  });
  const adminHistory = createIndexedHistoryReaders({
    basePath: adminHistoryBasePath,
    fetcher:
      signal === undefined
        ? adminProtectedFetch
        : bindReadSignal(adminProtectedFetch, signal),
    identity,
    manifest: protocolDeploymentManifest,
  });
  const adminProtocolHistory = composeAdminProtocolHistory(
    publicHistory.protocol,
    adminHistory.protocol,
  );
  const readTransport = makeViemProtocolTransport(
    // Base-family viem chain types add deposit transactions; the protocol
    // transport only uses the shared PublicClient read surface.
    readClient as unknown as Parameters<typeof makeViemProtocolTransport>[0],
    protocolDeploymentManifest,
    identity,
    undefined,
    signal,
  );
  const transactionTransport = makeViemProtocolTransport(
    protocolTransactionClient as unknown as Parameters<
      typeof makeViemProtocolTransport
    >[0],
    protocolDeploymentManifest,
    identity,
    undefined,
  );
  return {
    marketHistory: createCanonicalMarketHistoryReader({
      history: publicHistory,
      manifest: protocolDeploymentManifest,
      identity,
    }),
    publicReader: createProtocolReader({
      manifest: protocolDeploymentManifest,
      identity,
      history: publicHistory.protocol,
      transport: readTransport,
    }),
    adminReader: createProtocolReader({
      manifest: protocolDeploymentManifest,
      identity,
      history: adminProtocolHistory,
      transport: readTransport,
    }),
    publicTransactionReader: createProtocolReader({
      manifest: protocolDeploymentManifest,
      identity,
      history: publicHistory.protocol,
      transport: transactionTransport,
    }),
    adminTransactionReader: createProtocolReader({
      manifest: protocolDeploymentManifest,
      identity,
      history: adminProtocolHistory,
      transport: transactionTransport,
    }),
  };
};

const deploymentReadScope =
  protocolDeploymentManifest === undefined
    ? "unpublished"
    : deploymentManifestFingerprint(protocolDeploymentManifest);
const deploymentLaunchHash = protocolDeploymentManifest?.launch.transactionHash;

const isCurrentOperation = (
  metadata: CollectorTransactionMetadata | undefined,
  current: CollectorTransactionMetadata | undefined,
): boolean =>
  metadata === undefined || metadata.operationId === current?.operationId;

const collectorMetadata = (
  action: ProtocolAction,
  previous: CollectorTransactionMetadata | undefined,
): CollectorTransactionMetadata => {
  const affectedIdentityIds =
    "identityId" in action
      ? [action.identityId]
      : action.type === "claim"
        ? action.identityIds
        : [];
  // ponytail: retain 64 recent ownership hints; indexed history supplies the rest.
  return {
    operationId: crypto.randomUUID(),
    actionType: action.type,
    affectedIdentityIds,
    createdAt: Date.now(),
    identityIds: [
      ...new Set([...(previous?.identityIds ?? []), ...affectedIdentityIds]),
    ].slice(-64),
  };
};

const displayedTransactionMetadata = (
  metadata: CollectorTransactionMetadata | undefined,
): ProtocolClientContextValue["transactionMetadata"] =>
  metadata === undefined
    ? undefined
    : {
        operationId: metadata.operationId,
        identityIds: metadata.affectedIdentityIds,
        actionType: metadata.actionType,
        createdAt: metadata.createdAt,
      };

const actionPreparationMessage = (cause: unknown): string =>
  cause instanceof TransactionPreparationError
    ? cause.message
    : applicationCopy.common.notObserved;

const walletReadRequiresRecovery = (read: ProtocolWalletRead): boolean =>
  read.status === "failed" || (read.status === "loaded" && read.stale === true);

export function ProtocolClientProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const walletClient = useWalletClient({ chainId: protocolChain.id });
  const walletRecordScope = useMemo(
    () =>
      connection.status !== "connected" ||
      connection.address === undefined ||
      connection.chainId !== protocolChain.id ||
      protocolDeploymentManifest === undefined
        ? undefined
        : `${deploymentManifestFingerprint(protocolDeploymentManifest)}:${connection.chainId}:${connection.address.toLowerCase()}`,
    [connection.status, connection.address, connection.chainId],
  );
  const collectorRecordScope = pathname.startsWith("/admin")
    ? undefined
    : walletRecordScope;
  const recordScopeRef = useRef(walletRecordScope);
  const transactionMetadataRef = useRef<
    CollectorTransactionMetadata | undefined
  >(undefined);
  const transactionPersistRef = useRef(!pathname.startsWith("/admin"));
  const mountedRef = useRef(true);
  const restoredTransactionRef = useRef(false);
  const [transactionPersistenceAvailable, setTransactionPersistenceAvailable] =
    useState(true);
  const [completedTransactions, setCompletedTransactions] = useState<
    readonly CompletedCollectorTransaction[]
  >([]);
  const [transactionMetadata, setTransactionMetadata] =
    useState<ProtocolClientContextValue["transactionMetadata"]>();
  const [transaction, setTransaction] = useState(createTransactionState);
  const transactionRef = useRef<TransactionState>(transaction);
  const activeExecution = useRef<symbol | undefined>(undefined);
  const transactionPrivacyGenerationRef = useRef(0);
  const [minimumWalletBlock, setMinimumWalletBlock] = useState<
    bigint | undefined
  >();
  const [collectibleObservationFloor, setCollectibleObservationFloor] =
    useState<{ readonly scope: string; readonly block: bigint }>();
  const minimumCollectibleBlock =
    collectibleObservationFloor?.scope === walletRecordScope
      ? collectibleObservationFloor?.block
      : undefined;
  const [exchangeQuoteRevision, setExchangeQuoteRevision] = useState(0);
  const lastAttempt = useRef<ScopedTransactionAttempt | undefined>(undefined);
  const submittedTransactionPhase = useRef<
    SubmittedTransactionPhase | undefined
  >(undefined);
  const reconciliationInFlight = useRef(false);
  const updateTransaction = useCallback(
    (
      state: TransactionState,
      record: {
        readonly scope: string | undefined;
        readonly phase?: SubmittedTransactionPhase | undefined;
        readonly persist?: boolean;
        readonly metadata?: CollectorTransactionMetadata | undefined;
      } = {
        scope: recordScopeRef.current,
        phase: submittedTransactionPhase.current,
        persist: transactionPersistRef.current,
        metadata: transactionMetadataRef.current,
      },
    ) => {
      const metadata = record.metadata ?? transactionMetadataRef.current;
      const stored =
        record.scope === undefined ||
        record.persist === false ||
        metadata === undefined ||
        writeCollectorTransaction(record.scope, state, record.phase, metadata);
      if (
        !mountedRef.current ||
        record.scope !== recordScopeRef.current ||
        !isCurrentOperation(record.metadata, transactionMetadataRef.current)
      )
        return;
      transactionRef.current = state;
      setTransaction(state);
      setTransactionMetadata(displayedTransactionMetadata(metadata));
      setTransactionPersistenceAvailable(stored);
      if (record.scope !== undefined)
        setCompletedTransactions(
          readCompletedCollectorTransactions(record.scope),
        );
    },
    [],
  );
  const transactionScope = useMemo<TransactionScope>(
    () => ({
      address: connection.address,
      chainId: connection.chainId,
      pathname,
    }),
    [connection.address, connection.chainId, pathname],
  );
  const transactionScopeRef = useRef(transactionScope);
  const transactionScopeGenerationRef = useRef(0);
  useEffect(() => {
    const purgeAdminState = () => {
      if (!isProtectedAdminPath(transactionScopeRef.current.pathname)) return;
      transactionPrivacyGenerationRef.current += 1;
      transactionScopeGenerationRef.current += 1;
      lastAttempt.current = undefined;
      setMinimumWalletBlock(undefined);
      setCollectibleObservationFloor(undefined);
      activeExecution.current = undefined;
      updateTransaction(createTransactionState());
    };
    window.addEventListener(ADMIN_SESSION_ENDED_EVENT, purgeAdminState);
    return () =>
      window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, purgeAdminState);
  }, [updateTransaction]);
  useLayoutEffect(() => {
    if (transactionScopeRef.current === transactionScope) return;
    transactionScopeGenerationRef.current += 1;
    transactionScopeRef.current = transactionScope;
    lastAttempt.current = undefined;
  }, [transactionScope]);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      transactionPrivacyGenerationRef.current += 1;
    };
  }, []);
  useLayoutEffect(() => {
    if (recordScopeRef.current !== walletRecordScope) {
      transactionPrivacyGenerationRef.current += 1;
      activeExecution.current = undefined;
      reconciliationInFlight.current = false;
      setMinimumWalletBlock(undefined);
      setCollectibleObservationFloor(undefined);
    }
    recordScopeRef.current = walletRecordScope;
    const saved =
      walletRecordScope === undefined
        ? undefined
        : readCollectorTransaction(walletRecordScope);
    const state = saved?.state ?? createTransactionState();
    submittedTransactionPhase.current = saved?.phase;
    transactionMetadataRef.current = saved;
    transactionPersistRef.current = saved !== undefined;
    if (isTransactionInFlight(state)) {
      activeExecution.current = Symbol("restored collector transaction");
      restoredTransactionRef.current = true;
    }
    transactionRef.current = state;
    // Synchronize the external wallet-scoped storage before painting another wallet's activity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTransaction(state);
    setTransactionMetadata(displayedTransactionMetadata(saved));
    setCompletedTransactions(
      walletRecordScope === undefined
        ? []
        : readCompletedCollectorTransactions(walletRecordScope),
    );
  }, [walletRecordScope]);
  const transactionScopeStateRef = useRef(transactionScope);
  useEffect(() => {
    if (transactionScopeStateRef.current === transactionScope) return;
    transactionScopeStateRef.current = transactionScope;
    const current = transactionRef.current;
    if (
      transactionScope.pathname.startsWith("/admin") &&
      !isTransactionInFlight(current)
    ) {
      updateTransaction(createTransactionState());
    }
  }, [transactionScope, updateTransaction]);

  const runtime = useMemo(() => createProtocolRuntime(), []);
  const { reader, transactionReader } = readersForPath(runtime, pathname);
  const readerForSignal = useCallback(
    (signal: AbortSignal) =>
      readersForPath(createProtocolRuntime(signal), pathname).reader,
    [pathname],
  );

  const accessState = getCollectorAccessState({
    connected: connection.status === "connected",
    chainId: connection.chainId,
    deploymentAvailable: reader !== undefined,
    expectedChainId: deploymentEnvironment.chainId,
  });
  const {
    includeBytecodeInventory,
    includeConnectedWallet,
    includeOperationalHistory,
    includeRewardHistory,
  } = getProtocolHealthReadScope(pathname);
  const healthConnectedWallet = healthWalletScope(
    includeConnectedWallet,
    connection.address,
  );
  // Authorization diagnostics are needed for a connected transaction preview,
  // not for an anonymous visitor to the same collector route.
  const publicStatusEnabled = canLoadPublicStatus(
    reader,
    pathname,
    connection.status === "connected",
  );
  const publicStatusScope = deploymentReadScope;
  const publicStatusQueryKey = useMemo(
    () => ["public-protocol-status", publicStatusScope] as const,
    [publicStatusScope],
  );
  useLayoutEffect(() => {
    if (publicStatusEnabled) {
      for (const queryKey of [
        ["protocol-health"],
        ["protocol-wallet"],
        ["protocol-native-balance"],
      ]) {
        void queryClient.cancelQueries({ queryKey });
        queryClient.removeQueries({ queryKey });
      }
    } else {
      void queryClient.cancelQueries({ queryKey: ["public-protocol-status"] });
    }
    if (!shouldLoadMarketHistory(pathname)) {
      void queryClient.cancelQueries({
        queryKey: ["canonical-market-history"],
      });
    }
  }, [pathname, publicStatusEnabled, queryClient]);

  const healthQuery = useQuery({
    queryKey: [
      "protocol-health",
      deploymentLaunchHash,
      healthConnectedWallet,
      includeBytecodeInventory,
      includeOperationalHistory,
      includeRewardHistory,
    ],
    queryFn: ({ signal }) => {
      const read = (readSignal: AbortSignal) => {
        const scopedReader = readersForPath(
          createProtocolRuntime(readSignal),
          pathname,
        ).reader;
        if (scopedReader === undefined)
          throw new Error("Protocol reader unavailable");
        return scopedReader.readHealth(
          healthConnectedWallet,
          undefined,
          undefined,
          {
            includeBytecodeInventory,
            includeOperationalHistory,
            includeRewardHistory,
          },
        );
      };
      return isProtectedAdminPath(pathname)
        ? read(signal)
        : runPublicRead(read, { signal });
    },
    enabled: reader !== undefined && !publicStatusEnabled,
    refetchInterval: false,
    retry: healthQueryRetryForPath(pathname),
  });
  const publicStatusQuery = useQuery({
    queryKey: publicStatusQueryKey,
    queryFn: async ({ signal }) => {
      const snapshot = await runPublicRead(
        (readSignal) => {
          const scopedReader = createProtocolRuntime(readSignal)?.publicReader;
          if (scopedReader === undefined)
            throw new Error("Protocol reader unavailable");
          return scopedReader.readPublicStatus();
        },
        { signal },
      );
      const publicModel = derivePublicStatusModel(snapshot);
      if (typeof window !== "undefined") {
        writePublicEvidenceCache(
          window.localStorage,
          publicStatusScope,
          publicModel,
        );
      }
      return publicModel;
    },
    enabled: publicStatusEnabled,
    refetchInterval: false,
    retry: false,
  });
  useEffect(() => {
    if (
      !publicStatusEnabled ||
      publicStatusQuery.data !== undefined ||
      typeof window === "undefined"
    ) {
      return;
    }
    const cached = readPublicEvidenceCache(
      window.localStorage,
      publicStatusScope,
    );
    if (cached === undefined) return;
    queryClient.setQueryData(publicStatusQueryKey, cached.model, {
      updatedAt: cached.savedAt,
    });
  }, [
    publicStatusEnabled,
    publicStatusQuery.data,
    publicStatusQueryKey,
    publicStatusScope,
    queryClient,
  ]);
  const {
    health: currentHealth,
    healthError: currentHealthError,
    healthPending: currentHealthPending,
    healthRefreshing: currentHealthRefreshing,
    publicStatus: currentPublicStatus,
    publicStatusError: currentPublicStatusError,
    publicStatusPending: currentPublicStatusPending,
    publicStatusRefreshing: currentPublicStatusRefreshing,
  } = deriveScopedHealthRead({
    deploymentAvailable: reader !== undefined,
    health: healthQuery.data,
    healthError: healthQuery.error,
    healthPending: healthQuery.isPending,
    healthRefreshing: healthQuery.isFetching,
    healthFailClosed: isProtectedAdminPath(pathname),
    publicStatus: publicStatusQuery.data,
    publicStatusEnabled,
    publicStatusError: publicStatusQuery.error,
    publicStatusPending: publicStatusQuery.isPending,
    publicStatusRefreshing: publicStatusQuery.isFetching,
  });
  const walletQueryKey = [
    "protocol-wallet",
    deploymentLaunchHash,
    connection.address,
    deploymentReadScope,
  ] as const;
  const walletQuery = useQuery({
    queryKey: walletQueryKey,
    queryFn: ({ signal }) => {
      const address = connection.address;
      if (address === undefined)
        throw new Error("Protocol wallet reader unavailable");
      return runPublicRead(
        (readSignal) => {
          const scopedReader = readersForPath(
            createProtocolRuntime(readSignal),
            pathname,
          ).reader;
          if (scopedReader === undefined)
            throw new Error("Protocol wallet reader unavailable");
          return scopedReader.readWallet(address, [
            ...new Set([
              ...knownCollectibleIds(
                queryClient.getQueryData<WalletSnapshot>(walletQueryKey),
              ),
              ...(walletRecordScope === undefined
                ? []
                : (readCollectorTransaction(walletRecordScope)?.identityIds ??
                  [])),
            ]),
          ]);
        },
        { signal },
      );
    },
    enabled: canLoadWallet(reader, connection, publicStatusEnabled),
    // Follow unsettled work across collector routes. Completed wallets stay idle.
    refetchInterval: ({ state }) => {
      if (state.error !== null) return 30_000;
      if (state.data === undefined) return false;
      const { collectibles, partialFailures = [] } = state.data;
      return (collectibles.pendingDiscovery?.count ?? 0) > 0 ||
        partialFailures.length > 0 ||
        walletSnapshotIsSynchronizing(
          minimumWalletBlock,
          collectibles.permanentObservedBlock,
        )
        ? 30_000
        : false;
    },
    retry: webProtocolQueryRetryCount,
  });
  const nativeBalanceQuery = useQuery({
    queryKey: [
      "protocol-native-balance",
      deploymentLaunchHash,
      connection.address,
    ],
    queryFn: async ({ signal }) => {
      const address = connection.address;
      if (address === undefined) {
        throw new Error("Native wallet balance reader unavailable");
      }
      return runPublicRead(
        async (readSignal) => {
          const client = createProtocolReadClient(readSignal);
          const observedBlock = await client.getBlockNumber({ cacheTime: 0 });
          const rawWei = await client.getBalance({
            address,
            blockNumber: observedBlock,
          });
          return { formatted: formatUnits(rawWei, 18), observedBlock, rawWei };
        },
        { signal },
      );
    },
    enabled: canLoadWallet(reader, connection, publicStatusEnabled),
    refetchInterval: ({ state }) =>
      state.error !== null ||
      walletSnapshotIsSynchronizing(
        minimumWalletBlock,
        state.data?.observedBlock,
      )
        ? 30_000
        : false,
    retry: webProtocolQueryRetryCount,
  });
  const marketHistoryEnabled =
    runtime !== undefined && shouldLoadMarketHistory(pathname);
  const marketHistoryQuery = useQuery({
    queryKey: ["canonical-market-history", deploymentLaunchHash],
    queryFn: ({ signal }) =>
      runPublicRead(
        (readSignal) => {
          const scopedRuntime = createProtocolRuntime(readSignal);
          if (scopedRuntime === undefined)
            throw new Error("Indexed market history reader unavailable");
          return scopedRuntime.marketHistory.readLatest();
        },
        { signal },
      ),
    enabled: marketHistoryEnabled,
    refetchInterval: false,
    retry: false,
  });
  const marketHistory = useMemo(
    () =>
      deriveIndexedMarketHistoryRead(
        marketHistoryQuery.data,
        marketHistoryQuery.error,
      ),
    [marketHistoryQuery.data, marketHistoryQuery.error],
  );
  const walletRead = deriveWalletRead({
    accessState,
    error: walletQuery.error,
    fetching: walletQuery.isFetching,
    minimumBlock: minimumWalletBlock,
    pending: walletQuery.isPending,
    snapshot: walletQuery.data,
  });
  const nativeBalanceRead = deriveNativeBalanceRead({
    accessState,
    balance: nativeBalanceQuery.data,
    error: nativeBalanceQuery.error,
    fetching: nativeBalanceQuery.isFetching,
    pending: nativeBalanceQuery.isPending,
  });
  const walletSynchronizing = walletSnapshotIsSynchronizing(
    minimumWalletBlock,
    walletObservation(walletQuery.data, nativeBalanceQuery.data)?.observedBlock,
  );

  const refreshWallet = useCallback(
    async (requiredWalletBlock?: bigint) => {
      if (accessState !== "ready") return;
      if (
        requiredWalletBlock !== undefined &&
        walletRecordScope !== undefined &&
        recordScopeRef.current === walletRecordScope
      ) {
        setCollectibleObservationFloor((current) =>
          current?.scope === walletRecordScope &&
          current.block >= requiredWalletBlock
            ? current
            : { scope: walletRecordScope, block: requiredWalletBlock },
        );
      }
      const targetWalletBlock = requiredWalletBlock ?? minimumWalletBlock;
      const refetchBalances = async () => {
        const [wallet, native] = await Promise.all([
          walletQuery.refetch(),
          nativeBalanceQuery.refetch(),
        ]);
        return walletObservation(wallet.data, native.data);
      };
      const refetchWallet = async () => {
        if (targetWalletBlock === undefined) {
          await refetchBalances();
          return;
        }
        if (requiredWalletBlock !== undefined) {
          setMinimumWalletBlock((current) =>
            current === undefined || requiredWalletBlock > current
              ? requiredWalletBlock
              : current,
          );
        }
        const result = await refetchUntilObservedBlock({
          minimumBlock: targetWalletBlock,
          refetch: refetchBalances,
        });
        if (result.status === "caught-up") {
          setMinimumWalletBlock((current) =>
            current !== undefined && result.snapshot.observedBlock >= current
              ? undefined
              : current,
          );
        }
      };
      await Promise.all([
        refetchWallet(),
        queryClient.refetchQueries({
          queryKey: ["protocol-collectible"],
          type: "active",
        }),
      ]);
    },
    [
      accessState,
      minimumWalletBlock,
      walletRecordScope,
      nativeBalanceQuery,
      queryClient,
      walletQuery,
    ],
  );

  const refresh = useCallback(
    async (requiredWalletBlock?: bigint) => {
      if (publicStatusEnabled) {
        await publicStatusQuery.refetch();
        return;
      }
      await Promise.all([
        healthQuery.refetch(),
        refreshWallet(requiredWalletBlock),
        ...(marketHistoryEnabled ? [marketHistoryQuery.refetch()] : []),
      ]);
    },
    [
      healthQuery,
      marketHistoryEnabled,
      marketHistoryQuery,
      publicStatusEnabled,
      publicStatusQuery,
      refreshWallet,
    ],
  );

  const refreshMarketHistory = useCallback(async () => {
    await marketHistoryQuery.refetch();
  }, [marketHistoryQuery]);

  const executeTransaction = useCallback(
    async (
      action: ProtocolAction,
      label: string,
      renewSwapDeadline = false,
      authorize?: TransactionAuthorization,
      // Keep persistence, scope and signing fences in the same ordered operation.
      // eslint-disable-next-line complexity
    ) => {
      if (activeExecution.current !== undefined) return transactionRef.current;
      const executionId = Symbol(label);
      const executionRecordScope = recordScopeRef.current;
      const executionPersists = !transactionScope.pathname.startsWith("/admin");
      transactionPersistRef.current = executionPersists;
      const executionMetadata = collectorMetadata(
        action,
        transactionMetadataRef.current,
      );
      transactionMetadataRef.current = executionMetadata;
      if (executionPersists && executionRecordScope !== undefined) {
        setTransactionPersistenceAvailable(
          writeCollectorTransaction(
            executionRecordScope,
            { status: "pending", label },
            undefined,
            executionMetadata,
            true,
          ),
        );
      }
      const executionPhase: { current: SubmittedTransactionPhase | undefined } =
        {
          current: undefined,
        };
      activeExecution.current = executionId;
      const executionScopeGeneration = transactionScopeGenerationRef.current;
      const executionPrivacyGeneration =
        transactionPrivacyGenerationRef.current;
      const privacyIsCurrent = (): boolean =>
        executionPrivacyGeneration === transactionPrivacyGenerationRef.current;
      const scopeIsCurrent = (): boolean =>
        executionScopeGeneration === transactionScopeGenerationRef.current &&
        isSameTransactionScope(transactionScope, transactionScopeRef.current);
      const boundary = {
        privacyIsCurrent,
        scopeIsCurrent,
        persistUncertainSubmission: (state: TransactionState) => {
          if (executionPersists && executionRecordScope !== undefined)
            writeCollectorTransaction(
              executionRecordScope,
              state,
              executionPhase.current,
              executionMetadata,
            );
        },
      };
      const assertActiveScope = (): void => {
        if (!scopeIsCurrent() || !privacyIsCurrent()) {
          throw new TransactionScopeChangedError();
        }
      };
      const executionState: { current: TransactionState } = {
        current: { status: "pending", label },
      };
      const failureStep = { current: "client readiness" };
      submittedTransactionPhase.current = undefined;
      updateTransaction(executionState.current);
      try {
        const clients = requireTransactionClients({
          reader: transactionReader,
          walletClient: walletClient.data,
          address: connection.address,
          chainId: connection.chainId,
        });
        const walletBoundAction = bindProtocolActionToWallet(
          action,
          clients.address,
        );
        lastAttempt.current = {
          action: walletBoundAction,
          label,
          scope: transactionScope,
        };
        // An exact ERC-20 swap call cannot prove the discovery path while
        // allowance is low: transferFrom reverts before the discovery-
        // sensitive transfer. Use the wallet-bound, block-pinned requote as
        // the portable cap proof before asking the wallet for approval, then
        // run the exact prepared call after approval confirms.
        const requiredApprovalAsset = await readRequiredExchangeApprovalAsset({
          action: walletBoundAction,
          address: clients.address,
          failureStep,
          reader: clients.reader,
        });
        assertActiveScope();
        const executableAction = await refreshWalletBoundActionForExecution({
          action: walletBoundAction,
          address: clients.address,
          failureStep,
          reader: clients.reader,
          renewDeadline: renewSwapDeadline,
        });
        assertActiveScope();
        const snapshots = await readPreflightSnapshots({
          action: executableAction,
          address: clients.address,
          cachedHealth: currentHealth,
          cachedWallet: walletQuery.data,
          failureStep,
          reader: clients.reader,
        });
        assertActiveScope();
        const cachedRuntime = createTransactionRuntime({
          health: snapshots.health,
          wallet: snapshots.wallet,
          chainId: clients.chainId,
          address: clients.address,
          directCollectibles: snapshots.directCollectibles,
        });
        failureStep.current = "latest block preflight";
        const transactionRuntime = await updateRuntimeBlock(
          cachedRuntime,
          snapshots.freshOperatorHealth,
        );
        assertActiveScope();
        const sendPrepared = (
          prepared: PreparedTransaction,
          stepLabel: string,
          phase: SubmittedTransactionPhase = { kind: "action" },
        ) =>
          sendPreparedTransaction({
            address: clients.address,
            assertActiveScope,
            failureStep,
            label: stepLabel,
            onState: (state) => {
              executionState.current = state;
              executionPhase.current = phase;
              if (privacyIsCurrent()) submittedTransactionPhase.current = phase;
              if (
                executionPersists ||
                (privacyIsCurrent() &&
                  (scopeIsCurrent() || transactionSurvivesScopeChange(state)))
              ) {
                if (
                  executionPersists &&
                  !privacyIsCurrent() &&
                  executionRecordScope !== undefined
                ) {
                  writeCollectorTransaction(
                    executionRecordScope,
                    state,
                    phase,
                    executionMetadata,
                  );
                } else {
                  updateTransaction(state, {
                    scope: executionRecordScope,
                    phase,
                    persist: executionPersists,
                    metadata: executionMetadata,
                  });
                }
              }
            },
            prepared,
            walletClient: clients.walletClient,
          });

        failureStep.current = "transaction preparation";
        const prepared = prepareReviewedTransaction({
          action: executableAction,
          reader: clients.reader,
          reviewedAction: walletBoundAction,
          runtime: transactionRuntime,
        });
        if (authorize !== undefined) {
          failureStep.current = "admin action authorization";
          await authorize(walletBoundAction);
          assertActiveScope();
        }
        const finalPrepared = await finalizePreparedSwapAfterApproval({
          action: executableAction,
          address: clients.address,
          assertActiveScope,
          cachedWallet: walletQuery.data,
          chainId: clients.chainId,
          failureStep,
          onApprovalConfirmed: () => {
            executionState.current = { status: "pending", label };
            if (privacyIsCurrent()) updateTransaction(executionState.current);
          },
          prepared,
          reader: clients.reader,
          refresh,
          requiredApprovalAsset,
          reviewedAction: walletBoundAction,
          runtime: transactionRuntime,
          send: sendPrepared,
        });
        const sent = await sendPrepared(finalPrepared, label);
        if (scopeIsCurrent() && privacyIsCurrent()) {
          await refresh(sent.blockNumber);
          return sent.state;
        }
        if (privacyIsCurrent()) {
          await queryClient.invalidateQueries({
            queryKey: [
              "protocol-wallet",
              deploymentLaunchHash,
              clients.address,
            ],
            refetchType: "active",
          });
          await queryClient.invalidateQueries({
            queryKey: ["protocol-collectible"],
            refetchType: "active",
          });
        }
        const idle = createTransactionState();
        if (privacyIsCurrent() && !executionPersists) {
          updateTransaction(idle, {
            scope: executionRecordScope,
            persist: false,
          });
        }
        return executionPersists ? sent.state : idle;
      } catch (cause) {
        return handleTransactionExecutionFailure({
          boundary,
          cause,
          currentTransaction: () => transactionRef.current,
          executionState,
          failureStep: failureStep.current,
          invalidateExchangeQuote: () =>
            setExchangeQuoteRevision((revision) => revision + 1),
          submittedPhase: executionPhase,
          updateTransaction: (state) =>
            updateTransaction(state, {
              scope: executionRecordScope,
              phase: executionPhase.current,
              persist: executionPersists,
              metadata: executionMetadata,
            }),
        });
      } finally {
        releaseTransactionExecution({
          activeExecution,
          boundary,
          executionId,
          state: executionState.current,
        });
      }
    },
    [
      connection.address,
      connection.chainId,
      currentHealth,
      refresh,
      queryClient,
      transactionScope,
      transactionReader,
      updateTransaction,
      walletClient.data,
      walletQuery,
    ],
  );

  const execute = useCallback(
    (
      action: ProtocolAction,
      label: string,
      authorize?: TransactionAuthorization,
    ) => executeTransaction(action, label, false, authorize),
    [executeTransaction],
  );

  const retryUnknownOutcome = useCallback(
    async (
      current: Extract<TransactionState, { status: "outcome-unknown" }>,
    ): Promise<TransactionState> => {
      if (reconciliationInFlight.current) return current;
      reconciliationInFlight.current = true;
      const privacyGeneration = transactionPrivacyGenerationRef.current;
      const phase = submittedTransactionPhase.current;
      const reconciliationScope = recordScopeRef.current;
      const persist = transactionPersistRef.current;
      const metadata = transactionMetadataRef.current;
      const reconciliationExecution = activeExecution.current;
      const reconciling = { ...current, reconciling: true } as const;
      updateTransaction(reconciling);
      try {
        const reconciled = await reconcileUnknownTransaction({
          refresh: async (block) => {
            if (privacyGeneration === transactionPrivacyGenerationRef.current)
              await refresh(block);
          },
          state: reconciling,
          onState: (state) => {
            if (privacyGeneration === transactionPrivacyGenerationRef.current) {
              updateTransaction(state, {
                scope: reconciliationScope,
                phase,
                persist,
                metadata,
              });
            } else if (
              persist &&
              reconciliationScope !== undefined &&
              metadata !== undefined
            ) {
              writeCollectorTransaction(
                reconciliationScope,
                state,
                phase,
                metadata,
              );
            }
          },
        });
        if (privacyGeneration !== transactionPrivacyGenerationRef.current) {
          return createTransactionState();
        }
        if (reconciled.status === "outcome-unknown") {
          updateTransaction(reconciled);
          return reconciled;
        }
        submittedTransactionPhase.current = undefined;
        let settled = reconciled;
        if (reconciled.status === "confirmed" && phase?.kind === "approval") {
          lastAttempt.current = undefined;
          setExchangeQuoteRevision((revision) => revision + 1);
          settled = {
            ...reconciled,
            message: applicationCopy.transaction.approvalConfirmed,
          } as const;
        }
        if (activeExecution.current === reconciliationExecution) {
          activeExecution.current = undefined;
        }
        updateTransaction(settled);
        return settled;
      } finally {
        if (privacyGeneration === transactionPrivacyGenerationRef.current)
          reconciliationInFlight.current = false;
      }
    },
    [refresh, updateTransaction],
  );

  const retry = useCallback(
    async (authorize?: TransactionAuthorization) => {
      const current = transactionRef.current;
      if (current.status === "outcome-unknown") {
        return retryUnknownOutcome(current);
      }
      if (current.status !== "retriable") return current;
      const attempt = transactionAttemptForScope(
        lastAttempt.current,
        transactionScope,
      );
      if (attempt === undefined) {
        const idle = createTransactionState();
        updateTransaction(idle);
        return idle;
      }
      updateTransaction(advanceTransaction(current, { type: "retry" }));
      return executeTransaction(
        attempt.action,
        attempt.label,
        attempt.action.type === "swap-exact-input",
        authorize,
      );
    },
    [
      executeTransaction,
      retryUnknownOutcome,
      transactionScope,
      updateTransaction,
    ],
  );

  const reconcileRef = useRef(retryUnknownOutcome);
  useLayoutEffect(() => {
    reconcileRef.current = retryUnknownOutcome;
  }, [retryUnknownOutcome]);
  const transactionHash = "hash" in transaction ? transaction.hash : undefined;
  useEffect(() => {
    if (
      collectorRecordScope === undefined ||
      !transactionPersistRef.current ||
      transaction.status !== "outcome-unknown"
    )
      return;
    let cancelled = false;
    let delay = 5_000;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (cancelled || recordScopeRef.current !== collectorRecordScope) return;
      const current = transactionRef.current;
      if (current.status !== "outcome-unknown") return;
      await reconcileRef.current(current);
      if (!cancelled && transactionRef.current.status === "outcome-unknown") {
        timer = setTimeout(() => void check(), delay);
        delay = Math.min(delay * 2, 30_000);
      }
    };
    timer = setTimeout(
      () => void check(),
      restoredTransactionRef.current ? 0 : delay,
    );
    restoredTransactionRef.current = false;
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectorRecordScope, transaction.status, transactionHash]);

  const clearTransaction = useCallback(() => {
    const current = transactionRef.current;
    if (
      isTransactionInFlight(current) &&
      current.status !== "submission-unknown"
    )
      return;
    activeExecution.current = undefined;
    submittedTransactionPhase.current = undefined;
    updateTransaction(createTransactionState());
  }, [updateTransaction]);

  const getActionState = useCallback(
    (action: ProtocolAction) => {
      if (accessState !== "ready") {
        return {
          enabled: false,
          reason: "Connect your wallet on Base Sepolia before continuing.",
        } as const;
      }
      if (isTransactionInFlight(transaction)) {
        return {
          enabled: false,
          reason: applicationCopy.transaction.pending,
        } as const;
      }
      if (walletSynchronizing) {
        return {
          enabled: false,
          reason: applicationCopy.transaction.synchronizing,
        } as const;
      }
      if (walletReadRequiresRecovery(walletRead)) {
        return {
          enabled: false,
          reason: "Waiting for a current wallet check before another action.",
        } as const;
      }
      if (
        reader === undefined ||
        currentHealth === undefined ||
        connection.address === undefined ||
        connection.chainId === undefined
      ) {
        return {
          enabled: false,
          reason: applicationCopy.common.notObserved,
        } as const;
      }
      try {
        reader.prepareTransaction(
          action,
          createTransactionRuntime({
            health: currentHealth,
            wallet: walletQuery.data,
            chainId: connection.chainId,
            address: connection.address,
          }),
        );
        return { enabled: true, reason: undefined } as const;
      } catch (cause) {
        return {
          enabled: false,
          reason: actionPreparationMessage(cause),
        } as const;
      }
    },
    [
      accessState,
      connection.address,
      connection.chainId,
      currentHealth,
      reader,
      transaction,
      walletSynchronizing,
      walletQuery.data,
      walletRead,
    ],
  );

  const value = useMemo<ProtocolClientContextValue>(
    () => ({
      accessState,
      address: connection.address,
      chainId: connection.chainId,
      connected: connection.status === "connected",
      deploymentAvailable: reader !== undefined,
      reader,
      readerForSignal,
      health: currentHealth,
      healthPending: currentHealthPending,
      healthRefreshing: currentHealthRefreshing,
      healthError: currentHealthError,
      publicStatus: currentPublicStatus,
      publicStatusPending: currentPublicStatusPending,
      publicStatusRefreshing: currentPublicStatusRefreshing,
      publicStatusError: currentPublicStatusError,
      marketHistory,
      exchangeQuoteRevision,
      walletSynchronizing,
      minimumCollectibleBlock,
      walletRead,
      nativeBalanceRead,
      transaction,
      transactionPersistenceAvailable,
      transactionMetadata,
      completedTransactions,
      clearTransaction,
      refresh,
      refreshWallet,
      refreshMarketHistory,
      getActionState,
      execute,
      retry,
    }),
    [
      accessState,
      connection,
      execute,
      exchangeQuoteRevision,
      currentHealth,
      currentHealthError,
      currentHealthPending,
      currentHealthRefreshing,
      currentPublicStatus,
      currentPublicStatusError,
      currentPublicStatusPending,
      currentPublicStatusRefreshing,
      marketHistory,
      getActionState,
      reader,
      readerForSignal,
      refresh,
      refreshWallet,
      refreshMarketHistory,
      retry,
      transaction,
      transactionPersistenceAvailable,
      transactionMetadata,
      completedTransactions,
      clearTransaction,
      walletSynchronizing,
      minimumCollectibleBlock,
      walletRead,
      nativeBalanceRead,
    ],
  );

  return (
    <ProtocolClientContext value={value}>{children}</ProtocolClientContext>
  );
}

export const useProtocolClient = () => {
  const context = useContext(ProtocolClientContext);
  if (context === null)
    throw new Error(
      "useProtocolClient must be used inside ProtocolClientProvider",
    );
  return context;
};
