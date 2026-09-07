"use client";

import { WalletConnectionAction } from "@/components/wallet-connection-action";
import { applicationCopy } from "@/lib/identity";
import { isWalletConfigured } from "@/lib/wagmi";
import { useWalletSession } from "@/providers/wallet-session";

/**
 * The recovery action for a state that is blocked only by a missing wallet.
 *
 * The audited surfaces stated the blocking condition and stopped there — the
 * collection told the reader to connect a wallet with no way to do it from the
 * message, leaving them to go and find the header. The design contract says a
 * state offers a recovery action when one exists, and here one does.
 *
 * Renders nothing when wallet connection is not configured for the
 * deployment, because an action that cannot work is worse than none.
 */
export function ConnectWalletAction() {
  const session = useWalletSession();
  if (!isWalletConfigured) return null;
  return (
    <WalletConnectionAction
      disabled={!session.ready || session.connecting}
      onContinue={session.connect}
      size="sm"
    >
      {applicationCopy.shell.connectWallet}
    </WalletConnectionAction>
  );
}
