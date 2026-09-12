"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Disclosure } from "@/components/ui/disclosure";
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
  startedAt === undefined || startedAt === 0n
    ? undefined
    : Math.max(0, now - Number(startedAt));

const elapsedMinutes = (elapsed: number | undefined) =>
  elapsed === undefined ? undefined : Math.floor(elapsed / 60);
const passedDelay = (elapsed: number | undefined) => (elapsed ?? 0) >= 900;

function progressEvidence(pending: PendingDiscovery, now: number) {
  const batch = pending.batch;
  const elapsed = secondsSince(batch?.requestedAt, now);
  const randomReceived =
    batch !== undefined && batch.state !== "awaiting-randomness";
  return {
    elapsed: elapsedMinutes(elapsed),
    randomReceived,
    delayed:
      !randomReceived && (batch?.delayed === true || passedDelay(elapsed)),
    deliveryDelayed:
      randomReceived && passedDelay(secondsSince(batch?.fulfilledAt, now)),
  };
}

function progressTitle(
  pending: PendingDiscovery,
  evidence: ReturnType<typeof progressEvidence>,
) {
  if (pending.batch?.fullyCancelled) return "Discovery cancelled";
  if (evidence.deliveryDelayed) return "Collectible delivery is delayed";
  if (evidence.randomReceived) return "Your craft is being delivered";
  if (evidence.delayed) return "Your Discovery is taking longer than usual";
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
      {pending.batch !== undefined && elapsed !== undefined ? (
        <p className="text-body-sm">
          {elapsed < 1
            ? "Started less than a minute ago"
            : `Started ${elapsed} min ago`}
        </p>
      ) : (
        <p className="text-body-sm">Request details are still being checked.</p>
      )}
      <p className="text-body-sm text-ink-soft">
        {observedAt === undefined
          ? "Observation time unavailable"
          : `Last checked ${new Date(observedAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
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
      <p className="text-body text-ink-soft">
        {pending.count} {pending.count === 1 ? "craft is" : "craft are"} on the
        way. Keep the backing FUEL in this wallet until your Discovery arrives.
      </p>
      {evidence.delayed ? (
        <p className="text-body-sm text-warning">
          This has passed the 15-minute delay threshold. The request remains
          recorded; there is no reliable delivery estimate.
        </p>
      ) : null}
      {delivery.state === "running" ? (
        <p className="text-body-sm">
          No action needed. Your Fleet will update when delivery completes.
        </p>
      ) : (
        <p className="text-body-sm">{serviceMessage[delivery.state]}</p>
      )}
      <ProgressReference
        pending={pending}
        elapsed={evidence.elapsed}
        observedAt={observedAt}
      />
      <Disclosure searchable title="Discovery details">
        <ProgressStages pending={pending} received={evidence.randomReceived} />
        <p className="mt-3 text-body-sm text-ink-soft">
          Moving away a whole backing FUEL unit cancels its unresolved
          Discovery. Buying again does not retry an existing request.
        </p>
        <CollectorHelp topic="discovery" />
      </Disclosure>
    </section>
  );
}
