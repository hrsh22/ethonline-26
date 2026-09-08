"use client";

import { useState } from "react";

import { ChartFrame } from "@/components/market/chart-frame";
import {
  CANDLE_RANGES,
  continuousCandlesInRange,
  type CandleRangeKey,
  MarketCandlestickChart,
} from "@/components/market/market-candlestick-chart";
import { StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Rate, Unavailable } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";
import type { IndexedMarketHistoryRead } from "@/lib/market-history-state";

const historyStatus = (
  history: Extract<IndexedMarketHistoryRead, { status: "loaded" | "stale" }>,
) => {
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

/**
 * The trade-sized view of the project-owned Canonical Market history. It uses
 * the same candles and chart as Market, but leaves pool accounting and raw
 * indexing evidence on that dedicated route.
 */
export function TradeMarketChartContent({
  history,
  onRefresh,
  priceWei,
}: {
  readonly history: IndexedMarketHistoryRead | undefined;
  readonly onRefresh: () => void;
  readonly priceWei: bigint | undefined;
}) {
  const [range, setRange] = useState<CandleRangeKey>("24h");

  if (history === undefined || history.status === "loading") {
    return (
      <Panel className="min-h-64" title={applicationCopy.exchange.marketTitle}>
        <StateFeedback
          description={applicationCopy.exchange.historyLoadingDetail}
          title={applicationCopy.exchange.historyLoading}
          tone="loading"
        />
      </Panel>
    );
  }
  if (history.status === "failed") {
    return (
      <Panel className="min-h-64" title={applicationCopy.exchange.marketTitle}>
        <StateFeedback
          action={
            <Button onClick={onRefresh} type="button" variant="outline">
              {applicationCopy.exchange.historyRetry}
            </Button>
          }
          description={applicationCopy.exchange.historyUnavailableDetail}
          title={applicationCopy.exchange.historyUnavailable}
          tone="error"
        />
      </Panel>
    );
  }

  const snapshot = history.snapshot;
  const throughTime = snapshot.status.indexedThroughTime;
  const visible = continuousCandlesInRange(
    snapshot.candles,
    range,
    throughTime,
  );

  return (
    <Panel
      bodyClassName="grid content-start gap-3"
      className="min-w-0 [&>div:first-child]:flex-wrap [&>div:first-child>div]:max-w-full [&>div:first-child_span]:whitespace-normal"
      meta={historyStatus(history)}
      title={applicationCopy.exchange.marketTitle}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-body-sm text-ink-soft">
            WETH / {applicationCopy.exchange.token}
          </p>
          <div className="mt-1 font-mono text-title text-ink tabular-nums">
            {priceWei === undefined ? (
              <Unavailable reason={applicationCopy.common.notObserved} />
            ) : (
              <Rate value={priceWei} />
            )}
          </div>
        </div>
        <SegmentedControl
          className="w-full min-w-0 [&_button]:min-w-0 [&_button]:px-1 compact:max-w-[22rem]"
          label={applicationCopy.exchange.rangeLabel}
          onValueChange={setRange}
          options={CANDLE_RANGES.map(({ key, label }) => ({
            label,
            value: key,
          }))}
          size="compact"
          value={range}
        />
      </div>
      <div className="[&_svg]:!min-w-0">
        <ChartFrame
          caption={applicationCopy.exchange.candleDescription}
          emptyDescription={applicationCopy.exchange.candleEmptyDetail}
          emptyTitle={applicationCopy.exchange.candleEmpty}
          label={applicationCopy.exchange.candleChart}
          observations={visible.candles.length}
          sparseDescription={applicationCopy.exchange.candleSparse}
          sparseTitle={applicationCopy.exchange.historyTooShort}
        >
          <MarketCandlestickChart
            candles={snapshot.candles}
            feeMatchingState={snapshot.feeMatching.state}
            interval={snapshot.interval}
            range={range}
            throughTime={throughTime}
          />
        </ChartFrame>
      </div>
      {history.status === "stale" ? (
        <Button
          className="justify-self-start"
          onClick={onRefresh}
          size="sm"
          type="button"
          variant="outline"
        >
          {applicationCopy.exchange.historyRetry}
        </Button>
      ) : null}
    </Panel>
  );
}
