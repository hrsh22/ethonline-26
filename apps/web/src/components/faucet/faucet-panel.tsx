"use client";

import type { TestnetFundingResponse } from "@orbit/config/testnet-funding";

import type { StateFeedbackTone } from "@/components/state-feedback";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import { Unavailable } from "@/components/ui/value";
import { WalletControl } from "@/components/wallet-control";
import { useTestnetFunding } from "@/hooks/use-testnet-funding";
import { formatTokenAmount } from "@/lib/format";
import { applicationCopy } from "@/lib/identity";
import type {
  TestnetFundingView,
  TestnetFundingViewState,
} from "@/lib/testnet-funding-view";
import { useProtocolClient } from "@/providers/protocol-client-provider";
import { cn } from "@/lib/utils";

/**
 * The faucet: an eligibility board (what this wallet holds against the
 * targets, and when it is next eligible), the request itself, and — collapsed
 * — what each test asset is and is not.
 */

type AssetCopy =
  (typeof applicationCopy.faucet.assets)[keyof typeof applicationCopy.faucet.assets];

type AssetSymbol = string;

interface FaucetAmount {
  readonly display: string;
  readonly exact: string;
  readonly symbol: AssetSymbol;
}

interface FaucetAmounts {
  readonly balance: FaucetAmount | undefined;
  /** Absent for assets the faucet never dispenses, such as the liquid token. */
  readonly remaining: FaucetAmount | undefined;
  readonly target: FaucetAmount | undefined;
}

/*
 * Amounts go through the shared formatter; the exact expansion travels with
 * the compact display so a rounded figure never hides a small balance.
 */
const faucetAmount = (
  wei: string | bigint | undefined,
  symbol: AssetSymbol,
): FaucetAmount | undefined => {
  if (wei === undefined) return undefined;
  const formatted = formatTokenAmount(BigInt(wei));
  return { display: formatted.display, exact: formatted.exact, symbol };
};

const amountText = (amount: FaucetAmount): string =>
  `${amount.display} ${amount.symbol}`;

const assetAmounts = (
  response: TestnetFundingResponse | undefined,
  asset: "ethWei" | "wethWei",
  symbol: "ETH" | "WETH",
): FaucetAmounts => ({
  balance: faucetAmount(response?.recipient?.balances?.[asset], symbol),
  remaining: faucetAmount(response?.recipient?.remaining?.[asset], symbol),
  target: faucetAmount(response?.service?.targets?.[asset], symbol),
});

/**
 * A faucet amount with its unit. The shared `Amount` primitive sets the unit
 * in a separate span with no text separator, which reads fine but makes the
 * board's text content "0.001ETH"; here the unit is part of the sentence.
 */
function FaucetAmountValue({ amount }: { readonly amount: FaucetAmount }) {
  return (
    <span
      className="font-mono tabular-nums"
      title={
        amount.exact === amount.display
          ? undefined
          : amountText({ ...amount, display: amount.exact })
      }
    >
      {amount.display}{" "}
      <span className="text-[0.8em] font-medium tracking-wide text-ink-faint">
        {amount.symbol}
      </span>
    </span>
  );
}

const fundingStateCopy = (
  state: TestnetFundingViewState,
): { readonly title: string; readonly body: string } =>
  applicationCopy.faucet.states[state];

const fundingStateTone = (
  state: TestnetFundingViewState,
): StateFeedbackTone => {
  if (
    state === "retryable" ||
    state === "rpc-unavailable" ||
    state === "unavailable"
  ) {
    return "error";
  }
  if (state === "checking" || state === "submitting" || state === "pending") {
    return "loading";
  }
  if (state === "funded") return "success";
  if (state === "eligible") return "notice";
  return "blocked";
};

const badgeTone: Record<StateFeedbackTone, BadgeTone> = {
  loading: "info",
  empty: "neutral",
  notice: "live",
  blocked: "warning",
  partial: "warning",
  stale: "warning",
  success: "success",
  error: "danger",
};

const nextEligibleAt = (
  response: TestnetFundingResponse | undefined,
): number | undefined =>
  response?.recipient?.nextEligibleAt ?? response?.error?.nextEligibleAt;

function FaucetAction({
  fund,
  retry,
  view,
}: {
  readonly fund: () => void;
  readonly retry: () => void;
  readonly view: TestnetFundingView;
}) {
  switch (view.action) {
    case "connect-wallet":
    case "switch-network":
      // The status above already names the condition; the control only acts.
      return <WalletControl notices={false} />;
    case "fund":
      return (
        <Button onClick={fund} type="button">
          {applicationCopy.faucet.actions.fund}
        </Button>
      );
    case "retry-status":
      return (
        <Button onClick={retry} type="button" variant="outline">
          {applicationCopy.faucet.actions.retryStatus}
        </Button>
      );
    case "retry-funding":
      return (
        <Button onClick={retry} type="button">
          {applicationCopy.faucet.actions.retryFunding}
        </Button>
      );
    case "trade":
      return (
        <ButtonLink href="/exchange">
          {applicationCopy.faucet.actions.trade}
        </ButtonLink>
      );
    case "none":
      return null;
  }
}

/** A balance against its target: the value is what the wallet holds. */
function AssetMetric({
  amounts,
  fallback,
  label,
}: {
  readonly amounts: FaucetAmounts;
  readonly fallback: string;
  readonly label: string;
}) {
  const hint =
    amounts.remaining === undefined
      ? amounts.target === undefined
        ? undefined
        : applicationCopy.faucet.target(amountText(amounts.target))
      : applicationCopy.faucet.remaining(amountText(amounts.remaining));
  return (
    <Metric
      hint={hint}
      label={label}
      value={
        amounts.balance === undefined ? (
          <span className="text-body text-ink-soft">{fallback}</span>
        ) : (
          <FaucetAmountValue amount={amounts.balance} />
        )
      }
    />
  );
}

const cooldownHint = (
  response: TestnetFundingResponse | undefined,
): string | undefined => {
  const seconds = response?.service?.cooldownSeconds;
  if (seconds === undefined) return undefined;
  return applicationCopy.faucet.cooldownHint((seconds / 3600).toFixed(0));
};

/**
 * What "eligible again" means when the service reported no deadline.
 *
 * `nextEligibleAt` is only sent while a cooldown is running, so a successful
 * status read that omits it means no cooldown is in force. Treating that as an
 * unobserved value printed "—" for every wallet that had simply never
 * requested a top-up — a dash for a fact the read had actually established.
 */
function EligibleAgainWithoutDeadline({
  response,
  view,
}: {
  readonly response: TestnetFundingResponse | undefined;
  readonly view: TestnetFundingView;
}) {
  if (response === undefined) {
    return (
      <span className="text-body text-ink-soft">
        {applicationCopy.faucet.eligibleUnknown}
      </span>
    );
  }
  if (view.state === "cooldown") {
    // A cooldown without its deadline is the one case the value was expected
    // and could not be read.
    return <Unavailable reason={applicationCopy.common.notObserved} />;
  }
  if (view.state === "lifetime-exhausted") {
    return (
      <span className="text-body text-ink-soft">
        {applicationCopy.faucet.states["lifetime-exhausted"].title}
      </span>
    );
  }
  return <>{applicationCopy.faucet.eligibleNow}</>;
}

function EligibleAgainMetric({
  response,
  view,
}: {
  readonly response: TestnetFundingResponse | undefined;
  readonly view: TestnetFundingView;
}) {
  const eligibleAt = nextEligibleAt(response);
  const value =
    eligibleAt === undefined ? (
      <EligibleAgainWithoutDeadline response={response} view={view} />
    ) : (
      <time
        className="text-title-sm"
        dateTime={new Date(eligibleAt).toISOString()}
      >
        {new Date(eligibleAt).toLocaleString()}
      </time>
    );
  return (
    <Metric
      hint={cooldownHint(response)}
      label={applicationCopy.faucet.nextEligible}
      tone={
        eligibleAt === undefined && view.state === "eligible"
          ? "live"
          : "default"
      }
      value={value}
    />
  );
}

function EligibilityBoard({
  gas,
  response,
  view,
  weth,
}: {
  readonly gas: FaucetAmounts;
  readonly response: TestnetFundingResponse | undefined;
  readonly view: TestnetFundingView;
  readonly weth: FaucetAmounts;
}) {
  const tone = fundingStateTone(view.state);
  return (
    <MetricGroup columns={4} label={applicationCopy.faucet.eligibilityLabel}>
      <Metric
        label={applicationCopy.faucet.stateLabel}
        value={
          <Badge className="text-body-sm" dot tone={badgeTone[tone]}>
            {applicationCopy.faucet.stateBadges[view.state]}
          </Badge>
        }
      />
      <AssetMetric
        amounts={gas}
        fallback={applicationCopy.faucet.assets.gas.badge}
        label={applicationCopy.faucet.gasLabel}
      />
      <AssetMetric
        amounts={weth}
        fallback={applicationCopy.faucet.assets.weth.badge}
        label={applicationCopy.faucet.wethLabel}
      />
      <EligibleAgainMetric response={response} view={view} />
    </MetricGroup>
  );
}

/**
 * The request. Eligibility is a live reading announced once, in the panel
 * body: failures are alerts, everything else is a status.
 */
function RequestPanel({
  fund,
  retry,
  view,
}: {
  readonly fund: () => void;
  readonly retry: () => void;
  readonly view: TestnetFundingView;
}) {
  const copy = fundingStateCopy(view.state);
  const tone = fundingStateTone(view.state);
  const failure = tone === "error";
  return (
    <Panel
      title={applicationCopy.faucet.requestTitle}
      tone={view.state === "eligible" ? "live" : "default"}
    >
      <div
        aria-atomic="true"
        aria-labelledby="faucet-request-title"
        aria-live={failure ? "assertive" : "polite"}
        className="grid gap-3 tablet:grid-cols-[minmax(0,1fr)_auto] tablet:items-center"
        data-funding-state={view.state}
        data-state={tone}
        role={failure ? "alert" : "status"}
      >
        <div className="min-w-0">
          <h3
            className={cn(
              "font-mono text-title-sm font-semibold",
              failure ? "text-[var(--status-danger-text)]" : "text-ink",
            )}
            id="faucet-request-title"
          >
            {copy.title}
          </h3>
          <p className="mt-1 max-w-[62ch] text-body-sm text-ink-soft">
            {copy.body}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FaucetAction fund={fund} retry={retry} view={view} />
        </div>
      </div>
    </Panel>
  );
}

function FaucetAssetCard({
  amounts,
  copy,
}: {
  readonly amounts?: FaucetAmounts | undefined;
  readonly copy: AssetCopy;
}) {
  const candidates: readonly (readonly [string, FaucetAmount | undefined])[] = [
    [applicationCopy.faucet.currentBalance, amounts?.balance],
    [applicationCopy.faucet.remainingTopUp, amounts?.remaining],
  ];
  const present = candidates.flatMap(([label, amount]) =>
    amount === undefined ? [] : [[label, amount] as const],
  );
  return (
    <article className="min-w-0" data-faucet-asset>
      {/* The badge sits in the body, not the header strip: these boundary
          tokens are sentences long and a header strip cannot shrink. */}
      <Panel className="h-full" title={copy.title}>
        <Badge>{copy.badge}</Badge>
        <p className="mt-2 text-body-sm text-ink-soft">{copy.body}</p>
        {present.length === 0 ? null : (
          <DataList className="mt-3">
            {present.map(([label, amount]) => (
              <DataRow
                key={label}
                label={label}
                value={<FaucetAmountValue amount={amount} />}
              />
            ))}
          </DataList>
        )}
      </Panel>
    </article>
  );
}

function AssetEducation({
  fuel,
  gas,
  weth,
}: {
  readonly fuel: FaucetAmounts;
  readonly gas: FaucetAmounts;
  readonly weth: FaucetAmounts;
}) {
  return (
    <Disclosure searchable title={applicationCopy.faucet.assetBoundaryLabel}>
      <section
        aria-label={applicationCopy.faucet.assetBoundaryLabel}
        className="grid gap-3 tablet:grid-cols-2"
      >
        <FaucetAssetCard
          amounts={gas}
          copy={applicationCopy.faucet.assets.gas}
        />
        <FaucetAssetCard
          amounts={weth}
          copy={applicationCopy.faucet.assets.weth}
        />
        <FaucetAssetCard
          amounts={fuel}
          copy={applicationCopy.faucet.assets.fuel}
        />
        <FaucetAssetCard copy={applicationCopy.faucet.assets.collectibles} />
      </section>
    </Disclosure>
  );
}

function SecurityDisclosure() {
  return (
    <Disclosure searchable title={applicationCopy.faucet.securityDisclosure}>
      <p className="max-w-[62ch] text-body-sm text-ink-soft">
        {applicationCopy.faucet.inventoryDisclosure}
      </p>
      <p className="mt-2 max-w-[62ch] font-mono text-caption text-ink-faint">
        {applicationCopy.faucet.inventoryEvidence}
      </p>
    </Disclosure>
  );
}

export function FaucetPanel() {
  const protocol = useProtocolClient();
  const funding = useTestnetFunding(protocol, "faucet");
  const gas = assetAmounts(funding.statusResponse, "ethWei", "ETH");
  const weth = assetAmounts(funding.statusResponse, "wethWei", "WETH");
  // The route's terminal action is buying the liquid token, so the card that
  // explains it also answers how much this wallet already holds.
  const fuel: FaucetAmounts = {
    balance: faucetAmount(
      protocol.walletRead.status === "loaded"
        ? protocol.walletRead.snapshot.liquidToken.rawWei
        : undefined,
      applicationCopy.exchange.token,
    ),
    remaining: undefined,
    target: undefined,
  };

  return (
    <div className="mt-5 grid gap-3">
      <EligibilityBoard
        gas={gas}
        response={funding.response}
        view={funding.view}
        weth={weth}
      />
      <RequestPanel
        fund={funding.fund}
        retry={funding.retry}
        view={funding.view}
      />
      <AssetEducation fuel={fuel} gas={gas} weth={weth} />
      <SecurityDisclosure />
    </div>
  );
}
