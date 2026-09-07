"use client";

import {
  COLLECTION_SIZE,
  ORDINARY_IDENTITY_COUNT,
  tierWeights,
} from "@orbit/config/collection-manifest";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { DiscoveryOutcomes } from "@/components/fleet/discovery-outcomes";
import { DiscoveryProgress } from "@/components/fleet/discovery-progress";
import { CollectorNextAction } from "@/components/start/collector-next-action";
import { createCollectorJourneyView } from "@/lib/collector-journey";

import { blockedAccessMessage } from "@/components/access-notice";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { CollectibleExplorerLinks } from "@/components/fleet/collectible-explorer-links";
import {
  FleetCraftCard,
  type FleetCraft,
} from "@/components/fleet/fleet-craft-card";
import { StateFeedback } from "@/components/state-feedback";
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

interface FleetFilters {
  readonly state: CollectionFilter;
  readonly id: string;
  readonly track: string;
  readonly rewards: "all" | "claimable" | "updating";
  readonly page: number;
}
const DEFAULT_FILTERS: FleetFilters = {
  state: "all",
  id: "",
  track: "all",
  rewards: "all",
  page: 1,
};
const filterId = (id: string): string =>
  /^\d{1,4}$/.test(id) && Number(id) >= 1 && Number(id) <= 4444 ? id : "";
const filterPage = (page: number): number =>
  Number.isInteger(page) && page >= 1 && page <= 186 ? page : 1;
const readFilters = (params: Pick<URLSearchParams, "get">): FleetFilters => {
  const state = params.get("state");
  const rewards = params.get("rewards");
  const track = params.get("track") ?? "all";
  const id = params.get("id") ?? "";
  const page = Number(params.get("page") ?? "1");
  return {
    state: state === "transient" || state === "permanent" ? state : "all",
    rewards:
      rewards === "claimable" || rewards === "updating" ? rewards : "all",
    track: identity.rewardTrackLabels.includes(track) ? track : "all",
    id: filterId(id),
    page: filterPage(page),
  };
};

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
 * is typeset from base units; the remaining requirement rounds upward.
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
        value={
          <Amount
            minimumFractionDigits={4}
            rounding="ceil"
            value={liquidToken.nextDiscoveryDraw.remainingWei}
          />
        }
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
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Button
      disabled={refreshing}
      onClick={async () => {
        setRefreshing(true);
        try {
          await onRetry();
        } finally {
          setRefreshing(false);
        }
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {refreshing ? "Refreshing…" : applicationCopy.access.retryWalletRead}
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
        title="Your collection is temporarily unavailable"
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
      tone={blocked.tone}
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
}: {
  readonly holdingsIncomplete: boolean;
}) {
  if (holdingsIncomplete) {
    return (
      <StateFeedback
        description={applicationCopy.fleet.partial}
        title="Updating your collection"
        tone="partial"
      />
    );
  }
  return (
    <StateFeedback
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

const matchesFilter = (craft: FleetCraft, filter: CollectionFilter) =>
  filter === "all" || craft.permanent === (filter === "permanent");

const rewardsUpdating = (craft: FleetCraft) =>
  craft.pendingRewardsStatus === "unavailable" ||
  craft.claimEligibilityStatus === "unavailable";
const matchesRewards = (craft: FleetCraft, filter: FleetFilters["rewards"]) =>
  filter === "all" ||
  (filter === "updating"
    ? rewardsUpdating(craft)
    : craft.permanent &&
      !rewardsUpdating(craft) &&
      craft.claimEligible &&
      craft.hasAttachedRewards);
const matchesTrack = (craft: FleetCraft, track: string) =>
  track === "all" ||
  craft.rewardTrack === track ||
  craft.specialKindCode === "basket" ||
  craft.specialKindCode === "indicator";

function LoadedCollection({
  allCraft,
  filters,
  holdingsIncomplete,
  onFilters,
}: {
  readonly allCraft: readonly FleetCraft[];
  readonly filters: FleetFilters;
  readonly holdingsIncomplete: boolean;
  readonly onFilters: (filters: FleetFilters) => void;
}) {
  if (allCraft.length === 0)
    return <EmptyCollection holdingsIncomplete={holdingsIncomplete} />;
  const countFor = (option: CollectionFilter) =>
    allCraft.filter((craft) => matchesFilter(craft, option)).length;
  const matching = allCraft.filter(
    (craft) =>
      matchesFilter(craft, filters.state) &&
      matchesTrack(craft, filters.track) &&
      matchesRewards(craft, filters.rewards) &&
      (filters.id === "" ||
        String(craft.identityId) === String(Number(filters.id))),
  );
  const limit = filters.page * 24;
  const change = (update: Partial<FleetFilters>) =>
    onFilters({ ...filters, ...update, page: 1 });
  const controlClass =
    "min-h-11 min-w-0 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-[16px] text-ink";
  return (
    <>
      {holdingsIncomplete ? (
        <StateFeedback
          description={applicationCopy.fleet.partial}
          title="Updating your collection"
          tone="partial"
        />
      ) : null}
      <SegmentedControl
        className="max-w-[40rem]"
        label={applicationCopy.fleet.filterLabel}
        onValueChange={(state: CollectionFilter) => change({ state })}
        options={(["all", "transient", "permanent"] as const).map((option) => ({
          label: `${filterLabels[option]} (${countFor(option)})`,
          value: option,
        }))}
        value={filters.state}
      />
      <div className="grid min-w-0 grid-cols-1 gap-3 tablet:grid-cols-3">
        <label className="grid min-w-0 grid-cols-1 gap-1 text-body-sm">
          Identity number
          <input
            aria-label="Find a held identity"
            className={controlClass}
            inputMode="numeric"
            maxLength={4}
            placeholder="e.g. 1639"
            value={filters.id}
            onChange={(event) => change({ id: event.target.value })}
          />
        </label>
        <label className="grid min-w-0 grid-cols-1 gap-1 text-body-sm">
          Reward Track
          <select
            aria-label="Filter Reward Track"
            className={controlClass}
            value={filters.track}
            onChange={(event) => change({ track: event.target.value })}
          >
            <option value="all">All tracks</option>
            {identity.rewardTrackLabels.slice(1).map((track) => (
              <option key={track} value={track}>
                {track}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 grid-cols-1 gap-1 text-body-sm">
          Rewards
          <select
            aria-label="Filter rewards"
            className={controlClass}
            value={filters.rewards}
            onChange={(event) =>
              change({ rewards: event.target.value as FleetFilters["rewards"] })
            }
          >
            <option value="all">All rewards</option>
            <option value="claimable">Claimable</option>
            <option value="updating">Still updating</option>
          </select>
        </label>
      </div>
      {filters.rewards === "claimable" && allCraft.some(rewardsUpdating) ? (
        <p className="text-body-sm text-ink-soft">
          Some rewards are still updating and are excluded from this filter.
          Choose Still updating to see those identities.
        </p>
      ) : null}
      <p className="text-caption text-ink-soft" role="status">
        Showing {Math.min(limit, matching.length)} of {matching.length} matching
        confirmed collectibles.
      </p>
      <CollectionGrid craft={matching.slice(0, limit)} filter={filters.state} />
      {limit < matching.length ? (
        <Button
          variant="outline"
          onClick={() => onFilters({ ...filters, page: filters.page + 1 })}
        >
          Show more collectibles
        </Button>
      ) : null}
      {filters.state !== "all" ||
      filters.id !== "" ||
      filters.track !== "all" ||
      filters.rewards !== "all" ? (
        <Button variant="ghost" onClick={() => onFilters(DEFAULT_FILTERS)}>
          Clear filters
        </Button>
      ) : null}
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
  filters,
  onFilters,
  onRetry,
  walletRead,
}: {
  readonly filters: FleetFilters;
  readonly onFilters: (filters: FleetFilters) => void;
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
  if (
    allCraft.length === 0 &&
    collectibles.pendingDiscovery.count > 0 &&
    collectibles.permanentHoldingsStatus !== "unavailable"
  )
    return null;
  return (
    <LoadedCollection
      allCraft={allCraft}
      filters={filters}
      holdingsIncomplete={
        collectibles.permanentHoldingsStatus === "unavailable"
      }
      onFilters={onFilters}
    />
  );
}

/**
 * The collection route.
 *
 * Holdings are the point of the route, so the cards come first and the
 * six-value summary follows them as a compact board.
 *
 * A pending Discovery leads so its progress stays visible above the cards.
 */
function FleetContent() {
  const protocol = useProtocolClient();
  const params = useSearchParams();
  const [selection, setSelection] = useState(() => ({
    scope: protocol.address,
    filters: readFilters(params ?? new URLSearchParams()),
  }));
  const filters =
    selection.scope === protocol.address ? selection.filters : DEFAULT_FILTERS;
  const onFilters = (next: FleetFilters) => {
    setSelection({ scope: protocol.address, filters: next });
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value === DEFAULT_FILTERS[key as keyof FleetFilters])
        url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    window.history.replaceState(window.history.state, "", url);
  };
  useEffect(() => {
    const restore = () =>
      setSelection({
        scope: protocol.address,
        filters: readFilters(new URLSearchParams(window.location.search)),
      });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [protocol.address]);
  const walletRead = protocol.walletRead;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <div id="discovery-outcomes">
        <DiscoveryOutcomes />
      </div>
      {walletRead.status === "loaded" && walletRead.stale === true ? (
        <StateFeedback
          title="Connection interrupted"
          description="Showing your last verified collection while we reconnect. Ownership and rewards must refresh before any wallet action."
          tone="stale"
        />
      ) : null}
      {walletRead.status === "loaded" ? (
        <DiscoveryProgress
          observedAt={walletRead.snapshot.observedAt}
          pending={walletRead.snapshot.collectibles.pendingDiscovery}
        />
      ) : null}
      <div className="grid min-h-[32rem] min-w-0 grid-cols-1 content-start gap-3">
        {walletRead.status === "loaded" ? (
          <CollectorNextAction
            journey={createCollectorJourneyView({
              accessState: protocol.accessState,
              walletRead,
              nativeBalanceWei:
                protocol.nativeBalanceRead?.status === "loaded"
                  ? protocol.nativeBalanceRead.balance.rawWei
                  : undefined,
            })}
            returnTo="/fleet"
          />
        ) : null}
        <FleetReadContent
          filters={filters}
          onFilters={onFilters}
          onRetry={protocol.refreshWallet}
          walletRead={walletRead}
        />
        {walletRead.status === "loaded" ? (
          <CollectionSummary walletRead={walletRead} />
        ) : null}
      </div>
      <CollectibleExplorerLinks />
    </div>
  );
}

export function FleetPanel() {
  return (
    <div className="mt-4 min-h-[32rem]">
      <Suspense
        fallback={
          <StateFeedback
            title="Loading collection"
            description="Restoring your Fleet view."
            tone="loading"
          />
        }
      >
        <FleetContent />
      </Suspense>
    </div>
  );
}
