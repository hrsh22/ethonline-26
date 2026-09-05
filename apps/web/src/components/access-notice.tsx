"use client";

import { useProtocolClient } from "@/providers/protocol-client-provider";
import { type CollectorAccessState } from "@/lib/collector-access";
import { applicationCopy } from "@/lib/identity";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { StateFeedback } from "@/components/state-feedback";
import { Button } from "@/components/ui/button";

const messages = {
  disconnected: {
    title: applicationCopy.access.disconnectedTitle,
    body: applicationCopy.access.disconnectedBody,
  },
  "wrong-network": {
    title: applicationCopy.access.wrongNetworkTitle,
    body: applicationCopy.access.wrongNetworkBody,
  },
  "deployment-pending": {
    title: applicationCopy.access.deploymentPendingTitle,
    body: applicationCopy.access.deploymentPendingBody,
  },
  ready: {
    title: applicationCopy.access.readyTitle,
    body: applicationCopy.access.readyBody,
  },
} as const;

type WalletRead = ReturnType<typeof useProtocolClient>["walletRead"];

export interface BlockedAccessMessage {
  readonly body: string;
  /** True only when connecting a wallet is what clears the block. */
  readonly connectable: boolean;
  readonly title: string;
}

/**
 * Why a wallet-gated surface is blocked, in the words of the block itself.
 *
 * Every gated surface used to hard-code the disconnected wording, so a wallet
 * connected to the wrong chain was told it was not connected and offered a
 * connect action that could never clear the block. The reason is one value;
 * this keeps it one lookup.
 */
export const blockedAccessMessage = (
  accessState: CollectorAccessState,
): BlockedAccessMessage => ({
  ...messages[accessState],
  connectable: accessState === "disconnected",
});

const noticeFor = (walletRead: WalletRead) => {
  switch (walletRead.status) {
    case "blocked": {
      const blocked = blockedAccessMessage(walletRead.accessState);
      return {
        message: blocked,
        // Only a disconnected wallet has a recovery action here. A wrong
        // network is recovered by the wallet control's own switch, and a
        // pending deployment is not the reader's to fix.
        connectable: blocked.connectable,
        retriable: false,
        tone: "blocked",
      } as const;
    }
    case "loading":
      return {
        message: {
          title: applicationCopy.access.walletLoadingTitle,
          body: applicationCopy.access.walletLoadingBody,
        },
        retriable: false,
        tone: "loading",
      } as const;
    case "failed":
      return {
        message: {
          title: applicationCopy.access.walletFailedTitle,
          body: applicationCopy.access.walletFailedBody,
        },
        retriable: true,
        tone: "error",
      } as const;
    case "loaded": {
      const partial = walletRead.snapshot.partialFailures.length > 0;
      return {
        message: partial
          ? {
              title: applicationCopy.access.walletPartialTitle,
              body: applicationCopy.access.walletPartialBody,
            }
          : messages.ready,
        retriable: partial,
        tone: partial ? "partial" : "success",
      } as const;
    }
  }
};

export function AccessNotice({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const { refreshWallet, walletRead } = useProtocolClient();
  const notice = noticeFor(walletRead);
  return (
    <StateFeedback
      action={
        notice.retriable ? (
          <Button
            onClick={() => void refreshWallet()}
            size="sm"
            type="button"
            variant="outline"
          >
            {applicationCopy.access.retryWalletRead}
          </Button>
        ) : "connectable" in notice && notice.connectable ? (
          <ConnectWalletAction />
        ) : undefined
      }
      className="access-notice"
      compact={compact}
      description={notice.message.body}
      title={notice.message.title}
      tone={notice.tone}
    />
  );
}
