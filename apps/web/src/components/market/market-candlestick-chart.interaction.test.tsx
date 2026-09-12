/** @vitest-environment jsdom */

import type { MarketCandle } from "@orbit/protocol/market-history";
import {
  CrosshairTooltip,
  DARK_THEME,
  type DataSeries,
} from "@tradecanvas/chart";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketCandlestickChart } from "./market-candlestick-chart";

// The external canvas widget cannot render in JSDOM. Its data API scrolls to
// the end, so model that behavior instead of assuming setData preserves a view.
vi.mock("@tradecanvas/chart/widget", () => ({
  ChartWidget: class {
    data: DataSeries = [];
    viewport = document.createElement("div");
    view = document.createElement("input");
    value = document.createElement("output");
    listener:
      ((event: { payload: { from: number; to: number } }) => void) | undefined;
    constructor(container: HTMLElement) {
      this.viewport.className = "tcw-chart-container";
      this.viewport.tabIndex = 0;
      this.viewport.style.outline = "none";
      this.view.setAttribute("aria-label", "Chart first visible timestamp");
      this.view.addEventListener("change", () => {
        const from = this.data.findIndex(
          (bar) => bar.time === Number(this.view.value),
        );
        this.listener?.({ payload: { from, to: from + 1 } });
      });
      this.viewport.append(this.view, this.value);
      container.append(this.viewport);
    }
    setData(data: DataSeries) {
      this.data = data;
      this.value.textContent = String(data.at(-1)?.close);
      this.value.dataset.candleCount = String(data.length);
      this.view.value = String(data.at(-1)?.time);
      this.listener?.({
        payload: { from: Math.max(0, data.length - 1), to: data.length },
      });
    }
    getChart() {
      return {
        getData: () => this.data,
        setMarket: () => undefined,
        fitContent: () => {
          this.view.value = String(this.data[0]?.time);
        },
        scrollTo: (timestamp: number) => {
          this.view.value = String(timestamp);
        },
        on: (_type: string, listener: typeof this.listener) => {
          this.listener = listener;
        },
      };
    }
    destroy() {
      this.viewport.remove();
    }
  },
}));

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
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.stubGlobal("ResizeObserver", vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps sub-cent OHLC values precise in the advanced-chart hover card", () => {
    const tooltip = new CrosshairTooltip();
    tooltip.create(container);
    tooltip.show(
      { x: 100, y: 100 },
      {
        time: Date.parse("2026-09-07T12:00:00Z"),
        open: 0.005927444312077907,
        high: 0.005927444312077907,
        low: 0.005795143499402389,
        close: 0.005795143499402389,
        volume: 0.291,
      },
      DARK_THEME,
      { width: 400, height: 300 },
    );

    expect(container.textContent).toContain("O 0.0059274443 H 0.0059274443");
    expect(container.textContent).toContain("L 0.0057951435 C 0.0057951435");
    expect(container.textContent).not.toContain("O 0.01 H 0.01");
    tooltip.destroy();
  });

  it("keeps the chosen chart view while refreshed candles update", async () => {
    const render = async (lastClose: bigint) => {
      await act(async () =>
        root.render(
          <MarketCandlestickChart
            candles={[
              candle(3_600n),
              candle(7_200n),
              {
                ...candle(10_800n),
                highWethPerLiquidTokenX18: 4n * x18,
                closeWethPerLiquidTokenX18: lastClose,
              },
            ]}
            feeMatchingState="complete"
            interval="1h"
            range="all"
          />,
        ),
      );
    };
    await render(x18);
    const view = container.querySelector<HTMLInputElement>(
      "input[aria-label='Chart first visible timestamp']",
    );
    expect(view).not.toBeNull();
    view!.value = "7200000";
    view!.dispatchEvent(new Event("change"));

    await render(3n * x18);

    expect(
      container.querySelector<HTMLInputElement>(
        "input[aria-label='Chart first visible timestamp']",
      )?.value,
    ).toBe("7200000");
    expect(container.querySelector("output")?.textContent).toBe("3");
  });

  it("opens advanced tools immediately with an accessible summary and no simple-chart or OHLCV controls", async () => {
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={[candle(3_600n), candle(7_200n)]}
          feeMatchingState="complete"
          interval="1h"
          range="all"
        />,
      ),
    );
    const chart = container.querySelector("[data-library='tradecanvas']");
    expect(chart?.getAttribute("role")).toBe("region");
    expect(chart?.getAttribute("aria-label")).toContain("traded intervals");
    expect(chart?.hasAttribute("aria-hidden")).toBe(false);
    const viewport = chart?.querySelector<HTMLElement>(".tcw-chart-container");
    expect(viewport?.getAttribute("role")).toBe("img");
    expect(viewport?.getAttribute("aria-label")).toBe(
      "Interactive $FUEL market chart",
    );
    expect(viewport?.tabIndex).toBe(0);
    expect(viewport?.style.outline).toBe("");
    expect(viewport?.style.outlineOffset).toBe("-3px");
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("Open advanced chart");
    expect(container.textContent).not.toContain("Show exact");
  });

  it("offers an accessible retry if the chart cannot initialize", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    await act(async () =>
      root.render(
        <MarketCandlestickChart
          candles={[candle(3_600n), candle(7_200n)]}
          feeMatchingState="complete"
          interval="1h"
          range="all"
        />,
      ),
    );
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Chart could not load",
    );
    expect(container.textContent).toContain("traded intervals");
    expect(container.querySelector("svg")).toBeNull();
    vi.stubGlobal("ResizeObserver", vi.fn());
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry chart",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(
      container
        .querySelector("[data-library='tradecanvas']")
        ?.getAttribute("role"),
    ).toBe("region");
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("bounds advanced chart observations to the selected range", async () => {
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
    expect(container.querySelector("output")?.dataset.candleCount).toBe("25");
    expect(container.querySelector("table")).toBeNull();
  });
});
