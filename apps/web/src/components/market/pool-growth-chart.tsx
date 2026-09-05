import type { LiquidityCycleHistory } from "@orbit/protocol/market-history";
import { formatUnits } from "viem";

import { Disclosure } from "@/components/ui/disclosure";
import { Well } from "@/components/ui/panel";
import { applicationCopy } from "@/lib/identity";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;
const CHART_INSET = 34;
/* The value axis needs its own column. Anchoring the labels at the plot's
   right edge put them on top of the final observation and its endpoint. */
const AXIS_GUTTER = 88;
const PLOT_RIGHT = CHART_WIDTH - CHART_INSET - AXIS_GUTTER;
const RATIO_SCALE = 1_000_000n;
const compactNumber = new Intl.NumberFormat("en", {
  maximumSignificantDigits: 5,
});

export interface PoolGrowthPoint {
  readonly label: string;
  readonly cycleNumber?: bigint;
  readonly blockNumber?: bigint;
  readonly blockTimestamp?: bigint;
  readonly consumedWeth?: bigint;
  readonly queuedWeth?: bigint;
  readonly tickLower?: number;
  readonly tickUpper?: number;
  readonly liquidity?: bigint;
  readonly permanentlyLockedWeth: bigint;
  readonly projected: boolean;
}

const compareCycles = (
  left: LiquidityCycleHistory,
  right: LiquidityCycleHistory,
) => {
  if (left.cycleNumber === right.cycleNumber) return 0;
  return left.cycleNumber < right.cycleNumber ? -1 : 1;
};

const prependStartPoint = (
  points: PoolGrowthPoint[],
  observations: readonly LiquidityCycleHistory[],
) => {
  const firstPoint = points[0];
  if (
    observations[0]?.cycleNumber !== 1n ||
    firstPoint === undefined ||
    firstPoint.permanentlyLockedWeth === 0n
  ) {
    return;
  }
  points.unshift({
    label: applicationCopy.exchange.poolGrowthStart,
    permanentlyLockedWeth: 0n,
    projected: false,
  });
};

const appendQueuedPoint = (
  points: PoolGrowthPoint[],
  currentLockedWeth: bigint | undefined,
  pendingWeth: bigint | undefined,
) => {
  const locked = currentLockedWeth ?? points.at(-1)?.permanentlyLockedWeth;
  if (locked === undefined || pendingWeth === undefined || pendingWeth === 0n)
    return;
  if (points.length === 0 && locked !== 0n) return;
  if (points.length === 0) {
    points.push({
      label: applicationCopy.exchange.poolGrowthStart,
      permanentlyLockedWeth: 0n,
      projected: false,
    });
  }
  points.push({
    label: applicationCopy.exchange.poolGrowthQueued,
    permanentlyLockedWeth: locked + pendingWeth,
    queuedWeth: pendingWeth,
    projected: true,
  });
};

export const derivePoolGrowthPoints = ({
  cycles,
  currentLockedWeth,
  pendingWeth,
}: {
  readonly cycles: readonly LiquidityCycleHistory[];
  readonly currentLockedWeth: bigint | undefined;
  readonly pendingWeth: bigint | undefined;
}): PoolGrowthPoint[] => {
  const observations = [...cycles].sort(compareCycles);
  const points: PoolGrowthPoint[] = observations.map((cycle) => ({
    label: `Cycle ${cycle.cycleNumber}`,
    cycleNumber: cycle.cycleNumber,
    blockNumber: cycle.blockNumber,
    blockTimestamp: cycle.blockTimestamp,
    consumedWeth: cycle.consumedWeth,
    queuedWeth: cycle.queuedWeth,
    tickLower: cycle.tickLower,
    tickUpper: cycle.tickUpper,
    liquidity: cycle.liquidity,
    permanentlyLockedWeth: cycle.permanentlyLockedWeth,
    projected: false,
  }));
  prependStartPoint(points, observations);
  appendQueuedPoint(points, currentLockedWeth, pendingWeth);
  return points;
};

const pointCoordinates = (points: readonly PoolGrowthPoint[]) => {
  const maximum = points.reduce(
    (largest, point) =>
      point.permanentlyLockedWeth > largest
        ? point.permanentlyLockedWeth
        : largest,
    0n,
  );
  const usableWidth = PLOT_RIGHT - CHART_INSET;
  const usableHeight = CHART_HEIGHT - CHART_INSET * 2;
  return points.map((point, index) => {
    const x =
      points.length === 1
        ? (CHART_INSET + PLOT_RIGHT) / 2
        : CHART_INSET + (usableWidth * index) / (points.length - 1);
    const ratio =
      maximum === 0n
        ? 0
        : Number((point.permanentlyLockedWeth * RATIO_SCALE) / maximum) /
          Number(RATIO_SCALE);
    return {
      ...point,
      x,
      y: CHART_HEIGHT - CHART_INSET - usableHeight * ratio,
    };
  });
};

type ChartCoordinate = ReturnType<typeof pointCoordinates>[number];

const pathFor = (points: readonly ChartCoordinate[]) =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

const displayWeth = (value: bigint) => `${formatUnits(value, 18)} WETH`;

const compactWeth = (value: bigint) =>
  compactNumber.format(Number(formatUnits(value, 18)));

const displayTime = (timestamp: bigint | undefined) =>
  timestamp === undefined
    ? applicationCopy.common.notObserved
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(Number(timestamp) * 1_000);

const displayRange = (point: PoolGrowthPoint) =>
  point.tickLower === undefined || point.tickUpper === undefined
    ? applicationCopy.common.notObserved
    : `${point.tickLower} to ${point.tickUpper}`;

const displayOptionalWeth = (value: bigint | undefined) =>
  value === undefined ? applicationCopy.common.notObserved : displayWeth(value);

const displayOptional = (value: bigint | undefined) =>
  value?.toString() ?? applicationCopy.common.notObserved;

const showAxisLabel = (index: number, count: number) => {
  const last = count - 1;
  const stride = Math.ceil(count / 6);
  /* The final label is end-anchored and can be wide ("Locked + pipeline"),
     so intermediate labels keep at least a quarter of the axis clear of it. */
  const endClearance = Math.max(stride, Math.ceil(count / 4));
  return (
    index === 0 ||
    index === last ||
    (index % stride === 0 && last - index >= endClearance)
  );
};

const axisTextAnchor = (index: number, count: number) => {
  if (index === 0) return "start" as const;
  if (index === count - 1) return "end" as const;
  return "middle" as const;
};

const headerCell =
  "border-t border-line px-2.5 py-2 font-mono text-label font-medium tracking-[0.1em] whitespace-nowrap text-ink-faint uppercase";
const bodyCell =
  "border-t border-line px-2.5 py-2 font-mono text-caption tabular-nums whitespace-nowrap text-ink";
const axisLabelClass =
  "fill-(--chart-label) font-mono text-label tracking-[0.05em] uppercase";
const axisValueClass =
  "fill-(--chart-value) font-mono text-label font-semibold tracking-[0.05em] tabular-nums";

function PoolGrowthDataTable({
  points,
}: {
  readonly points: readonly PoolGrowthPoint[];
}) {
  return (
    <Disclosure searchable title={applicationCopy.exchange.poolGrowthData}>
      {/* A horizontally scrolling table holds nothing focusable, so a keyboard
          could reach the columns off its right edge only with a pointer. The
          region takes the tab stop itself and names what it holds. */}
      <div
        aria-label={applicationCopy.exchange.poolGrowthData}
        className="overflow-x-auto"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <thead>
            <tr>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthStage}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthTime}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthBlock}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthConsumed}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthQueue}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthRange}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthLiquidity}
              </th>
              <th className={headerCell} scope="col">
                {applicationCopy.exchange.poolGrowthLocked}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th className={`${bodyCell} font-medium`} scope="row">
                  {point.label}
                </th>
                <td className={bodyCell}>
                  {displayTime(point.blockTimestamp)}
                </td>
                <td className={bodyCell}>
                  {displayOptional(point.blockNumber)}
                </td>
                <td className={bodyCell}>
                  {displayOptionalWeth(point.consumedWeth)}
                </td>
                <td className={bodyCell}>
                  {displayOptionalWeth(point.queuedWeth)}
                </td>
                <td className={bodyCell}>{displayRange(point)}</td>
                <td className={bodyCell}>{displayOptional(point.liquidity)}</td>
                <td className={bodyCell}>
                  {displayWeth(point.permanentlyLockedWeth)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

function PoolGrowthSparse({
  latest,
  points,
}: {
  readonly latest: PoolGrowthPoint | undefined;
  readonly points: readonly PoolGrowthPoint[];
}) {
  return (
    <div className="grid gap-3">
      <Well className="grid min-h-40 content-center gap-1.5 text-center">
        <div role="status">
          <span className="block font-mono text-label tracking-[0.1em] text-ink-faint uppercase">
            {applicationCopy.exchange.poolGrowth}
          </span>
          <strong className="mt-1 block font-mono text-heading font-medium tabular-nums text-ink [overflow-wrap:anywhere]">
            {latest === undefined
              ? applicationCopy.common.notObserved
              : displayWeth(latest.permanentlyLockedWeth)}
          </strong>
          <p className="mt-1 text-body-sm text-ink-soft">
            {applicationCopy.exchange.poolGrowthWaiting}
          </p>
        </div>
      </Well>
      {latest === undefined ? null : <PoolGrowthDataTable points={points} />}
    </div>
  );
}

function PoolGrowthPlot({
  coordinates,
  maximumLockedWeth,
}: {
  readonly coordinates: readonly ChartCoordinate[];
  readonly maximumLockedWeth: bigint;
}) {
  const actual = coordinates.filter((point) => !point.projected);
  const projection = coordinates.at(-1)?.projected ? coordinates.slice(-2) : [];
  return (
    /* The plot is wider than a phone, so its wrapper scrolls. Without a tab
       stop inside it, a keyboard cannot pan to the later cycles at all; the
       candle plot already takes the stop on the figure itself. */
    <svg
      aria-describedby="pool-growth-description"
      aria-labelledby="pool-growth-title"
      className="block h-auto w-full min-w-[32rem] rounded-[var(--radius-surface)] focus-visible:-outline-offset-4"
      role="img"
      tabIndex={0}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
    >
      <title id="pool-growth-title">
        {applicationCopy.exchange.poolGrowth}
      </title>
      <desc id="pool-growth-description">
        {applicationCopy.exchange.poolGrowthDescription}
      </desc>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          className="stroke-(--chart-grid) stroke-1"
          key={ratio}
          x1={CHART_INSET}
          x2={PLOT_RIGHT}
          y1={CHART_INSET + (CHART_HEIGHT - CHART_INSET * 2) * ratio}
          y2={CHART_INSET + (CHART_HEIGHT - CHART_INSET * 2) * ratio}
        />
      ))}
      {/* The unit is stated once at the head of the axis so each tick can
          spend the gutter on digits instead of repeating "WETH". */}
      <text
        className={axisLabelClass}
        textAnchor="start"
        x={PLOT_RIGHT + 10}
        y={CHART_INSET - 12}
      >
        WETH
      </text>
      <text
        className={axisValueClass}
        data-axis-value
        textAnchor="start"
        x={PLOT_RIGHT + 10}
        y={CHART_INSET + 4}
      >
        {compactWeth(maximumLockedWeth)}
      </text>
      <text
        className={axisValueClass}
        data-axis-value
        textAnchor="start"
        x={PLOT_RIGHT + 10}
        y={CHART_HEIGHT - CHART_INSET + 4}
      >
        0
      </text>
      <path
        className="fill-none stroke-(--chart-primary) stroke-3 [stroke-linecap:round] [stroke-linejoin:round]"
        d={pathFor(actual)}
        data-series="actual"
      />
      {projection.length === 2 ? (
        <path
          className="fill-none stroke-(--chart-primary) stroke-3 [stroke-dasharray:9_8] [stroke-linecap:round]"
          d={pathFor(projection)}
          data-series="projection"
        />
      ) : null}
      {coordinates.map((point, index) => (
        <g key={point.label}>
          <circle
            className={
              point.projected
                ? "fill-(--chart-surface) stroke-(--chart-primary) stroke-3"
                : "fill-(--chart-primary) stroke-(--chart-surface) stroke-3"
            }
            cx={point.x}
            cy={point.y}
            data-projected={point.projected || undefined}
            r="5"
          >
            <title>{`${point.label}: ${displayWeth(point.permanentlyLockedWeth)}`}</title>
          </circle>
          {showAxisLabel(index, coordinates.length) ? (
            <text
              className={axisLabelClass}
              textAnchor={axisTextAnchor(index, coordinates.length)}
              x={point.x}
              y={CHART_HEIGHT - 9}
            >
              {point.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

export function PoolGrowthChart({
  points,
}: {
  readonly points: readonly PoolGrowthPoint[];
}) {
  const latest = points.at(-1);
  if (points.length < 2 || latest === undefined) {
    return <PoolGrowthSparse latest={latest} points={points} />;
  }
  const maximumLockedWeth = points.reduce(
    (maximum, point) =>
      point.permanentlyLockedWeth > maximum
        ? point.permanentlyLockedWeth
        : maximum,
    0n,
  );
  return (
    /* No figure or caption here: ChartFrame provides both, and rendering a
       second pair nested inside it duplicated the caption. */
    <div>
      <div className="overflow-x-auto">
        <PoolGrowthPlot
          coordinates={pointCoordinates(points)}
          maximumLockedWeth={maximumLockedWeth}
        />
      </div>
      <div className="px-3">
        <PoolGrowthDataTable points={points} />
      </div>
    </div>
  );
}
