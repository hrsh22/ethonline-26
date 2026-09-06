"use client";

import { useCompletionReveal } from "@/hooks/use-completion-reveal";
import Link from "next/link";
import { CraftArt } from "@/components/ui/craft-art";
import { trackIndexFor } from "@/components/fleet/fleet-craft-card";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

type Protocol = ReturnType<typeof useProtocolClient>;

function VerifiedLaunch({
  identityId,
  rewardTrack,
  operationId,
  owner,
}: {
  readonly identityId: number;
  readonly rewardTrack: string;
  readonly operationId: string;
  readonly owner: string;
}) {
  const { ref, announcement } = useCompletionReveal({
    owner,
    identityId,
    operationId,
    kind: "launch",
    message: `Launch complete. Orbiter #${identityId} is in your collection.`,
  });
  return (
    <div ref={ref} className="mt-3 flex flex-wrap items-center gap-4">
      <span ref={announcement} role="status" className="sr-only" />
      <div className="size-24">
        <CraftArt
          identityId={identityId}
          kind={identityId > 4440 ? "relic" : "permanent"}
          lit
          track={trackIndexFor(rewardTrack)}
        />
      </div>
      <div className="grid gap-2 text-body">
        <h2 className="font-semibold">
          Launch complete · Orbiter #{identityId}
        </h2>
        <p>
          Your identity is preserved as a permanent Orbiter. Launch burned 1
          FUEL.
        </p>
        <p>Reward Track: {rewardTrack}. Eligible rewards can now accrue.</p>
        <Link
          className="inline-flex min-h-11 items-center text-signal underline"
          href={`/fleet/${identityId}`}
        >
          View Orbiter #{identityId}
        </Link>
      </div>
    </div>
  );
}

const verifiedOrbiter = (protocol: Protocol, identityId: number) => {
  const read = protocol.walletRead;
  return read.status === "loaded" &&
    !read.stale &&
    read.snapshot.collectibles.permanentHoldingsStatus === "complete"
    ? read.snapshot.collectibles.permanent.find(
        (entry) => entry.identityId === identityId,
      )
    : undefined;
};

export function LaunchCompletion({
  protocol,
}: {
  readonly protocol: Protocol;
}) {
  const metadata = protocol.transactionMetadata;
  if (
    protocol.transaction.status !== "confirmed" ||
    metadata?.actionType !== "commit-collectible"
  )
    return null;
  const identityId = metadata.identityIds[0];
  if (identityId === undefined) return null;
  const craft = verifiedOrbiter(protocol, identityId);
  if (craft === undefined || protocol.walletSynchronizing)
    return (
      <p className="mt-3 text-body">
        Launch transaction confirmed for #{identityId}. We are checking its
        Orbiter ownership; collection synchronization is still in progress.
      </p>
    );
  return (
    <VerifiedLaunch
      owner={protocol.address ?? "unknown"}
      identityId={identityId}
      operationId={metadata.operationId}
      rewardTrack={craft.rewardTrack}
    />
  );
}
