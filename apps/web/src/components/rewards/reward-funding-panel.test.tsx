/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  RewardFundingEvidence,
  RewardFundingPanel,
} from "./reward-funding-panel";

it("shows missing and index-error evidence honestly", () => {
  expect(
    renderToStaticMarkup(
      <RewardFundingEvidence
        result={{
          state: "unavailable",
          observedAt: 1,
          reason: "indexing-error",
        }}
      />,
    ),
  ).toContain("indexing error");
  const html = renderToStaticMarkup(
    <RewardFundingEvidence
      result={{
        state: "available",
        observedAt: 200_000,
        data: {
          _meta: {
            block: { number: 100, hash: null, timestamp: 100 },
            deployment: "test",
            hasIndexingErrors: false,
          },
          rewardFundingSummary: null,
        },
      }}
    />,
  );
  expect(html).toContain("indexed block 100");
  expect(html).toContain("100 seconds old");
  expect(html).toContain("not evidence of a zero reward balance");
  expect(html).toContain("Chain-head lag is unknown");
});

it("only queries on explicit demand and reports failed requests without polling", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<RewardFundingPanel />));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")?.click(),
    );
    expect(fetcher).not.toHaveBeenCalled();
    const load = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Load funding activity",
    );
    expect(load).toBeDefined();
    await act(async () => load?.click());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Funding analytics is unavailable");
    expect(container.textContent).toContain("Refresh funding activity");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("shows pooled funding allocations and standard market swaps separately from claims", () => {
  const poolId = `0x${"a".repeat(64)}`;
  const token = { id: `0x${"a".repeat(40)}`, symbol: "WETH", decimals: 18 };
  const html = renderToStaticMarkup(
    <RewardFundingEvidence
      result={{
        state: "available",
        observedAt: 200_000,
        data: {
          _meta: {
            block: { number: 100, hash: null, timestamp: null },
            deployment: "test",
            hasIndexingErrors: false,
          },
          rewardFundingSummary: {
            id: poolId,
            totalFeesWeth: "3000000000000000000",
            totalRewardsWeth: "2000000000000000000",
            totalLiquidityWeth: "850000000000000000",
            totalCreatorWeth: "150000000000000000",
            totalConvertedWeth: "1000000000000000000",
            feeEventCount: 10,
            conversionCount: 4,
            lastEventBlock: "100",
            lastEventTimestamp: "100",
            pool: {
              id: poolId,
              inputTokens: [token, { ...token, symbol: "FUEL" }],
              swaps: [
                {
                  id: "swap",
                  hash: poolId,
                  timestamp: "100",
                  amountIn: "1000000000000000000",
                  amountOut: "2000000000000000000",
                  tokenIn: token,
                  tokenOut: { ...token, symbol: "FUEL" },
                },
              ],
            },
          },
        },
      }}
    />,
  );
  expect(html).toContain("Allocated to rewards · 2%");
  expect(html).toContain("Allocated to liquidity · 0.85%");
  expect(html).toContain("Allocated to creator · 0.15%");
  expect(html).toContain("Recent indexed market swaps");
  expect(html).toContain(`https://sepolia.basescan.org/tx/${poolId}`);
  expect(html).toContain("Rewards are pooled");
  expect(html).toContain("index age unavailable");
});
