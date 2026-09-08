"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { DiscoveryOutcomes } from "@/components/fleet/discovery-outcomes";
import { DiscoveryProgress } from "@/components/fleet/discovery-progress";
import { blockedAccessMessage } from "@/components/access-notice";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { CollectibleExplorerLinks } from "@/components/fleet/collectible-explorer-links";
import type { FleetCraft } from "@/components/fleet/fleet-craft-card";
import { FleetHangar } from "@/components/fleet/fleet-hangar";
import { StateFeedback } from "@/components/state-feedback";
import { Button, ButtonLink } from "@/components/ui/button";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Amount, Count, Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";
import { useWalletSession } from "@/providers/wallet-session";

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
  readonly selected: string;
}
const DEFAULT_FILTERS: FleetFilters = {
  state: "all",
  id: "",
  track: "all",
  rewards: "all",
  page: 1,
  selected: "",
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
    selected: filterId(params.get("selected") ?? ""),
  };
};

const filterLabels: Record<CollectionFilter, string> = {
  all: applicationCopy.fleet.filterAll,
  transient: applicationCopy.fleet.filterGrounded,
  permanent: "Orbiters",
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
 * unreadable is the permanent count when enumeration fell over. The summary
 * states balances and holdings only; it does not manufacture a next goal.
 */
function CollectionSummary({
  walletRead,
}: {
  readonly walletRead: LoadedWalletRead;
}) {
  const { collectibles, liquidToken } = walletRead.snapshot;
  const notObserved = applicationCopy.common.notObserved;
  return (
    <MetricGroup columns={4} label={applicationCopy.fleet.summaryLabel}>
      <Metric
        label={applicationCopy.fleet.tokenBalance}
        tone="live"
        value={amountValue(liquidToken.rawWei, notObserved)}
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
  const session = useWalletSession();
  if (
    walletRead.status === "blocked" &&
    walletRead.accessState === "disconnected" &&
    (!session.ready || session.connecting)
  ) {
    return (
      <StateFeedback
        title="Connecting wallet"
        description="Waiting for the wallet connection to finish."
        tone="loading"
      />
    );
  }
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
  if (blocked.connectable) {
    return (
      <section
        className="fleet-empty"
        data-state={blocked.tone}
        role="status"
        aria-live="polite"
      >
        <h2 className="sr-only">{blocked.title}</h2>
        <p>Connect a wallet to see your craft and rewards.</p>
        <ConnectWalletAction />
      </section>
    );
  }
  return (
    <StateFeedback
      description={blocked.body}
      title={blocked.title}
      tone={blocked.tone}
    />
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
    <section className="fleet-empty">
      <h2>No craft in your fleet.</h2>
      <p>Your collected craft appear here.</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/explore" size="sm">
          Explore craft
        </ButtonLink>
        <ButtonLink href="/exchange" size="sm" variant="outline">
          Trade FUEL
        </ButtonLink>
      </div>
    </section>
  );
}

function CollectionHangar({
  craft,
  filter,
  returnTo,
  selectedId,
  onSelect,
}: {
  readonly craft: readonly FleetCraft[];
  readonly filter: CollectionFilter;
  readonly returnTo: string;
  readonly selectedId: string;
  readonly onSelect: (identityId: number) => void;
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
    <FleetHangar
      craft={craft}
      returnTo={returnTo}
      selectedId={selectedId}
      onSelect={onSelect}
    />
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

const claimableRewards = (craft: readonly FleetCraft[]) => {
  const claimable = new Map<string, bigint>();
  for (const entry of craft) {
    if (rewardsUpdating(entry)) continue;
    if (!entry.permanent || !entry.claimEligible) continue;
    for (const reward of entry.pendingRewards) {
      if (reward.rawTokenUnits <= 0n) continue;
      claimable.set(
        reward.track,
        (claimable.get(reward.track) ?? 0n) + reward.rawTokenUnits,
      );
    }
  }
  return { claimable, updating: craft.some(rewardsUpdating) };
};

function ClaimableAmounts({
  claimable,
  updating,
}: {
  readonly claimable: ReadonlyMap<string, bigint>;
  readonly updating: boolean;
}) {
  if (claimable.size === 0) {
    return (
      <p className="mt-1 text-body-sm text-ink-soft">
        Claimable amounts are not shown until the required reads complete.
      </p>
    );
  }
  return (
    <>
      <div className="fleet-reward-values">
        {[...claimable].map(([track, rawTokenUnits]) => (
          <Amount key={track} unit={track} value={rawTokenUnits} />
        ))}
      </div>
      {updating ? (
        <p className="mt-1 text-caption text-ink-soft">
          Additional craft rewards are still updating.
        </p>
      ) : null}
    </>
  );
}

function ClaimShortcut({
  craft,
  returnTo,
}: {
  readonly craft: readonly FleetCraft[];
  readonly returnTo: string;
}) {
  const { claimable, updating } = claimableRewards(craft);
  if (claimable.size === 0 && !updating) return null;
  const rewardParams = new URLSearchParams(returnTo.split("?")[1]);
  rewardParams.set("view", "rewards");
  return (
    <section
      aria-labelledby="fleet-rewards-shortcut"
      className="fleet-reward-strip"
    >
      <div className="min-w-0">
        <h2 className="fleet-reward-heading" id="fleet-rewards-shortcut">
          {claimable.size === 0 ? "Rewards are updating" : "Rewards available"}
        </h2>
        <ClaimableAmounts claimable={claimable} updating={updating} />
      </div>
      <ButtonLink href={`/fleet?${rewardParams}`} size="sm" variant="outline">
        Review claims
      </ButtonLink>
    </section>
  );
}

const collectionReturnTo = (filters: FleetFilters): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== DEFAULT_FILTERS[key as keyof FleetFilters]) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === "" ? "/fleet" : `/fleet?${search}`;
};

const hasAdvancedFilters = (filters: FleetFilters) =>
  filters.id !== "" ||
  filters.track !== "all" ||
  filters.rewards !== "all" ||
  undefined;

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
      <ClaimShortcut craft={allCraft} returnTo={collectionReturnTo(filters)} />
      <div className="fleet-toolbar">
        <div
          className="fleet-filters"
          role="group"
          aria-label={applicationCopy.fleet.filterLabel}
        >
          {(["all", "transient", "permanent"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="fleet-filter"
              aria-pressed={filters.state === option}
              onClick={() => change({ state: option })}
            >
              {filterLabels[option]} {countFor(option)}
            </button>
          ))}
        </div>
        <details
          className="fleet-advanced-filters"
          open={hasAdvancedFilters(filters)}
        >
          <summary
            aria-label="Filter and search"
            className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-end gap-2 py-3 text-body-sm text-ink-soft"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            <span className="hidden tablet:inline">Filter and search</span>
          </summary>
          <div className="grid min-w-0 grid-cols-1 gap-3 pb-3 tablet:grid-cols-3">
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
                  change({
                    rewards: event.target.value as FleetFilters["rewards"],
                  })
                }
              >
                <option value="all">All rewards</option>
                <option value="claimable">Claimable</option>
                <option value="updating">Still updating</option>
              </select>
            </label>
          </div>
        </details>
      </div>
      {filters.rewards === "claimable" && allCraft.some(rewardsUpdating) ? (
        <p className="text-body-sm text-ink-soft">
          Some rewards are still updating and are excluded from this filter.
          Choose Still updating to see those identities.
        </p>
      ) : null}
      <p className="sr-only" role="status">
        Showing {Math.min(limit, matching.length)} of {matching.length} matching
        confirmed collectibles.
      </p>
      <CollectionHangar
        craft={matching.slice(0, limit)}
        filter={filters.state}
        returnTo={collectionReturnTo(filters)}
        selectedId={filters.selected}
        onSelect={(identityId) =>
          onFilters({ ...filters, selected: String(identityId) })
        }
      />
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
    return <UnloadedCollection onRetry={onRetry} walletRead={walletRead} />;
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
 * compact balance-and-holdings summary follows them as a quiet fact board.
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
      {walletRead.status === "loaded" && walletRead.stale === true ? (
        <StateFeedback
          title="Connection interrupted"
          description="Showing your last verified collection while we reconnect. Ownership and rewards must refresh before any wallet action."
          tone="stale"
        />
      ) : null}
      <div className="fleet-collection-content min-h-[32rem] min-w-0">
        <FleetReadContent
          filters={filters}
          onFilters={onFilters}
          onRetry={protocol.refreshWallet}
          walletRead={walletRead}
        />
        {walletRead.status === "loaded" ? (
          <DiscoveryProgress
            observedAt={walletRead.snapshot.observedAt}
            pending={walletRead.snapshot.collectibles.pendingDiscovery}
          />
        ) : null}
        {walletRead.status === "loaded" ? (
          <details className="mt-5">
            <summary className="min-h-11 cursor-pointer py-3 text-body-sm text-ink-soft">
              Collection details
            </summary>
            <CollectionSummary walletRead={walletRead} />
            <CollectibleExplorerLinks />
          </details>
        ) : null}
      </div>
      <div id="discovery-outcomes" className="empty:hidden">
        <DiscoveryOutcomes />
      </div>
    </div>
  );
}

export function FleetPanel() {
  return (
    <div className="fleet-panel min-h-[32rem]">
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
