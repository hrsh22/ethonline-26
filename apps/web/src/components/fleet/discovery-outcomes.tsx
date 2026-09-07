"use client";

import Link from "next/link";
import { useCompletionReveal } from "@/hooks/use-completion-reveal";
import type { DiscoveryHistoryRequest } from "@orbit/protocol/history";
import { useDiscoveryHistory } from "@/hooks/use-discovery-history";
import { useProtocolClient } from "@/providers/protocol-client-provider";
import { CraftArt } from "@/components/ui/craft-art";
import { trackIndexFor } from "./fleet-craft-card";

function DeliveredCraft({
  identityId,
  rewardTrack,
  permanent,
  operationId,
  owner,
}: {
  readonly identityId: number;
  readonly rewardTrack: string;
  readonly permanent: boolean;
  readonly operationId: string;
  readonly owner: string;
}) {
  const { ref, announcement } = useCompletionReveal({
    owner,
    identityId,
    operationId,
    kind: "delivery",
    message: `Delivery complete. Craft #${identityId} is in your collection.`,
  });
  return (
    <div ref={ref} className="flex items-center gap-4">
      <span ref={announcement} role="status" className="sr-only" />
      <div className="size-24">
        <CraftArt
          identityId={identityId}
          kind={
            identityId > 4440 ? "relic" : permanent ? "permanent" : "transient"
          }
          lit={permanent}
          track={trackIndexFor(rewardTrack)}
        />
      </div>
      <Link
        className="inline-flex min-h-11 items-center underline"
        href={`/fleet/${identityId}`}
      >
        View delivered craft #{identityId}
      </Link>
    </div>
  );
}

function Outcome({ request }: { readonly request: DiscoveryHistoryRequest }) {
  const protocol = useProtocolClient();
  const wallet = protocol.walletRead;
  const held =
    wallet.status === "loaded" &&
    !wallet.stale &&
    wallet.snapshot.collectibles.permanentHoldingsStatus === "complete"
      ? [
          ...wallet.snapshot.collectibles.transient.map((craft) => ({
            ...craft,
            permanent: false,
          })),
          ...wallet.snapshot.collectibles.permanent.map((craft) => ({
            ...craft,
            permanent: true,
          })),
        ].find((craft) => craft.identityId === request.identityId)
      : undefined;
  const title =
    request.outcome === "cancelled"
      ? "Discovery cancelled: FUEL backing moved"
      : request.outcome === "delivered"
        ? `Discovery revealed #${request.identityId}`
        : "Discovery recorded";
  return (
    <li className="grid gap-2 rounded border border-line p-4">
      <h3 className="font-semibold">{title}</h3>
      {held !== undefined ? (
        <DeliveredCraft
          identityId={held.identityId}
          rewardTrack={held.rewardTrack}
          permanent={held.permanent}
          operationId={request.outcomeHash ?? request.requestId}
          owner={protocol.address ?? "unknown"}
        />
      ) : null}
      <p className="text-body-sm">
        {outcomeMessage(request, held !== undefined)}
      </p>
      <p className="break-all text-body-sm text-ink-soft">
        Protocol request {request.requestId}
      </p>
      {request.acquisitionHash !== undefined ? (
        <a
          className="inline-flex min-h-11 items-center underline"
          href={`https://sepolia.basescan.org/tx/${request.acquisitionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View acquisition transaction
        </a>
      ) : (
        <p className="text-body-sm text-ink-soft">
          The acquisition is outside this recent history window.
        </p>
      )}
    </li>
  );
}
function outcomeMessage(request: DiscoveryHistoryRequest, held: boolean) {
  if (request.outcome === "cancelled")
    return "The recorded request was cancelled when its whole FUEL backing moved. No collectible is due for this request.";
  if (request.outcome === "pending")
    return "This acquisition has a recorded Discovery. Its final outcome has not reached indexed history yet.";
  return held
    ? "Delivery and current ownership are verified."
    : "Delivery is recorded onchain. Current ownership is not yet verified here; the craft may have moved since delivery.";
}

export function DiscoveryOutcomes() {
  const history = useDiscoveryHistory();
  if (history.data === undefined || history.data.requests.length === 0)
    return null;
  const data = history.data;
  return (
    <section aria-label="Acquisition outcomes" className="grid gap-3">
      <h2 className="font-semibold">Your discovery activity</h2>
      {history.isError ? (
        <p className="text-body-sm text-warning">
          History is temporarily unavailable. These are the last verified
          outcomes.
        </p>
      ) : null}
      <ul className="grid gap-3 tablet:grid-cols-2">
        {data.requests.slice(0, 12).map((request) => (
          <Outcome key={request.requestId} request={request} />
        ))}
      </ul>
      {data.truncated || data.requests.length > 12 ? (
        <p className="text-body-sm">
          Showing recent requests. Older acquisitions remain available in your
          onchain transaction history.
        </p>
      ) : null}
      <p className="text-body-sm text-ink-soft">
        {data.coverage === "partial" ? "History is still catching up. " : ""}
        Last indexed observation:{" "}
        {data.observedAt === undefined
          ? "unavailable"
          : new Date(Number(data.observedAt) * 1000).toISOString()}
        .
      </p>
    </section>
  );
}
