import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CraftArt } from "@/components/ui/craft-art";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Amount, Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";

/** The fields a holding card presents, plus which side of the collection it came from. */
export interface FleetCraft {
  readonly claimEligible: boolean;
  readonly hasAttachedRewards: boolean;
  readonly identityId: number;
  readonly observedAt: number | undefined;
  readonly pendingRewards: readonly {
    readonly track: string;
    readonly rawTokenUnits: bigint;
  }[];
  readonly pendingRewardsStatus: "observed" | "unavailable";
  readonly permanent: boolean;
  readonly rarityTier: string;
  readonly rewardTrack: string;
  readonly rewardWeight: number;
  readonly stateLabel: string;
}

/**
 * The reward track as the art draws it.
 *
 * The reader labels a track with the identity's own track list, so the label's
 * position in that list is the track index the hull bands encode. A label the
 * list does not know draws as track one rather than as nothing.
 */
export const trackIndexFor = (rewardTrack: string): number => {
  const index = identity.rewardTrackLabels.indexOf(rewardTrack);
  return index < 1 ? 1 : index;
};

const observedTime = (timestamp: number): string =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1_000));

/**
 * A legitimate zero and unreadable evidence are different facts: the reader
 * substitutes zero when a per-identity read fails, so the status decides.
 */
const attachedRewardsValue = (craft: FleetCraft): React.ReactNode => {
  if (craft.pendingRewardsStatus === "unavailable") {
    return <Unavailable reason={applicationCopy.common.readFailed} />;
  }
  const attached = craft.pendingRewards.filter(
    (reward) => reward.rawTokenUnits > 0n,
  );
  if (attached.length === 0) return applicationCopy.craft.rewardsUnattached;
  return (
    <span className="flex flex-col items-end gap-0.5">
      {attached.map((reward) => (
        <Amount
          key={reward.track}
          unit={reward.track}
          value={reward.rawTokenUnits}
        />
      ))}
    </span>
  );
};

const consequence = (craft: FleetCraft): string => {
  if (!craft.permanent) return applicationCopy.craft.transientConsequence;
  if (craft.claimEligible) return applicationCopy.craft.rewardsReady;
  return craft.hasAttachedRewards
    ? applicationCopy.craft.rewardsAttached
    : applicationCopy.craft.rewardsNone;
};

/**
 * One holding in the collection.
 *
 * The craft leads at a size its hull and ports are legible; the number and
 * state sit on one line beneath, then the facts that decide what it earns.
 * An Orbiter is the lit one — the only orange on the card is the art and its
 * state token, because Launch is the one thing that has happened to it.
 */
export function FleetCraftCard({ craft }: { readonly craft: FleetCraft }) {
  return (
    <article
      className="group flex w-full flex-col rounded-[var(--radius-surface)] border border-line bg-surface-1 transition-colors duration-[var(--motion-fast)] hover:border-line-strong motion-reduce:transition-none"
      // A stable hook: permanence is an onchain fact worth asserting.
      data-permanent={craft.permanent || undefined}
    >
      <div className="flex items-center justify-center border-b border-line bg-canvas p-4">
        <CraftArt
          className="size-32"
          decorative
          identityId={craft.identityId}
          kind={craft.permanent ? "permanent" : "transient"}
          track={trackIndexFor(craft.rewardTrack)}
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* A collectible is a top-level item on the collection page, so it
              is an h2 under the page heading. */}
          <h2 className="font-mono text-title font-semibold tabular-nums">
            #{String(craft.identityId).padStart(4, "0")}
          </h2>
          <Badge dot tone={craft.permanent ? "live" : "neutral"}>
            {craft.stateLabel}
          </Badge>
        </div>
        <DataList>
          <DataRow
            label={applicationCopy.craft.track}
            value={craft.rewardTrack}
          />
          <DataRow
            label={applicationCopy.craft.tier}
            value={craft.rarityTier}
          />
          <DataRow
            label={applicationCopy.craft.weight}
            value={<span>{craft.rewardWeight}&times;</span>}
          />
          <DataRow
            label={applicationCopy.craft.attachedRewards}
            value={attachedRewardsValue(craft)}
          />
        </DataList>
        <p className="text-body-sm text-ink-soft">{consequence(craft)}</p>
        <p className="mt-auto font-mono text-caption text-ink-faint">
          {applicationCopy.craft.lastConfirmed}{" "}
          {craft.observedAt === undefined ? (
            applicationCopy.craft.lastConfirmedSnapshot
          ) : (
            <time dateTime={new Date(craft.observedAt * 1_000).toISOString()}>
              {observedTime(craft.observedAt)} UTC
            </time>
          )}
        </p>
        <Link
          className="flex min-h-11 items-center font-mono text-body-sm font-semibold tracking-[0.06em] text-signal uppercase underline decoration-1 underline-offset-4 hover:text-ink"
          href={`/fleet/${craft.identityId}`}
        >
          {applicationCopy.fleet.inspect(craft.stateLabel)}
        </Link>
      </div>
    </article>
  );
}
