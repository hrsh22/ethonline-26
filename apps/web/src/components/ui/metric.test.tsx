import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Metric, MetricGroup } from "./metric";

const strip = (hint?: string) =>
  renderToStaticMarkup(
    <MetricGroup columns={5} label="Destination-locked funds">
      <Metric
        label="Cumulative WETH committed"
        value="0.021071 WETH"
        {...(hint === undefined ? {} : { hint })}
      />
    </MetricGroup>,
  );

describe("metric strip", () => {
  /* A <div> may wrap a dt/dd group inside a <dl>, but only that group. The
     hint used to render as a sibling <p>, which axe reports as "dl element has
     direct children that are not allowed: div > p" -- and no gate saw it: the
     JSDOM audit reads server HTML, and the browser matrix stubs every RPC read
     with "0x", so /status renders its unavailable state and has no strip. */
  it("keeps the hint inside the description rather than beside it", () => {
    const html = strip("Historical WETH consumed by locked positions.");

    expect(html).toContain("Historical WETH consumed");
    const cell = /<div class="min-w-0[^"]*">(?<body>.*?)<\/div>/su.exec(html)
      ?.groups?.body;
    expect(cell).toBeDefined();
    // Only a dt and a dd, in that order, and nothing after the dd.
    expect(cell).toMatch(/^<dt\b[^>]*>.*<\/dt><dd\b[^>]*>.*<\/dd>$/su);
    expect(cell).not.toMatch(/<\/dd>\s*<p\b/u);
  });

  it("renders the same cell shape with no hint at all", () => {
    const cell = /<div class="min-w-0[^"]*">(?<body>.*?)<\/div>/su.exec(strip())
      ?.groups?.body;

    expect(cell).toMatch(/^<dt\b[^>]*>.*<\/dt><dd\b[^>]*>.*<\/dd>$/su);
  });

  it("names the group so a summary strip is reachable as a region", () => {
    expect(strip()).toContain('aria-label="Destination-locked funds"');
  });
});
