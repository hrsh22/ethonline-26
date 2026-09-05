"use client";

import type { CanonicalMarketHistorySnapshot } from "@orbit/protocol/market-history";
import { useState, useSyncExternalStore } from "react";

import { ChartFrame } from "@/components/market/chart-frame";
import {
  continuousCandlesInRange,
  CANDLE_RANGES,
  type CandleRangeKey,
  MarketCandlestickChart,
  displayMarketTime,
} from "@/components/market/market-candlestick-chart";
import {
  derivePoolGrowthPoints,
  PoolGrowthChart,
  type PoolGrowthPoint,
} from "@/components/market/pool-growth-chart";
import { StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Amount, Rate, Unavailable } from "@/components/ui/value";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import type { IndexedMarketHistoryRead } from "@/lib/market-history-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";

const basescanRoots: Partial<Record<number, string>> = {
  8_453: "https://basescan.org",
  84_532: "https://sepolia.basescan.org",
};

const display = (value: string | bigint | number | undefined) =>
  value === undefined ? applicationCopy.common.notObserved : String(value);

const sumObserved = (
  values: readonly (bigint | undefined)[],
): bigint | undefined => {
  if (values.some((value) => value === undefined)) return undefined;
  return values.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);
};

const poolManagerUrl = () => {
  const explorerRoot = basescanRoots[deploymentEnvironment.chainId];
  if (explorerRoot === undefined || protocolDeploymentManifest === undefined) {
    return undefined;
  }
  return `${explorerRoot}/address/${protocolDeploymentManifest.contracts.uniswapV4PoolManager}`;
};

const canonicalPoolId = (fallback?: string) =>
  protocolDeploymentManifest?.canonicalPool.poolId ?? display(fallback);

const noTimeZoneUpdates = () => () => undefined;
const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverTimeZone = () => "UTC";

/** Keep server markup deterministic, then adopt the viewer's time zone. */
const useDisplayTimeZone = () =>
  useSyncExternalStore(noTimeZoneUpdates, browserTimeZone, serverTimeZone);

type HealthSnapshot = ReturnType<typeof useProtocolClient>["health"];
type LoadedHealthSnapshot = NonNullable<HealthSnapshot>;
type PublicStatus = ReturnType<typeof useProtocolClient>["publicStatus"];
type ConfirmedHistory = Extract<
  IndexedMarketHistoryRead,
  { readonly status: "loaded" | "stale" }
>;

interface MarketMetric {
  readonly label: string;
  readonly unit: string;
  /** A price keeps significant digits; a balance keeps a fixed fraction. */
  readonly kind: "amount" | "rate";
  readonly wei: bigint | undefined;
  readonly hint?: string;
  readonly tone?: "live";
}

interface FeeRoute {
  readonly label: string;
  readonly share: string;
  readonly wei: bigint | undefined;
}

export interface MarketDashboardModel {
  readonly activeLiquidity: string;
  readonly poolManagerUrl: string | undefined;
  readonly metrics: readonly MarketMetric[];
  readonly feeRoutes: readonly FeeRoute[];
  readonly poolId: string;
  readonly observedBlock: string;
  readonly growthPoints: readonly PoolGrowthPoint[];
  readonly candles: CanonicalMarketHistorySnapshot["candles"];
  readonly candleInterval: CanonicalMarketHistorySnapshot["interval"];
  readonly candleSource: CanonicalMarketHistorySnapshot["candleSource"];
  readonly feeMatchingState: CanonicalMarketHistorySnapshot["feeMatching"]["state"];
}

export const deriveMarketBalances = (health: LoadedHealthSnapshot) => {
  const rewardsWaiting = sumObserved([
    health.market.rewardPotWeth,
    ...health.operations.trackQueues.map((queue) => queue.weth),
  ]);
  const liquidityWaiting = sumObserved([
    health.market.liquidityPotWeth,
    health.operations.protocolOwnedLiquidity.queuedWeth,
  ]);
  return {
    creatorWaiting: health.market.creatorPotWeth,
    liquidityTotal: sumObserved([
      liquidityWaiting,
      health.operations.protocolOwnedLiquidity.permanentlyLockedWeth,
    ]),
    liquidityWaiting,
    rewardsWaiting,
  } as const;
};

const confirmedHistorySnapshot = (history: IndexedMarketHistoryRead) =>
  history.status === "loaded" || history.status === "stale"
    ? history.snapshot
    : undefined;

const candleSourceFrom = (
  snapshot: CanonicalMarketHistorySnapshot | undefined,
): CanonicalMarketHistorySnapshot["candleSource"] =>
  snapshot?.candleSource ?? {
    kind: "indexed-history",
    state: "partial",
    indexedThroughBlock: undefined,
  };

const candleIntervalFrom = (
  snapshot: CanonicalMarketHistorySnapshot | undefined,
): CanonicalMarketHistorySnapshot["interval"] => snapshot?.interval ?? "1m";

const latestIndexedPrice = (
  snapshot: CanonicalMarketHistorySnapshot | undefined,
): bigint | undefined =>
  snapshot?.candles
    .filter((candle) => candle.closeWethPerLiquidTokenX18 !== undefined)
    .at(-1)?.closeWethPerLiquidTokenX18;

interface Balances {
  readonly creatorWaiting: bigint | undefined;
  readonly liquidityLocked: bigint | undefined;
  readonly liquidityTotal: bigint | undefined;
  readonly liquidityWaiting: bigint | undefined;
  readonly rewardsWaiting: bigint | undefined;
}

/** The strip's four balance cells; the price is either live or last indexed. */
const balanceMetrics = (
  price: { readonly wei: bigint | undefined; readonly hint: string },
  balances: Balances,
  observedBlock: string,
): readonly MarketMetric[] => {
  const blockHint = `Block ${observedBlock}`;
  return [
    {
      label: applicationCopy.exchange.price,
      unit: `WETH / ${applicationCopy.exchange.token}`,
      kind: "rate",
      wei: price.wei,
      hint: price.hint,
      tone: "live",
    },
    {
      label: applicationCopy.exchange.rewardsWaiting,
      unit: "WETH",
      kind: "amount",
      wei: balances.rewardsWaiting,
      hint: blockHint,
    },
    {
      label: applicationCopy.exchange.liquidityTotal,
      unit: "WETH",
      kind: "amount",
      wei: balances.liquidityTotal,
      hint: blockHint,
    },
    {
      label: applicationCopy.exchange.creatorWaiting,
      unit: "WETH",
      kind: "amount",
      wei: balances.creatorWaiting,
      hint: blockHint,
    },
  ];
};

const feeRoutesFor = (balances: Balances): readonly FeeRoute[] => [
  {
    label: applicationCopy.exchange.rewardFee,
    share: "2.00%",
    wei: balances.rewardsWaiting,
  },
  {
    label: applicationCopy.exchange.liquidityFee,
    share: "0.85%",
    wei: balances.liquidityWaiting,
  },
  {
    label: applicationCopy.exchange.creatorFee,
    share: "0.15%",
    wei: balances.creatorWaiting,
  },
  {
    label: applicationCopy.market.lockedRow,
    share: applicationCopy.market.lockedShare,
    wei: balances.liquidityLocked,
  },
];

const publicBalances = (publicStatus: PublicStatus): Balances => {
  if (publicStatus === undefined) {
    return {
      creatorWaiting: undefined,
      liquidityLocked: undefined,
      liquidityTotal: undefined,
      liquidityWaiting: undefined,
      rewardsWaiting: undefined,
    };
  }
  const funds = publicStatus.funds;
  return {
    creatorWaiting: funds.creatorWeth,
    liquidityLocked: funds.liquidityLockedWeth,
    liquidityTotal: sumObserved([
      funds.liquidityWaitingWeth,
      funds.liquidityLockedWeth,
    ]),
    liquidityWaiting: funds.liquidityWaitingWeth,
    rewardsWaiting: funds.rewardWethWaiting,
  };
};

const unavailableModel = (
  history: IndexedMarketHistoryRead,
  publicStatus: PublicStatus,
): MarketDashboardModel => {
  const snapshot = confirmedHistorySnapshot(history);
  const balances = publicBalances(publicStatus);
  const observedBlock = display(
    publicStatus?.observedBlock ?? snapshot?.status.observedBlock,
  );
  return {
    activeLiquidity: applicationCopy.common.notObserved,
    poolManagerUrl: poolManagerUrl(),
    metrics: balanceMetrics(
      {
        wei: latestIndexedPrice(snapshot),
        hint: applicationCopy.market.indexedPriceHint,
      },
      balances,
      observedBlock,
    ),
    feeRoutes: feeRoutesFor(balances),
    poolId: canonicalPoolId(),
    observedBlock,
    growthPoints: derivePoolGrowthPoints({
      cycles: snapshot?.liquidityCycles ?? [],
      currentLockedWeth: balances.liquidityLocked,
      pendingWeth: balances.liquidityWaiting,
    }),
    candles: snapshot?.candles ?? [],
    candleInterval: candleIntervalFrom(snapshot),
    candleSource: candleSourceFrom(snapshot),
    feeMatchingState: snapshot?.feeMatching.state ?? "partial",
  };
};

const loadedModel = (
  health: LoadedHealthSnapshot,
  history: IndexedMarketHistoryRead,
): MarketDashboardModel => {
  const derived = deriveMarketBalances(health);
  const balances: Balances = {
    ...derived,
    liquidityLocked:
      health.operations.protocolOwnedLiquidity.permanentlyLockedWeth,
  };
  const snapshot = confirmedHistorySnapshot(history);
  // Only a fully loaded index may project the live queue; a partial one would
  // read as an observed zero.
  const liveQueue =
    history.status === "loaded"
      ? {
          currentLockedWeth: balances.liquidityLocked,
          pendingWeth: balances.liquidityWaiting,
        }
      : { currentLockedWeth: undefined, pendingWeth: undefined };
  const livePrice = health.market.price?.wethPerLiquidTokenWei;
  const observedBlock = display(health.deployment.observedBlock);
  return {
    activeLiquidity: display(health.market.activeLiquidity),
    poolManagerUrl: poolManagerUrl(),
    metrics: balanceMetrics(
      livePrice === undefined
        ? {
            wei: latestIndexedPrice(snapshot),
            hint: applicationCopy.market.indexedPriceHint,
          }
        : { wei: livePrice, hint: applicationCopy.market.livePriceHint },
      balances,
      observedBlock,
    ),
    feeRoutes: feeRoutesFor(balances),
    poolId: canonicalPoolId(health.market.poolId),
    observedBlock,
    growthPoints: derivePoolGrowthPoints({
      cycles: snapshot?.liquidityCycles ?? [],
      ...liveQueue,
    }),
    candles: snapshot?.candles ?? [],
    candleInterval: candleIntervalFrom(snapshot),
    candleSource: candleSourceFrom(snapshot),
    feeMatchingState: snapshot?.feeMatching.state ?? "partial",
  };
};

export const deriveMarketDashboardModel = (
  health: HealthSnapshot,
  history: IndexedMarketHistoryRead,
  publicStatus?: PublicStatus,
): MarketDashboardModel =>
  health === undefined
    ? unavailableModel(history, publicStatus)
    : loadedModel(health, history);

const displayHistoryTime = (timestamp: bigint | undefined, timeZone: string) =>
  timestamp === undefined
    ? applicationCopy.common.notObserved
    : displayMarketTime(timestamp, timeZone);

const sourceLabelFor = (
  candleSource: CanonicalMarketHistorySnapshot["candleSource"],
) =>
  candleSource.kind === "uniswap-v4-subgraph"
    ? applicationCopy.exchange.candleSourceUniswap
    : applicationCopy.exchange.candleSourceIndexed;

const metricValue = (metric: MarketMetric) => {
  if (metric.wei === undefined) {
    return <Unavailable reason={applicationCopy.common.notObserved} />;
  }
  return metric.kind === "rate" ? (
    <Rate value={metric.wei} />
  ) : (
    <Amount
      maximumFractionDigits={6}
      minimumFractionDigits={4}
      value={metric.wei}
    />
  );
};

const columnsFor = (count: number): 2 | 3 | 4 | 5 | 6 => {
  if (count <= 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 4;
  return count === 5 ? 5 : 6;
};

/** Trade facts read from the indexed candles, with their own freshness. */
function ActivityMetrics({
  candles,
  indexedThroughTime,
  timeZone,
}: {
  readonly candles: CanonicalMarketHistorySnapshot["candles"];
  readonly indexedThroughTime: bigint | undefined;
  readonly timeZone: string;
}) {
  const traded = candles.filter((candle) => candle.swapCount > 0);
  const latestTrade = traded.at(-1);
  if (latestTrade === undefined) return null;
  const volume = traded.reduce(
    (total, candle) => total + candle.grossWethVolume,
    0n,
  );
  const through = `${applicationCopy.market.indexedThrough} ${displayHistoryTime(indexedThroughTime, timeZone)}`;
  return (
    <>
      <Metric
        hint={through}
        label={applicationCopy.market.latestTrade}
        value={displayMarketTime(latestTrade.intervalEnd, timeZone)}
      />
      <Metric
        hint={through}
        label={applicationCopy.market.rangeVolume}
        value={<Amount maximumFractionDigits={6} unit="WETH" value={volume} />}
      />
    </>
  );
}

/**
 * The board. Only observed cells render: a strip of em dashes says nothing,
 * and the state feedback above it already says what could not be read.
 */
function MetricBoard({
  candles,
  indexedThroughTime,
  metrics,
  timeZone,
}: {
  readonly candles: CanonicalMarketHistorySnapshot["candles"];
  readonly indexedThroughTime: bigint | undefined;
  readonly metrics: readonly MarketMetric[];
  readonly timeZone: string;
}) {
  const observed = metrics.filter((metric) => metric.wei !== undefined);
  const traded = candles.some((candle) => candle.swapCount > 0) ? 2 : 0;
  const count = observed.length + traded;
  if (count === 0) return null;
  const [price, ...balances] = observed;
  const cell = (metric: MarketMetric) => (
    <Metric
      hint={metric.hint}
      key={metric.label}
      label={`${metric.label} (${metric.unit})`}
      tone={metric.tone}
      value={metricValue(metric)}
    />
  );
  return (
    <MetricGroup
      columns={columnsFor(count)}
      label={applicationCopy.market.title}
    >
      {price === undefined || price.kind !== "rate" ? null : cell(price)}
      <ActivityMetrics
        candles={candles}
        indexedThroughTime={indexedThroughTime}
        timeZone={timeZone}
      />
      {(price !== undefined && price.kind !== "rate" ? observed : balances).map(
        cell,
      )}
    </MetricGroup>
  );
}

function HistoryPosition({
  status,
  timeZone,
}: {
  readonly status: CanonicalMarketHistorySnapshot["status"];
  readonly timeZone: string;
}) {
  return (
    <DataList>
      <DataRow
        label={applicationCopy.exchange.historyThroughTime}
        note={applicationCopy.exchange.historyThrough(
          display(status.indexedThroughBlock),
        )}
        value={displayHistoryTime(status.indexedThroughTime, timeZone)}
      />
      <DataRow
        label={applicationCopy.exchange.historyHead}
        value={display(status.observedBlock)}
      />
      <DataRow
        label={applicationCopy.exchange.historyLag}
        note={applicationCopy.exchange.historyLagUnit}
        value={display(status.lagBlocks)}
      />
    </DataList>
  );
}

function HistoryStatus({
  history,
  onRefresh,
}: {
  readonly history: IndexedMarketHistoryRead;
  readonly onRefresh: () => void;
}) {
  const retryAction = (
    <Button onClick={onRefresh} type="button" variant="outline">
      {applicationCopy.exchange.historyRetry}
    </Button>
  );
  if (history.status === "loading") {
    return (
      <StateFeedback
        description={applicationCopy.exchange.historyLoadingDetail}
        title={applicationCopy.exchange.historyLoading}
        tone="loading"
      />
    );
  }
  if (history.status === "failed") {
    return (
      <StateFeedback
        action={retryAction}
        description={applicationCopy.exchange.historyUnavailableDetail}
        title={applicationCopy.exchange.historyUnavailable}
        tone="error"
      />
    );
  }
  if (history.status === "stale") {
    return (
      <StateFeedback
        action={retryAction}
        description={applicationCopy.exchange.historyStaleDetail}
        title={applicationCopy.exchange.historyStale}
        tone="stale"
      />
    );
  }
  if (history.snapshot.status.state === "partial") {
    return (
      <StateFeedback
        description={applicationCopy.exchange.historyThrough(
          display(history.snapshot.status.indexedThroughBlock),
        )}
        title={applicationCopy.exchange.historyPartial}
        tone="partial"
      />
    );
  }
  /* Complete history is the quiet case: the chart panel's badge says so. */
  return null;
}

/** The chart panel's caps meta: interval, source, and coverage. */
const historyBadge = (history: ConfirmedHistory) => {
  if (history.status === "stale") {
    return (
      <Badge dot tone="warning">
        {applicationCopy.exchange.historyStale}
      </Badge>
    );
  }
  return history.snapshot.status.state === "complete" ? (
    <Badge dot tone="success">
      {applicationCopy.exchange.historyComplete}
    </Badge>
  ) : (
    <Badge dot tone="warning">
      {applicationCopy.exchange.historyPartial}
    </Badge>
  );
};

function CandlePanel({
  history,
  model,
  timeZone,
}: {
  readonly history: ConfirmedHistory;
  readonly model: MarketDashboardModel;
  readonly timeZone: string;
}) {
  const [range, setRange] = useState<CandleRangeKey>("all");
  const indexedThroughTime = history.snapshot.status.indexedThroughTime;
  const continuous = continuousCandlesInRange(
    model.candles,
    range,
    indexedThroughTime,
  );
  return (
    <Panel
      className="laptop:col-span-12"
      meta={historyBadge(history)}
      title={applicationCopy.exchange.candleChart}
      titleId="market-candle-heading"
    >
      {/* The header strip holds one short token, so interval, source and
          indexed position read as a wrapping caption above the control. */}
      <p className="font-mono text-caption text-ink-faint">
        {continuous.intervalLabel} · {sourceLabelFor(model.candleSource)} ·{" "}
        {applicationCopy.market.indexedThrough}{" "}
        {displayHistoryTime(indexedThroughTime, timeZone)}
      </p>
      <SegmentedControl
        className="mt-3 max-w-[24rem]"
        label={applicationCopy.exchange.rangeLabel}
        onValueChange={setRange}
        options={CANDLE_RANGES.map(({ key, label }) => ({
          label,
          value: key,
        }))}
        value={range}
      />
      <ChartFrame
        caption={applicationCopy.exchange.candleDescription}
        className="mt-3"
        emptyDescription={applicationCopy.exchange.candleEmptyDetail}
        emptyTitle={applicationCopy.exchange.candleEmpty}
        label={applicationCopy.exchange.candleChart}
        observations={continuous.candles.length}
        sparseDescription={applicationCopy.exchange.candleSparse}
        sparseTitle={applicationCopy.exchange.historyTooShort}
      >
        <MarketCandlestickChart
          candles={model.candles}
          feeMatchingState={model.feeMatchingState}
          interval={model.candleInterval}
          range={range}
          throughTime={indexedThroughTime}
          timeZone={timeZone}
        />
      </ChartFrame>
    </Panel>
  );
}

function FeePanel({ routes }: { readonly routes: readonly FeeRoute[] }) {
  const observed = routes.filter((route) => route.wei !== undefined);
  return (
    <Panel
      className="laptop:col-span-4"
      footer={
        <Disclosure title={applicationCopy.exchange.totalFeeQueue}>
          <p className="max-w-[62ch] text-caption text-ink-soft">
            {applicationCopy.exchange.feeQueueDisclosure}
          </p>
        </Disclosure>
      }
      meta={<span>{applicationCopy.exchange.defaultFee}</span>}
      title={applicationCopy.exchange.feeRouting}
    >
      {observed.length === 0 ? (
        <StateFeedback
          compact
          description={applicationCopy.market.noLiveBalances}
          title={applicationCopy.common.notObserved}
          tone="empty"
        />
      ) : (
        <DataList>
          {observed.map((route) => (
            <DataRow
              key={route.label}
              label={route.label}
              note={route.share}
              value={
                route.wei === undefined ? (
                  <Unavailable reason={applicationCopy.common.notObserved} />
                ) : (
                  <Amount
                    maximumFractionDigits={6}
                    minimumFractionDigits={4}
                    unit="WETH"
                    value={route.wei}
                  />
                )
              }
            />
          ))}
        </DataList>
      )}
    </Panel>
  );
}

function GrowthPanel({
  points,
}: {
  readonly points: readonly PoolGrowthPoint[];
}) {
  return (
    <Panel
      className="laptop:col-span-8"
      meta={
        <span>
          {points.length} {applicationCopy.exchange.poolGrowthPoints}
        </span>
      }
      title={applicationCopy.exchange.poolGrowth}
    >
      {/* Two completed cycles used to render as a full-height plot containing
          one straight segment between two dots, which reads as a broken chart
          rather than as a short history. */}
      <ChartFrame
        caption={applicationCopy.exchange.poolGrowthDescription}
        emptyDescription={applicationCopy.exchange.poolGrowthEmpty}
        emptyTitle={applicationCopy.exchange.historyTooShort}
        label={applicationCopy.exchange.poolGrowth}
        observations={points.length}
        sparseDescription={applicationCopy.exchange.poolGrowthSparse}
        sparseTitle={applicationCopy.exchange.historyTooShort}
      >
        <PoolGrowthChart points={points} />
      </ChartFrame>
      {/* Legend, not lede: the plot states the numbers, this says how to read
          its two point styles. */}
      <Disclosure className="mt-3" title={applicationCopy.exchange.poolGrowth}>
        <p className="max-w-[62ch] text-body-sm text-ink-soft">
          {applicationCopy.exchange.poolGrowthIntroduction}
        </p>
      </Disclosure>
    </Panel>
  );
}

function PoolIdentity({
  activeLiquidity,
  observedBlock,
  poolId,
  poolManagerUrl,
}: {
  readonly activeLiquidity: string;
  readonly observedBlock: string;
  readonly poolId: string;
  readonly poolManagerUrl: string | undefined;
}) {
  return (
    <Disclosure searchable title={applicationCopy.exchange.poolIdentitySummary}>
      <DataList>
        <DataRow
          label={applicationCopy.exchange.poolId}
          value={
            <code className="font-mono text-caption [overflow-wrap:anywhere]">
              {poolId}
            </code>
          }
        />
        <DataRow
          label={applicationCopy.exchange.activeLiquidity}
          note={applicationCopy.exchange.activeLiquidityUnits}
          value={activeLiquidity}
        />
        <DataRow
          label={applicationCopy.home.observedBlock}
          value={observedBlock}
        />
      </DataList>
      <p className="mt-3 max-w-[62ch] text-body-sm text-ink-soft">
        {applicationCopy.exchange.poolIndexingDisclosure}
      </p>
      {poolManagerUrl === undefined ? null : (
        <a
          className={buttonVariants({ className: "mt-3", variant: "outline" })}
          href={poolManagerUrl}
          rel="noreferrer"
          target="_blank"
        >
          {applicationCopy.exchange.inspectPoolManager}
        </a>
      )}
    </Disclosure>
  );
}

/** Evidence and education, collapsed, after every live board. */
function MarketDisclosures({
  history,
  model,
  timeZone,
}: {
  readonly history: IndexedMarketHistoryRead;
  readonly model: MarketDashboardModel;
  readonly timeZone: string;
}) {
  return (
    <div className="mt-6">
      {history.status === "loaded" || history.status === "stale" ? (
        <Disclosure searchable title="Verify indexed history">
          <div data-market-history-proof>
            <HistoryPosition
              status={history.snapshot.status}
              timeZone={timeZone}
            />
          </div>
        </Disclosure>
      ) : null}
      <Disclosure searchable title={applicationCopy.exchange.openingCurveTitle}>
        <p className="max-w-[62ch] text-body-sm text-ink-soft">
          {applicationCopy.exchange.openingCurveExplanation}
        </p>
      </Disclosure>
      <PoolIdentity
        activeLiquidity={model.activeLiquidity}
        observedBlock={model.observedBlock}
        poolId={model.poolId}
        poolManagerUrl={model.poolManagerUrl}
      />
    </div>
  );
}

const marketPublicEvidenceFeedback = ({
  error,
  pending,
  publicStatus,
  refreshing,
}: {
  readonly error: Error | null | undefined;
  readonly pending: boolean;
  readonly publicStatus: PublicStatus;
  readonly refreshing: boolean;
}) => {
  if (error !== null && error !== undefined) {
    if (publicStatus !== undefined) {
      return {
        description:
          "The latest refresh failed. Values below remain from the last confirmed public snapshot.",
        title: "Showing last-known balances",
        tone: "stale" as const,
      };
    }
    if (error.message.includes("timed out after 8 seconds")) {
      return {
        description:
          "The onchain balance read reached its 8-second safety limit. Indexed market history remains available below; retry when the public RPC is responsive.",
        title: "Live balance read timed out",
        tone: "error" as const,
      };
    }
    return {
      description:
        "Live balances could not be refreshed. Indexed market history remains available below.",
      title: "Live balances unavailable",
      tone: "error" as const,
    };
  }
  if (pending || refreshing) {
    return {
      description:
        publicStatus === undefined
          ? "Reading the bounded public balance snapshot. Indexed history loads independently."
          : "Refreshing in the background without hiding the confirmed values below.",
      title:
        publicStatus === undefined
          ? "Loading live balances"
          : "Refreshing live balances",
      tone: "loading" as const,
    };
  }
  return undefined;
};

function MarketPublicEvidenceNotice({
  error,
  onRefresh,
  pending,
  publicStatus,
  refreshing,
}: {
  readonly error: Error | null | undefined;
  readonly onRefresh: (() => void) | undefined;
  readonly pending: boolean;
  readonly publicStatus: PublicStatus;
  readonly refreshing: boolean;
}) {
  const feedback = marketPublicEvidenceFeedback({
    error,
    pending,
    publicStatus,
    refreshing,
  });
  if (feedback === undefined) return null;
  const canRetry =
    error !== null && error !== undefined && onRefresh !== undefined;
  return (
    <StateFeedback
      action={
        canRetry ? (
          <Button onClick={onRefresh} type="button" variant="outline">
            Retry live balances
          </Button>
        ) : undefined
      }
      compact
      {...feedback}
    />
  );
}

export function MarketDashboardContent({
  health,
  history,
  publicStatus,
  publicStatusError,
  publicStatusPending = false,
  publicStatusRefreshing = false,
  onRefreshPublicStatus,
  onRefreshHistory,
}: {
  readonly health: HealthSnapshot;
  readonly history: IndexedMarketHistoryRead;
  readonly publicStatus?: PublicStatus;
  readonly publicStatusError?: Error | null;
  readonly publicStatusPending?: boolean;
  readonly publicStatusRefreshing?: boolean;
  readonly onRefreshPublicStatus?: () => void;
  readonly onRefreshHistory: () => void;
}) {
  const model = deriveMarketDashboardModel(health, history, publicStatus);
  const timeZone = useDisplayTimeZone();
  const confirmed =
    history.status === "loaded" || history.status === "stale"
      ? history
      : undefined;
  return (
    <div className="mt-3 grid gap-3">
      <MarketPublicEvidenceNotice
        error={publicStatusError}
        onRefresh={onRefreshPublicStatus}
        pending={publicStatusPending}
        publicStatus={publicStatus}
        refreshing={publicStatusRefreshing}
      />
      <HistoryStatus history={history} onRefresh={onRefreshHistory} />
      <MetricBoard
        candles={model.candles}
        indexedThroughTime={confirmed?.snapshot.status.indexedThroughTime}
        metrics={model.metrics}
        timeZone={timeZone}
      />
      <div className="grid gap-3 laptop:grid-cols-12">
        {confirmed === undefined ? null : (
          <CandlePanel history={confirmed} model={model} timeZone={timeZone} />
        )}
        <FeePanel routes={model.feeRoutes} />
        {confirmed === undefined ? null : (
          <GrowthPanel points={model.growthPoints} />
        )}
      </div>
      {/* Education and exact evidence follow the current price and chart. */}
      <MarketDisclosures history={history} model={model} timeZone={timeZone} />
    </div>
  );
}

export function MarketDashboard() {
  const protocol = useProtocolClient();
  return (
    <MarketDashboardContent
      health={protocol.health}
      history={protocol.marketHistory}
      onRefreshPublicStatus={() => void protocol.refresh()}
      onRefreshHistory={protocol.refreshMarketHistory}
      publicStatus={protocol.publicStatus}
      publicStatusError={protocol.publicStatusError}
      publicStatusPending={protocol.publicStatusPending}
      publicStatusRefreshing={protocol.publicStatusRefreshing}
    />
  );
}
