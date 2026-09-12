"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Amount } from "@/components/ui/value";
import { DiscoveryTarget } from "./discovery-target";
import type {
  ExchangeDirection,
  ExchangeSettlementMode,
  ExchangeWalletEvidence,
} from "@/lib/exchange-state";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

type Protocol = ReturnType<typeof useProtocolClient>;
export interface CompletedTrade {
  readonly direction: ExchangeDirection;
  readonly address: string;
}

export function TradeCompletion({
  completed,
  protocol,
  onDismiss,
}: {
  completed: CompletedTrade | undefined;
  protocol: Protocol;
  onDismiss: () => void;
}) {
  if (completed === undefined || completed.address !== protocol.address)
    return null;
  return (
    <section
      role="status"
      className="grid gap-3 rounded-lg bg-success-surface p-4 text-success"
    >
      <h2 className="text-title-sm font-semibold">
        {completed.direction === "buy"
          ? "Purchase confirmed"
          : "Sale confirmed"}
      </h2>
      {protocol.walletRead.status === "loaded" ? (
        <p className="text-body-sm">
          Your FUEL balance:{" "}
          <Amount
            value={protocol.walletRead.snapshot.liquidToken.rawWei}
            unit="$FUEL"
          />
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/fleet" size="sm">
          View Fleet
        </ButtonLink>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Make another trade
        </Button>
      </div>
    </section>
  );
}

export function TradeDiscoveryTarget({
  direction,
  mode,
  wallet,
  protocol,
  pending,
  onAmount,
}: {
  direction: ExchangeDirection;
  mode: ExchangeSettlementMode;
  wallet: ExchangeWalletEvidence;
  protocol: Protocol;
  pending: boolean;
  onAmount: (amount: string) => void;
}) {
  if (
    direction !== "buy" ||
    wallet.status !== "loaded" ||
    protocol.address === undefined
  )
    return null;
  return (
    <DiscoveryTarget
      key={`${protocol.address}:${mode}`}
      address={protocol.address}
      balance={wallet.liquidTokenBalanceWei}
      disabled={pending || protocol.walletSynchronizing}
      onAmount={onAmount}
    />
  );
}

export function TradeConfirmationSteps({
  nativeBuy,
  pending,
  approval,
  hasQuote,
}: {
  nativeBuy: boolean;
  pending: boolean;
  approval: boolean;
  hasQuote: boolean;
}) {
  if (!pending)
    return hasQuote ? (
      <p className="text-caption text-ink-soft">
        {nativeBuy
          ? "One wallet confirmation"
          : "Your wallet may request token approval before the trade."}
      </p>
    ) : null;
  return (
    <ol
      aria-label="Transaction steps"
      className="rounded-lg bg-surface-2 p-3 text-body-sm"
    >
      {nativeBuy ? null : (
        <li className={approval ? "text-signal" : "text-ink-soft"}>
          {approval
            ? "1. Confirm token approval in your wallet"
            : "1. Token allowance checked"}
        </li>
      )}
      <li className={approval ? "text-ink-soft" : "text-signal"}>
        {nativeBuy ? "" : "2. "}
        {approval
          ? "Confirm the trade after approval"
          : "Confirming your trade"}
      </li>
    </ol>
  );
}
