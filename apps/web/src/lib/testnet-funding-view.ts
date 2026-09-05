import type { TestnetFundingResponse } from "@orbit/config/testnet-funding";

import type { CollectorAccessState } from "./collector-access";

export type TestnetFundingViewState =
  | Exclude<CollectorAccessState, "ready">
  | "checking"
  | "eligible"
  | "submitting"
  | "pending"
  | "retryable"
  | "funded"
  | "funded-not-retained"
  | "cooldown"
  | "lifetime-exhausted"
  | "inventory-empty"
  | "disabled"
  | "rpc-unavailable"
  | "confirming"
  | "busy"
  | "unavailable";

export type TestnetFundingViewAction =
  | "connect-wallet"
  | "switch-network"
  | "fund"
  | "retry-status"
  | "retry-funding"
  | "trade"
  | "none";

export interface TestnetFundingView {
  readonly action: TestnetFundingViewAction;
  readonly state: TestnetFundingViewState;
}

interface TestnetFundingViewInput {
  readonly accessState: CollectorAccessState;
  readonly hasMutationResponse?: boolean | undefined;
  readonly mutationFailed?: boolean | undefined;
  readonly mutationPending?: boolean | undefined;
  readonly queryFailed?: boolean | undefined;
  readonly queryPending?: boolean | undefined;
  readonly response?: TestnetFundingResponse | undefined;
}

const view = (
  state: TestnetFundingViewState,
  action: TestnetFundingViewAction,
): TestnetFundingView => ({ action, state });

type ResolvedView = TestnetFundingView | undefined;

const ACCESS_VIEWS: Record<
  Exclude<CollectorAccessState, "ready">,
  readonly [TestnetFundingViewState, TestnetFundingViewAction]
> = {
  disconnected: ["disconnected", "connect-wallet"],
  "wrong-network": ["wrong-network", "switch-network"],
  "deployment-pending": ["deployment-pending", "none"],
};

const resolveAccessView = (accessState: CollectorAccessState): ResolvedView => {
  if (accessState === "ready") return undefined;
  const [state, action] = ACCESS_VIEWS[accessState];
  return view(state, action);
};

export const isTestnetFundingComplete = (
  response: TestnetFundingResponse | undefined,
): boolean =>
  response?.recipient?.state === "already-funded" ||
  response?.recipient?.state === "funded" ||
  response?.request?.state === "funded";

const resolveTransportView = (
  mutationPending: boolean,
  mutationFailed: boolean,
  queryFailed: boolean,
  hasMutationResponse: boolean,
): ResolvedView => {
  if (mutationPending) return view("submitting", "none");
  if (mutationFailed) return view("retryable", "retry-funding");
  if (queryFailed && !hasMutationResponse) {
    return view("unavailable", "retry-status");
  }
  return undefined;
};

const resolveProgressView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView => {
  if (!isTestnetFundingComplete(response)) return undefined;
  // The transfers confirmed, so the grant is spent and the cooldown has
  // started, but the wallet is no better off. Offering "Buy on Trade" here
  // sends a collector with no gas straight into a failing transaction.
  if (response?.recipient?.retainedTargets === false) {
    return view("funded-not-retained", "retry-status");
  }
  return view("funded", "trade");
};

/**
 * The faucet serves one wallet at a time. Masking that as a general outage told
 * a collector the service was broken when it was simply occupied.
 */
const resolveBusyView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView =>
  response?.error?.code === "funding-busy"
    ? view("busy", "retry-funding")
    : undefined;

const resolveRequestView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView => {
  if (response?.request?.state === "retryable") {
    return view("retryable", "retry-funding");
  }
  if (
    response?.recipient?.state === "pending" ||
    response?.request?.state === "pending"
  ) {
    return view("pending", "retry-funding");
  }
  return undefined;
};

const resolveLimitView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView => {
  const recipientState = response?.recipient?.state;
  const errorCode = response?.error?.code;
  if (
    recipientState === "rate-limited" ||
    errorCode === "funding-rate-limited"
  ) {
    return view("cooldown", "retry-status");
  }
  if (
    recipientState === "limit-reached" ||
    errorCode === "funding-lifetime-limit"
  ) {
    return view("lifetime-exhausted", "none");
  }
  return undefined;
};

const resolveServiceView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView => {
  const serviceState = response?.service?.state;
  const errorCode = response?.error?.code;
  if (
    serviceState === "inventory-empty" ||
    errorCode === "funding-inventory-empty"
  ) {
    return view("inventory-empty", "retry-status");
  }
  if (serviceState === "disabled" || errorCode === "funding-disabled") {
    return view("disabled", "retry-status");
  }
  return undefined;
};

const resolveRpcView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView => {
  if (response?.error?.code === "funding-confirming") {
    // Only resuming the request settles it; a status read observes no receipt
    // and would leave the collector clicking a button that cannot finish.
    return view("confirming", "retry-funding");
  }
  if (response?.error?.code === "funding-rpc-unavailable") {
    return view("rpc-unavailable", "retry-status");
  }
  return undefined;
};

const resolveEligibilityView = (
  response: TestnetFundingResponse | undefined,
): ResolvedView => {
  if (response?.recipient?.state === "eligible") {
    return view("eligible", "fund");
  }
  return undefined;
};

const hasUnavailableResponse = (
  response: TestnetFundingResponse | undefined,
): boolean =>
  response?.error?.code !== undefined ||
  response?.recipient?.state === "unavailable";

const resolveUnavailableView = (
  response: TestnetFundingResponse | undefined,
  hasMutationResponse: boolean,
): ResolvedView => {
  if (!hasUnavailableResponse(response)) return undefined;
  const action = hasMutationResponse ? "retry-funding" : "retry-status";
  return view("unavailable", action);
};

const resolveLoadingView = (
  queryPending: boolean,
  response: TestnetFundingResponse | undefined,
): TestnetFundingView => {
  if (queryPending || response === undefined) {
    return view("checking", "none");
  }
  return view("unavailable", "retry-status");
};

export const createTestnetFundingView = ({
  accessState,
  hasMutationResponse = false,
  mutationFailed = false,
  mutationPending = false,
  queryFailed = false,
  queryPending = false,
  response,
}: TestnetFundingViewInput): TestnetFundingView => {
  const candidates = [
    resolveAccessView(accessState),
    resolveTransportView(
      mutationPending,
      mutationFailed,
      queryFailed,
      hasMutationResponse,
    ),
    resolveProgressView(response),
    resolveBusyView(response),
    resolveRequestView(response),
    resolveLimitView(response),
    resolveServiceView(response),
    resolveRpcView(response),
    resolveEligibilityView(response),
    resolveUnavailableView(response, hasMutationResponse),
  ];
  return (
    candidates.find((candidate) => candidate !== undefined) ??
    resolveLoadingView(queryPending, response)
  );
};
