"use client";

import { Badge } from "@/components/ui/badge";
import { CraftArt } from "@/components/ui/craft-art";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { Amount, Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type PublicStatus = NonNullable<ProtocolClient["publicStatus"]>;

const wethOrUnavailable = (value: bigint | undefined, reason: string) =>
  value === undefined ? (
    <Unavailable reason={reason} />
  ) : (
    <Amount unit="WETH" value={value} />
  );

/**
 * The specimen: the same identity before and after Launch.
 *
 * One glance explains the product's only irreversible transition — a grey
 * Grounded Craft becomes a lit Orbiter — better than a paragraph did.
 */
export function SpecimenPanel({ identityId }: { readonly identityId: number }) {
  return (
    <Panel
      bodyClassName="grid gap-3 compact:grid-cols-2"
      meta={<span>#{identityId}</span>}
      title={applicationCopy.home.specimenLabel}
    >
      <figure className="flex min-w-0 flex-col items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas p-3">
        <CraftArt
          className="size-28 tablet:size-36"
          decorative
          identityId={identityId}
          kind="transient"
          track={2}
        />
        <Badge>{identity.terms.transientCollectible}</Badge>
        <figcaption className="text-center font-mono text-caption text-ink-soft">
          {applicationCopy.home.specimenGrounded}
        </figcaption>
      </figure>
      <figure className="flex min-w-0 flex-col items-center gap-2 rounded-[var(--radius-control)] border border-[var(--accent-border)] bg-canvas p-3">
        <CraftArt
          className="size-28 tablet:size-36"
          decorative
          identityId={identityId}
          kind="permanent"
          track={2}
        />
        <Badge tone="live">{identity.terms.permanentCollectible}</Badge>
        <figcaption className="text-center font-mono text-caption text-ink-soft">
          {applicationCopy.home.specimenLaunched}
        </figcaption>
      </figure>
    </Panel>
  );
}

const feeRows = (model: PublicStatus | undefined, reason: string) => {
  return [
    {
      label: applicationCopy.home.feeRewards,
      share: "2.00%",
      value: wethOrUnavailable(model?.funds.rewardPotWeth, reason),
    },
    {
      label: applicationCopy.home.feeLiquidity,
      share: "0.85%",
      value: wethOrUnavailable(model?.funds.liquidityQueuedWeth, reason),
    },
    {
      label: applicationCopy.home.feeCreator,
      share: "0.15%",
      value: wethOrUnavailable(model?.funds.creatorWeth, reason),
    },
  ] as const;
};

/** Where the 3% fee is right now, with the fixed split beside each queue. */
export function FeeRoutingPanel() {
  const { publicStatus, publicStatusPending } = useProtocolClient();
  const reason = publicStatusPending
    ? "Refreshing"
    : applicationCopy.common.notObserved;
  const locked = publicStatus?.funds.liquidityLockedWeth;
  return (
    <Panel meta={<span>3.00%</span>} title={applicationCopy.home.feeRouting}>
      <DataList>
        {feeRows(publicStatus, reason).map((row) => (
          <DataRow
            key={row.label}
            label={`${row.label} · ${row.share}`}
            value={row.value}
          />
        ))}
        <DataRow
          label={applicationCopy.home.feeLocked}
          tone="live"
          value={wethOrUnavailable(locked, reason)}
        />
      </DataList>
      <p className="mt-3 text-caption text-ink-faint">
        {applicationCopy.home.feeRoutingNote}
      </p>
    </Panel>
  );
}

const trackIds = [1, 2, 3, 4] as const;

/** The four reward tracks and what each currently owes its holders. */
export function RewardTracksPanel() {
  const { publicStatus, publicStatusPending } = useProtocolClient();
  const reason = publicStatusPending
    ? "Refreshing"
    : applicationCopy.common.notObserved;
  return (
    <Panel
      meta={<span>{trackIds.length} tracks</span>}
      title={applicationCopy.home.rewardTracks}
    >
      <DataList>
        {trackIds.map((trackId) => {
          const label = identity.rewardTrackLabels[trackId];
          const liability =
            publicStatus?.rewardActivity.collectorLiability.find(
              (track) => track.track === label,
            )?.amount;
          return (
            <DataRow
              key={trackId}
              label={label}
              note={applicationCopy.home.rewardTrackLiability}
              value={
                liability === undefined ? (
                  <Unavailable reason={reason} />
                ) : (
                  <Amount unit={label} value={liability} />
                )
              }
            />
          );
        })}
      </DataList>
      <p className="mt-3 text-caption text-ink-faint">
        {applicationCopy.home.rewardTracksNote}
      </p>
    </Panel>
  );
}
