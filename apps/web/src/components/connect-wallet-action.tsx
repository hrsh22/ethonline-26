"use client";

import { modal } from "@reown/appkit/react";

import { WalletConnectionAction } from "@/components/wallet-connection-action";
import { applicationCopy } from "@/lib/identity";
import { isReownConfigured } from "@/lib/wagmi";

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
  if (!isReownConfigured) return null;
  return (
    <WalletConnectionAction
      onContinue={() =>
        // The modal rejects if it is already open or still initialising;
        // neither is a failure the reader needs to hear about.
        void Promise.resolve(modal?.open({ view: "Connect" })).catch(
          () => undefined,
        )
      }
      size="sm"
    >
      {applicationCopy.shell.connectWallet}
    </WalletConnectionAction>
  );
}
