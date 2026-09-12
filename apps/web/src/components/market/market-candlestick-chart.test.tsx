import type { MarketCandle } from "@orbit/protocol/market-history";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  candlesInRange,
  continuousCandlesInRange,
  marketChartSeries,
  displayMarketTime,
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

describe("WETH/FUEL candlestick chart", () => {
  it("renders the advanced chart loading surface without a simple chart or OHLCV disclosure", () => {
    const html = renderToStaticMarkup(
      <MarketCandlestickChart
        candles={[candle(1_700_000_000n), candle(1_700_003_600n)]}
        feeMatchingState="complete"
        interval="1h"
        range="all"
      />,
    );
    expect(html).toContain('data-library="tradecanvas"');
    expect(html).toContain("Loading market chart");
    expect(html).toContain("traded intervals");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Open advanced chart");
    expect(html).not.toContain("Show exact");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<table");
  });

  it("formats market dates in the supplied time zone", () => {
    const timestamp = BigInt(
      Math.floor(Date.parse("2026-09-06T19:12:00Z") / 1_000),
    );
    expect(displayMarketTime(timestamp, "Asia/Kolkata")).toContain(
      "Sep 7, 2026",
    );
  });

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

  it("applies ranges from the indexed-through time rather than the latest trade", () => {
    const latest = 1_700_100_000n;
    const sparse = [candle(latest - 100n * 3_600n), candle(latest)];
    const indexedThrough = latest + 48n * 3_600n;

    expect(candlesInRange(sparse, "24h", indexedThrough)).toEqual([]);
    expect(candlesInRange(sparse, "7d", indexedThrough)).toEqual(sparse);
  });
});
