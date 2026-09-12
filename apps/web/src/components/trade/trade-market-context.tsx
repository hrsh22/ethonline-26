"use client";

import dynamic from "next/dynamic";

import type { IndexedMarketHistoryRead } from "@/lib/market-history-state";

/* The interactive chart is the single chart view; its module loads after
 * hydration so the order form is usable first. */
const TradeMarketChart = dynamic(() =>
  import("./trade-market-chart").then(
    (module) => module.TradeMarketChartContent,
  ),
);

export function TradeMarketContext({
  history,
  priceWei,
  onRefresh,
}: {
  readonly history: IndexedMarketHistoryRead | undefined;
  readonly priceWei: bigint | undefined;
  readonly onRefresh: () => void;
}) {
  return (
    <section
      aria-label="Market overview"
      className="flex min-h-[28rem] min-w-0 flex-col rounded-[var(--radius-surface)] border border-line bg-surface-1 shadow-[var(--shadow-raised)]"
    >
      <TradeMarketChart
        history={history}
        onRefresh={onRefresh}
        priceWei={priceWei}
      />
    </section>
  );
}
