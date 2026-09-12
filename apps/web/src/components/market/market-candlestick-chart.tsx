"use client";

import type {
  CanonicalMarketCandleInterval,
  MarketCandle,
  CanonicalMarketHistorySnapshot,
} from "@orbit/protocol/market-history";
import type { DataSeries, TimeFrame } from "@tradecanvas/chart";
import type { ChartWidget as ChartWidgetInstance } from "@tradecanvas/chart/widget";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";

import { StateFeedback } from "@/components/state-feedback";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/format";
import { applicationCopy } from "@/lib/identity";

const MAX_VISIBLE_CANDLES = 1_000;
const MAX_TRADING_CANDLES = 500n;
const TRADING_TIMEFRAMES = [
  { seconds: 60n, value: "1m" },
  { seconds: 180n, value: "3m" },
  { seconds: 300n, value: "5m" },
  { seconds: 900n, value: "15m" },
  { seconds: 1_800n, value: "30m" },
  { seconds: 2_700n, value: "45m" },
  { seconds: 3_600n, value: "1h" },
  { seconds: 7_200n, value: "2h" },
  { seconds: 10_800n, value: "3h" },
  { seconds: 14_400n, value: "4h" },
  { seconds: 21_600n, value: "6h" },
  { seconds: 28_800n, value: "8h" },
  { seconds: 43_200n, value: "12h" },
  { seconds: 86_400n, value: "1d" },
  { seconds: 172_800n, value: "2d" },
  { seconds: 259_200n, value: "3d" },
  { seconds: 604_800n, value: "1w" },
  { seconds: 1_209_600n, value: "2w" },
  { seconds: 2_592_000n, value: "1M" },
  { seconds: 7_776_000n, value: "3M" },
  { seconds: 15_552_000n, value: "6M" },
  { seconds: 31_536_000n, value: "12M" },
] as const satisfies readonly {
  readonly seconds: bigint;
  readonly value: TimeFrame;
}[];
const CHART_INTERVALS = TRADING_TIMEFRAMES.map(({ seconds }) => seconds);

/**
 * Ranges bound how much history the chart renders as the deployment ages.
 */
export const CANDLE_RANGES = [
  { key: "24h", hours: 24, label: applicationCopy.exchange.range24h },
  { key: "7d", hours: 24 * 7, label: applicationCopy.exchange.range7d },
  { key: "30d", hours: 24 * 30, label: applicationCopy.exchange.range30d },
  { key: "all", hours: undefined, label: applicationCopy.exchange.rangeAll },
] as const;

export type CandleRangeKey = (typeof CANDLE_RANGES)[number]["key"];

/** Applies a range, then the hard render cap for source observations. */
export const candlesInRange = (
  candles: readonly MarketCandle[],
  range: CandleRangeKey,
  throughTime?: bigint,
): readonly MarketCandle[] => {
  const entry = CANDLE_RANGES.find((candidate) => candidate.key === range);
  const rangeEnd = throughTime ?? candles.at(-1)?.intervalEnd;
  const ranged =
    entry?.hours === undefined || rangeEnd === undefined
      ? candles
      : candles.filter(
          (candle) =>
            candle.intervalEnd > rangeEnd - BigInt(entry.hours) * 3_600n,
        );
  return ranged.slice(-MAX_VISIBLE_CANDLES);
};

export interface ContinuousCandleSeries {
  readonly candles: readonly MarketCandle[];
  readonly intervalLabel: string;
  readonly intervalSeconds: bigint;
}

const preferredInterval = (range: CandleRangeKey) => {
  if (range === "24h") return 300n;
  if (range === "7d") return 1_800n;
  if (range === "30d") return 14_400n;
  return 60n;
};

export const displayCandleInterval = (seconds: bigint): string => {
  if (seconds % 86_400n === 0n) {
    const days = seconds / 86_400n;
    return `${days}-day`;
  }
  if (seconds % 3_600n === 0n) {
    const hours = seconds / 3_600n;
    return `${hours}-hour`;
  }
  const minutes = seconds / 60n;
  return `${minutes}-minute`;
};

const sourceIntervalSeconds = (candles: readonly MarketCandle[]) =>
  candles.reduce(
    (minimum, candle) => {
      const duration = candle.intervalEnd - candle.intervalStart;
      return duration > 0n && duration < minimum ? duration : minimum;
    },
    candles[0] === undefined
      ? 60n
      : candles[0].intervalEnd - candles[0].intervalStart,
  );

const chartIntervalSeconds = (
  duration: bigint,
  minimum: bigint,
  range: CandleRangeKey,
) => {
  const fixedInterval = CHART_INTERVALS.find(
    (candidate) =>
      candidate >= minimum &&
      candidate >= preferredInterval(range) &&
      (duration + candidate - 1n) / candidate + 1n <= MAX_TRADING_CANDLES,
  );
  if (fixedInterval !== undefined) return fixedInterval;

  // "All" eventually outgrows the fixed presets. Round the required width up
  // to whole days so even a long-lived deployment stays below the render cap.
  const targetIntervals = MAX_TRADING_CANDLES - 1n;
  const required = (duration + targetIntervals - 1n) / targetIntervals;
  const day = 86_400n;
  return ((required + day - 1n) / day) * day;
};

const minimumBigint = (values: readonly bigint[]) =>
  values.reduce((result, value) => (value < result ? value : result));

const maximumBigint = (values: readonly bigint[]) =>
  values.reduce((result, value) => (value > result ? value : result));

const closeOf = (candle: MarketCandle) => candle.closeWethPerLiquidTokenX18;

type PricedMarketCandle = MarketCandle & {
  readonly openWethPerLiquidTokenX18: bigint;
  readonly highWethPerLiquidTokenX18: bigint;
  readonly lowWethPerLiquidTokenX18: bigint;
  readonly closeWethPerLiquidTokenX18: bigint;
};

const hasPrices = (candle: MarketCandle): candle is PricedMarketCandle =>
  candle.openWethPerLiquidTokenX18 !== undefined &&
  candle.highWethPerLiquidTokenX18 !== undefined &&
  candle.lowWethPerLiquidTokenX18 !== undefined &&
  candle.closeWethPerLiquidTokenX18 !== undefined;

const emptyContinuousSeries = (
  range: CandleRangeKey,
): ContinuousCandleSeries => {
  const intervalSeconds = preferredInterval(range);
  return {
    candles: [],
    intervalLabel: displayCandleInterval(intervalSeconds),
    intervalSeconds,
  };
};

const effectiveRangeStart = (
  candles: readonly MarketCandle[],
  range: CandleRangeKey,
  rangeEnd: bigint,
) => {
  const firstStart = candles[0]?.intervalStart ?? rangeEnd;
  const hours = CANDLE_RANGES.find(
    (candidate) => candidate.key === range,
  )?.hours;
  if (hours === undefined) return firstStart;
  const requestedStart = rangeEnd - BigInt(hours) * 3_600n;
  return requestedStart > firstStart ? requestedStart : firstStart;
};

const aggregateCandleBucket = ({
  bucketEnd,
  bucketStart,
  members,
  previousClose,
}: {
  readonly bucketEnd: bigint;
  readonly bucketStart: bigint;
  readonly members: readonly MarketCandle[];
  readonly previousClose: bigint | undefined;
}): MarketCandle | undefined => {
  const priced = members.filter(hasPrices);
  const firstPriced = priced[0];
  const lastPriced = priced.at(-1);
  if (firstPriced === undefined || lastPriced === undefined) {
    if (previousClose === undefined) return undefined;
    return {
      intervalStart: bucketStart,
      intervalEnd: bucketEnd,
      openWethPerLiquidTokenX18: previousClose,
      highWethPerLiquidTokenX18: previousClose,
      lowWethPerLiquidTokenX18: previousClose,
      closeWethPerLiquidTokenX18: previousClose,
      grossWethVolume: 0n,
      protocolFeeWeth: 0n,
      swapCount: 0,
      matchedFeeCount: 0,
      feeMatchState: "complete",
    };
  }
  return {
    intervalStart: bucketStart,
    intervalEnd: bucketEnd,
    openWethPerLiquidTokenX18: firstPriced.openWethPerLiquidTokenX18,
    highWethPerLiquidTokenX18: maximumBigint(
      priced.map((candle) => candle.highWethPerLiquidTokenX18),
    ),
    lowWethPerLiquidTokenX18: minimumBigint(
      priced.map((candle) => candle.lowWethPerLiquidTokenX18),
    ),
    closeWethPerLiquidTokenX18: lastPriced.closeWethPerLiquidTokenX18,
    grossWethVolume: members.reduce(
      (total, candle) => total + candle.grossWethVolume,
      0n,
    ),
    protocolFeeWeth: members.reduce(
      (total, candle) => total + candle.protocolFeeWeth,
      0n,
    ),
    swapCount: members.reduce((total, candle) => total + candle.swapCount, 0),
    matchedFeeCount: members.reduce(
      (total, candle) => total + candle.matchedFeeCount,
      0,
    ),
    feeMatchState: members.some((candle) => candle.feeMatchState === "partial")
      ? "partial"
      : "complete",
  };
};

const closeBefore = (candles: readonly MarketCandle[], timestamp: bigint) =>
  candles
    .filter((candle) => candle.intervalStart < timestamp)
    .map(closeOf)
    .filter((price): price is bigint => price !== undefined)
    .at(-1);

const sourceIndexAt = (candles: readonly MarketCandle[], timestamp: bigint) => {
  const index = candles.findIndex(
    (candle) => candle.intervalStart >= timestamp,
  );
  return index < 0 ? candles.length : index;
};

const candleBucketMembers = ({
  bucketEnd,
  bucketStart,
  candles,
  sourceIndex,
}: {
  readonly bucketEnd: bigint;
  readonly bucketStart: bigint;
  readonly candles: readonly MarketCandle[];
  readonly sourceIndex: number;
}) => {
  const members: MarketCandle[] = [];
  let nextIndex = sourceIndex;
  while (
    nextIndex < candles.length &&
    (candles[nextIndex]?.intervalStart ?? bucketEnd) < bucketEnd
  ) {
    const member = candles[nextIndex];
    if (member !== undefined && member.intervalStart >= bucketStart) {
      members.push(member);
    }
    nextIndex += 1;
  }
  return { members, nextIndex } as const;
};

const buildContinuousCandles = ({
  candles,
  firstBucket,
  intervalSeconds,
  lastBucket,
}: {
  readonly candles: readonly MarketCandle[];
  readonly firstBucket: bigint;
  readonly intervalSeconds: bigint;
  readonly lastBucket: bigint;
}) => {
  const output: MarketCandle[] = [];
  let previousClose = closeBefore(candles, firstBucket);
  let sourceIndex = sourceIndexAt(candles, firstBucket);
  for (
    let bucketStart = firstBucket;
    bucketStart <= lastBucket;
    bucketStart += intervalSeconds
  ) {
    const bucketEnd = bucketStart + intervalSeconds;
    const bucket = candleBucketMembers({
      bucketEnd,
      bucketStart,
      candles,
      sourceIndex,
    });
    sourceIndex = bucket.nextIndex;
    const aggregated = aggregateCandleBucket({
      bucketEnd,
      bucketStart,
      members: bucket.members,
      previousClose,
    });
    if (aggregated === undefined) continue;
    output.push(aggregated);
    previousClose = aggregated.closeWethPerLiquidTokenX18;
  }
  return output;
};

/**
 * Builds the dense, bounded series a trading chart expects. Missing buckets
 * carry the last observed close as flat OHLC and always keep volume at zero;
 * they never claim that a swap occurred.
 */
export const continuousCandlesInRange = (
  candles: readonly MarketCandle[],
  range: CandleRangeKey,
  throughTime?: bigint,
): ContinuousCandleSeries => {
  const first = candles[0];
  const last = candles.at(-1);
  if (first === undefined || last === undefined)
    return emptyContinuousSeries(range);

  const rangeEnd = throughTime ?? last.intervalEnd;
  const effectiveStart = effectiveRangeStart(candles, range, rangeEnd);
  if (rangeEnd < effectiveStart) return emptyContinuousSeries(range);

  const duration = rangeEnd - effectiveStart;
  const intervalSeconds = chartIntervalSeconds(
    duration,
    sourceIntervalSeconds(candles),
    range,
  );
  const firstBucket = effectiveStart - (effectiveStart % intervalSeconds);
  const lastBucket = rangeEnd - (rangeEnd % intervalSeconds);
  const output = buildContinuousCandles({
    candles,
    firstBucket,
    intervalSeconds,
    lastBucket,
  });

  return {
    candles: output,
    intervalLabel: displayCandleInterval(intervalSeconds),
    intervalSeconds,
  };
};

/** Intervals with no swaps carry no prices, so they are excluded here. */
const priceExtent = (
  candles: readonly MarketCandle[],
): { readonly low: bigint; readonly high: bigint } | undefined => {
  const lows = candles
    .map((candle) => candle.lowWethPerLiquidTokenX18)
    .filter((price) => price !== undefined);
  const highs = candles
    .map((candle) => candle.highWethPerLiquidTokenX18)
    .filter((price) => price !== undefined);
  const low = lows.at(0);
  const high = highs.at(0);
  if (low === undefined || high === undefined) return undefined;
  return {
    low: lows.reduce((value, price) => (price < value ? price : value), low),
    high: highs.reduce((value, price) => (price > value ? price : value), high),
  };
};

/** A concise equivalent of the chart for assistive technology. */
const chartSummaryFor = (candles: readonly MarketCandle[]): string => {
  const traded = candles.filter((candle) => candle.swapCount > 0);
  const last = traded.at(-1);
  const extent = priceExtent(traded);
  if (last === undefined || extent === undefined) {
    return applicationCopy.exchange.candleEmptyDetail;
  }
  return applicationCopy.exchange.chartSummary(
    traded.length,
    displayPrice(extent.low),
    displayPrice(extent.high),
    displayPrice(last.closeWethPerLiquidTokenX18),
  );
};

type FeeMatchingState = CanonicalMarketHistorySnapshot["feeMatching"]["state"];

const displayPrice = (value: bigint | undefined) =>
  value === undefined
    ? applicationCopy.common.notObserved
    : `${formatTokenAmount(value, { maximumFractionDigits: 8 }).display} WETH / ${applicationCopy.exchange.token}`;

export const displayMarketTime = (timestamp: bigint, timeZone = "UTC") =>
  new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
    year: "numeric",
  }).format(Number(timestamp) * 1_000);

const chartPrice = (value: bigint) => Number(formatUnits(value, 18));

/** Convert protocol candles to the vendor widget's intentionally small API. */
export const marketChartSeries = (
  candles: readonly MarketCandle[],
): DataSeries =>
  candles.flatMap((candle) => {
    const open = candle.openWethPerLiquidTokenX18;
    const high = candle.highWethPerLiquidTokenX18;
    const low = candle.lowWethPerLiquidTokenX18;
    const close = candle.closeWethPerLiquidTokenX18;
    if (
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined
    ) {
      return [];
    }
    return [
      {
        time: Number(candle.intervalStart) * 1_000,
        open: chartPrice(open),
        high: chartPrice(high),
        low: chartPrice(low),
        close: chartPrice(close),
        volume: chartPrice(candle.grossWethVolume),
      },
    ];
  });

const chartTimeframe = (intervalSeconds: bigint): TimeFrame =>
  TRADING_TIMEFRAMES.find(({ seconds }) => seconds >= intervalSeconds)?.value ??
  "12M";

const availableChartTimeframes = (
  intervalSeconds: bigint,
): readonly TimeFrame[] => {
  const available = TRADING_TIMEFRAMES.filter(
    ({ seconds }) => seconds >= intervalSeconds,
  ).map(({ value }) => value);
  return available.length > 0 ? available : ["12M"];
};

const mountTradingChart = ({
  container,
  initialTimeframe,
  timeframes,
}: {
  readonly container: HTMLDivElement;
  readonly initialTimeframe: TimeFrame;
  readonly timeframes: TimeFrame[];
}) =>
  import("@tradecanvas/chart/widget").then(({ ChartWidget }) => {
    const widget = new ChartWidget(container, {
      alerts: false,
      dragDropImport: false,
      drawingTools: true,
      objectTree: true,
      persistLayouts: {
        debounceMs: 1_500,
        keyPrefix: "orbit:market-chart:",
      },
      resampleTimeframes: true,
      settings: true,
      statusBar: false,
      symbol: `${applicationCopy.exchange.token} / WETH`,
      symbols: [`${applicationCopy.exchange.token} / WETH`],
      theme: "dark",
      timeframe: initialTimeframe,
      timeframes,
      toolbar: true,
      trading: false,
      watchlist: false,
    });
    const chart = widget.getChart();
    chart.setMarket({
      currency: "WETH",
      pricePrecision: 8,
      priceStep: 0.00000001,
      type: "crypto",
    });
    return widget;
  });

function InteractiveTradingChart({
  candles,
  intervalSeconds,
}: {
  readonly candles: readonly MarketCandle[];
  readonly intervalSeconds: bigint;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ChartWidgetInstance | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [retry, setRetry] = useState(0);
  const data = useMemo(() => marketChartSeries(candles), [candles]);
  const latestData = useRef(data);
  const firstVisibleTime = useRef<number | undefined>(undefined);
  const initialTimeframe = useMemo(
    () => chartTimeframe(intervalSeconds),
    [intervalSeconds],
  );
  const timeframes = useMemo(
    () => [...availableChartTimeframes(intervalSeconds)],
    [intervalSeconds],
  );

  useEffect(() => {
    latestData.current = data;
    const widget = widgetRef.current;
    if (widget === undefined) return;
    const anchor = firstVisibleTime.current;
    widget.setData(data);
    // The vendor's setData scrolls to the end even when auto-scroll is off.
    if (anchor !== undefined) widget.getChart().scrollTo(anchor);
  }, [data]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    if (container.clientWidth === 0 || typeof ResizeObserver === "undefined") {
      setStatus("failed");
      return;
    }
    let disposed = false;
    firstVisibleTime.current = undefined;
    setStatus("loading");
    void mountTradingChart({ container, initialTimeframe, timeframes })
      .then((widget) => {
        if (disposed) {
          widget.destroy();
          return;
        }
        widgetRef.current = widget;
        const chart = widget.getChart();
        const viewport = container.querySelector<HTMLElement>(
          ".tcw-chart-container",
        );
        if (viewport !== null) {
          viewport.setAttribute("role", "img");
          viewport.setAttribute(
            "aria-label",
            `Interactive ${applicationCopy.exchange.token} market chart`,
          );
          // The vendor suppresses the canvas keyboard ring with inline CSS.
          // Restore the application focus treatment and keep it inside the plot.
          viewport.style.removeProperty("outline");
          viewport.style.outlineOffset = "-3px";
        }
        chart.on("visibleRangeChange", ({ payload: range }) => {
          firstVisibleTime.current = chart.getData()[range.from]?.time;
        });
        widget.setData(latestData.current);
        chart.fitContent();
        setStatus("ready");
      })
      .catch(() => {
        if (!disposed) setStatus("failed");
      });
    return () => {
      disposed = true;
      widgetRef.current?.destroy();
      widgetRef.current = undefined;
    };
  }, [initialTimeframe, retry, timeframes]);

  return (
    <div className="relative h-[clamp(34rem,68vh,44rem)] min-h-[34rem]">
      <div
        aria-hidden={status === "ready" ? undefined : true}
        aria-label={status === "ready" ? chartSummaryFor(candles) : undefined}
        className="absolute inset-0 min-w-0 aria-hidden:invisible"
        data-library="tradecanvas"
        ref={containerRef}
        role={status === "ready" ? "region" : undefined}
      />
      {status === "ready" ? null : (
        <div className="p-4">
          <StateFeedback
            action={
              status === "failed" ? (
                <Button
                  onClick={() => setRetry((value) => value + 1)}
                  type="button"
                  variant="outline"
                >
                  Retry chart
                </Button>
              ) : undefined
            }
            description={chartSummaryFor(candles)}
            title={
              status === "failed"
                ? "Chart could not load"
                : "Loading market chart"
            }
            tone={status === "failed" ? "error" : "loading"}
          />
        </div>
      )}
    </div>
  );
}

export function MarketCandlestickChart({
  candles,
  feeMatchingState,
  range,
  throughTime,
}: {
  readonly candles: readonly MarketCandle[];
  readonly feeMatchingState: FeeMatchingState;
  readonly interval: CanonicalMarketCandleInterval;
  readonly range: CandleRangeKey;
  readonly throughTime?: bigint | undefined;
  readonly timeZone?: string;
}) {
  const continuous = useMemo(
    () => continuousCandlesInRange(candles, range, throughTime),
    [candles, range, throughTime],
  );
  if (candles.length === 0) {
    const partial = feeMatchingState === "partial";
    return (
      <StateFeedback
        description={
          partial
            ? `${applicationCopy.exchange.candleEmptyDetail} ${applicationCopy.exchange.candleVolumePartial}`
            : applicationCopy.exchange.candleEmptyDetail
        }
        title={applicationCopy.exchange.candleEmpty}
        tone={partial ? "partial" : "empty"}
      />
    );
  }
  return (
    /* The interactive chart is the single chart view; its module loads after hydration. */
    <div>
      <InteractiveTradingChart
        candles={continuous.candles}
        intervalSeconds={continuous.intervalSeconds}
      />
      {feeMatchingState === "partial" ? (
        <p className="mt-3 text-body-sm text-ink-soft" role="status">
          {applicationCopy.exchange.candleVolumePartial}
        </p>
      ) : null}
    </div>
  );
}
