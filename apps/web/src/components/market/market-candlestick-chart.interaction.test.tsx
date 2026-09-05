/** @vitest-environment jsdom */

import type { MarketCandle } from "@orbit/protocol/market-history";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MarketCandlestickChart } from "./market-candlestick-chart";

const x18 = 10n ** 18n;
const candle = (intervalStart: bigint): MarketCandle => ({
  intervalStart,
  intervalEnd: intervalStart + 3_600n,
  openWethPerLiquidTokenX18: x18,
  highWethPerLiquidTokenX18: 2n * x18,
  lowWethPerLiquidTokenX18: x18 / 2n,
  closeWethPerLiquidTokenX18: (3n * x18) / 2n,
  grossWethVolume: 10n * x18,
  protocolFeeWeth: (3n * x18) / 100n,
  swapCount: 2,
  matchedFeeCount: 2,
  feeMatchState: "complete",
});

/**
 * The exact-data table lives in a Base UI collapsible whose panel stays in the
 * document while closed, so opening it means clicking the trigger button rather
 * than toggling a `<details>`.
 */
const openDisclosure = async (
  container: HTMLElement,
  label: string,
): Promise<HTMLButtonElement> => {
  const trigger = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (trigger === undefined) {
    throw new Error(`No disclosure trigger containing "${label}".`);
  }
  await act(async () => {
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return trigger;
};

describe("hydrated market chart accessibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("focuses the chart once and reveals its exact table from the keyboard control", async () => {
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={[candle(1_700_000_000n), candle(1_700_003_600n)]}
          feeMatchingState="complete"
          interval="1h"
          range="all"
        />,
      ),
    );

    // The chart itself, advanced-chart control, and table disclosure. The point is that
    // per-observation marks never become tab stops. Controls parked inside a
    // closed disclosure panel are excluded: `hidden` takes them out of the tab
    // order. The vendor terminal is loaded client-side and is exercised in the
    // browser suite.
    const sequentialStops = [
      ...container.querySelectorAll(
        'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => node.closest("[hidden]") === null);
    expect(sequentialStops).toHaveLength(3);

    const chart = container.querySelector<SVGElement>("svg");
    chart?.focus();
    expect(document.activeElement).toBe(chart);

    const trigger = await openDisclosure(container, "Show exact");

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.nextElementSibling?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("keeps the readable chart as the default and loads terminal tools on demand", async () => {
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={[candle(1_700_000_000n), candle(1_700_003_600n)]}
          feeMatchingState="complete"
          interval="1h"
          range="all"
        />,
      ),
    );

    expect(container.querySelector("svg[role='img']")).not.toBeNull();
    expect(container.querySelector("[data-library='tradecanvas']")).toBeNull();

    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Open advanced chart",
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(
      container.querySelector("[data-library='tradecanvas']"),
    ).not.toBeNull();
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
  });
  it("bounds the chart and its data table to the selected range", async () => {
    const candles = Array.from({ length: 200 }, (_, index) =>
      candle(1_700_000_000n + BigInt(index) * 3_600n),
    );
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={candles}
          feeMatchingState="complete"
          interval="1h"
          range="24h"
        />,
      ),
    );

    await openDisclosure(container, "Show exact");

    // The table follows the range rather than rendering every indexed hour.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(24);
    expect(container.querySelectorAll("[role='list'] > *")).toHaveLength(25);
  });

  it("keeps the price axis clear of the candles it labels", async () => {
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={Array.from({ length: 24 }, (_, index) =>
            candle(1_700_000_000n + BigInt(index) * 3_600n),
          )}
          feeMatchingState="complete"
          interval="1h"
          range="24h"
        />,
      ),
    );

    // Every price tick starts to the right of the rightmost candle. Anchoring
    // them at the plot's left edge drew the first several candles underneath.
    const axis = container.querySelector("[data-chart-axis]");
    const ticks = [...(axis?.querySelectorAll("text") ?? [])]
      .map((node) => Number(node.getAttribute("x")))
      .filter((x) => x > 100);
    const marks = [
      ...container.querySelectorAll("[role='list'] line, [role='list'] rect"),
    ].map((node) =>
      Number(node.getAttribute("x") ?? node.getAttribute("x1") ?? "0"),
    );
    expect(ticks.length).toBeGreaterThan(2);
    expect(marks.length).toBeGreaterThan(0);
    expect(Math.min(...ticks)).toBeGreaterThan(Math.max(...marks));
  });

  it("summarises the plotted range for assistive technology", async () => {
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={[candle(1_700_000_000n), candle(1_700_003_600n)]}
          feeMatchingState="complete"
          interval="1h"
          range="7d"
        />,
      ),
    );

    expect(container.querySelector("desc")?.textContent).toContain(
      "traded intervals",
    );
  });
});
