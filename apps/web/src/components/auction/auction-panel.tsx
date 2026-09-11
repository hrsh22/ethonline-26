"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";

import { AccessNotice } from "@/components/access-notice";
import { StateFeedback, DisabledReason } from "@/components/state-feedback";
import { TestFundsLink } from "@/components/shell/test-funds-link";
import { TransactionStatus } from "@/components/transaction-status";
import { AmountField } from "@/components/ui/amount-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import type { AuctionAdapter } from "@/lib/auction-adapter";
import { auctionAdapter } from "@/lib/auction-adapter";
import {
  auctionPhase,
  auctionPhaseCopy,
  auctionProgress,
  formatAuctionAmount,
  nextBidAction,
  parseAuctionAmount,
  recommendedAuctionBidAmount,
  type AuctionAction,
  type CollectorAuctionSnapshot,
} from "@/lib/auction-state";
import {
  clearAuctionTransaction,
  readAuctionTransaction,
  writeAuctionTransaction,
} from "@/lib/auction-transaction-record";
import {
  createTransactionState,
  isTransactionInFlight,
} from "@/lib/transaction-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";

const actionLabel = (action: AuctionAction): string => {
  switch (action.type) {
    case "deploy-escrow":
      return "Prepare auction account";
    case "approve-token":
      return "Approve Permit2";
    case "approve-auction":
      return "Set auction allowance";
    case "bid":
      return "Place bid";
    case "finalize":
      return "Finalize auction";
    case "exit":
      return `Settle bid ${action.bidId}`;
    case "claim":
      return `Claim bid ${action.bidId} to delivery`;
    case "withdraw-currency":
      return "Withdraw WETH refund";
    case "deliver-fuel":
      return "Deliver FUEL";
  }
};

const bidActionLabel = (
  action: AuctionAction,
  snapshot: CollectorAuctionSnapshot,
): string => {
  if (action.type === "approve-token")
    return `Approve ${formatAuctionAmount(action.amount, snapshot.currency.decimals)} ${snapshot.currency.symbol} for Permit2`;
  if (action.type === "approve-auction")
    return `Allow this auction to spend ${formatAuctionAmount(action.amount, snapshot.currency.decimals)} ${snapshot.currency.symbol}`;
  if (action.type === "bid")
    return `Place bid · ${formatAuctionAmount(action.amount, snapshot.currency.decimals)} ${snapshot.currency.symbol}`;
  return actionLabel(action);
};

const actionErrorMessage = (action: AuctionAction, cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "";
  if (
    /internal error|request arguments|insufficient funds|intrinsic transaction cost/iu.test(
      message,
    )
  )
    return `${actionLabel(action)} could not complete. Confirm the wallet is on Base Sepolia and has Base Sepolia ETH for gas, then retry.`;
  return message.length > 0
    ? `${actionLabel(action)} could not complete. ${message}`
    : `${actionLabel(action)} could not complete. Retry from this step.`;
};

const fundingCoverage = (committed: bigint, minimum: bigint): string => {
  if (minimum <= 0n) return "No minimum configured";
  const basisPoints = (committed * 10_000n) / minimum;
  return `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, "0")}% of the minimum submitted`;
};

function AuctionTape({
  snapshot,
}: {
  readonly snapshot: CollectorAuctionSnapshot;
}) {
  const phase = auctionPhase(snapshot);
  const progress = auctionProgress(snapshot);
  const copy = auctionPhaseCopy[phase];
  return (
    <section
      className="auction-tape"
      aria-label="Auction progress"
      data-phase={phase}
    >
      <div className="auction-tape__state">
        <Badge
          dot
          tone={
            phase === "live"
              ? "live"
              : phase === "complete"
                ? "success"
                : "info"
          }
        >
          {copy.label}
        </Badge>
        <p>{copy.explanation}</p>
      </div>
      <div className="auction-tape__blocks font-mono tabular-nums">
        <span>Block {snapshot.observedBlock.toString()}</span>
        <span>{progress.toFixed(2)}%</span>
      </div>
      <div aria-hidden="true" className="auction-tape__track">
        <span style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}

function AuctionLedger({
  busy,
  onAction,
  snapshot,
}: {
  readonly busy: boolean;
  readonly onAction: (action: AuctionAction) => void;
  readonly snapshot: CollectorAuctionSnapshot;
}) {
  const phase = auctionPhase(snapshot);
  if (snapshot.bids.length === 0)
    return (
      <StateFeedback
        description="A bid will appear here with its exact refund or token delivery amount."
        title="No bids from this wallet"
        tone="empty"
      />
    );
  return (
    <div className="grid gap-3">
      {snapshot.bids.map((bid) => {
        const settle =
          (phase === "refunds" || phase === "claims") && !bid.exited;
        const claim =
          phase === "claims" && bid.exited && bid.claimableTokens > 0n;
        return (
          <article
            className="auction-bid-row"
            data-auction-bid={bid.bidId.toString()}
            key={bid.bidId.toString()}
          >
            <div>
              <p className="font-mono text-label text-ink-faint">
                Bid {bid.bidId.toString()}
              </p>
              <p className="mt-1 font-mono text-title tabular-nums text-ink">
                {formatAuctionAmount(
                  bid.committedCurrency,
                  snapshot.currency.decimals,
                )}{" "}
                {snapshot.currency.symbol}
              </p>
              <p className="mt-1 text-body-sm text-ink-soft">
                Maximum {bid.maxPriceFormatted} {snapshot.currency.symbol} per{" "}
                {snapshot.token.symbol}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 tablet:justify-end">
              {settle ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    onAction({
                      type: "exit",
                      bidId: bid.bidId,
                    })
                  }
                  variant="outline"
                >
                  Settle bid
                </Button>
              ) : null}
              {claim ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    onAction({
                      type: "claim",
                      bidId: bid.bidId,
                    })
                  }
                >
                  Claim to delivery ·{" "}
                  {formatAuctionAmount(
                    bid.claimableTokens,
                    snapshot.token.decimals,
                  )}{" "}
                  {snapshot.token.symbol}
                </Button>
              ) : null}
              {!settle && !claim ? (
                <Badge tone="neutral">
                  {bid.exited ? "Settled" : "Awaiting result"}
                </Badge>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// This component owns one transaction state machine whose branches are kept
// together so saved-action recovery and fresh execution cannot diverge.
// eslint-disable-next-line complexity
function AuctionInstrument({
  adapter,
  account,
  initialSnapshot,
}: {
  readonly adapter: AuctionAdapter;
  readonly account: Address;
  readonly initialSnapshot: CollectorAuctionSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [amount, setAmount] = useState(() =>
    recommendedAuctionBidAmount(initialSnapshot),
  );
  const [maxPrice, setMaxPrice] = useState(
    initialSnapshot.suggestedMaxPriceFormatted,
  );
  const [transaction, setTransaction] = useState(createTransactionState);
  const activeAction = useRef<AuctionAction | undefined>(undefined);
  const recovering = useRef(false);
  const parsedAmount = parseAuctionAmount(amount, snapshot.currency.decimals);
  const next = nextBidAction(snapshot, parsedAmount, maxPrice);
  const busy =
    isTransactionInFlight(transaction) ||
    transaction.status === "outcome-unknown";

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    setSnapshot(await adapter.read(account, controller.signal));
  }, [account, adapter]);

  const remember = useCallback(
    (action: AuctionAction, state: typeof transaction) => {
      setTransaction(state);
      if (
        (state.status === "submitted" || state.status === "outcome-unknown") &&
        typeof window !== "undefined"
      ) {
        writeAuctionTransaction(window.localStorage, {
          version: 1,
          account,
          auctionAddress: snapshot.auctionAddress,
          action,
          hash: state.hash,
          createdAt: Date.now(),
        });
      }
      if (state.status === "confirmed" && typeof window !== "undefined")
        clearAuctionTransaction(window.localStorage);
    },
    [account, snapshot.auctionAddress],
  );

  const run = useCallback(
    async (action: AuctionAction) => {
      if (busy) return;
      activeAction.current = action;
      try {
        const result = await adapter.execute(account, action, (state) =>
          remember(action, state),
        );
        try {
          await refresh();
        } catch {
          setTransaction({
            status: "confirmed",
            label: actionLabel(action),
            hash: result.hash,
            message:
              "Transaction confirmed; refreshing auction balances failed. Refresh the page before continuing.",
          });
        }
      } catch (cause) {
        setTransaction({
          status: "retriable",
          label: actionLabel(action),
          message: actionErrorMessage(action, cause),
        });
      }
    },
    [account, adapter, busy, refresh, remember],
  );

  useEffect(() => {
    if (recovering.current || typeof window === "undefined") return;
    const record = readAuctionTransaction(
      window.localStorage,
      account,
      snapshot.auctionAddress,
    );
    if (record === undefined) return;
    recovering.current = true;
    activeAction.current = record.action;
    void Promise.resolve()
      .then(() => {
        setTransaction({
          status: "outcome-unknown",
          label: actionLabel(record.action),
          hash: record.hash,
          message:
            "Checking the saved transaction before another wallet action is allowed.",
          reconciling: true,
        });
        return adapter.recover(record, (state) =>
          remember(record.action, state),
        );
      })
      .then(refresh)
      .catch((cause: unknown) => {
        setTransaction({
          status: "outcome-unknown",
          label: actionLabel(record.action),
          hash: record.hash,
          message:
            cause instanceof Error
              ? cause.message
              : "The saved auction transaction could not be reconciled.",
        });
      })
      .finally(() => {
        recovering.current = false;
      });
  }, [account, adapter, refresh, remember, snapshot.auctionAddress]);

  const retry = () => {
    const action = activeAction.current;
    if (action !== undefined) void run(action);
  };
  const bidAction = next.action;
  const bidStep = !snapshot.escrow.deployed
    ? 0
    : parsedAmount === undefined || snapshot.tokenAllowance < parsedAmount
      ? 1
      : snapshot.auctionAllowance < parsedAmount
        ? 2
        : 3;
  const commitmentCushion = snapshot.currencyCommitted - snapshot.minimumRaise;
  const commitmentGap =
    commitmentCushion >= 0n ? commitmentCushion : -commitmentCushion;

  return (
    <div className="mt-5 grid gap-5">
      <AuctionTape snapshot={snapshot} />
      {auctionPhase(snapshot) === "settling" ? (
        <Panel title="Finalizing automatically" tone="live">
          <p className="text-body-sm text-ink-soft">
            The operator is recording the end-block checkpoint and preparing the
            canonical market. No wallet action is required.
          </p>
        </Panel>
      ) : null}
      <MetricGroup columns={4} label="Auction funding progress">
        <Metric
          hint={fundingCoverage(
            snapshot.currencyCommitted,
            snapshot.minimumRaise,
          )}
          label="Committed"
          tone="live"
          value={`${formatAuctionAmount(snapshot.currencyCommitted, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
        />
        <Metric
          hint="The final cleared amount must reach this threshold."
          label="Minimum to succeed"
          value={`${formatAuctionAmount(snapshot.minimumRaise, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
        />
        <Metric
          hint="Submitted commitments can clear for less than their maximum amount."
          label={
            commitmentCushion >= 0n ? "Commitment cushion" : "Still needed"
          }
          value={`${formatAuctionAmount(commitmentGap, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
        />
        <Metric
          hint="This clearing-derived value determines graduation."
          label="Cleared / raised"
          value={`${formatAuctionAmount(snapshot.currencyRaised, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
        />
      </MetricGroup>
      <MetricGroup columns={3} label="Current auction measurements">
        <Metric
          label="Clearing price"
          tone="live"
          value={`${snapshot.clearingPriceFormatted} ${snapshot.currency.symbol}`}
        />
        <Metric
          label="Floor price"
          value={`${snapshot.floorPriceFormatted} ${snapshot.currency.symbol}`}
        />
        <Metric
          label="Token allocation"
          value={`${formatAuctionAmount(snapshot.tokensSold, snapshot.token.decimals)} / ${formatAuctionAmount(snapshot.totalTokens, snapshot.token.decimals)}`}
        />
      </MetricGroup>

      <div className="auction-workspace">
        <Panel
          title="Bid ticket"
          tone={auctionPhase(snapshot) === "live" ? "live" : "default"}
        >
          <div className="grid gap-4">
            <AmountField
              id="auction-bid-amount"
              label="Commit"
              onValueChange={setAmount}
              unit={snapshot.currency.symbol}
              value={amount}
            />
            <AmountField
              description="Your bid may clear below this ceiling."
              id="auction-max-price"
              label="Maximum price per token"
              onValueChange={setMaxPrice}
              unit={snapshot.currency.symbol}
              value={maxPrice}
            />
            <p className="text-body-sm text-ink-soft">
              Bidding needs test WETH plus Base Sepolia ETH for network fees.{" "}
              <TestFundsLink href="/faucet?returnTo=/auction" />
            </p>
            <DataList>
              <DataRow
                label="Wallet balance"
                value={`${formatAuctionAmount(snapshot.walletCurrencyBalance, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
              />
              <DataRow
                label="Permit2 token approval"
                value={`${formatAuctionAmount(snapshot.tokenAllowance, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
              />
              <DataRow
                label="Auction allowance"
                value={`${formatAuctionAmount(snapshot.auctionAllowance, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
              />
              <DataRow
                label="Network fee balance"
                value={`${formatAuctionAmount(snapshot.walletGasBalance, 18)} ETH`}
              />
            </DataList>
            <div aria-label="Bid steps" className="grid gap-2">
              <p className="font-mono text-label text-ink-faint">Bid steps</p>
              <ol className="grid gap-1 text-body-sm text-ink-soft">
                {[
                  "Prepare delivery account",
                  `Approve ${amount || "—"} ${snapshot.currency.symbol} for Permit2`,
                  `Allow auction to spend ${amount || "—"} ${snapshot.currency.symbol}`,
                  `Place bid at up to ${maxPrice || "—"} ${snapshot.currency.symbol}`,
                ].map((label, index) => (
                  <li
                    className={index === bidStep ? "text-ink" : undefined}
                    key={label}
                  >
                    {index < bidStep ? "✓" : index === bidStep ? "→" : "·"}{" "}
                    {label}
                  </li>
                ))}
              </ol>
            </div>
            {bidAction === undefined ? (
              <Button disabled>Place bid</Button>
            ) : (
              <Button disabled={busy} onClick={() => void run(bidAction)}>
                {bidActionLabel(bidAction, snapshot)}
              </Button>
            )}
            {bidAction?.type === "approve-token" ||
            bidAction?.type === "approve-auction" ? (
              <p className="text-body-sm text-ink-soft">
                Each allowance is capped at this bid amount. Placing the bid
                remains a separate wallet action.
              </p>
            ) : null}
            {!next.state.enabled && next.state.reason !== undefined ? (
              <div>
                <DisabledReason id="auction-bid-disabled">
                  {next.state.reason}
                </DisabledReason>
                {next.state.condition === "insufficient-weth" ? (
                  <TestFundsLink
                    className="mt-1"
                    href="/faucet?returnTo=/auction"
                  >
                    Get test WETH
                  </TestFundsLink>
                ) : null}
                {next.state.condition === "insufficient-eth" ? (
                  <TestFundsLink
                    className="mt-1"
                    href="/faucet?returnTo=/auction"
                  >
                    Get test ETH
                  </TestFundsLink>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Your delivery"
          meta={`${snapshot.bids.length} ${snapshot.bids.length === 1 ? "bid" : "bids"}`}
        >
          <div className="grid gap-4">
            <DataList>
              <DataRow
                label="Refund ready"
                value={`${formatAuctionAmount(snapshot.escrow.currencyBalance, snapshot.currency.decimals)} ${snapshot.currency.symbol}`}
              />
              <DataRow
                label="FUEL awaiting delivery"
                value={`${formatAuctionAmount(snapshot.escrow.fuelBalance, snapshot.token.decimals)} ${snapshot.token.symbol}`}
              />
            </DataList>
            <div className="flex flex-wrap gap-2">
              {snapshot.escrow.currencyBalance > 0n ? (
                <Button
                  disabled={busy}
                  onClick={() => void run({ type: "withdraw-currency" })}
                  variant="outline"
                >
                  Withdraw refund
                </Button>
              ) : null}
              {snapshot.marketOpen && snapshot.escrow.fuelBalance > 0n ? (
                <Button
                  disabled={busy}
                  onClick={() => void run({ type: "deliver-fuel" })}
                >
                  Deliver next{" "}
                  {formatAuctionAmount(
                    snapshot.escrow.fuelBalance >
                      snapshot.escrow.maximumFuelWithdrawal
                      ? snapshot.escrow.maximumFuelWithdrawal
                      : snapshot.escrow.fuelBalance,
                    snapshot.token.decimals,
                  )}{" "}
                  {snapshot.token.symbol}
                </Button>
              ) : null}
            </div>
            <AuctionLedger
              busy={busy}
              onAction={(action) => void run(action)}
              snapshot={snapshot}
            />
          </div>
        </Panel>
      </div>
      <TransactionStatus
        automaticRecovery
        state={transaction}
        onRetry={retry}
      />
    </div>
  );
}

export function AuctionPanel({
  adapter = auctionAdapter,
}: {
  readonly adapter?: AuctionAdapter;
}) {
  const protocol = useProtocolClient();
  const [read, setRead] = useState<
    | { readonly status: "idle" }
    | { readonly status: "loading" }
    | { readonly status: "failed"; readonly error: Error }
    | { readonly status: "loaded"; readonly snapshot: CollectorAuctionSnapshot }
  >({ status: "idle" });

  const account = protocol.address;
  useEffect(() => {
    if (
      !adapter.configured ||
      protocol.accessState !== "ready" ||
      account === undefined
    )
      return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        setRead({ status: "loading" });
        return adapter.read(account, controller.signal);
      })
      .then((snapshot) => setRead({ status: "loaded", snapshot }))
      .catch((cause) => {
        if (!controller.signal.aborted)
          setRead({
            status: "failed",
            error: cause instanceof Error ? cause : new Error(String(cause)),
          });
      });
    return () => controller.abort();
  }, [account, adapter, protocol.accessState]);

  if (!adapter.configured)
    return (
      <div className="mt-5">
        <StateFeedback
          description="The collector interface is ready and will connect when the CCA address and reader are published for this deployment."
          title="Auction deployment pending"
          tone="notice"
        />
      </div>
    );
  if (protocol.accessState !== "ready" || account === undefined)
    return (
      <div className="mt-5">
        <AccessNotice />
      </div>
    );
  if (read.status === "idle" || read.status === "loading")
    return (
      <div className="mt-5">
        <StateFeedback
          description="Reading the auction and this wallet’s bids at one observed block."
          title="Loading auction"
          tone="loading"
        />
      </div>
    );
  if (read.status === "failed")
    return (
      <div className="mt-5">
        <StateFeedback
          description={read.error.message}
          title="Auction read failed"
          tone="error"
        />
      </div>
    );
  return (
    <AuctionInstrument
      account={account}
      adapter={adapter}
      initialSnapshot={read.snapshot}
    />
  );
}
