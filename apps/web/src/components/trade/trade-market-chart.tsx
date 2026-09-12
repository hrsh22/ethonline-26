"use client";

import Link from "next/link";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Rate, Unavailable } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";
import type { IndexedMarketHistoryRead } from "@/lib/market-history-state";
import { cn } from "@/lib/utils";

type ConfirmedHistory = Extract<
  IndexedMarketHistoryRead,
  { status: "loaded" | "stale" }
>;

const historyStatus = (history: ConfirmedHistory) => {
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

/** The pair and its live price: the first line of the trade route. */
function PairHeader({
  children,
  priceWei,
}: {
  readonly children?: React.ReactNode;
  readonly priceWei: bigint | undefined;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-title-sm font-semibold text-ink">
            {applicationCopy.exchange.token}
            <span className="text-ink-faint"> / WETH</span>
          </h2>
          <Link
            className="text-caption text-ink-soft underline-offset-4 hover:text-ink hover:underline"
            href="/market"
          >
            Market details →
          </Link>
        </div>
        <p className="mt-1 font-mono text-heading font-medium text-ink tabular-nums">
          {priceWei === undefined ? (
            <Unavailable reason={applicationCopy.common.notObserved} />
          ) : (
            <Rate value={priceWei} />
          )}
          <span className="ml-2 text-body-sm font-normal text-ink-soft">
            WETH per {applicationCopy.exchange.token}
          </span>
        </p>
      </div>
      {children}
    </div>
  );
}

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
      <>
        <PairHeader priceWei={priceWei} />
        <div className="p-5">
          <StateFeedback
            description={applicationCopy.exchange.historyLoadingDetail}
            title={applicationCopy.exchange.historyLoading}
            tone="loading"
          />
        </div>
      </>
    );
  }
  if (history.status === "failed") {
    return (
      <>
        <PairHeader priceWei={priceWei} />
        <div className="p-5">
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
        </div>
      </>
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
    <>
      <PairHeader priceWei={priceWei}>
        <div className="flex min-w-0 flex-col items-end gap-2">
          <SegmentedControl
            className="w-auto min-w-[16rem] [&_button]:min-w-0 [&_button]:px-2"
            label={applicationCopy.exchange.rangeLabel}
            onValueChange={setRange}
            options={CANDLE_RANGES.map(({ key, label }) => ({
              label,
              value: key,
            }))}
            size="compact"
            value={range}
          />
          <div className="flex items-center gap-2">
            {historyStatus(history)}
            {history.status === "stale" ? (
              <Button
                onClick={onRefresh}
                size="sm"
                type="button"
                variant="ghost"
              >
                {applicationCopy.exchange.historyRetry}
              </Button>
            ) : null}
          </div>
        </div>
      </PairHeader>
      <div
        className={cn(
          "flex-1 p-3 [&_svg]:!min-w-0",
          visible.candles.length === 0 && "grid content-center",
        )}
      >
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
            className="h-[20rem] compact:h-[24rem] laptop:h-[clamp(24rem,52vh,34rem)]"
            feeMatchingState={snapshot.feeMatching.state}
            interval={snapshot.interval}
            range={range}
            throughTime={throughTime}
          />
        </ChartFrame>
      </div>
    </>
  );
}
