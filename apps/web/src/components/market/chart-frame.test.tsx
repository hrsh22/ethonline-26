import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChartFrame } from "./chart-frame";

const frame = (observations: number) =>
  renderToStaticMarkup(
    <ChartFrame
      caption="Hourly WETH per $FUEL."
      emptyDescription="No swaps have been indexed for this range yet."
      emptyTitle="No swaps indexed yet"
      label="Market history"
      observations={observations}
      sparseDescription="Two observations cannot show a trend."
      sparseTitle="Not enough history"
    >
      <svg data-plot />
    </ChartFrame>,
  );

describe("chart frame", () => {
  it("draws no plot when there is nothing to plot", () => {
    const html = frame(0);
    expect(html).not.toContain("data-plot");
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No swaps have been indexed");
  });

  it("still shows a short history, but says it is not a trend", () => {
    const html = frame(2);
    // The values are real; hiding them would be worse than showing them.
    expect(html).toContain("data-plot");
    expect(html).toContain('data-sparse="true"');
    expect(html).toContain("cannot show a trend");
    // A range holding two plotted swaps must not announce that it holds
    // none: the sparse state gets its own title rather than the empty one.
    expect(html).toContain("Not enough history");
    expect(html).not.toContain("No swaps indexed yet");
    // The plot keeps its own size: a clamp here crops observations rather
    // than scaling them, and hiding observations while saying they are shown
    // is worse than the defect being fixed.
    expect(html).not.toContain("h-48");
  });

  it("draws the full plot once there is a shape to read", () => {
    const html = frame(3);
    expect(html).toContain("data-plot");
    expect(html).not.toContain("data-sparse");
    expect(html).not.toContain("cannot show a trend");
  });

  it("captions every figure", () => {
    expect(frame(5)).toContain("Hourly WETH per $FUEL.");
    expect(frame(5)).toContain('aria-label="Market history"');
  });
});
