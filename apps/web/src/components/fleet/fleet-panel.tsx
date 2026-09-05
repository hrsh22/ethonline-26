"use client";

import {
  COLLECTION_SIZE,
  ORDINARY_IDENTITY_COUNT,
  tierWeights,
} from "@orbit/config/collection-manifest";
import { useState } from "react";

import { blockedAccessMessage } from "@/components/access-notice";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { CollectibleExplorerLinks } from "@/components/fleet/collectible-explorer-links";
import {
  FleetCraftCard,
  type FleetCraft,
} from "@/components/fleet/fleet-craft-card";
import {
  StateFeedback,
  type StateFeedbackTone,
} from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { CraftArt, type CraftKind } from "@/components/ui/craft-art";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Amount, Count, Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type WalletRead = ProtocolClient["walletRead"];
type LoadedWalletRead = Extract<WalletRead, { readonly status: "loaded" }>;
type CollectionFilter = "all" | "transient" | "permanent";

const filterLabels: Record<CollectionFilter, string> = {
  all: applicationCopy.fleet.filterAll,
  transient: applicationCopy.fleet.grounded,
  permanent: applicationCopy.fleet.permanent,
};

const amountValue = (
  value: bigint | undefined,
  reason: string,
): React.ReactElement =>
  value === undefined ? (
    <Unavailable reason={reason} />
  ) : (
    <Amount minimumFractionDigits={4} value={value} />
  );

const countValue = (
  value: number | undefined,
  reason: string,
): React.ReactElement =>
  value === undefined ? (
    <Unavailable reason={reason} />
  ) : (
    <Count value={value} />
  );

/**
 * The connected summary.
 *
 * Only rendered for a loaded read, so the one value that can still be
 * unreadable is the permanent count when enumeration fell over. Every amount
 * is typeset from base units so the balance and the threshold round alike.
 */
function CollectionSummary({
  walletRead,
}: {
  readonly walletRead: LoadedWalletRead;
}) {
  const { collectibles, liquidToken } = walletRead.snapshot;
  const notObserved = applicationCopy.common.notObserved;
  return (
    <MetricGroup columns={6} label={applicationCopy.fleet.summaryLabel}>
      <Metric
        label={applicationCopy.fleet.tokenBalance}
        tone="live"
        value={amountValue(liquidToken.rawWei, notObserved)}
      />
      <Metric
        label={applicationCopy.fleet.nextThreshold}
        value={amountValue(
          liquidToken.nextDiscoveryDraw.thresholdWei,
          notObserved,
        )}
      />
      <Metric
        label={applicationCopy.fleet.remaining}
        value={amountValue(
          liquidToken.nextDiscoveryDraw.remainingWei,
          notObserved,
        )}
      />
      <Metric
        label={applicationCopy.fleet.grounded}
        value={countValue(collectibles.transient.length, notObserved)}
      />
      <Metric
        label={applicationCopy.fleet.permanent}
        value={
          collectibles.permanentHoldingsStatus === "unavailable" ? (
            <Unavailable reason={applicationCopy.fleet.partial} />
          ) : (
            countValue(collectibles.permanent.length, notObserved)
          )
        }
      />
      <Metric
        label={applicationCopy.fleet.pending}
        value={countValue(collectibles.pendingDiscovery.count, notObserved)}
      />
    </MetricGroup>
  );
}

function RetryAction({ onRetry }: { readonly onRetry: () => Promise<void> }) {
  return (
    <Button
      onClick={() => void onRetry()}
      size="sm"
      type="button"
      variant="outline"
    >
      {applicationCopy.access.retryWalletRead}
    </Button>
  );
}

/** Loading, failed, and blocked wallet reads each explain themselves. */
function UnloadedCollection({
  onRetry,
  walletRead,
}: {
  readonly onRetry: () => Promise<void>;
  readonly walletRead: Exclude<WalletRead, { readonly status: "loaded" }>;
}) {
  if (walletRead.status === "loading") {
    return (
      <StateFeedback
        description={applicationCopy.fleet.loading}
        title="Loading connected collection"
        tone="loading"
      />
    );
  }
  if (walletRead.status === "failed") {
    return (
      <StateFeedback
        action={<RetryAction onRetry={onRetry} />}
        description={applicationCopy.fleet.readFailed}
        title="Collection read failed"
        tone="error"
      />
    );
  }
  // A wallet on the wrong chain is connected. Naming the block "not
  // connected" and offering a connect button left it with no way forward.
  const blocked = blockedAccessMessage(walletRead.accessState);
  return (
    <StateFeedback
      action={
        blocked.connectable ? (
          <>
            <ConnectWalletAction />
            <ButtonLink href="/start" size="sm" variant="outline">
              {applicationCopy.fleet.connectAction}
            </ButtonLink>
          </>
        ) : undefined
      }
      description={
        blocked.connectable ? applicationCopy.fleet.connect : blocked.body
      }
      title={blocked.title}
      tone="blocked"
    />
  );
}

const sampleCraft: readonly {
  readonly detail: string;
  readonly identityId: number;
  readonly kind: CraftKind;
  readonly label: string;
  readonly track: number;
}[] = [
  {
    detail: applicationCopy.fleet.sampleTransient,
    identityId: 1204,
    kind: "transient",
    label: identity.terms.transientCollectible,
    track: 2,
  },
  {
    detail: applicationCopy.fleet.samplePermanent,
    identityId: 3340,
    kind: "permanent",
    label: identity.terms.permanentCollectible,
    track: 4,
  },
  {
    detail: applicationCopy.fleet.sampleRelic,
    identityId: 4442,
    kind: "relic",
    label: identity.terms.basketRelic,
    track: 1,
  },
];

/**
 * What the collection is, for a reader with no wallet: the public model as
 * a board, and one of each thing a collector can hold. Nothing here needs a
 * read, so nothing here can be a dash.
 */
function CollectionModel() {
  return (
    <>
      <MetricGroup columns={4} label={applicationCopy.fleet.modelLabel}>
        <Metric
          label={applicationCopy.fleet.modelIdentities}
          value={<Count value={COLLECTION_SIZE} />}
        />
        <Metric
          hint={identity.rewardTrackLabels.slice(1).join(" · ")}
          label={applicationCopy.fleet.modelTracks}
          value={<Count value={identity.rewardTrackLabels.length - 1} />}
        />
        <Metric
          hint={applicationCopy.fleet.modelRelicsHint}
          label={applicationCopy.fleet.modelRelics}
          value={<Count value={COLLECTION_SIZE - ORDINARY_IDENTITY_COUNT} />}
        />
        <Metric
          hint={applicationCopy.fleet.modelWeightsHint}
          label={applicationCopy.fleet.modelWeights}
          value={tierWeights.join(" / ")}
        />
      </MetricGroup>
      <Panel title={applicationCopy.fleet.sampleTitle}>
        <ul className="grid gap-3 compact:grid-cols-3">
          {sampleCraft.map((sample) => (
            <li
              className="flex min-w-0 flex-col items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-center"
              data-public-fleet-mark
              key={sample.identityId}
            >
              <CraftArt
                className="size-24 tablet:size-28"
                identityId={sample.identityId}
                kind={sample.kind}
                label={`${sample.label} example`}
                track={sample.track}
              />
              <Badge tone={sample.kind === "permanent" ? "live" : "neutral"}>
                {sample.label}
              </Badge>
              <p className="text-caption text-ink-soft">{sample.detail}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function EmptyCollection({
  holdingsIncomplete,
  onRetry,
}: {
  readonly holdingsIncomplete: boolean;
  readonly onRetry: () => Promise<void>;
}) {
  if (holdingsIncomplete) {
    return (
      <StateFeedback
        action={<RetryAction onRetry={onRetry} />}
        description={applicationCopy.fleet.partial}
        title="Collection is incomplete"
        tone="partial"
      />
    );
  }
  return (
    <StateFeedback
      // An empty collection is a task, not a dead end — and a wallet with
      // nothing to trade with starts at the faucet, not the market.
      action={
        <>
          <ButtonLink href="/exchange" size="sm">
            {applicationCopy.fleet.emptyAction}
          </ButtonLink>
          <ButtonLink href="/faucet" size="sm" variant="outline">
            {applicationCopy.fleet.emptyFaucetAction}
          </ButtonLink>
        </>
      }
      description={applicationCopy.fleet.empty}
      title="No collectibles yet"
      tone="empty"
    />
  );
}

function CollectionGrid({
  craft,
  filter,
}: {
  readonly craft: readonly FleetCraft[];
  readonly filter: CollectionFilter;
}) {
  if (craft.length === 0) {
    return (
      <StateFeedback
        compact
        description={applicationCopy.fleet.emptyFilter(filterLabels[filter])}
        title="Nothing matches this filter"
        tone="empty"
      />
    );
  }
  return (
    <ul className="grid gap-3 compact:grid-cols-2 laptop:grid-cols-3 nav:grid-cols-4">
      {craft.map((entry) => (
        <li className="flex" key={entry.identityId}>
          <FleetCraftCard craft={entry} />
        </li>
      ))}
    </ul>
  );
}

type PendingDiscovery =
  LoadedWalletRead["snapshot"]["collectibles"]["pendingDiscovery"];

interface PendingDiscoveryNoticeContent {
  readonly description: string;
  readonly title: string;
  readonly tone: StateFeedbackTone;
}

const readyDiscoveryDescription = (pending: PendingDiscovery): string => {
  const batch = pending.batch;
  return applicationCopy.fleet.discoveryReady(
    batch?.finalizedCount ?? 0,
    batch?.count ?? pending.count,
  );
};

const pendingDiscoveryNoticeContent = (
  pending: PendingDiscovery,
): PendingDiscoveryNoticeContent => {
  const notices = {
    complete: {
      description: applicationCopy.fleet.discoveryUnknown,
      title: applicationCopy.fleet.discoveryUnknownTitle,
      tone: "notice",
    },
    delayed: {
      description: applicationCopy.fleet.discoveryDelayed(pending.count),
      title: applicationCopy.fleet.discoveryDelayedTitle,
      tone: "stale",
    },
    finalizing: {
      description: readyDiscoveryDescription(pending),
      title: applicationCopy.fleet.discoveryReadyTitle,
      tone: "success",
    },
    "ready-for-finalization": {
      description: readyDiscoveryDescription(pending),
      title: applicationCopy.fleet.discoveryReadyTitle,
      tone: "success",
    },
    unknown: {
      description: applicationCopy.fleet.discoveryUnknown,
      title: applicationCopy.fleet.discoveryUnknownTitle,
      tone: "partial",
    },
    "waiting-for-randomness": {
      description: applicationCopy.fleet.discoveryWaiting(pending.count),
      title: applicationCopy.fleet.discoveryWaitingTitle,
      tone: "notice",
    },
  } as const satisfies Record<string, PendingDiscoveryNoticeContent>;
  return notices[pending.phase ?? "unknown"];
};

function PendingDiscoveryNotice({
  onRetry,
  pending,
}: {
  readonly onRetry: () => Promise<void>;
  readonly pending: PendingDiscovery;
}) {
  if (pending.count === 0) return null;
  const notice = pendingDiscoveryNoticeContent(pending);
  return (
    <StateFeedback
      action={<RetryAction onRetry={onRetry} />}
      description={notice.description}
      title={notice.title}
      tone={notice.tone}
    />
  );
}

const matchesFilter = (craft: FleetCraft, filter: CollectionFilter) =>
  filter === "all" || craft.permanent === (filter === "permanent");

function LoadedCollection({
  allCraft,
  filter,
  holdingsIncomplete,
  onFilter,
  onRetry,
}: {
  readonly allCraft: readonly FleetCraft[];
  readonly filter: CollectionFilter;
  readonly holdingsIncomplete: boolean;
  readonly onFilter: (filter: CollectionFilter) => void;
  readonly onRetry: () => Promise<void>;
}) {
  if (allCraft.length === 0) {
    return (
      <EmptyCollection
        holdingsIncomplete={holdingsIncomplete}
        onRetry={onRetry}
      />
    );
  }
  const countFor = (option: CollectionFilter) =>
    allCraft.filter((craft) => matchesFilter(craft, option)).length;

  return (
    <>
      {holdingsIncomplete ? (
        <StateFeedback
          action={<RetryAction onRetry={onRetry} />}
          description={applicationCopy.fleet.partial}
          title="Collection is incomplete"
          tone="partial"
        />
      ) : null}
      <SegmentedControl
        className="max-w-[40rem]"
        label={applicationCopy.fleet.filterLabel}
        onValueChange={onFilter}
        options={(["all", "transient", "permanent"] as const).map((option) => ({
          label: `${filterLabels[option]} (${countFor(option)})`,
          value: option,
        }))}
        value={filter}
      />
      <CollectionGrid
        craft={allCraft.filter((craft) => matchesFilter(craft, filter))}
        filter={filter}
      />
    </>
  );
}

const enrichCraft =
  (permanent: boolean, observedAt: number | undefined) =>
  (
    craft: LoadedWalletRead["snapshot"]["collectibles"]["transient"][number],
  ): FleetCraft => ({
    ...craft,
    hasAttachedRewards: craft.pendingRewards.some(
      (reward) => reward.rawTokenUnits > 0n,
    ),
    observedAt,
    permanent,
  });

function FleetReadContent({
  filter,
  onFilter,
  onRetry,
  walletRead,
}: {
  readonly filter: CollectionFilter;
  readonly onFilter: (filter: CollectionFilter) => void;
  readonly onRetry: () => Promise<void>;
  readonly walletRead: WalletRead;
}) {
  if (walletRead.status !== "loaded") {
    return (
      <>
        {walletRead.status === "blocked" ? <CollectionModel /> : null}
        <UnloadedCollection onRetry={onRetry} walletRead={walletRead} />
      </>
    );
  }
  const { collectibles, observedAt } = walletRead.snapshot;
  const allCraft: readonly FleetCraft[] = [
    ...collectibles.transient.map(enrichCraft(false, observedAt)),
    ...collectibles.permanent.map(
      enrichCraft(true, collectibles.permanentObservedAt ?? observedAt),
    ),
  ];
  return (
    <LoadedCollection
      allCraft={allCraft}
      filter={filter}
      holdingsIncomplete={
        collectibles.permanentHoldingsStatus === "unavailable"
      }
      onFilter={onFilter}
      onRetry={onRetry}
    />
  );
}

/**
 * The collection route.
 *
 * Holdings are the point of the route, so the cards come first and the
 * six-value summary follows them as a compact board.
 *
 * A pending Discovery leads, though. It is a live state with its own retry,
 * and it sat below every card: a wallet holding sixteen craft pushed it about
 * ten thousand pixels down a 375px viewport, out of reach of the reader it
 * was addressed to. Its sibling notice — an incomplete holdings read — already
 * leads the list for the same reason.
 */
export function FleetPanel() {
  const protocol = useProtocolClient();
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const walletRead = protocol.walletRead;

  return (
    <div className="mt-4 grid gap-3">
      {walletRead.status === "loaded" ? (
        <PendingDiscoveryNotice
          onRetry={protocol.refreshWallet}
          pending={walletRead.snapshot.collectibles.pendingDiscovery}
        />
      ) : null}
      <FleetReadContent
        filter={filter}
        onFilter={setFilter}
        onRetry={protocol.refreshWallet}
        walletRead={walletRead}
      />
      {walletRead.status === "loaded" ? (
        <CollectionSummary walletRead={walletRead} />
      ) : null}
      <CollectibleExplorerLinks />
    </div>
  );
}
