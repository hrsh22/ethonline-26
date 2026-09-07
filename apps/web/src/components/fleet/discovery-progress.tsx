"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { CollectorHelp } from "@/components/collector-help";
import {
  useDeliveryStatus,
  type DeliveryCondition,
} from "@/hooks/use-delivery-status";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

type Loaded = Extract<
  ReturnType<typeof useProtocolClient>["walletRead"],
  { status: "loaded" }
>;
export type PendingDiscovery =
  Loaded["snapshot"]["collectibles"]["pendingDiscovery"];
const subscribeMinute = (notify: () => void) => {
  const timer = setInterval(notify, 60_000);
  return () => clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / 60_000);
const serviceMessage: Record<DeliveryCondition, string> = {
  stopped:
    "Delivery is stopped. The operator must resume processing; another wallet signature will not help.",
  offline:
    "The delivery service is offline. The operator needs to restore it; your recorded request remains available.",
  checking:
    "The service is checking work without submitting delivery transactions. The operator must enable processing.",
  delayed:
    "The delivery service reported a delay. The operator needs to resolve it; do not repeat your acquisition.",
  unknown:
    "Delivery service status is unavailable. Your recorded request remains visible; check service status for updates.",
  running:
    "The delivery service is running. No additional wallet action is needed for processing.",
};

const secondsSince = (startedAt: bigint | undefined, now: number) =>
  startedAt === undefined ? 0 : Math.max(0, now - Number(startedAt));

function progressEvidence(pending: PendingDiscovery, now: number) {
  const batch = pending.batch;
  const elapsed = secondsSince(batch?.requestedAt, now);
  const randomReceived =
    batch !== undefined && batch.state !== "awaiting-randomness";
  return {
    elapsed: Math.floor(elapsed / 60),
    randomReceived,
    delayed: !randomReceived && (batch?.delayed === true || elapsed >= 900),
    deliveryDelayed:
      randomReceived && secondsSince(batch?.fulfilledAt, now) >= 900,
  };
}

function progressTitle(
  pending: PendingDiscovery,
  evidence: ReturnType<typeof progressEvidence>,
) {
  if (pending.batch?.fullyCancelled) return "Discovery cancelled";
  if (evidence.deliveryDelayed) return "Collectible delivery is delayed";
  if (evidence.randomReceived)
    return "Randomness verified · preparing your collection";
  if (evidence.delayed) return "Randomness is taking longer than expected";
  return "Your discovery is underway";
}

function ProgressStages({
  pending,
  received,
}: {
  readonly pending: PendingDiscovery;
  readonly received: boolean;
}) {
  return (
    <ol className="grid gap-2 text-body">
      <li>
        FUEL backing recorded · {pending.count} pending{" "}
        {pending.count === 1 ? "Discovery" : "Discoveries"}
      </li>
      <li>
        {received
          ? "Randomness received"
          : "Waiting for independently verified randomness"}
      </li>
      <li>
        {received && pending.batch !== undefined
          ? `${pending.batch.finalizedCount} of ${pending.batch.count} results processed`
          : "Collection delivery follows randomness"}
      </li>
    </ol>
  );
}

function ProgressReference({
  pending,
  elapsed,
  observedAt,
}: {
  readonly pending: PendingDiscovery;
  readonly elapsed: number | undefined;
  readonly observedAt: number | undefined;
}) {
  return (
    <>
      {pending.batch !== undefined ? (
        <p className="break-all text-body-sm">
          Discovery request {String(pending.batch.vrfRequestId)} · {elapsed} min
          elapsed
        </p>
      ) : (
        <p className="text-body-sm">Request details are still being checked.</p>
      )}
      <p className="text-body-sm text-ink-soft">
        {observedAt === undefined
          ? "Observation time unavailable"
          : `Last checked ${new Date(observedAt * 1000).toISOString()}`}
        .{" "}
        <Link className="underline" href="/status">
          Service status
        </Link>
      </p>
    </>
  );
}

export function DiscoveryProgress({
  pending,
  observedAt,
}: {
  readonly pending: PendingDiscovery;
  readonly observedAt: number | undefined;
}) {
  const delivery = useDeliveryStatus();
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, () => 0);
  if (pending.count === 0) return null;
  const now = minute === 0 ? (observedAt ?? 0) : minute * 60;
  const evidence = progressEvidence(pending, now);
  return (
    <section
      data-state={
        evidence.delayed || evidence.deliveryDelayed ? "stale" : "notice"
      }
      aria-label="Discovery progress"
      className="grid min-w-0 grid-cols-1 gap-3 rounded border border-line bg-panel p-4 [overflow-wrap:anywhere]"
    >
      <h2 className="font-semibold">{progressTitle(pending, evidence)}</h2>
      <ProgressStages pending={pending} received={evidence.randomReceived} />
      {evidence.randomReceived ? (
        <p className="text-body-sm text-ink-soft">
          Your random draw is verified. Processed results can include cancelled
          backing. Delivered identities appear in Fleet only after ownership is
          verified.
        </p>
      ) : null}
      {evidence.delayed ? (
        <p className="text-body-sm text-warning">
          This has passed the 15-minute delay threshold. The request remains
          recorded; there is no reliable delivery estimate.
        </p>
      ) : null}
      <p className="text-body-sm">{serviceMessage[delivery.state]}</p>
      <p className="text-body-sm text-ink-soft">
        Moving away the whole FUEL unit cancels its unresolved Discovery. Do not
        buy again to retry this request.
      </p>
      <ProgressReference
        pending={pending}
        elapsed={evidence.elapsed}
        observedAt={observedAt}
      />
      <CollectorHelp topic="discovery" />
    </section>
  );
}
