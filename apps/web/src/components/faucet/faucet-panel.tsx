"use client";

import type { TestnetFundingResponse } from "@orbit/config/testnet-funding";

import { RelativeTime } from "@/components/ui/relative-time";

import { CollectorReturnLink } from "@/components/start/collector-return-link";
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
import {
  isTestnetFundingComplete,
  type TestnetFundingView,
  type TestnetFundingViewState,
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

const assetPairText = (
  amounts: { readonly ethWei: string; readonly wethWei: string } | undefined,
): string | undefined => {
  if (amounts === undefined) return undefined;
  const eth = faucetAmount(amounts.ethWei, "ETH")!;
  const weth = faucetAmount(amounts.wethWei, "WETH")!;
  return `${amountText(eth)} / ${amountText(weth)}`;
};

const durationText = (seconds: number): string => {
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const minutes = seconds / 60;
  return `${minutes.toLocaleString()} minutes`;
};

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

const DAILY_LIMIT_CODES = new Set([
  "funding-daily-budget",
  "funding-daily-grant-limit",
]);

const nextEligibleAt = (
  response: TestnetFundingResponse | undefined,
): number | undefined => {
  if (response === undefined) return undefined;
  const recipientDeadline = response.recipient?.nextEligibleAt;
  if (recipientDeadline !== undefined && recipientDeadline !== null) {
    return recipientDeadline;
  }
  const error = response.error;
  if (error === undefined) return undefined;
  if (error.nextEligibleAt !== undefined) return error.nextEligibleAt;
  return DAILY_LIMIT_CODES.has(error.code) ? error.windowResetsAt : undefined;
};

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
      return <CollectorReturnLink fallbackToTrade primary />;
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
      : `${amountText(amounts.remaining)} to reach target`;
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
  view: TestnetFundingView,
): string | undefined => {
  const seconds = response?.service?.cooldownSeconds;
  if (
    seconds === undefined ||
    (view.state !== "cooldown" && view.state !== "funded")
  ) {
    return undefined;
  }
  return `${durationText(seconds)} after a successful top-up`;
};

/**
 * After funding, an omitted deadline is unknown. Explicit null means the
 * service verified that no cooldown remains.
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
  if (
    view.state === "cooldown" ||
    (isTestnetFundingComplete(response) &&
      response.recipient?.nextEligibleAt !== null)
  ) {
    return <Unavailable reason={applicationCopy.common.notObserved} />;
  }
  const labelByState: Partial<Record<TestnetFundingViewState, string>> = {
    disabled: "When service resumes",
    funded: "After a balance falls below target",
    "inventory-empty": "After inventory returns",
    "lifetime-exhausted": "No automatic reset",
  };
  const label = labelByState[view.state];
  if (label !== undefined) {
    return <span className="text-body text-ink-soft">{label}</span>;
  }
  const availableNow =
    isTestnetFundingComplete(response) || view.state === "eligible";
  if (availableNow) return <>{applicationCopy.faucet.eligibleNow}</>;
  return (
    <span className="text-body text-ink-soft">
      {applicationCopy.faucet.eligibleUnknown}
    </span>
  );
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
      <RelativeTime timestamp={eligibleAt} countdown />
    );
  return (
    <Metric
      hint={cooldownHint(response, view)}
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

interface RequestCopy {
  readonly title: string;
  readonly body: string;
}

const lifetimeRequestCopy = (
  response: TestnetFundingResponse | undefined,
  state: TestnetFundingView["state"],
): RequestCopy | undefined => {
  if (state !== "lifetime-exhausted") return undefined;
  const service = response?.service;
  const lifetime = assetPairText(service?.limits?.lifetime);
  return {
    title: applicationCopy.faucet.states["lifetime-exhausted"].title,
    body: `The next top-up would exceed this wallet’s lifetime grant cap for at least one asset. ${lifetime === undefined ? "" : `The caps are ${lifetime}. `}Waiting does not reset them.`,
  };
};

const disabledRequestCopy = (
  state: TestnetFundingView["state"],
): RequestCopy | undefined =>
  state === "disabled"
    ? {
        title: applicationCopy.faucet.states.disabled.title,
        body: "Self-service funding is paused for every wallet. It resumes only when the operator enables it; this wallet’s balance and limits did not cause the pause.",
      }
    : undefined;

const dailyLimitRequestCopy = (
  response: TestnetFundingResponse | undefined,
): RequestCopy | undefined => {
  const errorCode = response?.error?.code ?? "";
  if (!DAILY_LIMIT_CODES.has(errorCode)) return undefined;
  return {
    title: "Faucet daily limit reached",
    body: "A service-wide daily limit has been reached across all wallets. Try again after the daily reset.",
  };
};

const policyRequestCopy = (
  response: TestnetFundingResponse | undefined,
  state: TestnetFundingView["state"],
): RequestCopy | undefined =>
  lifetimeRequestCopy(response, state) ??
  disabledRequestCopy(state) ??
  dailyLimitRequestCopy(response);

const transferRequestCopy = (
  response: TestnetFundingResponse | undefined,
  state: TestnetFundingView["state"],
): RequestCopy =>
  response?.request?.delayed
    ? {
        title: "Your top-up is taking longer than usual",
        body: "The service is still checking the saved transfers. You can leave this page; no further signature is needed.",
      }
    : response?.request?.state === "failed"
      ? {
          title: "The previous top-up could not finish",
          body: "Any received assets remain in your wallet. Check your current eligibility before requesting another top-up.",
        }
      : fundingStateCopy(state);

const requestCopy = (
  response: TestnetFundingResponse | undefined,
  state: TestnetFundingView["state"],
): RequestCopy =>
  policyRequestCopy(response, state) ?? transferRequestCopy(response, state);

function TransferProgress({
  response,
}: {
  readonly response: TestnetFundingResponse | undefined;
}) {
  const request = response?.request;
  if (request?.transactions === undefined) return null;
  return (
    <ul
      aria-label="Top-up transfer progress"
      className="grid gap-1 text-body-sm text-ink-soft"
    >
      {request.transactions.map((transfer) => (
        <li key={transfer.kind}>
          {transfer.kind.toUpperCase()}:{" "}
          {transfer.state === "confirmed"
            ? "Received"
            : transfer.state === "broadcast"
              ? "Confirming"
              : request.state === "failed"
                ? "Not completed"
                : "Waiting"}
        </li>
      ))}
    </ul>
  );
}

function OptionalLimitRow({
  label,
  note,
  value,
}: {
  readonly label: string;
  readonly note?: string | undefined;
  readonly value: string | undefined;
}) {
  if (value === undefined) return null;
  return <DataRow label={label} note={note} value={value} />;
}

const optionalDuration = (seconds: number | undefined): string | undefined =>
  seconds === undefined
    ? undefined
    : `${durationText(seconds)} after a successful top-up`;

type ServiceLimits = NonNullable<
  NonNullable<TestnetFundingResponse["service"]>["limits"]
>;

const lifetimePolicy = (
  limits: ServiceLimits | undefined,
): {
  readonly note: string | undefined;
  readonly value: string | undefined;
} => {
  if (limits === undefined) return { note: undefined, value: undefined };
  const lifetime = assetPairText(limits.lifetime);
  if (lifetime === undefined) {
    return {
      note: "Recurring top-ups; wallet cooldown still applies",
      value: "None",
    };
  }
  return {
    note: "Confirmed grants; no automatic reset",
    value: lifetime,
  };
};

function FaucetLimits({
  response,
}: {
  readonly response: TestnetFundingResponse | undefined;
}) {
  if (response === undefined) return null;
  const service = response.service;
  if (service === undefined) return null;
  const limits = service.limits;
  const target = assetPairText(service.targets);
  const lifetime = lifetimePolicy(limits);
  const dailyBudget = assetPairText(limits?.dailyBudget);
  const cooldown = optionalDuration(service.cooldownSeconds);
  const hasLimits = [target, lifetime.value, dailyBudget, cooldown].some(
    (value) => value !== undefined,
  );
  if (!hasLimits) return null;
  return (
    <Panel title="Faucet limits">
      <p className="max-w-[72ch] text-body-sm text-ink-soft">
        Each top-up restores only the shortfall to the wallet targets. Wallet
        and service-wide limits are separate.
      </p>
      <DataList className="mt-3">
        <OptionalLimitRow
          label="Top-up balance targets"
          note="Only the shortfall is sent"
          value={target}
        />
        <OptionalLimitRow
          label="Wallet lifetime grant cap"
          note={lifetime.note}
          value={lifetime.value}
        />
        <OptionalLimitRow label="Wallet cooldown" value={cooldown} />
        <OptionalLimitRow
          label="Service daily asset budget"
          note="Across all wallets; resets 00:00 UTC"
          value={dailyBudget}
        />
        <OptionalLimitRow
          label="Service daily top-up limit"
          note="Across all wallets; resets 00:00 UTC"
          value={limits?.dailyGrantLimit.toLocaleString()}
        />
        <OptionalLimitRow
          label="Client request limit"
          note={
            limits === undefined
              ? undefined
              : `Per fixed ${durationText(limits.clientWindowSeconds)} window`
          }
          value={limits?.clientWindowLimit.toLocaleString()}
        />
      </DataList>
    </Panel>
  );
}

/**
 * The request. Eligibility is a live reading announced once, in the panel
 * body: failures are alerts, everything else is a status.
 */
function RequestPanel({
  fund,
  retry,
  response,
  view,
}: {
  readonly fund: () => void;
  readonly retry: () => void;
  readonly response: TestnetFundingResponse | undefined;
  readonly view: TestnetFundingView;
}) {
  const copy = requestCopy(response, view.state);
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
        <TransferProgress response={response} />
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

function TopupAmount({
  amounts,
  label,
}: {
  readonly amounts: FaucetAmounts;
  readonly label: string;
}) {
  const amount = amounts.remaining ?? amounts.target ?? amounts.balance;
  return (
    <div>
      <p className="text-body-sm text-ink-soft">{label}</p>
      <div className="mt-2 text-title">
        {amount === undefined ? (
          <span className="text-body text-ink-soft">Checking amount…</span>
        ) : (
          <FaucetAmountValue amount={amount} />
        )}
      </div>
    </div>
  );
}
function FundingOnward({
  response,
  view,
}: {
  readonly response: TestnetFundingResponse | undefined;
  readonly view: TestnetFundingView;
}) {
  if (view.state !== "funded" && view.state !== "cooldown") return null;
  const eligibleAt = nextEligibleAt(response);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ButtonLink href="/exchange">Continue to Trade</ButtonLink>
      {eligibleAt === undefined ? null : (
        <p className="text-body-sm text-ink-soft">
          Next top-up: <RelativeTime timestamp={eligibleAt} countdown />
        </p>
      )}
    </div>
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
      <CollectorReturnLink />
      <div className="flex flex-wrap gap-6 rounded-lg bg-surface-1 p-5">
        <TopupAmount amounts={gas} label="ETH for network fees" />
        <TopupAmount amounts={weth} label="WETH for trading" />
      </div>
      <RequestPanel
        fund={funding.fund}
        response={funding.response}
        retry={funding.retry}
        view={funding.view}
      />
      <FundingOnward response={funding.response} view={funding.view} />
      <Disclosure searchable title="Balances and eligibility">
        {" "}
        <EligibilityBoard
          gas={gas}
          response={funding.response}
          view={funding.view}
          weth={weth}
        />
      </Disclosure>
      <Disclosure searchable title="Funding limits">
        <FaucetLimits response={funding.response} />
      </Disclosure>
      <Disclosure searchable title="About test assets">
        <AssetEducation fuel={fuel} gas={gas} weth={weth} />
      </Disclosure>
      <SecurityDisclosure />
    </div>
  );
}
