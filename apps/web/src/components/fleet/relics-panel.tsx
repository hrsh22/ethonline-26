"use client";

import Link from "next/link";

import { blockedAccessMessage } from "@/components/access-notice";
import { StateFeedback } from "@/components/state-feedback";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { RelicPreview } from "@/components/ui/craft-preview";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

/**
 * The collection defines three Basket Relic identities and one Indicator
 * Relic. Representing the baskets as a single concept hid two of them.
 */
const BASKET_RELIC_IDENTITY_IDS = [4441, 4442, 4443] as const;
const INDICATOR_RELIC_IDENTITY_ID = 4444;

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type WalletRead = ProtocolClient["walletRead"];
type Health = NonNullable<ProtocolClient["health"]>;

interface RelicIdentity {
  readonly allocation: string;
  readonly identityId: number;
  readonly kind: string;
  readonly role: string;
  readonly title: string;
}

/**
 * Only manifest facts: the identity number, which kind of relic it is, and
 * what that kind is owed per track. The collection defines no per-relic
 * attributes beyond those, so the card invents none.
 */
const relicIdentities: readonly RelicIdentity[] = [
  ...BASKET_RELIC_IDENTITY_IDS.map((identityId, index) => ({
    allocation: applicationCopy.relics.stationAllocation,
    identityId,
    kind: identity.terms.basketRelic,
    role: `${identity.terms.basketRelic} #${identityId}`,
    title: applicationCopy.relics.stationTitles[index] ?? "",
  })),
  {
    allocation: applicationCopy.relics.indicatorAllocation,
    identityId: INDICATOR_RELIC_IDENTITY_ID,
    kind: identity.terms.indicatorRelic,
    role: `${identity.terms.indicatorRelic} #${INDICATOR_RELIC_IDENTITY_ID}`,
    title: applicationCopy.relics.indicatorTitle,
  },
];

type OwnershipState = "held" | "not-held" | "unknown";

/**
 * Ownership is a wallet fact. While no wallet read has succeeded the card
 * must not claim eligibility for a wallet it cannot see.
 */
const ownershipFor = (
  walletRead: WalletRead,
  identityId: number,
): OwnershipState => {
  if (walletRead.status !== "loaded") return "unknown";
  const held = [
    ...walletRead.snapshot.collectibles.transient,
    ...walletRead.snapshot.collectibles.permanent,
  ].some((craft) => craft.identityId === identityId);
  return held
    ? "held"
    : walletRead.snapshot.collectibles.permanentHoldingsStatus === "complete"
      ? "not-held"
      : "unknown";
};

const ownership: Record<
  OwnershipState,
  { readonly badge: string; readonly label: string; readonly tone: BadgeTone }
> = {
  held: {
    badge: applicationCopy.relics.heldBadge,
    label: applicationCopy.relics.heldLabel,
    tone: "live",
  },
  "not-held": {
    badge: applicationCopy.relics.notHeldBadge,
    label: applicationCopy.relics.notHeld,
    tone: "neutral",
  },
  unknown: {
    badge: applicationCopy.relics.unknownBadge,
    label: applicationCopy.relics.ownershipUnknown,
    tone: "neutral",
  },
};

/**
 * Why ownership is still unknown.
 *
 * Every unread state used to say "Connect a wallet to check ownership", so a
 * wallet connected to the wrong chain, a loading read, and a failed read all
 * asked the reader to do something they had already done.
 */
const unknownOwnershipReason = (walletRead: WalletRead): string => {
  switch (walletRead.status) {
    case "loaded":
      return "Ownership is updating. Confirmed holdings remain visible.";
    case "loading":
      return applicationCopy.access.walletLoadingTitle;
    case "failed":
      return applicationCopy.access.walletFailedTitle;
    case "blocked": {
      const blocked = blockedAccessMessage(walletRead.accessState);
      return blocked.connectable
        ? applicationCopy.relics.ownershipUnknown
        : blocked.title;
    }
    default:
      return applicationCopy.relics.ownershipUnknown;
  }
};

/**
 * One relic: its own drawing, its number, what it is owed per track, and
 * whether this wallet holds it. A held relic takes the signal hairline
 * because live ownership is the one distinction here that is a fact.
 */
function RelicCard({
  relic,
  walletRead,
}: {
  readonly relic: RelicIdentity;
  readonly walletRead: WalletRead;
}) {
  const state = ownershipFor(walletRead, relic.identityId);
  const owned = ownership[state];
  const caption =
    state === "unknown" ? unknownOwnershipReason(walletRead) : owned.label;

  return (
    <article
      className={`flex w-full flex-col rounded-[var(--radius-surface)] border bg-surface-1 ${
        state === "held" ? "border-[var(--accent-border)]" : "border-line"
      }`}
      data-ownership={state}
      data-relic-card
      data-relic-role={relic.role}
    >
      <div className="border-b border-line bg-canvas">
        <RelicPreview identityId={relic.identityId} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono text-title-sm font-semibold">
            {relic.title}
          </h2>
          <span className="font-mono text-body-sm text-ink-faint tabular-nums">
            {applicationCopy.relics.identityNumber(relic.identityId)}
          </span>
        </div>
        <DataList>
          <DataRow label={applicationCopy.relics.kind} value={relic.kind} />
          <DataRow
            label={applicationCopy.relics.allocation}
            value={relic.allocation}
          />
          <DataRow
            label={applicationCopy.relics.ownership}
            tone={state === "held" ? "live" : "default"}
            value={<Badge tone={owned.tone}>{owned.badge}</Badge>}
          />
        </DataList>
        <p className="mt-auto text-caption text-ink-soft">{caption}</p>
        {state === "held" ? (
          <Link
            className="flex min-h-11 items-center font-mono text-body-sm font-semibold tracking-[0.06em] text-signal uppercase underline decoration-1 underline-offset-4 hover:text-ink"
            href={`/fleet/${relic.identityId}`}
          >
            {applicationCopy.relics.inspectIdentity(relic.identityId)}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function RelicNextAction({ walletRead }: { readonly walletRead: WalletRead }) {
  if (
    walletRead.status !== "loaded" ||
    walletRead.snapshot.collectibles.permanentHoldingsStatus !== "complete"
  )
    return null;
  const holdsRelic = relicIdentities.some(
    ({ identityId }) => ownershipFor(walletRead, identityId) === "held",
  );
  if (holdsRelic) return null;
  return (
    <StateFeedback
      action={
        <ButtonLink href="/exchange" size="sm">
          {applicationCopy.relics.noRelicAction}
        </ButtonLink>
      }
      description={applicationCopy.relics.noRelicBody}
      title={applicationCopy.relics.noRelicTitle}
      tone="empty"
    />
  );
}

/** The allocation, stated once, so each card can stay about its identity. */
function AllocationComparison() {
  return (
    <Panel title={applicationCopy.relics.comparisonTitle}>
      <DataList>
        <DataRow
          label={applicationCopy.relics.stationsTogether}
          value={applicationCopy.relics.stationsAllocation}
        />
        <DataRow
          label={identity.terms.indicatorRelic}
          value={applicationCopy.relics.indicatorAllocationLong}
        />
        <DataRow
          label={applicationCopy.relics.ordinaryLabel}
          value={applicationCopy.relics.ordinaryAllocation}
        />
      </DataList>
    </Panel>
  );
}

/** Live accounting status of each track, since a relic sits in all four. */
function TrackBoard({ health }: { readonly health: Health | undefined }) {
  return (
    <Panel
      meta={<span>{applicationCopy.relics.trackBoardMeta}</span>}
      title={applicationCopy.relics.fourTracks}
    >
      <p className="mb-3 text-caption text-ink-soft">
        {applicationCopy.relics.trackBoardDescription}
      </p>
      <DataList>
        {identity.rewardTrackLabels.slice(1).map((track, index) => {
          const liveTrack = health?.rewards.tracks[index];
          return (
            <DataRow
              key={track}
              label={track}
              value={
                liveTrack === undefined ? (
                  <Unavailable reason={applicationCopy.common.notObserved} />
                ) : (
                  <Badge>
                    {applicationCopy.status.accounting[liveTrack.status]}
                  </Badge>
                )
              }
            />
          );
        })}
      </DataList>
    </Panel>
  );
}

export function RelicsPanel() {
  const { walletRead, health } = useProtocolClient();

  return (
    <div className="mt-4 grid gap-3">
      <ul className="grid gap-3 compact:grid-cols-2 laptop:grid-cols-4">
        {relicIdentities.map((relic) => (
          <li className="flex" key={relic.identityId}>
            <RelicCard relic={relic} walletRead={walletRead} />
          </li>
        ))}
      </ul>
      <div className="grid gap-3 laptop:grid-cols-2">
        <AllocationComparison />
        <TrackBoard health={health} />
      </div>
      <RelicNextAction walletRead={walletRead} />
    </div>
  );
}
