"use client";

import { isTransactionInFlight } from "@/lib/transaction-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";

export function MobileActivityIndicator() {
  const { transaction } = useProtocolClient();
  return isTransactionInFlight(transaction) ? (
    <span
      aria-label="Pending wallet activity"
      className="absolute top-1 right-2 size-2 rounded-full bg-signal-fill"
    />
  ) : null;
}

export function MobileActivityLink() {
  const { transaction } = useProtocolClient();
  return transaction.status === "idle" ? null : (
    <a
      href="#collector-activity"
      className="flex min-h-11 items-center px-4 text-body text-signal"
    >
      View wallet activity
    </a>
  );
}
