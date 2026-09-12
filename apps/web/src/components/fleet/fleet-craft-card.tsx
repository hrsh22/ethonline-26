import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { CraftArt } from "@/components/ui/craft-art";
import { FleetCraftArt } from "@/components/fleet/fleet-craft-art";
import { applicationCopy, identity } from "@/lib/identity";

/** Actual holdings evidence, shared by the selector and featured craft. */
export interface FleetCraft {
  readonly claimEligible: boolean;
  readonly claimEligibilityStatus?: "observed" | "unavailable";
  readonly specialKindCode?: "ordinary" | "basket" | "indicator";
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

export const trackIndexFor = (rewardTrack: string): number => {
  const index = identity.rewardTrackLabels.indexOf(rewardTrack);
  return index < 1 ? 1 : index;
};

export const fleetStateLabel = (craft: FleetCraft) =>
  craft.permanent ? craft.stateLabel : applicationCopy.fleet.filterGrounded;

/** B · Hangar: a framed object and a quiet, unboxed identity caption. */
export function FleetCraftCard({
  craft,
  returnTo = "/fleet",
}: {
  readonly craft: FleetCraft;
  readonly returnTo?: string;
}) {
  return (
    <article
      className="fleet-featured"
      data-permanent={craft.permanent || undefined}
      data-featured-craft
    >
      <div className="fleet-art-stage">
        {craft.identityId > 4440 ? (
          <CraftArt
            className="fleet-featured-art"
            decorative
            identityId={craft.identityId}
            kind="relic"
            lit={craft.permanent}
          />
        ) : (
          <FleetCraftArt
            className="fleet-featured-art"
            decorative
            identityId={craft.identityId}
            permanent={craft.permanent}
            rewardTrack={craft.rewardTrack}
          />
        )}
      </div>
      <div className="fleet-featured-info">
        <span className="fleet-state-badge">{fleetStateLabel(craft)}</span>
        <h2>#{String(craft.identityId).padStart(4, "0")}</h2>
        <p>
          {craft.rewardTrack} · {applicationCopy.craft.tier} {craft.rarityTier}
        </p>
        {craft.pendingRewardsStatus === "unavailable" ||
        craft.claimEligibilityStatus === "unavailable" ? (
          <p className="fleet-read-notice">
            {applicationCopy.rewards.readFailed}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {!craft.permanent ? (
            <ButtonLink
              href={`/fleet/${craft.identityId}?returnTo=${encodeURIComponent(returnTo)}#launch`}
              size="sm"
            >
              Review Launch
            </ButtonLink>
          ) : craft.claimEligible && craft.hasAttachedRewards ? (
            <ButtonLink href="/fleet?view=rewards" size="sm">
              Review rewards
            </ButtonLink>
          ) : null}
          <Link
            className="fleet-view-craft"
            href={`/fleet/${craft.identityId}?returnTo=${encodeURIComponent(returnTo)}`}
            aria-label={`Inspect ${craft.stateLabel} #${craft.identityId}`}
          >
            View craft
          </Link>
        </div>
      </div>
    </article>
  );
}
