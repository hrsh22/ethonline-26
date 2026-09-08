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
  onRecover,
  canRecover,
}: {
  readonly onClear: () => void;
  readonly onRecover: ((hash: string) => Promise<void>) | undefined;
  readonly canRecover: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="mt-3 grid gap-2">
      {canRecover && onRecover !== undefined ? (
        <RecoverKnownTransaction onRecover={onRecover} />
      ) : (
        <p className="text-body-sm text-ink-soft">
          This older attempt has no saved call evidence for matching a
          transaction hash. Keep its wallet or explorer record; the app cannot
          safely mark it complete here.
        </p>
      )}
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
        record. If a hash recovery field is available, paste its transaction
        hash to verify this attempt. Do not submit the same action again.
      </p>
    </div>
  );
}

export function RecoverKnownTransaction({
  onRecover,
}: {
  readonly onRecover: (hash: string) => Promise<void>;
}) {
  const [hash, setHash] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (checking) return;
        setChecking(true);
        setError(undefined);
        void onRecover(hash.trim())
          .catch((cause: unknown) => {
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to verify this transaction. Try again after checking its wallet record.",
            );
          })
          .finally(() => setChecking(false));
      }}
    >
      <label className="grid gap-2 text-body-sm">
        Transaction hash from your wallet
        <input
          aria-describedby="transaction-hash-recovery-help"
          className="min-h-11 rounded-md border border-line bg-transparent px-3 font-mono text-body-sm"
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          placeholder="0x…"
          maxLength={66}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p
        id="transaction-hash-recovery-help"
        className="text-body-sm text-ink-soft"
      >
        If the wallet says this transaction completed, verify its hash against
        the exact saved call. This only checks the chain and never sends another
        transaction.
      </p>
      <div>
        <Button
          type="submit"
          variant="outline"
          disabled={checking || !/^0x[0-9a-fA-F]{64}$/u.test(hash.trim())}
        >
          {checking ? "Checking transaction…" : "Verify transaction hash"}
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-body-sm text-ink-soft">
          {error}
        </p>
      )}
    </form>
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
    <p className="mt-2 text-body [overflow-wrap:anywhere]">
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
      {transaction.status === "confirmed" ? null : (
        <CollectorHelp topic="transaction" />
      )}
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
          onRecover={protocol.recoverTransactionHash}
          canRecover={protocol.transactionMetadata?.canRecoverHash === true}
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
