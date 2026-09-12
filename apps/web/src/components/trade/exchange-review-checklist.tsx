"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Well } from "@/components/ui/panel";
import { Amount, Count } from "@/components/ui/value";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import {
  deriveExchangeTradeTerms,
  type deriveExchangeReviewState,
  type ExchangeQuote,
  type ExchangeSettlementMode,
  type ExchangeTradeTerms,
} from "@/lib/exchange-state";
import { formatTokenAmount } from "@/lib/format";
import { applicationCopy } from "@/lib/identity";

type ExchangeReviewState = ReturnType<typeof deriveExchangeReviewState>;
type ReadyReview = Extract<
  ExchangeReviewState,
  { readonly status: "ready" }
>["review"];

const quoteRoute = (quote: ExchangeQuote) =>
  quote.liquidTokenForWeth
    ? `${applicationCopy.exchange.token} → WETH`
    : `WETH → ${applicationCopy.exchange.token}`;

const rawQuoteEvidence = (
  quote: ExchangeQuote,
  settlementMode: ExchangeSettlementMode,
) =>
  JSON.stringify(
    {
      route: quoteRoute(quote),
      settlementMode,
      amountInRaw: quote.amountIn.toString(),
      amountOutRaw: quote.amountOut.toString(),
      tradingFeeRaw: quote.tradingFee.toString(),
      observedBlock: quote.observedBlock.toString(),
      expiresAtBlock: quote.expiresAtBlock.toString(),
      canonicalRouter:
        protocolDeploymentManifest?.contracts.canonicalRouter ?? null,
      canonicalFeeHook:
        protocolDeploymentManifest?.contracts.canonicalFeeHook ?? null,
      canonicalPoolId: protocolDeploymentManifest?.canonicalPool.poolId ?? null,
    },
    null,
    2,
  );

const evidenceCode = "font-mono text-caption [overflow-wrap:anywhere]";

function RawQuoteEvidence({
  quote,
  settlementMode,
}: {
  readonly quote: ExchangeQuote;
  readonly settlementMode: ExchangeSettlementMode;
}) {
  const [copiedRaw, setCopiedRaw] = useState<string | undefined>();
  const rawEvidence = useMemo(
    () => rawQuoteEvidence(quote, settlementMode),
    [quote, settlementMode],
  );
  return (
    <Disclosure searchable title="Raw quote and route evidence">
      <DataList>
        <DataRow label="Route" value={quoteRoute(quote)} />
        <DataRow
          label="Canonical router"
          value={
            <code className={evidenceCode}>
              {protocolDeploymentManifest?.contracts.canonicalRouter ??
                applicationCopy.common.notObserved}
            </code>
          }
        />
        <DataRow
          label="Canonical pool"
          value={
            <code className={evidenceCode}>
              {protocolDeploymentManifest?.canonicalPool.poolId ??
                applicationCopy.common.notObserved}
            </code>
          }
        />
      </DataList>
      <Button
        className="mt-3"
        onClick={() => {
          if (navigator.clipboard === undefined) return;
          void navigator.clipboard
            .writeText(rawEvidence)
            .then(() => setCopiedRaw(rawEvidence))
            .catch(() => setCopiedRaw(undefined));
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {copiedRaw === rawEvidence
          ? "Copied raw quote evidence"
          : "Copy raw quote evidence"}
      </Button>
      <pre className="mt-3 max-h-80 overflow-auto rounded-[var(--radius-control)] bg-canvas p-3 font-mono text-caption [overflow-wrap:anywhere] whitespace-pre-wrap">
        {rawEvidence}
      </pre>
    </Disclosure>
  );
}

/**
 * The full pre-flight terms for a quoted trade, collapsed by default: the
 * review well above the submit button carries what a trader must read, and
 * these seven rows are the evidence they can open.
 */
function ExchangeTradeTermsList({
  quote,
  referencePriceWei,
  settlementMode,
}: {
  readonly quote: ExchangeQuote;
  readonly referencePriceWei: bigint | undefined;
  readonly settlementMode: ExchangeSettlementMode;
}) {
  const terms = deriveExchangeTradeTerms(
    quote,
    referencePriceWei,
    settlementMode,
  );
  const rows: readonly (readonly [string, string])[] = [
    [applicationCopy.exchange.executionPrice, terms.executionPrice],
    ...(terms.priceImpact === undefined
      ? []
      : ([[applicationCopy.exchange.priceImpact, terms.priceImpact]] as const)),
    [applicationCopy.exchange.fee, `${terms.feeAmount} (${terms.feePercent})`],
    [applicationCopy.exchange.minimumReceived, terms.minimumReceived],
    [applicationCopy.exchange.quoteBlock, terms.quoteBlock],
    [applicationCopy.exchange.slippageTolerance, terms.slippageTolerance],
    [applicationCopy.exchange.deadlineLabel, terms.deadline],
  ];
  return (
    <Disclosure searchable title={applicationCopy.exchange.termsTitle}>
      <div data-trade-terms>
        <DataList>
          {rows.map(([label, value]) => (
            <DataRow
              key={label}
              label={label}
              value={<span className="[overflow-wrap:anywhere]">{value}</span>}
            />
          ))}
        </DataList>
        <p className="mt-3 text-body-sm text-ink-soft">
          {applicationCopy.exchange.slippagePolicy(
            terms.slippageTolerance,
            terms.deadline,
          )}
        </p>
        <div className="mt-3">
          <RawQuoteEvidence quote={quote} settlementMode={settlementMode} />
        </div>
      </div>
    </Disclosure>
  );
}

/** Detailed protocol evidence stays available after the decisive action. */
export function ExchangeTradeEvidence({
  displayedQuote,
  referencePriceWei,
  settlementMode,
}: {
  readonly displayedQuote: ExchangeQuote | undefined;
  readonly referencePriceWei: bigint | undefined;
  readonly settlementMode: ExchangeSettlementMode;
}) {
  if (displayedQuote === undefined) return null;
  return (
    <ExchangeTradeTermsList
      quote={displayedQuote}
      referencePriceWei={referencePriceWei}
      settlementMode={settlementMode}
    />
  );
}

const quoteAgeSeconds = (
  nowMilliseconds: number | undefined,
  receivedAtMilliseconds: number | undefined,
): number | undefined => {
  if (nowMilliseconds === undefined || receivedAtMilliseconds === undefined) {
    return undefined;
  }
  return Math.max(
    0,
    Math.floor((nowMilliseconds - receivedAtMilliseconds) / 1_000),
  );
};

/**
 * The confirmed pre-flight summary for a trade the wallet can submit now: the
 * one review sentence, then the numbers a trader compares before pressing the
 * button directly beneath. No enter animation: this mounts and unmounts as a
 * quote loads or expires, and a fade would obscure actionable state.
 */
function ExchangeReviewReady({
  ageSeconds,
  quote,
  review,
  terms,
}: {
  readonly ageSeconds: number | undefined;
  readonly quote: ExchangeQuote;
  readonly review: ReadyReview;
  readonly terms: ExchangeTradeTerms;
}) {
  const age =
    ageSeconds === undefined
      ? applicationCopy.exchange.quoteFresh
      : applicationCopy.exchange.quoteAge(ageSeconds);
  return (
    <section aria-labelledby="trade-review" data-trade-review>
      <h3
        className="font-mono text-label font-semibold tracking-[0.1em] text-ink-faint uppercase"
        id="trade-review"
      >
        {applicationCopy.exchange.reviewTitle}
      </h3>
      <p className="mt-1.5 text-body-sm text-ink">{review.sentence}</p>
      <DataList className="mt-1.5">
        <DataRow
          label={applicationCopy.exchange.reviewPay}
          value={<Amount unit={terms.payAsset} value={quote.amountIn} />}
        />
        <DataRow
          label={applicationCopy.exchange.reviewReceive}
          tone="live"
          value={<Amount unit={terms.receiveAsset} value={quote.amountOut} />}
        />
        <DataRow
          label={applicationCopy.exchange.minimumReceived}
          value={terms.minimumReceived}
        />
        <DataRow
          label={applicationCopy.exchange.fee}
          value={`${terms.feeAmount} (${terms.feePercent})`}
        />
        {terms.priceImpact === undefined ? null : (
          <DataRow
            label={applicationCopy.exchange.priceImpact}
            value={terms.priceImpact}
          />
        )}
        <DataRow
          label={applicationCopy.exchange.quoteFreshness}
          value={
            <>
              {`${age} · block `}
              <Count value={quote.observedBlock} />
            </>
          }
        />
      </DataList>
      {"warning" in review ? (
        <p
          className="mt-2 border-l-2 border-[var(--status-warning-text)] pl-3 text-body-sm text-warning"
          role="alert"
        >
          {review.warning}
        </p>
      ) : null}
    </section>
  );
}

interface ReviewFeedback {
  readonly message: string;
  readonly role: "alert" | "status" | undefined;
}

/* Every blocked, stale, or loading state keeps the role grammar the intent
 * derivation expects: errors are alerts, waiting states are polite statuses. */
const accessQuoteMessages: Partial<
  Record<ExchangeReviewState["status"], string>
> = {
  disconnected:
    "Connect your wallet to get a live quote. Your amount will stay here.",
  "wrong-network": `Switch to ${deploymentEnvironment.chainLabel} to get a live quote. Your amount will stay here.`,
  "deployment-pending":
    "Trading is not available for this deployment yet. Your amount will stay here.",
};
export const exchangeAccessQuoteMessage = (
  status: ExchangeReviewState["status"],
): string | undefined => accessQuoteMessages[status];

const staticReviewFeedback: Partial<
  Record<ExchangeReviewState["status"], ReviewFeedback>
> = {
  "transaction-pending": {
    message:
      "Your wallet action is in progress. We’ll update your balances when it confirms.",
    role: "status",
  },
  "quote-unavailable": {
    message: applicationCopy.exchange.quoteUnavailable,
    role: "alert",
  },
  "stale-quote": {
    message: applicationCopy.exchange.staleQuote,
    role: "status",
  },
  "discovery-unavailable": {
    message: applicationCopy.exchange.discoveryEvidenceUnavailable,
    role: "alert",
  },
  "discovery-invalid": {
    message: applicationCopy.exchange.discoveryEvidenceInvalid,
    role: "alert",
  },
  "quote-loading": {
    message: applicationCopy.exchange.quoteLoading,
    role: "status",
  },
  empty: { message: applicationCopy.exchange.quoteEmpty, role: undefined },
};

const reviewFeedbackFor = (
  reviewState: ExchangeReviewState,
): ReviewFeedback | undefined => {
  const accessMessage = exchangeAccessQuoteMessage(reviewState.status);
  if (accessMessage !== undefined)
    return { message: accessMessage, role: "status" };
  return reviewState.status === "discovery-limit"
    ? {
        message: applicationCopy.exchange.discoveryLimit(
          reviewState.mutations,
          reviewState.maximumMutations,
          formatTokenAmount(reviewState.maximumLiquidTokenAmount).display,
        ),
        role: "alert",
      }
    : staticReviewFeedback[reviewState.status];
};

/**
 * The decision a trader must understand before submission, in a recessed well
 * directly above the submit button. Ready quotes get the full summary; every
 * other state gets one line.
 */
export function ExchangeDecisionReview({
  displayedQuote,
  nowMilliseconds,
  quoteReceivedAtMilliseconds,
  referencePriceWei,
  reviewState,
  settlementMode,
}: {
  readonly displayedQuote: ExchangeQuote | undefined;
  readonly nowMilliseconds: number | undefined;
  readonly quoteReceivedAtMilliseconds: number | undefined;
  readonly referencePriceWei: bigint | undefined;
  readonly reviewState: ExchangeReviewState;
  readonly settlementMode: ExchangeSettlementMode;
}) {
  if (reviewState.status === "ready" && displayedQuote !== undefined) {
    return (
      <Well className="grid min-h-[6rem] content-start">
        <ExchangeReviewReady
          ageSeconds={quoteAgeSeconds(
            nowMilliseconds,
            quoteReceivedAtMilliseconds,
          )}
          quote={displayedQuote}
          review={reviewState.review}
          terms={deriveExchangeTradeTerms(
            displayedQuote,
            referencePriceWei,
            settlementMode,
          )}
        />
      </Well>
    );
  }
  /* A state with nothing of its own to say (an amount the
   * field is already rejecting) keeps the well's promise visible instead of
   * leaving an empty box above the button. */
  const feedback = reviewFeedbackFor(reviewState) ?? staticReviewFeedback.empty;
  return (
    <Well className="grid min-h-[6rem] content-center">
      <p
        className={
          feedback?.role === "alert"
            ? "text-body-sm text-danger"
            : "text-body-sm text-ink-soft"
        }
        role={feedback?.role}
      >
        {feedback?.message}
      </p>
    </Well>
  );
}
