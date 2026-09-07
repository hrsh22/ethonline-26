"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { useDeliveryStatus } from "@/hooks/use-delivery-status";
import {
  deploymentEnvironment,
  protocolDeploymentFingerprint,
} from "@/lib/deployment";
import { identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

export type CollectorHelpTopic =
  "discovery" | "transaction" | "wallet-artwork" | "rewards";
const labels: Record<CollectorHelpTopic, string> = {
  discovery: "Help with collectible delivery",
  transaction: "Help with this wallet action",
  "wallet-artwork": "Help finding a collectible in your wallet",
  rewards: "Help understanding rewards",
};

type ProtocolClient = ReturnType<typeof useProtocolClient>;
const walletSupportDetails = (read: ProtocolClient["walletRead"]) => {
  if (read.status !== "loaded") return { walletRead: read.status };
  const pending = read.snapshot.collectibles.pendingDiscovery;
  return {
    walletRead: read.status,
    walletObservedAtSeconds: read.snapshot.observedAt,
    discoveryRequest: pending?.batch?.vrfRequestId?.toString(),
    discoveryStage: pending?.phase,
  };
};
const transactionSupportDetails = (
  transaction: ProtocolClient["transaction"],
) => {
  const hash = "hash" in transaction ? transaction.hash : undefined;
  return {
    transactionStage: transaction.status,
    transactionHash:
      hash !== undefined && /^0x[0-9a-f]{64}$/i.test(hash) ? hash : undefined,
  };
};

export function CollectorHelp({
  topic,
}: {
  readonly topic: CollectorHelpTopic;
}) {
  const protocol = useProtocolClient();
  const delivery = useDeliveryStatus();
  const transaction = protocol.transaction;
  const details = JSON.stringify(
    {
      app: identity.brand,
      topic,
      chainId: deploymentEnvironment.chainId,
      deployment: protocolDeploymentFingerprint,
      ...walletSupportDetails(protocol.walletRead),
      ...transactionSupportDetails(transaction),
      delivery: delivery.state,
      deliveryObservedAtMilliseconds: delivery.data?.observedAt,
      reference:
        protocol.walletRead.status === "failed"
          ? "wallet-read-unavailable"
          : `transaction-${transaction.status}`,
    },
    null,
    2,
  );
  const [copied, setCopied] = useState<string>();
  const [manualCopy, setManualCopy] = useState<string>();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(details);
      setManualCopy(undefined);
    } catch {
      setManualCopy(details);
    }
  };
  return (
    <div className="mt-3 grid gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/learn#help-${topic}`} size="sm" variant="outline">
          {labels[topic]}
        </ButtonLink>
        <Button onClick={() => void copy()} size="sm" variant="ghost">
          Copy support details
        </Button>
        <ButtonLink href="/status" size="sm" variant="ghost">
          Service status
        </ButtonLink>
      </div>
      <p className="text-caption text-ink-soft">
        Copies only this request’s public network, stage, transaction or
        Discovery reference, and observation times. No signature, private key,
        or wallet history is included.
      </p>
      <p aria-live="polite" className="text-body-sm">
        {copied === details ? "Support details copied" : ""}
      </p>
      {manualCopy === details ? (
        <label className="grid gap-1 text-body-sm">
          Copy these support details
          <textarea
            aria-label="Support details"
            className="min-h-40 w-full border border-line bg-canvas p-3 text-[16px]"
            readOnly
            value={details}
            onFocus={(event) => event.target.select()}
          />
        </label>
      ) : null}
    </div>
  );
}
