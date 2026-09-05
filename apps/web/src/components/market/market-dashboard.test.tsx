import type { CanonicalMarketHistorySnapshot } from "@orbit/protocol/market-history";
import { IndexedHistoryError } from "@orbit/protocol/history";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  deriveMarketBalances,
  deriveMarketDashboardModel,
  MarketDashboardContent,
} from "./market-dashboard";
import { protocolDeploymentManifest } from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";

const health = {
  market: {
    rewardPotWeth: 1n,
    liquidityPotWeth: 2n,
    creatorPotWeth: 3n,
    activeLiquidity: 100n,
    poolId: `0x${"1".repeat(64)}`,
    price: { wethPerLiquidTokenFormatted: "0.01" },
  },
  operations: {
    trackQueues: [1n, 2n, 3n, 4n].map((weth) => ({ weth })),
    protocolOwnedLiquidity: {
      cycleCount: 2n,
      queuedWeth: 5n,
      permanentlyLockedWeth: 7n,
    },
    recentEvents: [],
  },
  deployment: { observedBlock: 200n },
} as const;

const history = (
  state: "complete" | "partial",
): CanonicalMarketHistorySnapshot => ({
  interval: "1m",
  candleSource: {
    kind: "indexed-history",
    state,
    indexedThroughBlock: 190n,
  },
  status: {
    state,
    fromBlock: 10n,
    indexedThroughBlock: 190n,
    indexedThroughTime: 1_700_000_000n,
    observedBlock: 200n,
    lagBlocks: 10n,
  },
  feeMatching: {
    state: "complete",
    matchedSwapCount: 0,
    unmatchedSwapCount: 0,
    unmatchedFeeCount: 0,
  },
  liquidityCycles: [1n, 2n].map((cycleNumber) => ({
    cycleNumber,
    blockNumber: 100n + cycleNumber,
    blockTimestamp: 1_700_000_000n + cycleNumber,
    transactionHash: `0x${cycleNumber.toString().padStart(64, "0")}`,
    pulledWeth: 10n,
    consumedWeth: 8n,
    queuedWeth: 2n,
    permanentlyLockedWeth: cycleNumber * 3n,
    tickLower: -120,
    tickUpper: -60,
    liquidity: 1_000n,
  })),
  candles: [],
});

describe("plain-language market balances", () => {
  it("includes downstream queues and locked liquidity in the visible totals", () => {
    const health = {
      market: {
        rewardPotWeth: 1n,
        liquidityPotWeth: 2n,
        creatorPotWeth: 3n,
      },
      operations: {
        trackQueues: [1n, 2n, 3n, 4n].map((weth) => ({ weth })),
        protocolOwnedLiquidity: {
          queuedWeth: 5n,
          permanentlyLockedWeth: 7n,
        },
      },
    };

    expect(deriveMarketBalances(health as never)).toEqual({
      creatorWaiting: 3n,
      liquidityTotal: 14n,
      liquidityWaiting: 7n,
      rewardsWaiting: 11n,
    });
  });

  it("does not display a false zero when a source read is unavailable", () => {
    const health = {
      market: {
        rewardPotWeth: undefined,
        liquidityPotWeth: 2n,
        creatorPotWeth: 3n,
      },
      operations: {
        trackQueues: [{ weth: 1n }],
        protocolOwnedLiquidity: {
          queuedWeth: undefined,
          permanentlyLockedWeth: 7n,
        },
      },
    };

    expect(deriveMarketBalances(health as never)).toMatchObject({
      liquidityTotal: undefined,
      liquidityWaiting: undefined,
      rewardsWaiting: undefined,
    });
  });

  it("uses every indexed cycle even when the old route health window is empty", () => {
    const model = deriveMarketDashboardModel(health as never, {
      status: "loaded",
      snapshot: history("complete"),
    });

    expect(health.operations.recentEvents).toEqual([]);
    expect(model.growthPoints.map((point) => point.label)).toEqual([
      "Start",
      "Cycle 1",
      "Cycle 2",
      "Locked + pipeline",
    ]);
  });

  it("keeps indexed history visible when the independent live-health read is unavailable", () => {
    const indexed = {
      ...history("complete"),
      candles: [
        {
          intervalStart: 1_700_000_000n,
          intervalEnd: 1_700_000_060n,
          openWethPerLiquidTokenX18: 2n,
          highWethPerLiquidTokenX18: 3n,
          lowWethPerLiquidTokenX18: 1n,
          closeWethPerLiquidTokenX18: 3n,
          grossWethVolume: 10n,
          protocolFeeWeth: 1n,
          swapCount: 1,
          matchedFeeCount: 1,
          feeMatchState: "complete" as const,
        },
      ],
    };
    const model = deriveMarketDashboardModel(
      undefined,
      {
        status: "loaded",
        snapshot: indexed,
      },
      {
        observedBlock: 198n,
        funds: {
          rewardWethWaiting: 11n,
          liquidityWaitingWeth: 7n,
          liquidityLockedWeth: 9n,
          creatorWeth: 3n,
        },
      } as never,
    );

    expect(model.growthPoints.map((point) => point.label)).toEqual([
      "Start",
      "Cycle 1",
      "Cycle 2",
      "Locked + pipeline",
    ]);
    expect(model.feeMatchingState).toBe("complete");
    expect(model.poolId).toBe(protocolDeploymentManifest?.canonicalPool.poolId);
    expect(model.metrics.map((metric) => metric.wei)).toEqual([
      3n,
      11n,
      16n,
      3n,
    ]);
    expect(model.observedBlock).toBe("198");
  });

  it("shows one explicit live-balance state instead of a strip of unavailable values", () => {
    const markup = renderToStaticMarkup(
      <MarketDashboardContent
        health={undefined}
        history={{ status: "loading" }}
        onRefreshHistory={() => undefined}
        publicStatusPending
      />,
    );

    expect(markup).toContain("Loading live balances");
    expect(markup).toContain("Loading indexed market history");
    expect(markup).not.toContain("WETH per $FUEL (WETH / $FUEL)");
  });

  it("renders explicit loading, partial, and failure states for indexed history", () => {
    const loading = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loading" }}
        onRefreshHistory={() => undefined}
      />,
    );
    const partial = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loaded", snapshot: history("partial") }}
        onRefreshHistory={() => undefined}
      />,
    );
    const failed = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "failed", error: new Error("private upstream") }}
        onRefreshHistory={() => undefined}
      />,
    );

    expect(loading).toContain("Loading indexed market history");
    expect(partial).toContain("Partial history");
    expect(partial).toContain("Indexed through block 190");
    expect(partial).toContain("POC reference curve");
    expect(partial).toContain("not the current market price");
    expect(partial).toContain("average execution price");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Retry indexed history");
    expect(failed).not.toContain("private upstream");
  });

  it("keeps every dashboard section directly beneath the page heading", () => {
    const loading = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loading" }}
        onRefreshHistory={() => undefined}
      />,
    );
    const loaded = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loaded", snapshot: history("complete") }}
        onRefreshHistory={() => undefined}
      />,
    );
    const headingLevels = (markup: string) =>
      [...markup.matchAll(/<h([1-6])(?:\s|>)/g)].map((match) => match[1]);

    // The route owns the h1; the dashboard contributes only section headings,
    // so a reader navigating by outline still descends exactly one level.
    // The route owns the h1; the dashboard contributes only section headings,
    // so a reader navigating by outline still descends exactly one level. The
    // pool's technical identity is a disclosure rather than a heading, because
    // a collapsed trigger is a button and should not appear in the outline.
    expect(headingLevels(loading)).toEqual(["2"]);
    expect(headingLevels(loaded)).toEqual(["2", "2", "2"]);
  });

  it("keeps confirmed charts but never labels them complete after a refresh failure", () => {
    const stale = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={
          {
            status: "stale",
            snapshot: history("complete"),
            error: new IndexedHistoryError(
              "history-rpc-unavailable",
              "private refresh failure",
              503,
            ),
          } as never
        }
        onRefreshHistory={() => undefined}
      />,
    );

    expect(stale).toContain("History refresh failed");
    expect(stale).toContain('role="status"');
    expect(stale).toContain('aria-live="polite"');
    expect(stale).toContain('data-state="stale"');
    expect(stale).not.toContain('role="alert"');
    expect(stale).not.toContain("market-history-state failed");
    expect(stale).toContain("Protocol-Owned Liquidity growth");
    expect(stale).not.toContain("Locked + pipeline");
    expect(stale).not.toContain("Complete history");
    expect(stale).not.toContain("private refresh failure");
  });
  const renderLoaded = () =>
    renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loaded", snapshot: history("complete") }}
        onRefreshHistory={() => undefined}
      />,
    );

  it("leads with price and the chart before opening-curve education", () => {
    const html = renderLoaded();
    // The metric strip is addressed by its accessible name now, not by the
    // grid class the route stylesheet used to give it.
    const metricsIndex = html.indexOf(
      `aria-label="${applicationCopy.market.title}"`,
    );
    const chartIndex = html.indexOf('id="market-candle-heading"');
    const educationIndex = html.indexOf(
      applicationCopy.exchange.openingCurveTitle,
    );
    expect(metricsIndex).toBeGreaterThan(-1);
    expect(chartIndex).toBeGreaterThan(-1);
    expect(educationIndex).toBeGreaterThan(-1);
    expect(metricsIndex).toBeLessThan(chartIndex);
    expect(chartIndex).toBeLessThan(educationIndex);
  });

  it("shows a readable chart before offering advanced terminal tools", () => {
    const x18 = 10n ** 18n;
    const snapshot = {
      ...history("complete"),
      candles: Array.from({ length: 8 }, (_, index) => ({
        intervalStart: 1_700_000_000n + BigInt(index) * 3_600n,
        intervalEnd: 1_700_003_600n + BigInt(index) * 3_600n,
        openWethPerLiquidTokenX18: x18,
        highWethPerLiquidTokenX18: 2n * x18,
        lowWethPerLiquidTokenX18: x18 / 2n,
        closeWethPerLiquidTokenX18: (3n * x18) / 2n,
        grossWethVolume: 10n * x18,
        protocolFeeWeth: (3n * x18) / 100n,
        swapCount: 2,
        matchedFeeCount: 2,
        feeMatchState: "complete" as const,
      })),
    };
    const html = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loaded", snapshot }}
        onRefreshHistory={() => undefined}
      />,
    );

    const plot = html.indexOf("<figure");
    expect(plot).toBeGreaterThan(-1);
    expect(html).not.toContain('data-library="tradecanvas"');
    expect(html).toContain("Open advanced chart");
    expect(html).toContain('aria-label="Chart range"');
    expect(html).not.toContain(
      `aria-label="${applicationCopy.exchange.candleLegend}"`,
    );
    expect(html).not.toContain("continuous 1-hour candle");
    expect(html).toContain("Latest indexed trade");
    expect(html).toContain("Available-range volume");
    expect(html).toContain("Indexed through");
    expect(html).toContain("Show exact traded minute OHLCV data");
    expect(html).toContain("Verify indexed history");
  });

  it("labels official Uniswap OHLC separately from the indexed fallback", () => {
    const external = {
      ...history("complete"),
      interval: "1h" as const,
      candleSource: {
        kind: "uniswap-v4-subgraph" as const,
        state: "complete" as const,
        indexedThroughBlock: 190n,
      },
    };
    const externalHtml = renderToStaticMarkup(
      <MarketDashboardContent
        health={health as never}
        history={{ status: "loaded", snapshot: external }}
        onRefreshHistory={() => undefined}
      />,
    );
    const fallbackHtml = renderLoaded();

    expect(externalHtml).toContain("Uniswap v4 OHLC");
    expect(fallbackHtml).toContain("Uniswap v4 PoolManager events");
  });

  it("keeps the opening-curve explanation available behind disclosure", () => {
    const html = renderLoaded();
    // Collapsed, but kept in the document with `hidden="until-found"` so the
    // browser's own page search can still find and open the explanation.
    expect(html).toContain("How the opening price was set");
    expect(html).toContain("POC reference curve");
  });
});
