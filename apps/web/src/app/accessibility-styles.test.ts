import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("responsive accessibility styles", () => {
  it("keeps operator numeric controls at 16px or larger on iOS", () => {
    /* iOS zooms the page when a focused input is smaller than 16px. Both
       operator amount fields are plain inputs styled with utilities, so the
       guarantee is read from their sources: the input must carry a type step
       of at least 1rem (`lede` is the first such step; `body` is 14px). */
    for (const file of [
      "../components/admin/admin-track-action-card.tsx",
      "../components/admin/admin-creator-fee-card.tsx",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const input = /<input[\s\S]*?className="(?<classes>[^"]*)"/u.exec(source);
      expect(input?.groups?.classes, file).toMatch(
        /\btext-(?:lede|title|heading)\b/u,
      );
      expect(input?.groups?.classes, file).not.toMatch(
        /\btext-(?:label|caption|body-sm|body|xs|sm)\b/u,
      );
    }
  });

  it("keeps the chart's single keyboard stop inside the global focus ring", () => {
    // The chart is one focusable SVG. It must not opt out of the shared
    // `:focus-visible` outline, and it may only adjust the ring's offset so
    // the outline stays inside the scrolling frame instead of being clipped.
    const chartSource = readFileSync(
      new URL(
        "../components/market/market-candlestick-chart.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(chartSource).toMatch(/tabIndex=\{0\}/u);
    expect(chartSource).toMatch(/focus-visible:-outline-offset-/u);
    expect(chartSource).not.toMatch(
      /outline-none|focus:outline-0|focus-visible:outline-0/u,
    );
  });

  it("contains exact token balances inside a metric cell", () => {
    // A balance of one base unit renders eighteen decimals, which is wider
    // than a six-column cell. The guarantee lives in the shared metric
    // primitive, so it holds everywhere a metric is rendered.
    const metricSource = readFileSync(
      new URL("../components/ui/metric.tsx", import.meta.url),
      "utf8",
    );
    expect(metricSource).toContain("min-w-0");
    expect(metricSource).toContain("[overflow-wrap:anywhere]");
  });
});
