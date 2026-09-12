"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { IndexedMarketHistoryRead } from "@/lib/market-history-state";
import { Button } from "@/components/ui/button";
import { Rate } from "@/components/ui/value";

const AdvancedChart = dynamic(() =>
  import("./trade-market-chart").then(
    (module) => module.TradeMarketChartContent,
  ),
);

const historyCandles = (history: IndexedMarketHistoryRead | undefined) =>
  history?.status === "loaded" || history?.status === "stale"
    ? history.snapshot.candles
    : [];
const chartEmptyMessage = (history: IndexedMarketHistoryRead | undefined) =>
  history === undefined || history.status === "loading"
    ? "Loading price history…"
    : history.status === "failed"
      ? "Price history is unavailable."
      : "More trades are needed to show price history.";
function chartPoints(history: IndexedMarketHistoryRead | undefined) {
  const candles = historyCandles(history);
  const observations = candles
    .flatMap((candle) =>
      candle.closeWethPerLiquidTokenX18 === undefined
        ? []
        : [
            {
              price: Number(candle.closeWethPerLiquidTokenX18),
              time: Number(candle.intervalStart),
            },
          ],
    )
    .slice(-120);
  const prices = observations.map((point) => point.price);
  const firstTime = observations[0]?.time ?? 0,
    lastTime = observations.at(-1)?.time ?? 0;
  const low = Math.min(...prices),
    high = Math.max(...prices);
  const points = observations
    .map(
      ({ price, time }) =>
        `${12 + ((time - firstTime) / Math.max(1, lastTime - firstTime)) * 576},${150 - ((price - low) / Math.max(1, high - low)) * 110}`,
    )
    .join(" ");
  return { prices, points };
}
function SimpleMarketChart({
  history,
}: {
  readonly history: IndexedMarketHistoryRead | undefined;
}) {
  const { prices, points } = chartPoints(history);
  return (
    <>
      {prices.length < 2 ? (
        <p className="py-8 text-body-sm text-ink-soft">
          {chartEmptyMessage(history)}
        </p>
      ) : (
        <svg
          viewBox="0 0 600 180"
          className="max-h-48 w-full"
          role="img"
          aria-label={`Recent FUEL closing prices across ${prices.length} observed intervals${history?.status === "stale" ? ", last known data" : ""}`}
        >
          <path
            d="M12 40H588M12 95H588M12 150H588"
            stroke="var(--border-subtle)"
            strokeWidth="1"
          />
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent-text)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <p className="text-caption text-ink-soft">
        {history?.status === "stale"
          ? "Last known history · updating"
          : "Recent market history"}
      </p>
    </>
  );
}

export function TradeMarketContext({
  history,
  priceWei,
  onRefresh,
}: {
  history: IndexedMarketHistoryRead | undefined;
  priceWei: bigint | undefined;
  onRefresh: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    try {
      // Restore this browser's explicit chart preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdvanced(localStorage.getItem("orbit:advanced-chart") === "true");
    } catch {
      /* Optional preference. */
    }
  }, []);
  return (
    <section
      aria-label="Market overview"
      className="grid min-w-0 gap-4 rounded-xl bg-surface-1 p-5 laptop:p-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title-sm text-ink-soft">FUEL price</h2>
          <p className="mt-2 text-heading">
            {priceWei === undefined ? (
              <span aria-label="Price unavailable">—</span>
            ) : (
              <Rate value={priceWei} />
            )}{" "}
            <span className="text-body text-ink-soft">WETH</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={advanced}
          aria-controls="advanced-market-chart"
          onClick={() => {
            setAdvanced(!advanced);
            try {
              localStorage.setItem("orbit:advanced-chart", String(!advanced));
            } catch {
              /* Optional preference. */
            }
          }}
        >
          {advanced ? "Simple chart" : "Advanced chart"}
        </Button>
      </div>
      {advanced ? (
        <div id="advanced-market-chart">
          <AdvancedChart
            history={history}
            onRefresh={onRefresh}
            priceWei={priceWei}
          />
        </div>
      ) : (
        <SimpleMarketChart history={history} />
      )}
      <Link
        href="/market"
        className="w-fit py-2 text-body-sm text-ink-soft underline underline-offset-4"
      >
        Market details
      </Link>
    </section>
  );
}
