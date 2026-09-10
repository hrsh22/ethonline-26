import type { CanonicalMarketHistorySnapshot } from "@orbit/protocol/market-history";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TradeMarketChartContent } from "./trade-market-chart";

const candle = (start: bigint, close: bigint) => ({
  intervalStart: start,
  intervalEnd: start + 60n,
  openWethPerLiquidTokenX18: close,
  highWethPerLiquidTokenX18: close + 1n,
  lowWethPerLiquidTokenX18: close - 1n,
  closeWethPerLiquidTokenX18: close,
  grossWethVolume: 10n,
  protocolFeeWeth: 1n,
  swapCount: 1,
  matchedFeeCount: 1,
  feeMatchState: "complete" as const,
});

const snapshot: CanonicalMarketHistorySnapshot = {
  interval: "1m",
  candleSource: {
    kind: "indexed-history",
    state: "complete",
    indexedThroughBlock: 103n,
  },
  status: {
    state: "complete",
    fromBlock: 1n,
    indexedThroughBlock: 103n,
    indexedThroughTime: 1_700_000_180n,
    observedBlock: 103n,
    lagBlocks: 0n,
  },
  feeMatching: {
    state: "complete",
    matchedSwapCount: 3,
    unmatchedSwapCount: 0,
    unmatchedFeeCount: 0,
  },
  liquidityCycles: [],
  candles: [
    candle(1_700_000_000n, 8_000_000_000_000_000n),
    candle(1_700_000_060n, 9_000_000_000_000_000n),
    candle(1_700_000_120n, 10_000_000_000_000_000n),
  ],
};

describe("Trade market chart", () => {
  it("renders the real indexed candles with live price and range controls", () => {
    const html = renderToStaticMarkup(
      <TradeMarketChartContent
        history={{ status: "loaded", snapshot }}
        onRefresh={() => undefined}
        priceWei={10_000_000_000_000_000n}
      />,
    );

    expect(html).toContain("WETH / $FUEL");
    expect(html).toContain("24H");
    expect(html).toContain('aria-label="$FUEL market history"');
    expect(html).toContain("Complete history");
  });
});
