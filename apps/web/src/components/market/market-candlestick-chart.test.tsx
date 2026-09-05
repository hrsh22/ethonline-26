import type { MarketCandle } from "@orbit/protocol/market-history";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  candlesInRange,
  continuousCandlesInRange,
  marketChartSeries,
  MarketCandleDataTable,
  MarketCandlestickChart,
} from "./market-candlestick-chart";

const x18 = 10n ** 18n;

const candle = (
  start: bigint,
  values: Partial<MarketCandle> = {},
): MarketCandle => ({
  intervalStart: start,
  intervalEnd: start + 3_600n,
  openWethPerLiquidTokenX18: x18,
  highWethPerLiquidTokenX18: 2n * x18,
  lowWethPerLiquidTokenX18: x18 / 2n,
  closeWethPerLiquidTokenX18: (3n * x18) / 2n,
  grossWethVolume: 10n * x18,
  protocolFeeWeth: (3n * x18) / 100n,
  swapCount: 2,
  matchedFeeCount: 2,
  feeMatchState: "complete",
  ...values,
});

/**
 * The exact-data disclosure keeps its content in the document (Base UI's
 * `hiddenUntilFound` panel) so browser find-in-page can reach the evidence, so
 * "collapsed" is no longer "absent from the markup": it is a panel carrying
 * `hidden`. The panel is the only element that sets the collapsible height
 * variable, which makes it identifiable without depending on utility classes.
 */
const collapsiblePanels = (html: string) =>
  [...html.matchAll(/<div[^>]*--collapsible-panel-height[^>]*>/gu)].map(
    (match) => match[0],
  );

describe("WETH/FUEL candlestick chart", () => {
  it("hands the terminal millisecond OHLCV data without inventing idle volume", () => {
    const active = candle(1_700_000_000n);
    const idle = candle(1_700_003_600n, {
      openWethPerLiquidTokenX18: active.closeWethPerLiquidTokenX18,
      highWethPerLiquidTokenX18: active.closeWethPerLiquidTokenX18,
      lowWethPerLiquidTokenX18: active.closeWethPerLiquidTokenX18,
      closeWethPerLiquidTokenX18: active.closeWethPerLiquidTokenX18,
      grossWethVolume: 0n,
      protocolFeeWeth: 0n,
      swapCount: 0,
      matchedFeeCount: 0,
    });

    expect(marketChartSeries([active, idle])).toEqual([
      {
        time: 1_700_000_000_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      },
      {
        time: 1_700_003_600_000,
        open: 1.5,
        high: 1.5,
        low: 1.5,
        close: 1.5,
        volume: 0,
      },
    ]);
  });

  it("renders price and volume with a screen-reader table and non-color direction", () => {
    const html = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={[
          candle(1_700_000_000n),
          candle(1_700_003_600n, {
            openWethPerLiquidTokenX18: 2n * x18,
            closeWethPerLiquidTokenX18: x18,
          }),
        ]}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('data-direction="up"');
    expect(html).toContain('data-direction="down"');
    expect(html).toContain("data-chart-axis");
    expect(html).toContain("WETH volume");
    expect(html).toContain("Show exact traded hourly OHLCV data");
    expect(html).toContain('aria-expanded="false"');
    const panels = collapsiblePanels(html);
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((panel) => panel.includes('hidden=""'))).toBe(true);

    const table = renderToStaticMarkup(
      <MarketCandleDataTable candles={[candle(1_700_000_000n)]} />,
    );
    expect(table).toContain("Gross trader WETH volume");
    expect(table).toContain("Hook protocol fee");
    expect(table).toContain("10 WETH");
    expect(table).toContain("0.03 WETH");
  });

  it("renders candle dates in the viewer's supplied time zone", () => {
    const septemberFirstUtc = BigInt(
      Math.floor(Date.parse("2026-09-01T19:12:00Z") / 1_000),
    );
    const table = renderToStaticMarkup(
      <MarketCandleDataTable
        candles={[candle(septemberFirstUtc)]}
        interval="1m"
        timeZone="Asia/Kolkata"
      />,
    );

    expect(table).toContain("Sep 2, 2026");
    expect(table).toContain("Minute (Asia/Kolkata)");
  });

  it("carries the prior close through empty intervals with zero volume", () => {
    const html = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={[
          candle(1_700_000_000n),
          candle(1_700_003_600n, {
            openWethPerLiquidTokenX18: undefined,
            highWethPerLiquidTokenX18: undefined,
            lowWethPerLiquidTokenX18: undefined,
            closeWethPerLiquidTokenX18: undefined,
            grossWethVolume: 0n,
            protocolFeeWeth: 0n,
            swapCount: 0,
            matchedFeeCount: 0,
          }),
        ]}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );

    expect(html).toContain("No swaps · carried close");
    expect(html).toContain("volume 0 WETH");
    expect(html).toContain('data-direction="flat"');
    expect(html).not.toContain("data-candle-gap");
  });

  it("densifies sparse trades without inventing volume or swap counts", () => {
    const first = candle(0n, {
      intervalEnd: 60n,
      closeWethPerLiquidTokenX18: x18,
      grossWethVolume: 2n * x18,
      protocolFeeWeth: x18 / 10n,
      swapCount: 1,
      matchedFeeCount: 1,
    });
    const third = candle(120n, {
      intervalEnd: 180n,
      openWethPerLiquidTokenX18: 2n * x18,
      highWethPerLiquidTokenX18: 2n * x18,
      lowWethPerLiquidTokenX18: 2n * x18,
      closeWethPerLiquidTokenX18: 2n * x18,
      grossWethVolume: 3n * x18,
      protocolFeeWeth: x18 / 5n,
      swapCount: 1,
      matchedFeeCount: 1,
    });

    const series = continuousCandlesInRange([first, third], "all", 180n);

    expect(series.intervalSeconds).toBe(60n);
    expect(series.candles).toHaveLength(4);
    expect(series.candles[1]).toMatchObject({
      intervalStart: 60n,
      openWethPerLiquidTokenX18: x18,
      highWethPerLiquidTokenX18: x18,
      lowWethPerLiquidTokenX18: x18,
      closeWethPerLiquidTokenX18: x18,
      grossWethVolume: 0n,
      protocolFeeWeth: 0n,
      swapCount: 0,
      matchedFeeCount: 0,
    });
    expect(series.candles[2]).toMatchObject({
      intervalStart: 120n,
      closeWethPerLiquidTokenX18: 2n * x18,
      grossWethVolume: 3n * x18,
      swapCount: 1,
    });
    expect(series.candles[3]).toMatchObject({
      intervalStart: 180n,
      closeWethPerLiquidTokenX18: 2n * x18,
      grossWethVolume: 0n,
      swapCount: 0,
    });
  });

  it("keeps a no-trade 24-hour range chartable from the prior close", () => {
    const lastTrade = candle(1_700_000_000n, {
      intervalEnd: 1_700_000_060n,
      closeWethPerLiquidTokenX18: 2n * x18,
    });
    const through = lastTrade.intervalEnd + 48n * 3_600n;

    const series = continuousCandlesInRange([lastTrade], "24h", through);

    expect(series.intervalSeconds).toBe(300n);
    expect(series.candles.length).toBeGreaterThan(200);
    expect(series.candles.every((item) => item.swapCount === 0)).toBe(true);
    expect(
      series.candles.every(
        (item) => item.closeWethPerLiquidTokenX18 === 2n * x18,
      ),
    ).toBe(true);
    expect(series.candles.every((item) => item.grossWethVolume === 0n)).toBe(
      true,
    );
  });

  it("keeps a multi-year all-time chart below the render cap", () => {
    const firstTrade = candle(0n, { intervalEnd: 60n });
    const through = 730n * 86_400n;

    const series = continuousCandlesInRange([firstTrade], "all", through);

    expect(series.candles.length).toBeLessThanOrEqual(500);
    expect(series.intervalSeconds).toBeGreaterThanOrEqual(86_400n);
  });

  it("renders an honest sparse-history placeholder", () => {
    const html = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={[]}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("No indexed swaps yet");
  });

  it("warns when an empty chart also has unmatched fee evidence", () => {
    const html = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={[]}
        feeMatchingState="partial"
        interval="1h"
        range="all"
      />,
    );

    expect(html).toContain("Some swaps could not be matched");
    expect(html).toContain('data-state="partial"');
    expect(html.match(/role="(?:alert|status)"/gu)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"');
  });

  it("keeps the visual bounded while the exact table retains every interval", () => {
    const candles = Array.from({ length: 501 }, (_, index) =>
      candle(1_700_000_000n + BigInt(index) * 3_600n),
    );
    const closedChart = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={candles}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );
    const exactTable = renderToStaticMarkup(
      <MarketCandleDataTable candles={candles} />,
    );

    // The full-fidelity table ships with the page so find-in-page can reach it,
    // but every collapsed panel stays hidden until the reader asks for it.
    const panels = collapsiblePanels(closedChart);
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((panel) => panel.includes('hidden=""'))).toBe(true);
    expect(exactTable.match(/<tr>/gu)).toHaveLength(502);
  });

  it("applies ranges from the indexed-through time rather than the latest trade", () => {
    const latest = 1_700_100_000n;
    const sparse = [candle(latest - 100n * 3_600n), candle(latest)];
    const indexedThrough = latest + 48n * 3_600n;

    expect(candlesInRange(sparse, "24h", indexedThrough)).toEqual([]);
    expect(candlesInRange(sparse, "7d", indexedThrough)).toEqual(sparse);
  });

  it("uses one chart tab stop instead of one per observation", () => {
    const candles = Array.from({ length: 500 }, (_, index) =>
      candle(1_700_000_000n + BigInt(index) * 3_600n),
    );
    const html = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={candles}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );

    const sparse = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={candles.slice(0, 2)}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );

    // Exactly one graphic tab stop, no matter how many marks it draws. The
    // remaining stops are the chrome around it — the advanced-chart control and
    // the disclosure triggers — which are buttons and so do not scale with the
    // observation count.
    expect(html.match(/<svg[^>]*tabindex="0"/gu)).toHaveLength(1);
    expect(html.match(/tabindex="0"/gu)).toEqual(
      sparse.match(/tabindex="0"/gu),
    );
    expect(html).toContain("Open advanced chart");
  });
});
