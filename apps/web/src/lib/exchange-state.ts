import {
  validateMarketDiscoveryEvidence,
  type MarketDiscoveryEvidence,
  type ValidatedMarketDiscoveryEvidence,
} from "@orbit/protocol/domain";
import { parseUnits } from "viem";

import { formatBasisPoints, formatTokenAmount } from "./format";
import type { Address } from "viem";

import type { CollectorAccessState } from "./collector-access";
import { applicationCopy, identity } from "./identity";

export type ExchangeDirection = "buy" | "sell";
export type ExchangeSettlementMode = "native" | "wrapped";

/** Leaves enough native ETH for a Base Sepolia wallet to submit the swap. */
export const NATIVE_TRADE_GAS_RESERVE_WEI = 200_000_000_000_000n;

interface LoadedExchangeWallet {
  readonly status: "loaded";
  readonly account: Address;
  readonly observedBlock: bigint;
  readonly liquidTokenBalanceWei: bigint;
  readonly nativeBalanceWei?: bigint | undefined;
  readonly wethBalanceWei: bigint;
}

export type ExchangeWalletEvidence =
  | LoadedExchangeWallet
  | { readonly status: "blocked" }
  | { readonly status: "loading" }
  | { readonly status: "failed" };

export interface ExchangeIntentInput {
  readonly accessState: CollectorAccessState;
  readonly amount: string;
  readonly direction: ExchangeDirection;
  readonly readerAvailable: boolean;
  readonly settlementMode?: ExchangeSettlementMode | undefined;
  readonly wallet: ExchangeWalletEvidence;
}

const decimalAmountPattern = /^(?:\d+(?:\.\d{0,18})?|\.\d{1,18})$/;

const resolveExchangeAccess = (input: ExchangeIntentInput) => {
  if (input.accessState !== "ready") {
    return {
      status: "blocked",
      intent: { status: input.accessState, quoteEnabled: false } as const,
    } as const;
  }
  if (!input.readerAvailable) {
    return {
      status: "blocked",
      intent: {
        status: "reader-unavailable",
        quoteEnabled: false,
      } as const,
    } as const;
  }
  if (input.wallet.status === "loading") {
    return {
      status: "blocked",
      intent: { status: "balance-loading", quoteEnabled: false } as const,
    } as const;
  }
  if (input.wallet.status !== "loaded") {
    return {
      status: "blocked",
      intent: { status: "balance-unavailable", quoteEnabled: false } as const,
    } as const;
  }
  return { status: "ready", wallet: input.wallet } as const;
};

const parseExchangeAmount = (rawAmount: string) => {
  const amount = rawAmount.trim();
  if (amount === "") {
    return { status: "empty", quoteEnabled: false } as const;
  }
  if (!decimalAmountPattern.test(amount)) {
    return { status: "invalid", quoteEnabled: false } as const;
  }
  try {
    const amountIn = parseUnits(amount, 18);
    if (amountIn <= 0n) {
      return { status: "invalid", quoteEnabled: false } as const;
    }
    return { status: "ready", amountIn } as const;
  } catch {
    return { status: "invalid", quoteEnabled: false } as const;
  }
};

const availableExchangeBalance = (
  wallet: LoadedExchangeWallet,
  buying: boolean,
  useNative: boolean,
): bigint => {
  if (!buying) return wallet.liquidTokenBalanceWei;
  if (!useNative) return wallet.wethBalanceWei;
  const nativeBalanceWei = wallet.nativeBalanceWei ?? 0n;
  return nativeBalanceWei > NATIVE_TRADE_GAS_RESERVE_WEI
    ? nativeBalanceWei - NATIVE_TRADE_GAS_RESERVE_WEI
    : 0n;
};

const deriveBalanceEligibleIntent = (
  input: ExchangeIntentInput,
  wallet: LoadedExchangeWallet,
  amountIn: bigint,
) => {
  const buying = input.direction === "buy";
  const useNative = input.settlementMode === "native";
  if (buying && useNative && wallet.nativeBalanceWei === undefined) {
    return { status: "balance-unavailable", quoteEnabled: false } as const;
  }
  const availableBalanceWei = availableExchangeBalance(
    wallet,
    buying,
    useNative,
  );
  if (amountIn <= availableBalanceWei) {
    return {
      status: "ready",
      amountIn,
      quoteEnabled: true,
      direction: input.direction,
      account: wallet.account,
      walletObservedBlock: wallet.observedBlock,
      liquidTokenBalanceWei: wallet.liquidTokenBalanceWei,
      settlementMode: input.settlementMode ?? "wrapped",
    } as const;
  }
  if (buying) {
    return {
      status: "insufficient-balance",
      amountIn,
      availableBalanceWei,
      asset: useNative ? "native" : "settlement",
      quoteEnabled: false,
      recovery: "faucet",
    } as const;
  }
  // The seller's way out is the other side of this same panel: buy the liquid
  // token first. Without a named recovery the sell direction dead-ended on
  // "not enough" while the buy direction offered the faucet.
  return {
    status: "insufficient-balance",
    amountIn,
    availableBalanceWei,
    asset: "liquid-token",
    quoteEnabled: false,
    recovery: "buy",
  } as const;
};

export const deriveExchangeIntent = (input: ExchangeIntentInput) => {
  const access = resolveExchangeAccess(input);
  if (access.status === "blocked") return access.intent;
  const amount = parseExchangeAmount(input.amount);
  if (amount.status !== "ready") return amount;
  return deriveBalanceEligibleIntent(input, access.wallet, amount.amountIn);
};

export interface ExchangeQuote {
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
  readonly discovery?: MarketDiscoveryEvidence;
}

export interface ExchangeQuoteWalletScope {
  readonly account: Address;
  readonly observedBlock: bigint;
  readonly liquidTokenBalanceWei: bigint;
}

type ExchangeQuoteRead =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "loaded";
      readonly quote: ExchangeQuote;
      readonly receivedAtMilliseconds: number;
      readonly walletScope: ExchangeQuoteWalletScope;
    };

export interface ExchangeReviewStateInput {
  readonly intent: ReturnType<typeof deriveExchangeIntent>;
  readonly nowMilliseconds: number;
  readonly observedBlock: bigint | undefined;
  readonly quoteRead: ExchangeQuoteRead;
  readonly transactionPending: boolean;
}

type ReadyExchangeIntent = Extract<
  ReturnType<typeof deriveExchangeIntent>,
  { readonly status: "ready" }
>;

const maximumQuoteAgeBlocks = 30n;
// Base Sepolia targets two-second blocks. Expiring one block early at a
// conservative one second per remaining block fails closed if block
// observation pauses; the UI exposes an explicit refresh when this expires.
const quoteBlockSafetyMilliseconds = 1_000;

export const exchangeQuoteFreshUntilMilliseconds = (
  quote: ExchangeQuote,
  receivedAtMilliseconds: number,
): number => {
  const remainingBlocks = quote.expiresAtBlock - quote.observedBlock - 1n;
  if (remainingBlocks <= 0n) return receivedAtMilliseconds;
  const boundedBlocks =
    remainingBlocks > maximumQuoteAgeBlocks
      ? maximumQuoteAgeBlocks
      : remainingBlocks;
  return (
    receivedAtMilliseconds +
    Number(boundedBlocks) * quoteBlockSafetyMilliseconds
  );
};

const staleQuote = (
  intent: ReadyExchangeIntent,
  quote: ExchangeQuote,
  walletScope: ExchangeQuoteWalletScope,
  observedBlock: bigint | undefined,
  receivedAtMilliseconds: number,
  nowMilliseconds: number,
): boolean =>
  quote.amountIn !== intent.amountIn ||
  quote.liquidTokenForWeth !== (intent.direction === "sell") ||
  walletScope.account.toLowerCase() !== intent.account.toLowerCase() ||
  walletScope.observedBlock !== intent.walletObservedBlock ||
  walletScope.liquidTokenBalanceWei !== intent.liquidTokenBalanceWei ||
  quote.observedBlock < walletScope.observedBlock ||
  (observedBlock !== undefined && observedBlock > quote.expiresAtBlock) ||
  nowMilliseconds >=
    exchangeQuoteFreshUntilMilliseconds(quote, receivedAtMilliseconds);

const resolveDiscoveryReview = (
  intent: ReadyExchangeIntent,
  quote: ExchangeQuote,
) => {
  const { discovery } = quote;
  if (discovery === undefined) {
    return {
      status: "discovery-unavailable",
      submitEnabled: false,
      retryAvailable: true,
    } as const;
  }
  let validation: ValidatedMarketDiscoveryEvidence;
  try {
    validation = validateMarketDiscoveryEvidence({
      account: intent.account,
      evidence: discovery,
      liquidTokenAmount: quote.liquidTokenForWeth
        ? quote.amountIn
        : quote.amountOut,
      liquidTokenForWeth: quote.liquidTokenForWeth,
    });
  } catch {
    return {
      status: "discovery-invalid",
      submitEnabled: false,
      retryAvailable: true,
    } as const;
  }
  if (!validation.capacity.executable) {
    return {
      status: "discovery-limit",
      submitEnabled: false,
      mutations: validation.capacity.mutations,
      maximumMutations: validation.capacity.maximumMutations,
      maximumLiquidTokenAmount: validation.capacity.maximumLiquidTokenAmount,
    } as const;
  }
  return { status: "ready", intent, quote, validation } as const;
};

const resolveReviewEvidence = (input: ExchangeReviewStateInput) => {
  if (input.intent.status !== "ready") {
    return { status: input.intent.status, submitEnabled: false } as const;
  }
  if (input.transactionPending) {
    return { status: "transaction-pending", submitEnabled: false } as const;
  }
  if (input.quoteRead.status === "idle") {
    return { status: "missing-quote", submitEnabled: false } as const;
  }
  if (input.quoteRead.status === "loading") {
    return { status: "quote-loading", submitEnabled: false } as const;
  }
  if (input.quoteRead.status === "failed") {
    return {
      status: "quote-unavailable",
      submitEnabled: false,
      retryAvailable: true,
    } as const;
  }
  const { intent } = input;
  const { quote, receivedAtMilliseconds, walletScope } = input.quoteRead;
  if (
    staleQuote(
      intent,
      quote,
      walletScope,
      input.observedBlock,
      receivedAtMilliseconds,
      input.nowMilliseconds,
    )
  ) {
    return {
      status: "stale-quote",
      submitEnabled: false,
      retryAvailable: true,
    } as const;
  }
  return resolveDiscoveryReview(intent, quote);
};

const plural = (count: number, singular: string, multiple: string): string =>
  count === 1 ? singular : multiple;

type BoundaryImpact = NonNullable<
  ValidatedMarketDiscoveryEvidence["walletImpact"]
>;

const sellBoundarySentence = (impact: BoundaryImpact): string => {
  const pendingTerm = identity.terms.pendingDiscovery;
  if (impact.lostWholeUnitCount === 0) {
    return `This sale stays within the current fractional balance. It does not cancel a ${pendingTerm} or dissolve a ${identity.terms.transientCollectible}.`;
  }
  const pendingLabel = plural(
    impact.pendingDiscoveryCancellationCount,
    pendingTerm,
    identity.terms.pendingDiscoveryPlural,
  );
  if (impact.transientDissolutionCount === 0) {
    return `This sale cancels ${impact.pendingDiscoveryCancellationCount} ${pendingLabel}. No ${identity.terms.transientCollectible} is dissolved.`;
  }
  const craftLabel = plural(
    impact.transientDissolutionCount,
    identity.terms.transientCollectible,
    `${identity.terms.transientCollectible}s`,
  );
  if (impact.pendingDiscoveryCancellationCount === 0) {
    return `This sale dissolves ${impact.transientDissolutionCount} ${craftLabel}. No ${pendingTerm} is canceled.`;
  }
  return `This sale cancels ${impact.pendingDiscoveryCancellationCount} ${pendingLabel} and dissolves ${impact.transientDissolutionCount} ${craftLabel}.`;
};

const sellWarning = (lostWholeUnitCount: number) =>
  lostWholeUnitCount >= 10
    ? {
        warning: `Large collection change: this trade removes ${lostWholeUnitCount} whole-unit holdings. Check the collection impact before submitting.`,
      }
    : {};

const deriveSellReview = (
  quote: ExchangeQuote,
  validation: ValidatedMarketDiscoveryEvidence,
  settlementMode: ExchangeSettlementMode,
) => {
  const feePercent = displayBasisPoints(quote.tradingFeeBps);
  const review = validation.walletDiscoveryExempt
    ? `This wallet was discovery-exempt at the quote block, so the sale records no ${identity.terms.discoveryDraw} boundary changes.`
    : sellBoundarySentence(validation.walletImpact);
  return {
    status: "ready",
    submitEnabled: true,
    review: {
      sentence: `You pay ${displayAmount(quote.amountIn)} ${applicationCopy.exchange.token} and receive ${displayAmount(quote.amountOut)} ${settlementMode === "native" ? "ETH" : "WETH"}. The ${feePercent} fee is ${displayAmount(quote.tradingFee)} WETH. ${review}`,
      ...sellWarning(
        validation.walletDiscoveryExempt
          ? 0
          : validation.walletImpact.lostWholeUnitCount,
      ),
    },
  } as const;
};

const discoveryLabel = (count: number): string =>
  plural(
    count,
    identity.terms.discoveryDraw,
    identity.terms.discoveryDrawPlural,
  );

const buyBoundarySentence = (
  validation: ValidatedMarketDiscoveryEvidence,
): string => {
  const { evidence: discovery } = validation;
  const { recipient } = discovery;
  if (validation.walletDiscoveryExempt) {
    return `This wallet was discovery-exempt at the quote block, so the trade schedules no random ${identity.terms.discoveryDraw}.`;
  }
  const count = recipient.mutations;
  if (count > 0) {
    return `Buying this amount schedules ${count} random ${discoveryLabel(count)}.`;
  }
  return `After this trade, ${formatTokenAmount(validation.walletImpact.projectedNextDiscoveryDraw.remainingWei, { rounding: "ceil" }).display} ${applicationCopy.exchange.token} remains before the next random ${identity.terms.discoveryDraw}.`;
};

const buyWarning = (discoveryCount: number) =>
  discoveryCount >= 10
    ? {
        warning: `Large collection change: this trade schedules ${discoveryCount} random ${discoveryLabel(discoveryCount)}. Use a smaller amount if you only want one ${identity.terms.transientCollectible}.`,
      }
    : {};

const deriveBuyReview = (
  quote: ExchangeQuote,
  validation: ValidatedMarketDiscoveryEvidence,
  settlementMode: ExchangeSettlementMode,
) => {
  const { evidence: discovery } = validation;
  const discoveryCount = discovery.recipient.mutations;
  const feePercent = displayBasisPoints(quote.tradingFeeBps);
  return {
    status: "ready",
    submitEnabled: true,
    review: {
      sentence: `You pay ${displayAmount(quote.amountIn)} ${settlementMode === "native" ? "ETH" : "WETH"} and receive ${displayAmount(quote.amountOut)} ${applicationCopy.exchange.token}. The ${feePercent} fee is ${displayAmount(quote.tradingFee)} WETH. ${buyBoundarySentence(validation)}`,
      ...buyWarning(discoveryCount),
    },
  } as const;
};

export const deriveExchangeReviewState = (input: ExchangeReviewStateInput) => {
  const evidence = resolveReviewEvidence(input);
  if (evidence.status !== "ready") return evidence;
  return evidence.intent.direction === "sell"
    ? deriveSellReview(
        evidence.quote,
        evidence.validation,
        evidence.intent.settlementMode,
      )
    : deriveBuyReview(
        evidence.quote,
        evidence.validation,
        evidence.intent.settlementMode,
      );
};

/**
 * The application submits every swap with a fixed protective policy. It is
 * declared here, in display units, so the review can state it in plain
 * language rather than leaving it implicit in the submit handler.
 */
export const EXCHANGE_SLIPPAGE_POLICY = {
  toleranceBps: 100,
  deadlineSeconds: 600,
} as const;

/** Applies the fixed tolerance to a quoted output. */
export const exchangeMinimumAmountOut = (amountOut: bigint): bigint =>
  (amountOut * BigInt(10_000 - EXCHANGE_SLIPPAGE_POLICY.toleranceBps)) /
  10_000n;

export interface ExchangeTradeTerms {
  readonly executionPrice: string;
  readonly feeAmount: string;
  readonly feePercent: string;
  readonly minimumReceived: string;
  readonly priceImpact: string | undefined;
  readonly quoteBlock: string;
  readonly slippageTolerance: string;
  readonly deadline: string;
  readonly payAsset: string;
  readonly receiveAsset: string;
}

const WEI = 10n ** 18n;

/** Six decimal places is enough to compare prices without implying precision. */
/**
 * Amounts and percentages as a reader should see them.
 *
 * `ExchangeQuote` carries `amountInFormatted`, `amountOutFormatted`, and
 * `tradingFeeFormatted`, all of which are exact `formatUnits` expansions — so
 * every sentence and term built from them printed eighteen decimals. These go
 * through the shared value formatter instead.
 */
/*
 * Unpadded on purpose. Fixed fraction width is what makes a column of like
 * quantities scannable; these are heterogeneous label/value rows and prose,
 * where "You pay 1.0000 $FUEL" states a precision the sentence does not need.
 * Padding belongs to the value components, which know their own context.
 */
const displayAmount = (wei: bigint): string => formatTokenAmount(wei).display;

const displayBasisPoints = (basisPoints: number): string =>
  formatBasisPoints(basisPoints).display;

const ratio = (numerator: bigint, denominator: bigint): string => {
  if (denominator === 0n) return "0";
  const scaled = (numerator * 1_000_000n) / denominator;
  const whole = scaled / 1_000_000n;
  const fraction = (scaled % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`
    .replace(/0+$/u, "")
    .replace(/\.$/u, "");
};

/**
 * Price impact compares the trade's average execution price against the
 * marginal price implied by the pool before the trade. Without a reference
 * price the field is omitted rather than guessed.
 */
const impactPercent = (
  quote: ExchangeQuote,
  referencePriceWei: bigint | undefined,
): string | undefined => {
  if (referencePriceWei === undefined || referencePriceWei === 0n) {
    return undefined;
  }
  if (quote.amountOut === 0n || quote.amountIn === 0n) return undefined;
  const executionPriceWei = quote.liquidTokenForWeth
    ? (quote.amountOut * WEI) / quote.amountIn
    : (quote.amountIn * WEI) / quote.amountOut;
  const difference =
    executionPriceWei > referencePriceWei
      ? executionPriceWei - referencePriceWei
      : referencePriceWei - executionPriceWei;
  const basisPoints = (difference * 10_000n) / referencePriceWei;
  return `${ratio(basisPoints, 100n)}%`;
};

/**
 * Everything a collector needs to judge a trade before signing, in display
 * units. Kept beside the review so both derive from the same quote.
 */
export const deriveExchangeTradeTerms = (
  quote: ExchangeQuote,
  referencePriceWei?: bigint | undefined,
  settlementMode: ExchangeSettlementMode = "wrapped",
): ExchangeTradeTerms => {
  const selling = quote.liquidTokenForWeth;
  const settlementAsset = settlementMode === "native" ? "ETH" : "WETH";
  const liquidTokenAmount = selling ? quote.amountIn : quote.amountOut;
  const wethAmount = selling ? quote.amountOut : quote.amountIn;
  const minimum = exchangeMinimumAmountOut(quote.amountOut);
  return {
    executionPrice: `${ratio(wethAmount, liquidTokenAmount)} WETH per ${applicationCopy.exchange.token}`,
    feeAmount: `${displayAmount(quote.tradingFee)} WETH`,
    feePercent: displayBasisPoints(quote.tradingFeeBps),
    minimumReceived: `${displayAmount(minimum)} ${
      selling ? settlementAsset : applicationCopy.exchange.token
    }`,
    priceImpact: impactPercent(quote, referencePriceWei),
    quoteBlock: quote.observedBlock.toString(),
    slippageTolerance: `${EXCHANGE_SLIPPAGE_POLICY.toleranceBps / 100}%`,
    deadline: `${EXCHANGE_SLIPPAGE_POLICY.deadlineSeconds / 60} minutes`,
    payAsset: selling ? applicationCopy.exchange.token : settlementAsset,
    receiveAsset: selling ? settlementAsset : applicationCopy.exchange.token,
  };
};
