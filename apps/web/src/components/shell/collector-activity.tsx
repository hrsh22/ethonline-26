"use client";

import { CompletedActivity } from "@/components/shell/completed-activity";
import { useDiscoveryHistory } from "@/hooks/use-discovery-history";
import { CollectorHelp } from "@/components/collector-help";
import { useState } from "react";
import Link from "next/link";
import { useDiscoveryReference } from "@/hooks/use-discovery-reference";
import { LaunchCompletion } from "./launch-completion";

import { TransactionStatus } from "@/components/transaction-status";
import { Button } from "@/components/ui/button";
import { useProtocolClient } from "@/providers/protocol-client-provider";

function InterruptedWalletPrompt({
  onClear,
}: {
  readonly onClear: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="mt-3 grid gap-2">
      <label className="flex min-h-11 items-center gap-3 text-body">
        <input
          checked={checked}
          className="size-5 accent-signal"
          onChange={(event) => setChecked(event.target.checked)}
          type="checkbox"
        />
        I checked my wallet activity. No transaction was sent.
      </label>
      <Button disabled={!checked} onClick={onClear} variant="outline">
        Return to review
      </Button>
      <p className="text-body-sm text-ink-soft">
        If your wallet shows a pending or confirmed transaction, follow that
        record and keep waiting here. Do not submit the same action again.
      </p>
    </div>
  );
}

function DiscoveryActivity({
  reference,
  pending,
}: {
  readonly reference: string | undefined;
  readonly pending: number | undefined;
}) {
  if (reference === undefined && !pending) return null;
  const message =
    pending === undefined
      ? "Checking discovery progress."
      : pending > 0
        ? `${pending} pending ${pending === 1 ? "Discovery" : "Discoveries"}.`
        : "The last recorded batch is no longer pending. Recorded acquisition outcomes and verified holdings are in Fleet.";
  return (
    <p className="mt-2 text-body">
      {message}{" "}
      {reference === undefined ? "" : `Discovery request ${reference}. `}
      <Link className="underline" href="/fleet">
        View discovery and collection
      </Link>
    </p>
  );
}

const hasActivity = (
  protocol: ReturnType<typeof useProtocolClient>,
  reference: string | undefined,
  pending: number | undefined,
  historyCount = 0,
) =>
  protocol.transaction.status !== "idle" ||
  reference !== undefined ||
  Boolean(pending) ||
  historyCount > 0 ||
  Boolean(protocol.completedTransactions?.length);

/** The shell owns this notice so navigation cannot hide a submitted action. */
export function CollectorActivity() {
  const protocol = useProtocolClient();
  const discoveryReference = useDiscoveryReference(protocol);
  const discoveryHistory = useDiscoveryHistory({ poll: true });
  const pending =
    protocol.walletRead.status === "loaded"
      ? protocol.walletRead.snapshot.collectibles.pendingDiscovery.count
      : undefined;
  if (
    !hasActivity(
      protocol,
      discoveryReference,
      pending,
      discoveryHistory.data?.requests.length,
    )
  )
    return null;
  return (
    <section
      id="collector-activity"
      aria-label="Wallet activity"
      className="border-b border-line px-4 py-3 tablet:px-6"
    >
      <WalletTransactionActivity protocol={protocol} />
      <CompletedActivity records={protocol.completedTransactions ?? []} />
      {discoveryHistory.data?.requests.some(
        (request) => request.outcome !== "pending",
      ) ? (
        <Link
          className="mt-2 inline-flex min-h-11 items-center underline"
          href="/fleet#discovery-outcomes"
        >
          View recorded discovery outcomes
        </Link>
      ) : null}
      <DiscoveryActivity reference={discoveryReference} pending={pending} />
    </section>
  );
}

function WalletTransactionActivity({
  protocol,
}: {
  readonly protocol: ReturnType<typeof useProtocolClient>;
}) {
  const {
    transaction,
    retry,
    clearTransaction,
    transactionPersistenceAvailable,
  } = protocol;
  if (transaction.status === "idle") return null;
  return (
    <>
      <TransactionStatus
        automaticRecovery
        state={transaction}
        onRetry={() => void retry()}
      />
      <LaunchCompletion protocol={protocol} />
      <CollectorHelp topic="transaction" />
      {transactionPersistenceAvailable === false ? (
        <p className="mt-2 text-body text-warning">
          Browser storage is unavailable. Keep this tab open and save the
          transaction link while we check its outcome.
        </p>
      ) : null}
      {transaction.status === "submission-unknown" &&
      clearTransaction !== undefined ? (
        <InterruptedWalletPrompt
          key={`${protocol.address}:${protocol.chainId}:${protocol.transactionMetadata?.operationId}`}
          onClear={clearTransaction}
        />
      ) : null}
      {["confirmed", "failed"].includes(transaction.status) &&
      clearTransaction !== undefined ? (
        <Button
          className="mt-2"
          onClick={clearTransaction}
          size="sm"
          variant="ghost"
        >
          Dismiss completed activity
        </Button>
      ) : null}
    </>
  );
}
