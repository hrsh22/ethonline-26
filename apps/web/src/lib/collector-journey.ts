import type { TestnetFundingResponse } from "@orbit/config/testnet-funding";

import type { CollectorAccessState } from "./collector-access";
import { NATIVE_TRADE_GAS_RESERVE_WEI } from "./exchange-state";
import { isTestnetFundingComplete } from "./testnet-funding-view";

export type CollectorJourneyPhaseId = "fund" | "discover" | "launch";
export type CollectorJourneyPhaseStatus = "complete" | "current" | "waiting";
export type CollectorJourneyAction =
  | "connect-wallet"
  | "switch-network"
  | "open-faucet"
  | "open-trade"
  | "open-collection"
  | "review-launch"
  | "none";

export interface CollectorJourneyPhase {
  readonly action: CollectorJourneyAction;
  readonly id: CollectorJourneyPhaseId;
  readonly status: CollectorJourneyPhaseStatus;
  readonly targetIdentityId?: number | undefined;
}

export interface CollectorJourneyMetrics {
  readonly available: boolean;
  /*
   * Base units, not pre-formatted strings.
   *
   * The view formatted these itself by truncating at six fraction digits
   * behind an approximation sign, so a balance of 1.234e-7 read as
   * "≈0.000000" — a false zero wearing a qualifier. Formatting belongs to the
   * value primitives, which know their own context.
   */
  readonly balanceWei: bigint | undefined;
  readonly nextThresholdWei: bigint | undefined;
  readonly remainingWei: bigint | undefined;
  readonly pending: number;
  readonly transient: number;
  readonly permanent: number;
}

interface JourneyCollectible {
  readonly identityId: number;
}

interface JourneyWalletSnapshot {
  readonly liquidToken: {
    readonly rawWei: bigint;
    readonly nextDiscoveryDraw: {
      readonly thresholdWei: bigint;
      readonly remainingWei: bigint;
    };
  };
  readonly settlementToken: {
    readonly rawWei: bigint;
  };
  readonly collectibles: {
    readonly pendingDiscovery: { readonly count: number };
    readonly transient: readonly JourneyCollectible[];
    readonly permanent: readonly JourneyCollectible[];
  };
}

type JourneyWalletRead =
  | {
      readonly status: "blocked";
      readonly accessState: Exclude<CollectorAccessState, "ready">;
    }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: Error }
  | { readonly status: "loaded"; readonly snapshot: JourneyWalletSnapshot };

interface CollectorJourneyInput {
  readonly accessState: CollectorAccessState;
  readonly fundingResponse?: TestnetFundingResponse | undefined;
  readonly nativeBalanceWei?: bigint | undefined;
  readonly walletRead: JourneyWalletRead;
}

/**
 * Distinguishes progress that is still arriving from progress that cannot be
 * read at all, so the view never renders an ambiguous placeholder glyph.
 */
export type CollectorProgressState = "loading" | "unavailable" | "ready";

export interface CollectorJourneyView {
  readonly complete: boolean;
  readonly currentPhase: CollectorJourneyPhase | undefined;
  readonly metrics: CollectorJourneyMetrics;
  readonly progressState: CollectorProgressState;
  readonly phases: readonly [
    CollectorJourneyPhase,
    CollectorJourneyPhase,
    CollectorJourneyPhase,
  ];
  readonly primaryIdentityId: number | undefined;
}

const EMPTY_METRICS: CollectorJourneyMetrics = {
  available: false,
  balanceWei: undefined,
  nextThresholdWei: undefined,
  remainingWei: undefined,
  pending: 0,
  transient: 0,
  permanent: 0,
};

const metricsFromWallet = (
  walletRead: JourneyWalletRead,
): CollectorJourneyMetrics => {
  if (walletRead.status !== "loaded") return EMPTY_METRICS;
  const { collectibles, liquidToken } = walletRead.snapshot;
  return {
    available: true,
    balanceWei: liquidToken.rawWei,
    nextThresholdWei: liquidToken.nextDiscoveryDraw.thresholdWei,
    remainingWei: liquidToken.nextDiscoveryDraw.remainingWei,
    pending: collectibles.pendingDiscovery.count,
    transient: collectibles.transient.length,
    permanent: collectibles.permanent.length,
  };
};

const phase = (
  id: CollectorJourneyPhaseId,
  status: CollectorJourneyPhaseStatus,
  action: CollectorJourneyAction,
  targetIdentityId?: number,
): CollectorJourneyPhase => ({ action, id, status, targetIdentityId });

const BLOCKED_FUND_ACTIONS: Record<
  Exclude<CollectorAccessState, "ready">,
  CollectorJourneyAction
> = {
  disconnected: "connect-wallet",
  "wrong-network": "switch-network",
  "deployment-pending": "none",
};

const fundPhase = (
  accessState: CollectorAccessState,
  tradeReady: boolean,
  journeyAdvanced: boolean,
): CollectorJourneyPhase => {
  if (journeyAdvanced) return phase("fund", "complete", "none");
  if (accessState !== "ready") {
    return phase("fund", "current", BLOCKED_FUND_ACTIONS[accessState]);
  }
  return phase("fund", "current", tradeReady ? "open-trade" : "open-faucet");
};

const discoveryPhase = (
  metrics: CollectorJourneyMetrics,
): CollectorJourneyPhase => {
  if (metrics.transient > 0 || metrics.permanent > 0) {
    return phase("discover", "complete", "none");
  }
  if (metrics.pending > 0) {
    return phase("discover", "current", "open-collection");
  }
  return phase("discover", "waiting", "none");
};

const launchPhase = (
  metrics: CollectorJourneyMetrics,
  primaryTransientId: number | undefined,
): CollectorJourneyPhase => {
  if (metrics.permanent > 0) return phase("launch", "complete", "none");
  if (primaryTransientId !== undefined) {
    return phase("launch", "current", "review-launch", primaryTransientId);
  }
  return phase("launch", "waiting", "none");
};

const progressState = (
  walletRead: JourneyWalletRead,
): CollectorProgressState => {
  if (walletRead.status === "loaded") return "ready";
  return walletRead.status === "loading" ? "loading" : "unavailable";
};

const loadedSnapshot = (
  walletRead: JourneyWalletRead,
): JourneyWalletSnapshot | undefined =>
  walletRead.status === "loaded" ? walletRead.snapshot : undefined;

/**
 * Faucet targets are replenishment policy, not a prerequisite for trading.
 * A collector who retained some WETH and gas can continue buying FUEL even
 * when either balance has fallen below the faucet's preferred top-up target.
 */
const hasTradeAssets = (
  snapshot: JourneyWalletSnapshot | undefined,
  nativeBalanceWei: bigint | undefined,
  fundingResponse: TestnetFundingResponse | undefined,
): boolean => {
  const observedNativeWei =
    nativeBalanceWei ??
    BigInt(fundingResponse?.recipient?.balances?.ethWei ?? "0");
  const canPayNatively = observedNativeWei > NATIVE_TRADE_GAS_RESERVE_WEI;
  const canPayWithWeth =
    (snapshot?.settlementToken.rawWei ?? 0n) > 0n && observedNativeWei > 0n;
  return canPayNatively || canPayWithWeth;
};

export const createCollectorJourneyView = ({
  accessState,
  fundingResponse,
  nativeBalanceWei,
  walletRead,
}: CollectorJourneyInput): CollectorJourneyView => {
  const metrics = metricsFromWallet(walletRead);
  const snapshot = loadedSnapshot(walletRead);
  const primaryTransientId = snapshot?.collectibles.transient[0]?.identityId;
  const primaryIdentityId =
    snapshot?.collectibles.permanent[0]?.identityId ?? primaryTransientId;
  const journeyAdvanced =
    metrics.pending + metrics.transient + metrics.permanent > 0;
  const tradeReady =
    isTestnetFundingComplete(fundingResponse) ||
    hasTradeAssets(snapshot, nativeBalanceWei, fundingResponse);
  const phases = [
    fundPhase(accessState, tradeReady, journeyAdvanced),
    discoveryPhase(metrics),
    launchPhase(metrics, primaryTransientId),
  ] as const;
  return {
    complete: metrics.permanent > 0,
    currentPhase: phases.find((entry) => entry.status === "current"),
    metrics,
    phases,
    progressState: progressState(walletRead),
    primaryIdentityId,
  };
};
