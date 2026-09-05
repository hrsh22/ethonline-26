import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Data, Effect, Scope } from "effect";
import {
  getAddress,
  parseTransaction,
  recoverMessageAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import { decodeTestnetFundingResponse } from "@orbit/config/testnet-funding";
import {
  createFundingProofChallenge,
  decodePublicFundingProof,
  fundingProofRejectionMessage,
  FUNDING_PROOF_NONCE_BYTES,
  FUNDING_PROOF_TTL_SECONDS,
  verifyFundingProofFields,
} from "@orbit/config/funding-proof";

import {
  evaluateFundingBudget,
  evaluateFundingThrottle,
  fundingBudgetWindowStart,
  fundingClientWindowStart,
  fundingDepletionState,
  FUNDING_BUDGET_WINDOW_MILLISECONDS,
  type FundingBudgetSpend,
  type TestnetFundingAbusePolicy,
} from "./abuse-controls.ts";

import {
  openTestnetFundingStore,
  type RecipientFundingPolicy,
  type StoredFundingRequest,
  type StoredFundingTransfer,
  type TestnetFundingMetrics,
  type TestnetFundingStore,
} from "./sqlite-store.ts";
import {
  evaluateTestnetFundingPolicy,
  type TestnetFundingPolicy,
} from "./policy.ts";
import type {
  PreparedTestnetFundingTransfer,
  TestnetFundingAssetAmounts,
  TestnetFundingChain,
  TestnetFundingChainInspection,
  TestnetFundingReceiptState,
} from "./types.ts";

export interface TestnetFundingConfiguration {
  readonly enabled: boolean;
  readonly chainId: number;
  readonly signer: Address;
  readonly privilegedAddresses: ReadonlySet<Address>;
  readonly policy: TestnetFundingPolicy;
  readonly abusePolicy: TestnetFundingAbusePolicy;
  /** Domain a wallet-control proof must be bound to. */
  readonly proofDomain: string;
}

export interface TestnetFundingHttpServerOptions {
  readonly apiToken: string | undefined;
  readonly chain: TestnetFundingChain;
  readonly configuration: TestnetFundingConfiguration;
  readonly databasePath: string;
  readonly host: string;
  readonly nowMilliseconds: () => number;
  readonly port: number;
  readonly requestId: () => string;
  /**
   * How long one request may wait for its own transfers to confirm before
   * reporting them as still settling. Base Sepolia produces a block every two
   * seconds, so answering after a single look made the common case "come back
   * and click again". Zero keeps the single look, which is what the tests and
   * the foreign-settle path want.
   */
  readonly receiptSettleMilliseconds?: number;
  /**
   * Every decision that moves inventory or refuses to. A faucet that denied a
   * request and wrote nothing anywhere left the operator with a browser error
   * and an empty terminal.
   */
  readonly log?: (message: string) => void;
  /** Injected so proof nonces are deterministic under test. */
  readonly nonce?: () => string;
  readonly verifySignature?: (input: {
    readonly address: Address;
    readonly message: string;
    readonly signature: Hex;
  }) => Promise<boolean>;
}

export interface RunningTestnetFundingHttpServer {
  readonly url: string;
}

export class TestnetFundingHttpError extends Data.TaggedError(
  "TestnetFundingHttpError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const json = (
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void => {
  const serialized = JSON.stringify(
    decodeTestnetFundingResponse({ apiVersion: 1, ...body }),
  );
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(serialized),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(serialized);
};

const authorized = (
  request: IncomingMessage,
  apiToken: string | undefined,
): boolean => {
  // An absent token admits everything. That is a test-only affordance: the
  // production entry point (runtime-configuration.ts) refuses to start without
  // a >=32-character token, so this branch is unreachable there. The history
  // indexer's equivalent fails closed; if this service ever gains an entry
  // point that does not force a token, flip this to `return false` and give
  // the tests explicit credentials.
  if (apiToken === undefined) return true;
  const expected = Buffer.from(`Bearer ${apiToken}`);
  const observed = Buffer.from(request.headers.authorization ?? "");
  return (
    expected.length === observed.length && timingSafeEqual(expected, observed)
  );
};

const requestUrl = (request: IncomingMessage): URL =>
  new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

const recipientFromStatus = (url: URL): Address | undefined => {
  const value = url.searchParams.get("recipient");
  if (value === null) return undefined;
  const recipient = getAddress(value);
  if (recipient === zeroAddress) throw new Error("zero recipient");
  return recipient;
};

const disabledStatus = (
  configuration: TestnetFundingConfiguration,
  recipient: Address | undefined,
) => ({
  service: {
    state: "disabled",
    chainId: configuration.chainId,
  },
  ...(recipient === undefined
    ? {}
    : { recipient: { address: recipient, state: "unavailable" } }),
});

const sameAddress = (left: Address, right: Address): boolean =>
  left.toLowerCase() === right.toLowerCase();

const validateInspection = (
  configuration: TestnetFundingConfiguration,
  inspection: TestnetFundingChainInspection,
): void => {
  if (inspection.chainId !== configuration.chainId) {
    throw new Error("Funding source is connected to the wrong chain");
  }
  if (!sameAddress(inspection.signer, configuration.signer)) {
    throw new Error("Funding signer does not match its checked configuration");
  }
  if (inspection.signerCode !== "0x") {
    throw new Error("Funding signer must be an externally owned account");
  }
  if (
    [...configuration.privilegedAddresses].some((address) =>
      sameAddress(address, inspection.signer),
    ) ||
    sameAddress(inspection.deploymentSender, inspection.signer) ||
    sameAddress(inspection.wethOperator, inspection.signer) ||
    sameAddress(inspection.usdcOperator, inspection.signer)
  ) {
    throw new Error("Funding signer has a privileged protocol role");
  }
};

const readyStatus = (
  configuration: TestnetFundingConfiguration,
  recipient: Address,
  inspection: TestnetFundingChainInspection,
  metrics: TestnetFundingMetrics,
  policy: RecipientFundingPolicy,
  nowMilliseconds: number,
  active: StoredFundingRequest | undefined,
  budget: FundingBudgetSpend,
  disabledAt: number | undefined,
) => {
  validateInspection(configuration, inspection);
  const depletion = fundingDepletionState(configuration.abusePolicy, budget);
  const evaluation = evaluateTestnetFundingPolicy(configuration.policy, {
    activeRecipient: active?.recipient,
    nowMilliseconds,
    recipient,
    recipientBalance: inspection.recipientBalance,
    recipientHistory: policy,
    signerBalance: inspection.signerBalance,
  });
  return {
    service: {
      state: evaluation.serviceInventoryAvailable ? "ready" : "inventory-empty",
      chainId: configuration.chainId,
      targets: {
        wethWei: configuration.policy.target.wethWei.toString(),
        ethWei: configuration.policy.target.ethWei.toString(),
      },
      cooldownSeconds: configuration.policy.cooldownMilliseconds / 1_000,
      inventory: {
        state: evaluation.serviceInventoryAvailable ? "available" : "empty",
        wethWei: evaluation.available.wethWei.toString(),
        ethWei: evaluation.available.ethWei.toString(),
      },
      metrics,
      // The operator alert reports velocity only. No signer address, signer
      // balance, or key material is exposed here.
      budget: {
        windowResetsAt:
          fundingBudgetWindowStart(nowMilliseconds) +
          FUNDING_BUDGET_WINDOW_MILLISECONDS,
        grantsUsed: budget.grants,
        grantLimit: configuration.abusePolicy.dailyGrantLimit,
        usedRatio: depletion.usedRatio,
        alert: depletion.state,
      },
      halted: disabledAt !== undefined,
    },
    recipient: {
      address: recipient,
      state: evaluation.recipientState,
      balances: {
        wethWei: inspection.recipientBalance.wethWei.toString(),
        ethWei: inspection.recipientBalance.ethWei.toString(),
      },
      remaining: {
        wethWei: evaluation.deficit.wethWei.toString(),
        ethWei: evaluation.deficit.ethWei.toString(),
      },
      nextEligibleAt: evaluation.nextEligibleAt,
    },
    ...(active !== undefined && sameAddress(active.recipient, recipient)
      ? { request: { id: active.id, state: "pending" } }
      : {}),
  };
};

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 2_048) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new Error("Funding request body is too large"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (cause) {
        reject(cause);
      }
    });
    request.on("error", reject);
  });

const recipientFromBody = (body: unknown): Address => {
  if (
    typeof body !== "object" ||
    body === null ||
    !("recipient" in body) ||
    typeof body.recipient !== "string"
  ) {
    throw new Error("Funding recipient is missing");
  }
  const recipient = getAddress(body.recipient);
  if (recipient === zeroAddress) throw new Error("zero recipient");
  return recipient;
};

const expectedTransferAmounts = (
  amounts: TestnetFundingAssetAmounts,
): ReadonlyMap<PreparedTestnetFundingTransfer["kind"], bigint> => {
  const expected = new Map<PreparedTestnetFundingTransfer["kind"], bigint>();
  if (amounts.wethWei > 0n) expected.set("weth", amounts.wethWei);
  if (amounts.ethWei > 0n) expected.set("eth", amounts.ethWei);
  return expected;
};

const validatePreparedTransfers = (
  transfers: readonly PreparedTestnetFundingTransfer[],
  amounts: TestnetFundingAssetAmounts,
): void => {
  const expected = expectedTransferAmounts(amounts);
  if (transfers.length !== expected.size) {
    throw new Error("Funding preflight returned an unexpected transfer count");
  }
  const observed = new Set<PreparedTestnetFundingTransfer["kind"]>();
  for (const transfer of transfers) {
    if (
      observed.has(transfer.kind) ||
      expected.get(transfer.kind) !== transfer.amountWei ||
      transfer.hash === "0x" ||
      transfer.rawTransaction === "0x"
    ) {
      throw new Error("Funding preflight returned an unexpected transfer");
    }
    observed.add(transfer.kind);
  }
};

const publicTransactions = (transfers: readonly StoredFundingTransfer[]) =>
  transfers.map(({ hash, kind, state }) => ({
    kind,
    hash,
    state,
  }));

const alreadyFundedResponse = (
  recipient: Address,
  inspection: TestnetFundingChainInspection,
  nextEligibleAt: number | null,
) => ({
  recipient: {
    address: recipient,
    state: "already-funded",
    nextEligibleAt,
    balances: {
      wethWei: inspection.recipientBalance.wethWei.toString(),
      ethWei: inspection.recipientBalance.ethWei.toString(),
    },
  },
});

const hasReachedTargets = (
  configuration: TestnetFundingConfiguration,
  inspection: TestnetFundingChainInspection,
): boolean =>
  inspection.recipientBalance.wethWei >= configuration.policy.target.wethWei &&
  inspection.recipientBalance.ethWei >= configuration.policy.target.ethWei;

const RECEIPT_POLL_INTERVAL_MILLISECONDS = 400;

/**
 * A signed transfer whose nonce is already behind the signer can never land:
 * the node rejects it as `nonce too low` and no receipt will ever exist. Read
 * as "still pending" it strands its request forever, and because the faucet
 * serves one request at a time that refuses every other wallet too. Any nonce
 * gap produces it -- a crash between signing and broadcast, a dropped mempool
 * transaction, a second process sharing the signer.
 */
const signedNonce = (rawTransaction: Hex): number | undefined => {
  try {
    return parseTransaction(rawTransaction).nonce;
  } catch {
    // Unreadable rather than behind: never fail a request on a nonce this
    // cannot establish.
    return undefined;
  }
};

const transferIsStranded = async (
  options: TestnetFundingHttpServerOptions,
  transfer: StoredFundingTransfer,
): Promise<boolean> => {
  const nonce = signedNonce(transfer.rawTransaction);
  if (nonce === undefined) return false;
  return nonce < (await Effect.runPromise(options.chain.signerNonce()));
};

const observeReceipt = async (
  options: TestnetFundingHttpServerOptions,
  hash: Hex,
): Promise<TestnetFundingReceiptState> =>
  Effect.runPromise(options.chain.receipt(hash));

/**
 * Bounded by an absolute deadline shared across the request, so the gateway's
 * upstream timeout is never the thing that decides the outcome.
 */
const awaitReceipt = async (
  options: TestnetFundingHttpServerOptions,
  hash: Hex,
  deadline: number,
): Promise<TestnetFundingReceiptState> => {
  for (;;) {
    const receipt = await observeReceipt(options, hash);
    if (receipt !== "pending") return receipt;
    if (options.nowMilliseconds() >= deadline) return "pending";
    await delay(RECEIPT_POLL_INTERVAL_MILLISECONDS);
  }
};

/**
 * Reports a transfer as still in flight, unless its nonce proves it can never
 * land -- in which case nothing will ever resolve it and the request has to be
 * failed so the queue moves on.
 */
const reportPending = async (
  options: TestnetFundingHttpServerOptions,
  transfer: StoredFundingTransfer,
): Promise<"pending"> => {
  if (await transferIsStranded(options, transfer)) {
    throw new Error("Funding transfer can no longer be broadcast");
  }
  return "pending";
};

const broadcastPreparedTransfer = async (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  requestId: string,
  transfer: StoredFundingTransfer,
): Promise<"pending" | "retryable" | "broadcast" | "confirmed"> => {
  let hash: Hex;
  try {
    hash = await Effect.runPromise(
      options.chain.broadcast(transfer.rawTransaction),
    );
  } catch {
    const receipt = await observeReceipt(options, transfer.hash);
    if (receipt === "reverted") throw new Error("Funding transaction reverted");
    // A rejected broadcast with no receipt is the shape a stranded nonce
    // takes, and it is the one that reached production: reported as pending,
    // it parked the request and refused every other wallet.
    if (receipt === "pending") return reportPending(options, transfer);
    if (receipt === "unavailable") return "retryable";
    store.updateTransferState(
      requestId,
      transfer.kind,
      "confirmed",
      options.nowMilliseconds(),
    );
    return "confirmed";
  }
  if (hash.toLowerCase() !== transfer.hash.toLowerCase()) {
    throw new Error("Broadcast transaction hash did not match preflight");
  }
  store.updateTransferState(
    requestId,
    transfer.kind,
    "broadcast",
    options.nowMilliseconds(),
  );
  return "broadcast";
};

const executeTransfer = async (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  requestId: string,
  transfer: StoredFundingTransfer,
  deadline: number,
): Promise<"confirmed" | "pending" | "retryable"> => {
  if (transfer.state === "confirmed") return "confirmed";
  if (transfer.state === "prepared") {
    const broadcast = await broadcastPreparedTransfer(
      options,
      store,
      requestId,
      transfer,
    );
    if (broadcast === "pending" || broadcast === "retryable") return broadcast;
    if (broadcast === "confirmed") return "confirmed";
  }
  const receipt = await awaitReceipt(options, transfer.hash, deadline);
  if (receipt === "pending") return reportPending(options, transfer);
  if (receipt === "unavailable") return "retryable";
  if (receipt === "reverted") throw new Error("Funding transaction reverted");
  store.updateTransferState(
    requestId,
    transfer.kind,
    "confirmed",
    options.nowMilliseconds(),
  );
  return "confirmed";
};

const fundedResponse = (
  id: string,
  recipient: Address,
  transfers: readonly StoredFundingTransfer[],
  inspection: TestnetFundingChainInspection,
  retainedTargets: boolean,
  nextEligibleAt: number | null,
) => ({
  request: {
    id,
    state: "funded",
    transactions: publicTransactions(transfers),
  },
  recipient: {
    address: recipient,
    state: "funded",
    retainedTargets,
    nextEligibleAt,
    balances: {
      wethWei: inspection.recipientBalance.wethWei.toString(),
      ethWei: inspection.recipientBalance.ethWei.toString(),
    },
  },
});

const pendingResponse = (
  recipient: Address,
  request: StoredFundingRequest,
) => ({
  request: {
    id: request.id,
    state: "pending",
    transactions: publicTransactions(request.transfers),
  },
  recipient: { address: recipient, state: "pending" },
});

const sendPending = (
  response: ServerResponse,
  store: TestnetFundingStore,
  recipient: Address,
): void => {
  const pending = store.readActiveRequest();
  if (pending === undefined) {
    throw new Error("Pending funding request disappeared");
  }
  json(response, 202, pendingResponse(recipient, pending));
};

/**
 * Two different situations reach this response and only one of them is an RPC
 * problem. Reporting both as `funding-rpc-unavailable` sent every operator
 * looking at a healthy node while the real cause was a recipient balance that
 * had not caught up with a confirmed transfer.
 */
const RETRYABLE_FUNDING_ERRORS = {
  confirming: {
    code: "funding-confirming",
    message: "Transfers confirmed; the recipient balance has not caught up yet",
  },
  rpc: {
    code: "funding-rpc-unavailable",
    message: "Funding RPC evidence is temporarily unavailable; retry safely",
  },
} as const;

const sendRetryable = (
  response: ServerResponse,
  store: TestnetFundingStore,
  request: StoredFundingRequest,
  error: (typeof RETRYABLE_FUNDING_ERRORS)[keyof typeof RETRYABLE_FUNDING_ERRORS] = RETRYABLE_FUNDING_ERRORS.rpc,
): void => {
  store.releaseLease(request.id);
  const active = store.readActiveRequest();
  if (active === undefined) {
    throw new Error("Retryable funding request disappeared");
  }
  const pending = pendingResponse(active.recipient, active);
  json(response, 503, {
    ...pending,
    request: {
      ...pending.request,
      state: "retryable",
    },
    error,
  });
};

const sendBusy = (response: ServerResponse): void => {
  json(response, 409, {
    error: {
      code: "funding-busy",
      message: "Another testnet funding request is still pending",
    },
  });
};

const reconciliationExpired = (
  options: TestnetFundingHttpServerOptions,
  request: StoredFundingRequest,
): boolean => {
  if (request.transfers.some((transfer) => transfer.state !== "confirmed")) {
    return false;
  }
  const confirmedAt = Math.max(
    request.createdAt,
    ...request.transfers.map(
      (transfer) => transfer.confirmedAt ?? request.createdAt,
    ),
  );
  return (
    options.nowMilliseconds() - confirmedAt >=
    options.configuration.policy.reconciliationTimeoutMilliseconds
  );
};

/**
 * Drives every transfer of one request to a terminal state: broadcasting what
 * was signed but never sent, and observing the receipt of what was. Throws when
 * a transfer reverted, because nothing more will land.
 */
const driveRequestTransfers = async (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  request: StoredFundingRequest,
  deadline: number,
): Promise<"confirmed" | "pending" | "retryable"> => {
  for (const transfer of request.transfers) {
    const state = await executeTransfer(
      options,
      store,
      request.id,
      transfer,
      deadline,
    );
    if (state !== "confirmed") return state;
  }
  return "confirmed";
};

/**
 * The faucet serves one request at a time, so another recipient's unresolved
 * request gates every wallet behind it. Leaving that resolution to the
 * request's own recipient made the gate permanent: a transfer that had
 * confirmed on chain hours earlier still read as `broadcast` in the ledger,
 * because nothing ever looked, and every other wallet was refused.
 *
 * The transfers are already signed, so finishing them here is the same work
 * with the same bytes -- there is nothing about it that only the original
 * caller may do. Only a transfer genuinely still in flight keeps the lock.
 */
const settleForeignRequest = async (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  request: StoredFundingRequest,
): Promise<boolean> => {
  const now = options.nowMilliseconds();
  try {
    // No waiting on someone else's transfers: this caller's time budget is for
    // its own top-up, and an unconfirmed foreign transfer simply keeps the lock.
    if (
      (await driveRequestTransfers(options, store, request, now)) !==
      "confirmed"
    ) {
      return false;
    }
  } catch {
    store.failRequest(request.id, now);
    store.releaseLease(request.id);
    return true;
  }
  // Every transfer landed, so the grant was delivered whatever the recipient
  // did with it afterwards.
  store.completeRequest(request.id, now);
  store.releaseLease(request.id);
  return true;
};

const acquireRequestLease = (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  requestId: string,
  recipient: Address,
): boolean => {
  const acquiredAt = options.nowMilliseconds();
  return store.tryAcquireLease({
    requestId,
    recipient,
    acquiredAt,
    expiresAt:
      acquiredAt + options.configuration.policy.requestLeaseMilliseconds,
  });
};

const executeFundingRequest = async (
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  request: StoredFundingRequest,
): Promise<void> => {
  try {
    const driven = await driveRequestTransfers(
      options,
      store,
      request,
      options.nowMilliseconds() + (options.receiptSettleMilliseconds ?? 0),
    );
    if (driven === "pending") {
      sendPending(response, store, request.recipient);
      return;
    }
    if (driven === "retryable") {
      sendRetryable(response, store, request);
      return;
    }
    let funded: TestnetFundingChainInspection;
    try {
      funded = await Effect.runPromise(
        options.chain.inspect(request.recipient),
      );
    } catch {
      sendRetryable(response, store, request);
      return;
    }
    const retainedTargets = hasReachedTargets(options.configuration, funded);
    // The reconciliation window absorbs a balance read that lags its own
    // confirmed transfer. Past it, the balance is the truth -- and an account
    // that forwards what it receives will never reach the targets, so failing
    // the request left it executing forever and answered every retry with a
    // healthy RPC reported as unavailable. A grant is delivered when its
    // transfers confirm; whether the wallet kept it travels with the result,
    // and the cooldown, lifetime limit, and daily budget bound the rest.
    if (!retainedTargets && !reconciliationExpired(options, request)) {
      sendRetryable(
        response,
        store,
        request,
        RETRYABLE_FUNDING_ERRORS.confirming,
      );
      return;
    }
    const completed = store.completeRequest(
      request.id,
      options.nowMilliseconds(),
    );
    store.releaseLease(request.id);
    options.log?.(
      `Funded ${request.recipient}${retainedTargets ? "" : " (the wallet did not retain it)"}`,
    );
    const { nextEligibleAt } = evaluateTestnetFundingPolicy(
      options.configuration.policy,
      {
        activeRecipient: undefined,
        nowMilliseconds: options.nowMilliseconds(),
        recipient: request.recipient,
        recipientBalance: funded.recipientBalance,
        recipientHistory: store.readRecipientPolicy(request.recipient),
        signerBalance: funded.signerBalance,
      },
    );
    json(
      response,
      200,
      fundedResponse(
        request.id,
        request.recipient,
        completed.transfers,
        funded,
        retainedTargets,
        nextEligibleAt,
      ),
    );
  } catch (cause) {
    store.failRequest(request.id, options.nowMilliseconds());
    store.releaseLease(request.id);
    throw cause;
  }
};

const createFundingRequest = async (
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  recipient: Address,
  amounts: TestnetFundingAssetAmounts,
): Promise<void> => {
  const id = options.requestId();
  if (!acquireRequestLease(options, store, id, recipient)) {
    sendBusy(response);
    return;
  }
  try {
    const transfers = await Effect.runPromise(
      options.chain.prepare({ recipient, amounts }),
    );
    validatePreparedTransfers(transfers, amounts);
    const request = store.createPreparedRequest({
      id,
      recipient,
      transfers,
      createdAt: options.nowMilliseconds(),
    });
    await executeFundingRequest(response, options, store, request);
  } catch (cause) {
    store.releaseLease(id);
    throw cause;
  }
};

/**
 * Reports a per-recipient denial or an already-funded wallet. Returns true when
 * the request is fully answered and no inventory should move.
 */
const respondToRecipientState = (
  response: ServerResponse,
  store: TestnetFundingStore,
  recipient: Address,
  inspection: TestnetFundingChainInspection,
  evaluation: ReturnType<typeof evaluateTestnetFundingPolicy>,
  nowMilliseconds: number,
  log: ((message: string) => void) | undefined,
): boolean => {
  if (evaluation.recipientState === "already-funded") {
    json(
      response,
      200,
      alreadyFundedResponse(recipient, inspection, evaluation.nextEligibleAt),
    );
    return true;
  }
  if (evaluation.recipientState === "rate-limited") {
    log?.(`Denied ${recipient}: still in its funding cooldown`);
    store.recordDenial(recipient, "funding-rate-limited", nowMilliseconds);
    json(response, 429, {
      error: {
        code: "funding-rate-limited",
        message: "This wallet is still in its testnet funding cooldown",
        nextEligibleAt: evaluation.nextEligibleAt,
      },
    });
    return true;
  }
  if (evaluation.recipientState === "limit-reached") {
    log?.(`Denied ${recipient}: lifetime funding limit reached`);
    store.recordDenial(recipient, "funding-lifetime-limit", nowMilliseconds);
    json(response, 429, {
      error: {
        code: "funding-lifetime-limit",
        message: "This wallet has reached its lifetime testnet funding limit",
      },
    });
    return true;
  }
  if (!evaluation.recipientInventoryAvailable) {
    log?.(`Denied ${recipient}: inventory cannot satisfy the request`);
    json(response, 503, {
      error: {
        code: "funding-inventory-empty",
        message: "Testnet funding inventory cannot satisfy this request",
      },
    });
    return true;
  }
  return false;
};

/**
 * Whatever request holds the queue, resolved as far as evidence allows: another
 * recipient's is settled from its own receipts, this recipient's is left for
 * the resume path below. Returns the request still holding the lock, if any.
 */
const remainingActiveRequest = async (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  recipient: Address,
): Promise<StoredFundingRequest | undefined> => {
  const active = store.readActiveRequest();
  if (active === undefined || sameAddress(active.recipient, recipient)) {
    return active;
  }
  if (!(await settleForeignRequest(options, store, active))) return active;
  options.log?.(
    `Settled a previous funding request for ${active.recipient} before serving ${recipient}`,
  );
  return store.readActiveRequest();
};

const fundRecipient = async (
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  recipient: Address,
): Promise<void> => {
  const inspection = await Effect.runPromise(options.chain.inspect(recipient));
  validateInspection(options.configuration, inspection);
  const active = await remainingActiveRequest(options, store, recipient);
  if (active !== undefined) {
    if (!sameAddress(active.recipient, recipient)) {
      options.log?.(
        `Refused a funding request for ${recipient}: a request for ${active.recipient} is still settling`,
      );
      sendBusy(response);
      return;
    }
    if (!acquireRequestLease(options, store, active.id, recipient)) {
      sendBusy(response);
      return;
    }
    await executeFundingRequest(response, options, store, active);
    return;
  }
  const nowMilliseconds = options.nowMilliseconds();
  const evaluation = evaluateTestnetFundingPolicy(
    options.configuration.policy,
    {
      activeRecipient: undefined,
      nowMilliseconds,
      recipient,
      recipientBalance: inspection.recipientBalance,
      recipientHistory: store.readRecipientPolicy(recipient),
      signerBalance: inspection.signerBalance,
    },
  );
  if (
    respondToRecipientState(
      response,
      store,
      recipient,
      inspection,
      evaluation,
      nowMilliseconds,
      options.log,
    )
  ) {
    return;
  }
  // The service-wide budget is what actually stops multi-address depletion.
  const budgetWindow = fundingBudgetWindowStart(nowMilliseconds);
  const budget = evaluateFundingBudget(
    options.configuration.abusePolicy,
    store.readBudgetUsage(budgetWindow),
    evaluation.deficit,
  );
  if (!budget.ok) {
    json(response, 503, {
      error: {
        code:
          budget.reason === "grant-limit"
            ? "funding-daily-grant-limit"
            : "funding-daily-budget",
        message:
          "The service-wide daily testnet funding budget is exhausted. Try again after the window resets.",
        windowResetsAt: budgetWindow + FUNDING_BUDGET_WINDOW_MILLISECONDS,
      },
    });
    return;
  }
  store.recordBudgetSpend({
    windowStart: budgetWindow,
    wethWei: evaluation.deficit.wethWei,
    ethWei: evaluation.deficit.ethWei,
  });
  await createFundingRequest(
    response,
    options,
    store,
    recipient,
    evaluation.deficit,
  );
};

const handleStatusRequest = async (
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  url: URL,
): Promise<void> => {
  try {
    const recipient = recipientFromStatus(url);
    if (!options.configuration.enabled) {
      json(response, 200, disabledStatus(options.configuration, recipient));
      return;
    }
    const inspectedRecipient = recipient ?? options.configuration.signer;
    const inspection = await Effect.runPromise(
      options.chain.inspect(inspectedRecipient),
    );
    const status = readyStatus(
      options.configuration,
      inspectedRecipient,
      inspection,
      store.readMetrics(),
      store.readRecipientPolicy(inspectedRecipient),
      options.nowMilliseconds(),
      store.readActiveRequest(),
      store.readBudgetUsage(
        fundingBudgetWindowStart(options.nowMilliseconds()),
      ),
      store.readServiceDisabledAt(),
    );
    json(
      response,
      200,
      recipient === undefined ? { service: status.service } : status,
    );
  } catch {
    json(response, 503, {
      error: {
        code: "funding-unavailable",
        message: "Testnet funding status is temporarily unavailable",
      },
    });
  }
};

/**
 * Signature verification is injected so tests exercise the whole boundary
 * without a wallet. The default recovers the signer from the message.
 */
const verifyProofSignature = async (
  options: TestnetFundingHttpServerOptions,
  input: {
    readonly address: Address;
    readonly message: string;
    readonly signature: Hex;
  },
): Promise<boolean> => {
  if (options.verifySignature !== undefined) {
    return options.verifySignature(input);
  }
  try {
    const recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature,
    });
    return recovered.toLowerCase() === input.address.toLowerCase();
  } catch {
    return false;
  }
};

const clientKeyFor = (request: IncomingMessage): string => {
  // The public API proxies funding, so the forwarded chain is the only view of
  // the originating client. Fall back to the socket for direct callers.
  const forwarded = request.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = header?.split(",")[0]?.trim();
  if (candidate !== undefined && candidate.length > 0) return candidate;
  return request.socket.remoteAddress ?? "unknown";
};

const serviceHalted = (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
): boolean =>
  !options.configuration.enabled || store.readServiceDisabledAt() !== undefined;

const issueProofChallenge = (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  recipient: Address,
) => {
  const nonce =
    options.nonce?.() ?? randomBytes(FUNDING_PROOF_NONCE_BYTES).toString("hex");
  const issuedAt = options.nowMilliseconds();
  const challenge = createFundingProofChallenge({
    chainId: options.configuration.chainId,
    domain: options.configuration.proofDomain,
    issuedAtMilliseconds: issuedAt,
    nonce,
    recipient,
    uri: `https://${options.configuration.proofDomain}/faucet`,
  });
  store.pruneNonces(issuedAt);
  store.recordNonce({
    nonce,
    recipient,
    issuedAt,
    expiresAt: issuedAt + FUNDING_PROOF_TTL_SECONDS * 1_000,
  });
  return challenge;
};

const handleChallengeRequest = (
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  url: URL,
): void => {
  let recipient: Address;
  try {
    const raw = url.searchParams.get("recipient");
    if (raw === null) throw new Error("recipient is required");
    recipient = getAddress(raw);
    if (recipient === zeroAddress) throw new Error("zero recipient");
  } catch {
    json(response, 400, {
      error: {
        code: "funding-invalid-request",
        message: "A valid nonzero wallet address is required",
      },
    });
    return;
  }
  if (serviceHalted(options, store)) {
    json(response, 503, {
      error: {
        code: "funding-disabled",
        message: "Testnet funding is disabled by the operator",
      },
    });
    return;
  }
  const challenge = issueProofChallenge(options, store, recipient);
  json(response, 200, { challenge });
};

type ProofOutcome =
  | { readonly ok: true; readonly recipient: Address }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

const nonceRejection = (
  reason: "unknown" | "consumed" | "expired",
): { readonly code: string; readonly message: string } => {
  if (reason === "consumed") {
    return {
      code: "funding-proof-replayed",
      message:
        "This wallet-control proof was already used. Request a new one and sign again.",
    };
  }
  return {
    code: "funding-proof-expired",
    message:
      "This wallet-control proof is unknown or expired. Request a new one and sign again.",
  };
};

/**
 * Verifies that the caller controls the recipient wallet. Deployment-bound
 * fields are checked before any signature work, and the nonce is consumed
 * atomically so a replay cannot fund twice.
 */
const verifyRecipientControl = async (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  body: unknown,
  recipient: Address,
): Promise<ProofOutcome> => {
  let proof: { readonly message: string; readonly signature: Hex };
  try {
    proof = decodePublicFundingProof(
      (body as { readonly proof?: unknown } | null)?.proof,
    );
  } catch {
    return {
      ok: false,
      status: 400,
      code: "funding-proof-required",
      message:
        "A signed wallet-control proof is required. Request a challenge and sign it.",
    };
  }
  const nowMilliseconds = options.nowMilliseconds();
  const fields = verifyFundingProofFields(proof.message, {
    chainId: options.configuration.chainId,
    domain: options.configuration.proofDomain,
    nowMilliseconds,
    recipient,
  });
  if (!fields.ok) {
    return {
      ok: false,
      status: 400,
      code: "funding-proof-invalid",
      message: fundingProofRejectionMessage[fields.reason],
    };
  }
  const verified = await verifyProofSignature(options, {
    address: recipient,
    message: proof.message,
    signature: proof.signature,
  });
  if (!verified) {
    return {
      ok: false,
      status: 401,
      code: "funding-proof-invalid",
      message:
        "The wallet-control proof signature does not match the requested recipient.",
    };
  }
  const consumed = store.consumeNonce({
    nonce: fields.fields.nonce,
    recipient,
    nowMilliseconds,
  });
  if (!consumed.ok) {
    return { ok: false, status: 409, ...nonceRejection(consumed.reason) };
  }
  return { ok: true, recipient };
};

/**
 * Counts one funding attempt for the calling client before the proof is
 * checked, so a signature-guessing loop is bounded too. The counter is
 * persisted, so a restart does not clear it.
 */
const countClientAttempt = (
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  request: IncomingMessage,
) => {
  const now = options.nowMilliseconds();
  const windowStart = fundingClientWindowStart(
    now,
    options.configuration.abusePolicy.clientWindowMilliseconds,
  );
  const attempts = store.recordClientAttempt({
    clientKey: clientKeyFor(request),
    windowStart,
  });
  return evaluateFundingThrottle(
    options.configuration.abusePolicy,
    attempts,
    now,
    windowStart,
  );
};

const handleFundRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
): Promise<void> => {
  if (serviceHalted(options, store)) {
    json(response, 503, {
      error: {
        code: "funding-disabled",
        message: "Testnet funding is disabled by the operator",
      },
    });
    return;
  }
  let body: unknown;
  let recipient: Address;
  try {
    body = await readBody(request);
    recipient = recipientFromBody(body);
  } catch {
    json(response, 400, {
      error: {
        code: "funding-invalid-request",
        message: "A valid nonzero wallet address is required",
      },
    });
    return;
  }
  const throttle = countClientAttempt(options, store, request);
  if (!throttle.ok) {
    json(response, 429, {
      error: {
        code: "funding-client-throttled",
        message:
          "Too many funding requests from this client. Wait for the window to reset and try again.",
        retryAfterMilliseconds: throttle.retryAfterMilliseconds,
      },
    });
    return;
  }
  const proof = await verifyRecipientControl(options, store, body, recipient);
  if (!proof.ok) {
    json(response, proof.status, {
      error: { code: proof.code, message: proof.message },
    });
    return;
  }
  try {
    await fundRecipient(response, options, store, recipient);
  } catch {
    if (response.headersSent) return;
    json(response, 502, {
      error: {
        code: "funding-failed",
        message: "Testnet funding could not be completed",
      },
    });
  }
};

/**
 * Emergency halt. The worker port is token-authorized and never publicly
 * routed, so this is operator-only. The flag is persisted, which means it
 * takes effect immediately and survives a restart, unlike the boot-time
 * TESTNET_FUNDING_ENABLED variable it complements.
 */
const handleServiceControl = (
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
  disable: boolean,
): void => {
  store.setServiceDisabled(disable ? options.nowMilliseconds() : undefined);
  const disabledAt = store.readServiceDisabledAt();
  json(response, 200, {
    service: {
      chainId: options.configuration.chainId,
      state: disabledAt === undefined ? "ready" : "disabled",
      disabled: disabledAt !== undefined,
      disabledAt: disabledAt ?? null,
    },
  });
};

interface WorkerRouteContext {
  readonly options: TestnetFundingHttpServerOptions;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly store: TestnetFundingStore;
  readonly url: URL;
}

const workerRoutes: Readonly<
  Record<string, (context: WorkerRouteContext) => Promise<void> | void>
> = {
  "GET /v1/challenge": ({ options, response, store, url }) =>
    handleChallengeRequest(response, options, store, url),
  "GET /v1/status": ({ options, response, store, url }) =>
    handleStatusRequest(response, options, store, url),
  "POST /v1/fund": ({ options, request, response, store }) =>
    handleFundRequest(request, response, options, store),
  "POST /v1/control/disable": ({ options, response, store }) =>
    handleServiceControl(response, options, store, true),
  "POST /v1/control/enable": ({ options, response, store }) =>
    handleServiceControl(response, options, store, false),
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: TestnetFundingHttpServerOptions,
  store: TestnetFundingStore,
): Promise<void> => {
  if (!authorized(request, options.apiToken)) {
    json(response, 401, { error: { code: "funding-unauthorized" } });
    return;
  }
  const url = requestUrl(request);
  const route = `${request.method ?? "GET"} ${url.pathname}`;
  const handler = workerRoutes[route];
  if (handler === undefined) {
    json(response, 404, { error: { code: "funding-route-not-found" } });
    return;
  }
  await handler({ options, request, response, store, url });
};

const stopServer = (
  server: ReturnType<typeof createServer>,
): Effect.Effect<void> =>
  Effect.async((resume) => {
    server.close(() => resume(Effect.void));
  });

const validateFundingStartup = (
  options: TestnetFundingHttpServerOptions,
): Effect.Effect<void, TestnetFundingHttpError> => {
  if (!options.configuration.enabled) return Effect.void;
  return options.chain.inspect(options.configuration.signer).pipe(
    Effect.flatMap((inspection) =>
      Effect.try({
        try: () => validateInspection(options.configuration, inspection),
        catch: (cause) =>
          new TestnetFundingHttpError({
            message: "Testnet funding signer failed startup validation",
            cause,
          }),
      }),
    ),
    Effect.mapError((cause) =>
      cause instanceof TestnetFundingHttpError
        ? cause
        : new TestnetFundingHttpError({
            message: "Could not inspect the testnet funding signer",
            cause,
          }),
    ),
  );
};

export const acquireTestnetFundingHttpServer = (
  options: TestnetFundingHttpServerOptions,
): Effect.Effect<
  RunningTestnetFundingHttpServer,
  TestnetFundingHttpError,
  Scope.Scope
> =>
  validateFundingStartup(options).pipe(
    Effect.flatMap(() =>
      Effect.acquireRelease(
        Effect.try({
          try: () =>
            openTestnetFundingStore(options.databasePath, {
              chainId: options.configuration.chainId,
              signer: options.configuration.signer,
            }),
          catch: (cause) =>
            new TestnetFundingHttpError({
              message: "Could not open testnet funding database",
              cause,
            }),
        }),
        (store) => Effect.sync(() => store.close()),
      ),
    ),
    Effect.flatMap((store) =>
      Effect.acquireRelease(
        Effect.async<
          RunningTestnetFundingHttpServer & {
            readonly server: ReturnType<typeof createServer>;
          },
          TestnetFundingHttpError
        >((resume) => {
          const server = createServer((request, response) => {
            void handleRequest(request, response, options, store).catch(
              (cause: unknown) => {
                if (!response.headersSent) {
                  json(response, 500, {
                    error: {
                      code: "funding-internal-error",
                      message: "Testnet funding could not complete the request",
                    },
                  });
                } else {
                  response.destroy(cause instanceof Error ? cause : undefined);
                }
              },
            );
          });
          const fail = (cause: Error): void => {
            resume(
              Effect.fail(
                new TestnetFundingHttpError({
                  message: "Could not start testnet funding HTTP server",
                  cause,
                }),
              ),
            );
          };
          server.once("error", fail);
          server.listen(options.port, options.host, () => {
            server.removeListener("error", fail);
            const address = server.address() as AddressInfo;
            resume(
              Effect.succeed({
                url: `http://${options.host}:${address.port}`,
                server,
              }),
            );
          });
          return Effect.sync(() => server.close());
        }),
        ({ server }) => stopServer(server),
      ),
    ),
    Effect.map(({ url }) => ({ url })),
  );
