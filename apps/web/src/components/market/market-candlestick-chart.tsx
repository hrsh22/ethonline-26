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
import { Disclosure } from "@/components/ui/disclosure";
import { formatTokenAmount } from "@/lib/format";
import { applicationCopy } from "@/lib/identity";

const CHART_WIDTH = 900;
const CHART_HEIGHT = 360;
const CHART_INSET = 40;
/* The price axis needs its own column. Drawing the labels at the plot's left
   edge put the first several candles of any full range underneath them. */
const PRICE_GUTTER = 84;
const PLOT_RIGHT = CHART_WIDTH - CHART_INSET - PRICE_GUTTER;
const PRICE_BOTTOM = 250;
const VOLUME_TOP = 282;
const VOLUME_BOTTOM = 336;
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
 * Ranges bound how much history is rendered. Without them the chart grew with
 * deployment age and the disclosure table rendered every hour ever indexed.
 */
export const CANDLE_RANGES = [
  { key: "24h", hours: 24, label: applicationCopy.exchange.range24h },
  { key: "7d", hours: 24 * 7, label: applicationCopy.exchange.range7d },
  { key: "30d", hours: 24 * 30, label: applicationCopy.exchange.range30d },
  { key: "all", hours: undefined, label: applicationCopy.exchange.rangeAll },
] as const;

export type CandleRangeKey = (typeof CANDLE_RANGES)[number]["key"];

/** Applies a range, then the hard render cap that protects the SVG. */
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

const RATIO_SCALE = 1_000_000n;
const compactNumber = new Intl.NumberFormat("en", {
  maximumSignificantDigits: 5,
});

type FeeMatchingState = CanonicalMarketHistorySnapshot["feeMatching"]["state"];

const displayPrice = (value: bigint | undefined) =>
  value === undefined
    ? applicationCopy.common.notObserved
    : `${formatTokenAmount(value, { maximumFractionDigits: 8 }).display} WETH / ${applicationCopy.exchange.token}`;

const displayWeth = (value: bigint) =>
  `${formatTokenAmount(value, { maximumFractionDigits: 8 }).display} WETH`;

/* Ticks carry digits only; the unit is stated once at the head of the axis so
   a tick fits the gutter instead of reaching back across the plot. */
const displayAxisPrice = (value: bigint) =>
  compactNumber.format(Number(formatUnits(value, 18)));
const PRICE_AXIS_UNIT = `WETH / ${applicationCopy.exchange.token}`;

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

const displayAxisTime = (timestamp: bigint, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(Number(timestamp) * 1_000);

const observedPrices = (candles: readonly MarketCandle[]) =>
  candles.flatMap((candle) =>
    candle.lowWethPerLiquidTokenX18 === undefined ||
    candle.highWethPerLiquidTokenX18 === undefined
      ? []
      : [candle.lowWethPerLiquidTokenX18, candle.highWethPerLiquidTokenX18],
  );

const minimum = (values: readonly bigint[]) =>
  values.reduce((result, value) => (value < result ? value : result));

const maximum = (values: readonly bigint[]) =>
  values.reduce((result, value) => (value > result ? value : result));

const priceBounds = (candles: readonly MarketCandle[]) => {
  const prices = observedPrices(candles);
  return prices.length === 0
    ? undefined
    : { low: minimum(prices), high: maximum(prices) };
};

const paddedPriceBounds = (candles: readonly MarketCandle[]) => {
  const bounds = priceBounds(candles);
  if (bounds === undefined) return undefined;
  const spread = bounds.high - bounds.low;
  const padding = spread === 0n ? bounds.high / 100n || 1n : spread / 10n || 1n;
  return {
    low: bounds.low > padding ? bounds.low - padding : 0n,
    high: bounds.high + padding,
  };
};

const ratio = (value: bigint, low: bigint, high: bigint) =>
  high === low
    ? 0.5
    : Number(((value - low) * RATIO_SCALE) / (high - low)) /
      Number(RATIO_SCALE);

const priceY = (value: bigint, low: bigint, high: bigint) =>
  PRICE_BOTTOM - ratio(value, low, high) * (PRICE_BOTTOM - CHART_INSET);

const volumeHeight = (volume: bigint, maximumVolume: bigint) =>
  maximumVolume === 0n
    ? 0
    : (Number((volume * RATIO_SCALE) / maximumVolume) / Number(RATIO_SCALE)) *
      (VOLUME_BOTTOM - VOLUME_TOP);

const direction = (candle: MarketCandle) => {
  const open = candle.openWethPerLiquidTokenX18;
  const close = candle.closeWethPerLiquidTokenX18;
  if (open === undefined || close === undefined) return "empty" as const;
  if (close === open) return "flat" as const;
  return close > open ? ("up" as const) : ("down" as const);
};

interface CandleCoordinate {
  readonly candle: MarketCandle;
  readonly x: number;
  readonly width: number;
  readonly highY: number | undefined;
  readonly lowY: number | undefined;
  readonly openY: number | undefined;
  readonly closeY: number | undefined;
  readonly volumeHeight: number;
  readonly direction: ReturnType<typeof direction>;
}

const coordinateFor = ({
  candle,
  count,
  firstStart,
  lastStart,
  low,
  high,
  maximumVolume,
}: {
  readonly candle: MarketCandle;
  readonly count: number;
  readonly firstStart: bigint;
  readonly lastStart: bigint;
  readonly low: bigint;
  readonly high: bigint;
  readonly maximumVolume: bigint;
}): CandleCoordinate => {
  const plotWidth = PLOT_RIGHT - CHART_INSET;
  const markInset = 8;
  const markWidth = plotWidth - markInset * 2;
  const elapsed = lastStart - firstStart;
  const timeRatio =
    elapsed === 0n
      ? 0.5
      : Number(((candle.intervalStart - firstStart) * RATIO_SCALE) / elapsed) /
        Number(RATIO_SCALE);
  const x = CHART_INSET + markInset + markWidth * timeRatio;
  const intervalWidth =
    elapsed === 0n
      ? plotWidth / Math.max(count, 1)
      : (Number(
          ((candle.intervalEnd - candle.intervalStart) * RATIO_SCALE) / elapsed,
        ) /
          Number(RATIO_SCALE)) *
        markWidth;
  const price = (value: bigint | undefined) =>
    value === undefined ? undefined : priceY(value, low, high);
  return {
    candle,
    x,
    width: Math.max(2, Math.min(14, intervalWidth * 0.72)),
    highY: price(candle.highWethPerLiquidTokenX18),
    lowY: price(candle.lowWethPerLiquidTokenX18),
    openY: price(candle.openWethPerLiquidTokenX18),
    closeY: price(candle.closeWethPerLiquidTokenX18),
    volumeHeight: volumeHeight(candle.grossWethVolume, maximumVolume),
    direction: direction(candle),
  };
};

const coordinatesFor = (
  candles: readonly MarketCandle[],
): readonly CandleCoordinate[] => {
  const prices = observedPrices(candles);
  if (prices.length === 0) return [];
  const bounds = paddedPriceBounds(candles);
  if (bounds === undefined) return [];
  const firstStart = candles[0]?.intervalStart;
  const lastStart = candles.at(-1)?.intervalStart;
  if (firstStart === undefined || lastStart === undefined) return [];
  const maximumVolume = maximum(
    candles.map((candle) => candle.grossWethVolume),
  );
  return candles.map((candle) =>
    coordinateFor({
      candle,
      count: candles.length,
      firstStart,
      lastStart,
      low: bounds.low,
      high: bounds.high,
      maximumVolume,
    }),
  );
};

const observationLabel = (coordinate: CandleCoordinate, timeZone: string) => {
  const candle = coordinate.candle;
  if (candle.swapCount === 0) {
    return [
      displayMarketTime(candle.intervalStart, timeZone),
      applicationCopy.exchange.candleCarried,
      `close ${displayPrice(candle.closeWethPerLiquidTokenX18)}`,
      "volume 0 WETH",
    ].join(", ");
  }
  if (coordinate.direction === "empty") {
    return `${displayMarketTime(candle.intervalStart, timeZone)}: ${applicationCopy.exchange.candleNoSwaps}`;
  }
  return [
    displayMarketTime(candle.intervalStart, timeZone),
    `open ${displayPrice(candle.openWethPerLiquidTokenX18)}`,
    `high ${displayPrice(candle.highWethPerLiquidTokenX18)}`,
    `low ${displayPrice(candle.lowWethPerLiquidTokenX18)}`,
    `close ${displayPrice(candle.closeWethPerLiquidTokenX18)}`,
    `volume ${displayWeth(candle.grossWethVolume)}`,
  ].join(", ");
};

const wickClass = {
  up: "stroke-(--chart-positive) stroke-2",
  down: "stroke-(--chart-negative) stroke-2",
  flat: "stroke-(--chart-primary) stroke-2",
} as const;

const bodyClass = {
  up: "fill-(--chart-surface) stroke-(--chart-positive) stroke-2",
  down: "fill-(--chart-negative) stroke-(--chart-negative) stroke-2",
  flat: "fill-(--chart-primary) stroke-(--chart-primary) stroke-2",
} as const;

function CandleMark({
  coordinate,
  timeZone,
}: {
  readonly coordinate: CandleCoordinate;
  readonly timeZone: string;
}) {
  const {
    candle,
    closeY,
    direction: trend,
    highY,
    lowY,
    openY,
    width,
    x,
  } = coordinate;
  if (
    trend === "empty" ||
    closeY === undefined ||
    highY === undefined ||
    lowY === undefined ||
    openY === undefined
  ) {
    return (
      <line
        aria-label={observationLabel(coordinate, timeZone)}
        className="stroke-(--chart-grid) stroke-3 [stroke-dasharray:3_4]"
        data-candle-gap
        role="listitem"
        x1={x - width / 2}
        x2={x + width / 2}
        y1={(CHART_INSET + PRICE_BOTTOM) / 2}
        y2={(CHART_INSET + PRICE_BOTTOM) / 2}
      />
    );
  }
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(3, Math.abs(closeY - openY));
  return (
    <g
      aria-label={observationLabel(coordinate, timeZone)}
      data-direction={trend}
      role="listitem"
    >
      <line className={wickClass[trend]} x1={x} x2={x} y1={highY} y2={lowY} />
      <rect
        className={bodyClass[trend]}
        height={bodyHeight}
        width={width}
        x={x - width / 2}
        y={bodyTop}
      />
      <rect
        className="fill-(--chart-secondary) opacity-70"
        height={coordinate.volumeHeight}
        width={width}
        x={x - width / 2}
        y={VOLUME_BOTTOM - coordinate.volumeHeight}
      />
      <title>{observationLabel(coordinate, timeZone)}</title>
      {candle.feeMatchState === "partial" ? (
        <desc>{applicationCopy.exchange.candleVolumePartial}</desc>
      ) : null}
    </g>
  );
}

const headerCell =
  "border-t border-line px-2.5 py-2 font-mono text-label font-medium tracking-[0.1em] whitespace-nowrap text-ink-faint uppercase";
const bodyCell =
  "border-t border-line px-2.5 py-2 font-mono text-caption tabular-nums whitespace-nowrap text-ink";

function CandleRow({
  candle,
  timeZone,
}: {
  readonly candle: MarketCandle;
  readonly timeZone: string;
}) {
  return (
    <tr>
      <th className={`${bodyCell} font-medium`} scope="row">
        {displayMarketTime(candle.intervalStart, timeZone)}
      </th>
      {candle.swapCount === 0 ? (
        <td className={`${bodyCell} text-ink-soft`} colSpan={4}>
          {applicationCopy.exchange.candleNoSwaps}
        </td>
      ) : (
        <>
          <td className={bodyCell}>
            {displayPrice(candle.openWethPerLiquidTokenX18)}
          </td>
          <td className={bodyCell}>
            {displayPrice(candle.highWethPerLiquidTokenX18)}
          </td>
          <td className={bodyCell}>
            {displayPrice(candle.lowWethPerLiquidTokenX18)}
          </td>
          <td className={bodyCell}>
            {displayPrice(candle.closeWethPerLiquidTokenX18)}
          </td>
        </>
      )}
      <td className={bodyCell}>{displayWeth(candle.grossWethVolume)}</td>
      <td className={bodyCell}>{displayWeth(candle.protocolFeeWeth)}</td>
      <td className={bodyCell}>{candle.swapCount}</td>
    </tr>
  );
}

export function MarketCandleDataTable({
  candles,
  interval = "1h",
  timeZone = "UTC",
}: {
  readonly candles: readonly MarketCandle[];
  readonly interval?: CanonicalMarketCandleInterval;
  readonly timeZone?: string;
}) {
  const columns = [
    applicationCopy.exchange.candleTime(interval, timeZone),
    applicationCopy.exchange.candleOpen,
    applicationCopy.exchange.candleHigh,
    applicationCopy.exchange.candleLow,
    applicationCopy.exchange.candleClose,
    applicationCopy.exchange.candleVolume,
    applicationCopy.exchange.candleProtocolFee,
    applicationCopy.exchange.candleSwaps,
  ];
  return (
    /* A horizontally scrolling table holds nothing focusable, so a keyboard
       could reach the columns off its right edge only with a pointer. The
       region takes the tab stop itself and names what it holds. */
    <div
      aria-label={applicationCopy.exchange.candleData(interval)}
      className="overflow-x-auto"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[56rem] border-collapse text-left">
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={headerCell} key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candles.map((candle) => (
            <CandleRow
              candle={candle}
              key={candle.intervalStart.toString()}
              timeZone={timeZone}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rawCandleJson = (candles: readonly MarketCandle[]) =>
  JSON.stringify(
    candles.map((candle) => ({
      intervalStartSeconds: candle.intervalStart.toString(),
      intervalEndSeconds: candle.intervalEnd.toString(),
      openWethPerFuelX18: candle.openWethPerLiquidTokenX18?.toString() ?? null,
      highWethPerFuelX18: candle.highWethPerLiquidTokenX18?.toString() ?? null,
      lowWethPerFuelX18: candle.lowWethPerLiquidTokenX18?.toString() ?? null,
      closeWethPerFuelX18:
        candle.closeWethPerLiquidTokenX18?.toString() ?? null,
      grossWethVolumeWei: candle.grossWethVolume.toString(),
      protocolFeeWethWei: candle.protocolFeeWeth.toString(),
      swapCount: candle.swapCount,
    })),
    null,
    2,
  );

/** Mounted only while its disclosure is open, so the JSON is built on demand. */
function RawCandleData({
  candles,
}: {
  readonly candles: readonly MarketCandle[];
}) {
  const [copied, setCopied] = useState(false);
  const raw = useMemo(() => rawCandleJson(candles), [candles]);
  return (
    <div className="grid gap-3">
      <Button
        onClick={() => {
          if (navigator.clipboard === undefined) return;
          void navigator.clipboard
            .writeText(raw)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
        type="button"
        variant="outline"
      >
        {copied
          ? applicationCopy.market.copiedRaw
          : applicationCopy.market.copyRaw}
      </Button>
      <pre className="max-h-80 overflow-auto rounded-[var(--radius-control)] border border-line bg-canvas p-3 font-mono text-caption whitespace-pre-wrap [overflow-wrap:anywhere]">
        {raw}
      </pre>
    </div>
  );
}

function CandleTable({
  candles,
  interval,
  timeZone,
}: {
  readonly candles: readonly MarketCandle[];
  readonly interval: CanonicalMarketCandleInterval;
  readonly timeZone: string;
}) {
  return (
    <Disclosure
      className="mt-3"
      searchable
      title={applicationCopy.exchange.candleData(interval)}
    >
      <MarketCandleDataTable
        candles={candles}
        interval={interval}
        timeZone={timeZone}
      />
      <Disclosure className="mt-3" title={applicationCopy.market.rawUnits}>
        <RawCandleData candles={candles} />
      </Disclosure>
    </Disclosure>
  );
}

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
  fallback,
  intervalSeconds,
}: {
  readonly candles: readonly MarketCandle[];
  readonly fallback: React.ReactNode;
  readonly intervalSeconds: bigint;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ChartWidgetInstance | undefined>(undefined);
  const [ready, setReady] = useState(false);
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
    if (
      container === null ||
      container.clientWidth === 0 ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    let disposed = false;
    firstVisibleTime.current = undefined;
    setReady(false);
    void mountTradingChart({ container, initialTimeframe, timeframes })
      .then((widget) => {
        if (disposed) {
          widget.destroy();
          return;
        }
        widgetRef.current = widget;
        const chart = widget.getChart();
        chart.on("visibleRangeChange", ({ payload: range }) => {
          firstVisibleTime.current = chart.getData()[range.from]?.time;
        });
        widget.setData(latestData.current);
        chart.fitContent();
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setReady(false);
      });
    return () => {
      disposed = true;
      widgetRef.current?.destroy();
      widgetRef.current = undefined;
    };
  }, [initialTimeframe, timeframes]);

  return (
    <div className="relative h-[clamp(34rem,68vh,44rem)] min-h-[34rem]">
      <div
        aria-hidden={ready ? undefined : true}
        aria-label={ready ? chartSummaryFor(candles) : undefined}
        className="absolute inset-0 min-w-0 aria-hidden:invisible"
        data-library="tradecanvas"
        ref={containerRef}
        role={ready ? "region" : undefined}
      />
      {ready ? null : fallback}
    </div>
  );
}

function ProgressiveTradingChart({
  candles,
  fallback,
  intervalSeconds,
}: {
  readonly candles: readonly MarketCandle[];
  readonly fallback: React.ReactNode;
  readonly intervalSeconds: bigint;
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div>
      {advanced ? (
        <InteractiveTradingChart
          candles={candles}
          fallback={fallback}
          intervalSeconds={intervalSeconds}
        />
      ) : (
        fallback
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button
          aria-expanded={advanced}
          onClick={() => setAdvanced((current) => !current)}
          type="button"
          variant="outline"
        >
          {advanced
            ? applicationCopy.exchange.advancedChartClose
            : applicationCopy.exchange.advancedChartOpen}
        </Button>
        <p className="max-w-[38rem] text-body-sm text-ink-soft">
          {applicationCopy.exchange.advancedChartDescription}
        </p>
      </div>
    </div>
  );
}

function CandleAxis({
  bounds,
  firstCandle,
  lastCandle,
  timeZone,
}: {
  readonly bounds: { readonly low: bigint; readonly high: bigint };
  readonly firstCandle: MarketCandle;
  readonly lastCandle: MarketCandle;
  readonly timeZone: string;
}) {
  return (
    <g
      className="fill-(--chart-label) font-mono text-label tracking-[0.05em] tabular-nums uppercase"
      data-chart-axis
    >
      <text x={PLOT_RIGHT + 10} y={CHART_INSET - 10}>
        {PRICE_AXIS_UNIT}
      </text>
      <text x={PLOT_RIGHT + 10} y={CHART_INSET + 14}>
        {displayAxisPrice(bounds.high)}
      </text>
      <text x={PLOT_RIGHT + 10} y={PRICE_BOTTOM - 6}>
        {displayAxisPrice(bounds.low)}
      </text>
      <text x={PLOT_RIGHT + 10} y={VOLUME_TOP + 13}>
        WETH volume
      </text>
      <text textAnchor="start" x={CHART_INSET} y={CHART_HEIGHT - 7}>
        {displayAxisTime(firstCandle.intervalStart, timeZone)}
      </text>
      <text textAnchor="end" x={PLOT_RIGHT} y={CHART_HEIGHT - 7}>
        {displayAxisTime(lastCandle.intervalStart, timeZone)}
      </text>
    </g>
  );
}

/**
 * The readable default: one SVG, one tab stop, sized to the panel rather than
 * the viewport. The ring on focus is the global one; only its offset moves
 * inward so the plate's clipped corners cannot swallow it.
 */
function CandlePlot({
  intervalLabel,
  timeZone,
  visible,
}: {
  readonly intervalLabel: string;
  readonly timeZone: string;
  readonly visible: readonly MarketCandle[];
}) {
  const coordinates = coordinatesFor(visible);
  const bounds = priceBounds(visible);
  const firstCandle = visible[0];
  const lastCandle = visible.at(-1);
  return (
    <div className="overflow-x-auto" data-chart-scroll>
      <svg
        aria-describedby="market-candle-description"
        aria-labelledby="market-candle-title"
        className="block h-auto max-h-[clamp(22rem,48vh,30rem)] w-full min-w-[40rem] rounded-[var(--radius-surface)] focus-visible:-outline-offset-4"
        role="img"
        tabIndex={0}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <title id="market-candle-title">
          {applicationCopy.exchange.candleChart}
        </title>
        <desc id="market-candle-description">{chartSummaryFor(visible)}</desc>
        {bounds !== undefined &&
        firstCandle !== undefined &&
        lastCandle !== undefined ? (
          <CandleAxis
            bounds={bounds}
            firstCandle={firstCandle}
            lastCandle={lastCandle}
            timeZone={timeZone}
          />
        ) : null}
        <line
          className="stroke-(--chart-grid) stroke-1"
          x1={CHART_INSET}
          x2={PLOT_RIGHT}
          y1={VOLUME_TOP - 12}
          y2={VOLUME_TOP - 12}
        />
        <g
          aria-label={applicationCopy.market.observationsLabel(intervalLabel)}
          role="list"
        >
          {coordinates.map((coordinate) => (
            <CandleMark
              coordinate={coordinate}
              key={coordinate.candle.intervalStart.toString()}
              timeZone={timeZone}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

export function MarketCandlestickChart({
  candles,
  feeMatchingState,
  interval,
  range,
  throughTime,
  timeZone = "UTC",
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
  const traded = useMemo(
    () => candlesInRange(candles, range, throughTime),
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
    /* The readable SVG is the default. TradeCanvas and its terminal controls
       are an explicit secondary mode, while exact source rows stay below. */
    <div>
      <ProgressiveTradingChart
        candles={continuous.candles}
        fallback={
          <CandlePlot
            intervalLabel={continuous.intervalLabel}
            timeZone={timeZone}
            visible={continuous.candles}
          />
        }
        intervalSeconds={continuous.intervalSeconds}
      />
      {feeMatchingState === "partial" ? (
        <p className="mt-3 text-body-sm text-ink-soft" role="status">
          {applicationCopy.exchange.candleVolumePartial}
        </p>
      ) : null}
      <CandleTable candles={traded} interval={interval} timeZone={timeZone} />
    </div>
  );
}
