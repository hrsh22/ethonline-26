"use client";

import { runPublicRead } from "@orbit/protocol/read-lifetime";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { CollectorReturnLink } from "@/components/start/collector-return-link";
import { TestFundsLink } from "@/components/shell/test-funds-link";
import { AccessNotice } from "@/components/access-notice";
import { DisabledReason } from "@/components/state-feedback";
import {
  ExchangeBalancesBoard,
  ExchangeBalancesRefresh,
} from "@/components/trade/exchange-balances-board";
import {
  ExchangeDirectionControl,
  SettlementModeControl,
} from "@/components/trade/exchange-direction-controls";
import {
  ExchangeInstrument,
  ExchangeMarketReference,
} from "@/components/trade/exchange-instrument";
import {
  TradeCompletion,
  TradeDiscoveryTarget,
  TradeConfirmationSteps,
} from "@/components/trade/exchange-progress";
import { TradeMarketContext } from "@/components/trade/trade-market-context";
import { useExchangeDraft } from "@/lib/use-exchange-draft";
import { formatTokenAmount } from "@/lib/format";
import {
  exchangeAccessQuoteMessage,
  ExchangeDecisionReview,
  ExchangeTradeEvidence,
} from "@/components/trade/exchange-review-checklist";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Amount } from "@/components/ui/value";
import { Panel } from "@/components/ui/panel";
import {
  deriveExchangeIntent,
  deriveExchangeReviewState,
  exchangeMinimumAmountOut,
  exchangeQuoteFreshUntilMilliseconds,
  EXCHANGE_SLIPPAGE_POLICY,
  NATIVE_TRADE_GAS_RESERVE_WEI,
  type ExchangeDirection,
  type ExchangeQuote,
  type ExchangeSettlementMode,
  type ExchangeWalletEvidence,
} from "@/lib/exchange-state";
import { applicationCopy } from "@/lib/identity";
import { isTransactionInFlight } from "@/lib/transaction-state";
import { webProtocolQueryRetryCount } from "@/lib/web-rpc-policy";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type ExchangeIntent = ReturnType<typeof deriveExchangeIntent>;

const staticIntentFeedback: Partial<
  Record<
    ExchangeIntent["status"],
    { readonly message: string; readonly tone: "error" | "status" }
  >
> = {
  invalid: { message: applicationCopy.exchange.invalidAmount, tone: "error" },
  "reader-unavailable": {
    message: applicationCopy.exchange.readerUnavailable,
    tone: "error",
  },
  "balance-unavailable": {
    message: applicationCopy.exchange.balanceUnavailable,
    tone: "error",
  },
  "balance-loading": {
    message: applicationCopy.exchange.balanceLoading,
    tone: "status",
  },
};

const exchangeAssets = (
  direction: ExchangeDirection,
  settlementMode: ExchangeSettlementMode,
): { readonly pay: string; readonly receive: string } => {
  const settlement =
    settlementMode === "native"
      ? applicationCopy.exchange.nativeEth
      : applicationCopy.exchange.wrappedEth;
  return direction === "buy"
    ? { pay: settlement, receive: applicationCopy.exchange.token }
    : { pay: applicationCopy.exchange.token, receive: settlement };
};

type ExchangeOutputState = "loading" | "empty";

/** A wallet-read state that already explains itself in the amount field. */
const balanceReadPending = (status: ExchangeIntent["status"]): boolean =>
  status === "balance-loading" || status === "balance-unavailable";

/**
 * The wallet panel repeats the access notice only while it says something the
 * balance rows do not: disconnected, wrong network, loading, failed, partial.
 * A clean loaded read is evidenced by the balances themselves.
 */
const accessNoticeVisible = (
  protocol: ProtocolClient,
  intentStatus: ExchangeIntent["status"],
): boolean => {
  if (protocol.walletSynchronizing) return true;
  if (balanceReadPending(intentStatus)) return false;
  const { walletRead } = protocol;
  return !(
    walletRead.status === "loaded" &&
    walletRead.snapshot.partialFailures.length === 0
  );
};

const outputStateFor = (
  quoteStatus: "idle" | "loading" | "failed" | "loaded",
): ExchangeOutputState => (quoteStatus === "loading" ? "loading" : "empty");

/** The quote a review may display, including a blocked discovery cap. */
const quoteForDisplay = <QuoteValue,>(
  reviewStatus: string,
  quote: QuoteValue | undefined,
): QuoteValue | undefined =>
  reviewStatus === "ready" || reviewStatus === "discovery-limit"
    ? quote
    : undefined;

/** Zero is a known spendable balance; unavailable reads remain undefined. */
const spendableBalanceWei = (
  wallet: ExchangeWalletEvidence,
  direction: ExchangeDirection,
  settlementMode: ExchangeSettlementMode,
): bigint | undefined => {
  if (wallet.status !== "loaded") return undefined;
  if (
    direction === "buy" &&
    settlementMode === "native" &&
    wallet.nativeBalanceWei === undefined
  )
    return undefined;
  const balance =
    direction === "sell"
      ? wallet.liquidTokenBalanceWei
      : settlementMode === "native"
        ? wallet.nativeBalanceWei === undefined ||
          wallet.nativeBalanceWei <= NATIVE_TRADE_GAS_RESERVE_WEI
          ? 0n
          : wallet.nativeBalanceWei - NATIVE_TRADE_GAS_RESERVE_WEI
        : wallet.wethBalanceWei;
  return balance;
};

/**
 * Wallet balances as base units plus, when a value cannot be read, the reason.
 * Formatting is the value primitives' job; this function's job is the read
 * state.
 */
interface BalanceRead {
  readonly observedBlock?: bigint | undefined;
  readonly reason: string;
  readonly wei: bigint | undefined;
}

interface WalletBalances {
  readonly liquidToken: BalanceRead;
  readonly nativeEth: BalanceRead;
  readonly observedBlock: bigint | undefined;
  readonly settlementToken: BalanceRead;
}

const walletBalanceValues = (protocol: ProtocolClient): WalletBalances => {
  const { walletRead: read } = protocol;
  const native = protocol.nativeBalanceRead;
  const nativeEth: BalanceRead =
    native?.status === "loaded"
      ? {
          reason: "",
          wei: native.balance.rawWei,
          observedBlock: native.balance.observedBlock,
        }
      : {
          reason:
            native?.status === "failed"
              ? applicationCopy.common.readFailed
              : applicationCopy.common.loading,
          wei: undefined,
        };
  if (read.status === "loaded") {
    return {
      liquidToken: { reason: "", wei: read.snapshot.liquidToken.rawWei },
      nativeEth,
      observedBlock: read.snapshot.observedBlock,
      settlementToken: {
        reason: "",
        wei: read.snapshot.settlementToken.rawWei,
      },
    };
  }
  const unread =
    read.status === "failed"
      ? applicationCopy.common.readFailed
      : read.status === "blocked"
        ? applicationCopy.common.notLoaded
        : applicationCopy.common.loading;
  return {
    liquidToken: { reason: unread, wei: undefined },
    nativeEth,
    observedBlock: undefined,
    settlementToken: { reason: unread, wei: undefined },
  };
};

const useDebouncedValue = <Value,>(value: Value, delay: number): Value => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
};

const exchangeWalletEvidence = (
  protocol: ProtocolClient,
): ExchangeWalletEvidence => {
  const { walletRead } = protocol;
  if (walletRead.status === "blocked" || protocol.address === undefined) {
    return { status: "blocked" };
  }
  if (walletRead.status === "loading") return { status: "loading" };
  if (walletRead.status === "failed") return { status: "failed" };
  if (walletRead.stale === true) return { status: "failed" };
  const wallet = walletRead.snapshot;
  return {
    status: "loaded",
    account: protocol.address,
    observedBlock: wallet.observedBlock,
    liquidTokenBalanceWei: wallet.liquidToken.rawWei,
    nativeBalanceWei:
      protocol.nativeBalanceRead?.status === "loaded"
        ? protocol.nativeBalanceRead.balance.rawWei
        : undefined,
    wethBalanceWei: wallet.settlementToken.rawWei,
  };
};

const quoteWalletScopeKey = (intent: ExchangeIntent): string =>
  intent.status === "ready"
    ? [
        intent.account.toLowerCase(),
        intent.walletObservedBlock.toString(),
        intent.liquidTokenBalanceWei.toString(),
      ].join(":")
    : intent.status;

const intentAccessMessage = (
  intent: ExchangeIntent,
  status: Parameters<typeof exchangeAccessQuoteMessage>[0],
) =>
  intent.status === "insufficient-gas"
    ? "Get test ETH to cover the network fee before trading."
    : exchangeAccessQuoteMessage(status);

function DiscoveryShortfall({
  protocol,
  direction,
}: {
  readonly protocol: ProtocolClient;
  readonly direction: ExchangeDirection;
}) {
  if (
    direction !== "buy" ||
    protocol.walletRead.status !== "loaded" ||
    protocol.walletRead.stale === true
  )
    return null;
  const next = protocol.walletRead.snapshot.liquidToken.nextDiscoveryDraw;
  if (next === undefined) return null;
  return (
    <p className="text-body-sm text-ink-soft">
      <Amount rounding="ceil" value={next.remainingWei} /> $FUEL to the next
      Discovery. The trade review shows how your collection will change.
    </p>
  );
}

const useMarketQuote = (
  protocol: ProtocolClient,
  direction: ExchangeDirection,
  amount: string,
  wallet: ExchangeWalletEvidence,
  settlementMode: ExchangeSettlementMode,
) => {
  const debouncedAmount = useDebouncedValue(amount, 250);
  // Clearing a completed trade is an explicit state transition, not another
  // keystroke to debounce. Disable the old quote immediately so the receive
  // side cannot linger in a loading state for the just-finished amount.
  const quoteAmount = amount === "" ? "" : debouncedAmount;
  const intent = deriveExchangeIntent({
    accessState: protocol.accessState,
    amount: quoteAmount,
    direction,
    readerAvailable: protocol.reader !== undefined,
    settlementMode,
    wallet,
  });
  const walletScopeKey = quoteWalletScopeKey(intent);
  const query = useQuery({
    queryKey: [
      "canonical-market-quote",
      protocol.address,
      direction,
      settlementMode,
      amount,
      walletScopeKey,
      protocol.exchangeQuoteRevision,
    ],
    queryFn: async ({ signal }) =>
      runPublicRead(
        async (readSignal) => {
          const reader = protocol.readerForSignal(readSignal);
          if (
            reader === undefined ||
            protocol.address === undefined ||
            intent.status !== "ready"
          ) {
            throw new Error(applicationCopy.exchange.unavailable);
          }
          const quote = await reader.quoteExactInput(
            direction === "sell",
            intent.amountIn,
            protocol.address,
          );
          return {
            quote,
            receivedAtMilliseconds: Date.now(),
            walletScope: {
              account: intent.account,
              observedBlock: intent.walletObservedBlock,
              liquidTokenBalanceWei: intent.liquidTokenBalanceWei,
            },
          };
        },
        { signal },
      ),
    enabled:
      amount === quoteAmount &&
      intent.quoteEnabled &&
      protocol.address !== undefined,
    // Keep a visible, eligible order current while the collector reviews it.
    // Stop renewal during wallet actions; the next review gets fresh evidence.
    refetchInterval: (query) =>
      isTransactionInFlight(protocol.transaction)
        ? false
        : query.state.status === "error"
          ? 30_000
          : 15_000,
    refetchOnWindowFocus: "always",
    retry: webProtocolQueryRetryCount,
  });
  const settled = amount === quoteAmount;
  const quoteRead = !settled
    ? ({ status: "loading" } as const)
    : query.error !== null
      ? ({ status: "failed" } as const)
      : query.data === undefined
        ? query.isFetching
          ? ({ status: "loading" } as const)
          : ({ status: "idle" } as const)
        : ({
            status: "loaded",
            quote: query.data.quote,
            receivedAtMilliseconds: query.data.receivedAtMilliseconds,
            walletScope: query.data.walletScope,
          } as const);
  return {
    quote: quoteRead.status === "loaded" ? quoteRead.quote : undefined,
    quoteRead,
    freshUntilMilliseconds:
      quoteRead.status === "loaded"
        ? exchangeQuoteFreshUntilMilliseconds(
            quoteRead.quote,
            quoteRead.receivedAtMilliseconds,
          )
        : undefined,
    refresh: async () => {
      await query.refetch();
    },
  } as const;
};

const useQuoteFreshnessClock = (freshUntilMilliseconds: number | undefined) => {
  const [nowMilliseconds, setNowMilliseconds] = useState(() => Date.now());
  useEffect(() => {
    if (freshUntilMilliseconds === undefined) return;
    const interval = window.setInterval(
      () => setNowMilliseconds(Date.now()),
      1_000,
    );
    const delay = Math.max(0, freshUntilMilliseconds - Date.now() + 1);
    const timeout = window.setTimeout(
      () => setNowMilliseconds(Date.now()),
      delay,
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [freshUntilMilliseconds]);
  return nowMilliseconds;
};

const quoteReceivedAt = (
  quoteRead: ReturnType<typeof useMarketQuote>["quoteRead"],
): number | undefined =>
  quoteRead.status === "loaded" ? quoteRead.receivedAtMilliseconds : undefined;

const submitLabels: Record<
  ExchangeDirection,
  { readonly idle: string; readonly pending: string }
> = {
  buy: {
    idle: applicationCopy.exchange.submitBuy,
    pending: applicationCopy.exchange.submittingBuy,
  },
  sell: {
    idle: applicationCopy.exchange.submitSell,
    pending: applicationCopy.exchange.submittingSell,
  },
};

function ExchangeActions({
  accessMessage,
  canSubmit,
  direction,
  onQuote,
  onSubmit,
  pending,
  retryQuote,
}: {
  readonly accessMessage: string | undefined;
  readonly canSubmit: boolean;
  readonly direction: ExchangeDirection;
  readonly onQuote: () => Promise<void>;
  readonly onSubmit: () => Promise<void>;
  readonly pending: boolean;
  readonly retryQuote: boolean;
}) {
  const disabledReason = canSubmit
    ? undefined
    : pending
      ? "Wait for the current transaction to finish before submitting another exchange."
      : accessMessage;
  return (
    <div>
      <div className="grid gap-2" data-exchange-actions>
        {retryQuote ? (
          <Button
            className="w-full"
            onClick={onQuote}
            size="lg"
            type="button"
            variant="outline"
          >
            {applicationCopy.exchange.refreshQuote}
          </Button>
        ) : null}
        <Button
          aria-describedby={
            disabledReason === undefined
              ? undefined
              : "exchange-submit-disabled-reason"
          }
          className="w-full"
          disabled={!canSubmit}
          focusableWhenDisabled
          onClick={onSubmit}
          size="lg"
          type="button"
        >
          {pending
            ? submitLabels[direction].pending
            : submitLabels[direction].idle}
        </Button>
      </div>
      {disabledReason === undefined ? null : (
        <DisabledReason id="exchange-submit-disabled-reason">
          {disabledReason}
        </DisabledReason>
      )}
    </div>
  );
}

const recoveryLinkClassName =
  "flex min-h-11 w-fit items-center font-mono text-body-sm text-signal underline decoration-1 underline-offset-4 hover:text-ink";

function InsufficientBalanceFeedback({
  intent,
  onBuyRecovery,
}: {
  readonly intent: Extract<
    ExchangeIntent,
    { readonly status: "insufficient-balance" }
  >;
  readonly onBuyRecovery: () => void;
}) {
  const asset =
    intent.asset === "native"
      ? applicationCopy.exchange.nativeEth
      : intent.asset === "settlement"
        ? applicationCopy.exchange.wrappedEth
        : applicationCopy.exchange.token;
  return (
    <div
      className="grid gap-0.5 text-body-sm text-danger"
      id="exchange-amount-feedback"
      role="alert"
    >
      <p>{applicationCopy.exchange.insufficientBalance(asset)}</p>
      <p>
        {applicationCopy.exchange.availableMaximum(
          formatTokenAmount(intent.availableBalanceWei).display,
          asset,
        )}
      </p>
      {intent.recovery === "faucet" ? (
        <TestFundsLink
          className={recoveryLinkClassName}
          href="/faucet?returnTo=/exchange"
        >
          {intent.asset === "native"
            ? applicationCopy.exchange.nativeFaucetRecovery
            : applicationCopy.exchange.faucetRecovery}
        </TestFundsLink>
      ) : intent.recovery === "buy" ? (
        <button
          className={recoveryLinkClassName}
          onClick={onBuyRecovery}
          type="button"
        >
          {applicationCopy.exchange.buyRecovery}
        </button>
      ) : null}
    </div>
  );
}

function ExchangeIntentFeedback({
  intent,
  onBuyRecovery,
}: {
  readonly intent: ExchangeIntent;
  readonly onBuyRecovery: () => void;
}) {
  if (intent.status === "insufficient-gas") {
    return (
      <div
        id="exchange-amount-feedback"
        className="grid gap-1 text-body-sm text-danger"
        role="alert"
      >
        <p>You need Base Sepolia ETH for network fees.</p>
        <TestFundsLink
          className={recoveryLinkClassName}
          href="/faucet?returnTo=/exchange"
        >
          Get test ETH
        </TestFundsLink>
      </div>
    );
  }
  if (intent.status === "insufficient-balance") {
    return (
      <InsufficientBalanceFeedback
        intent={intent}
        onBuyRecovery={onBuyRecovery}
      />
    );
  }
  const feedback = staticIntentFeedback[intent.status];
  return feedback === undefined ? null : (
    <p
      className={
        feedback.tone === "error"
          ? "text-body-sm text-danger"
          : "text-body-sm text-ink-soft"
      }
      id="exchange-amount-feedback"
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      {feedback.message}
    </p>
  );
}

/** Wallet and market evidence stays available without competing with the order. */
function ExchangeSecondaryDetails({
  balances,
  displayedQuote,
  payAsset,
  protocol,
}: {
  readonly balances: WalletBalances;
  readonly displayedQuote: ExchangeQuote | undefined;
  readonly payAsset: string;
  readonly protocol: ProtocolClient;
}) {
  return (
    <Disclosure searchable title="Wallet balances and market details">
      <div className="grid gap-4">
        <h3 className="sr-only" id="exchange-wallet-title">
          {applicationCopy.exchange.walletTitle}
        </h3>
        {/* A blocked read has no balances to list; three dashes under a
         * connect button would be a row of dead metrics. */}
        {protocol.walletRead.status === "blocked" ? null : (
          <ExchangeBalancesBoard
            labelledBy="exchange-wallet-title"
            observedBlock={balances.observedBlock}
            payAsset={payAsset}
            rows={[
              {
                asset: applicationCopy.exchange.nativeEth,
                ...balances.nativeEth,
              },
              {
                asset: applicationCopy.exchange.wrappedEth,
                ...balances.settlementToken,
              },
              {
                asset: applicationCopy.exchange.token,
                ...balances.liquidToken,
              },
            ]}
          />
        )}
        <div className="flex justify-end">
          <ExchangeBalancesRefresh
            enabled={
              protocol.walletRead.status === "loaded" ||
              protocol.walletRead.status === "failed"
            }
            onRefresh={protocol.refreshWallet}
          />
        </div>
        <div className="border-t border-line pt-3">
          <ExchangeMarketReference
            feeBasisPoints={displayedQuote?.tradingFeeBps}
            priceWei={protocol.health?.market.price?.wethPerLiquidTokenWei}
          />
        </div>
      </div>
    </Disclosure>
  );
}

type SubmittedTrade = {
  readonly quote: ExchangeQuote;
  readonly review: ReturnType<typeof deriveExchangeReviewState>;
  readonly address: string;
};
const pendingReview = (
  pending: boolean,
  submitted: SubmittedTrade | undefined,
  address: string | undefined,
) => (pending && submitted?.address === address ? submitted : undefined);
const isApproval = (protocol: ProtocolClient) =>
  protocol.transactionMetadata?.isApproval === true;
const healthObservedBlock = (protocol: ProtocolClient) =>
  protocol.health?.deployment?.observedBlock;
const marketReferencePrice = (protocol: ProtocolClient) =>
  protocol.health?.market.price?.wethPerLiquidTokenWei;
const executeTrade = (
  protocol: ProtocolClient,
  quote: NonNullable<ReturnType<typeof useMarketQuote>["quote"]>,
  direction: ExchangeDirection,
  mode: ExchangeSettlementMode,
) =>
  protocol.execute(
    {
      type: "swap-exact-input",
      quote,
      liquidTokenForWeth: direction === "sell",
      exactAmountIn: quote.amountIn,
      minimumAmountOut: exchangeMinimumAmountOut(quote.amountOut),
      recipient: protocol.address!,
      deadline: BigInt(
        Math.floor(Date.now() / 1000) +
          EXCHANGE_SLIPPAGE_POLICY.deadlineSeconds,
      ),
      useNative: mode === "native",
    },
    direction === "buy"
      ? applicationCopy.exchange.directionToToken
      : applicationCopy.exchange.directionToWeth,
  );

export function ExchangePanel() {
  const protocol = useProtocolClient();
  const {
    direction,
    setDirection,
    settlementMode,
    setSettlementMode,
    amount,
    setAmount,
  } = useExchangeDraft(protocol.address);
  const [submitted, setSubmitted] = useState<{
    quote: ExchangeQuote;
    review: ReturnType<typeof deriveExchangeReviewState>;
    address: string;
  }>();
  const [completed, setCompleted] = useState<{
    direction: ExchangeDirection;
    address: string;
  }>();
  const settlementModeChosen = useRef(false);
  useEffect(() => {
    if (
      settlementModeChosen.current ||
      amount !== "" ||
      protocol.walletRead.status !== "loaded" ||
      protocol.walletRead.snapshot.settlementToken.rawWei > 0n ||
      protocol.nativeBalanceRead?.status !== "loaded" ||
      protocol.nativeBalanceRead.balance.rawWei <= NATIVE_TRADE_GAS_RESERVE_WEI
    ) {
      return;
    }
    setSettlementMode("native");
  }, [
    amount,
    protocol.nativeBalanceRead,
    protocol.walletRead,
    setSettlementMode,
  ]);
  const wallet = exchangeWalletEvidence(protocol);
  const intent = deriveExchangeIntent({
    accessState: protocol.accessState,
    amount,
    direction,
    readerAvailable: protocol.reader !== undefined,
    settlementMode,
    wallet,
  });
  const quoteState = useMarketQuote(
    protocol,
    direction,
    amount,
    wallet,
    settlementMode,
  );
  const nowMilliseconds = useQuoteFreshnessClock(
    quoteState.freshUntilMilliseconds,
  );
  const transactionPending = isTransactionInFlight(protocol.transaction);
  const reviewState = deriveExchangeReviewState({
    intent,
    nowMilliseconds,
    observedBlock: healthObservedBlock(protocol),
    quoteRead: quoteState.quoteRead,
    transactionPending,
  });
  const currentQuote =
    reviewState.status === "ready" ? quoteState.quote : undefined;
  const frozen = pendingReview(transactionPending, submitted, protocol.address);
  const displayedQuote =
    frozen?.quote ?? quoteForDisplay(reviewState.status, quoteState.quote);
  const displayedReview = frozen?.review ?? reviewState;

  const submitExchange = async () => {
    if (currentQuote === undefined || protocol.address === undefined) return;
    setSubmitted({
      quote: currentQuote,
      review: reviewState,
      address: protocol.address,
    });
    setCompleted(undefined);
    const result = await executeTrade(
      protocol,
      currentQuote,
      direction,
      settlementMode,
    );
    if (result.status === "confirmed") {
      setAmount("");
      setCompleted({ direction, address: protocol.address });
    }
  };

  const assets = exchangeAssets(direction, settlementMode);
  const referencePriceWei = marketReferencePrice(protocol);

  /* DOM order is the reading order a trader needs: inputs, the current quote
   * summary, the submit button, then the full terms as evidence. */
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 laptop:grid-cols-12 laptop:items-start">
      <div className="min-w-0 laptop:col-span-12">
        <CollectorReturnLink />
      </div>
      <Panel
        bodyClassName="grid gap-4"
        className="laptop:col-span-5 laptop:col-start-8 laptop:row-start-2 nav:col-span-4 nav:col-start-9"
      >
        <h2 className="sr-only">{applicationCopy.exchange.orderTitle}</h2>
        {accessNoticeVisible(protocol, intent.status) ? (
          <AccessNotice compact />
        ) : null}
        <TradeCompletion
          completed={completed}
          protocol={protocol}
          onDismiss={() => setCompleted(undefined)}
        />
        <fieldset disabled={transactionPending} className="grid min-w-0 gap-3">
          <ExchangeDirectionControl
            direction={direction}
            onDirection={setDirection}
          />
          <SettlementModeControl
            direction={direction}
            mode={settlementMode}
            onMode={(mode) => {
              settlementModeChosen.current = true;
              setSettlementMode(mode);
            }}
          />
          <div className="grid gap-2">
            <ExchangeInstrument
              amount={amount}
              intent={intent}
              maximumAmountWei={spendableBalanceWei(
                wallet,
                direction,
                settlementMode,
              )}
              onAmount={setAmount}
              outputState={outputStateFor(quoteState.quoteRead.status)}
              payAsset={assets.pay}
              quote={displayedQuote}
              receiveAsset={assets.receive}
            />
            <ExchangeIntentFeedback
              intent={intent}
              onBuyRecovery={() => setDirection("buy")}
            />
          </div>
        </fieldset>
        <TradeDiscoveryTarget
          direction={direction}
          mode={settlementMode}
          wallet={wallet}
          protocol={protocol}
          pending={transactionPending}
          onAmount={setAmount}
        />
        {amount === "" ? (
          <DiscoveryShortfall protocol={protocol} direction={direction} />
        ) : null}
        <TradeConfirmationSteps
          nativeBuy={settlementMode === "native" && direction === "buy"}
          pending={transactionPending}
          approval={isApproval(protocol)}
          hasQuote={displayedQuote !== undefined}
        />
        <ExchangeDecisionReview
          displayedQuote={displayedQuote}
          nowMilliseconds={nowMilliseconds}
          quoteReceivedAtMilliseconds={quoteReceivedAt(quoteState.quoteRead)}
          referencePriceWei={referencePriceWei}
          reviewState={displayedReview}
          settlementMode={settlementMode}
        />
        <div className="grid gap-3">
          <ExchangeActions
            accessMessage={intentAccessMessage(intent, reviewState.status)}
            canSubmit={reviewState.submitEnabled}
            direction={direction}
            onQuote={quoteState.refresh}
            onSubmit={submitExchange}
            pending={transactionPending}
            retryQuote={"retryAvailable" in reviewState}
          />
        </div>
        <ExchangeTradeEvidence
          displayedQuote={displayedQuote}
          referencePriceWei={referencePriceWei}
          settlementMode={settlementMode}
        />
        <ExchangeSecondaryDetails
          balances={walletBalanceValues(protocol)}
          displayedQuote={displayedQuote}
          payAsset={assets.pay}
          protocol={protocol}
        />
      </Panel>
      <div className="min-w-0 laptop:col-span-7 laptop:col-start-1 laptop:row-start-2 laptop:sticky laptop:top-[5.5rem] nav:col-span-8">
        <TradeMarketContext
          history={protocol.marketHistory}
          onRefresh={protocol.refreshMarketHistory}
          priceWei={referencePriceWei}
        />
      </div>
    </div>
  );
}
