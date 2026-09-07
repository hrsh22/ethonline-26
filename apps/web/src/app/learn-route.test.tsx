import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LearnPage from "./(collector)/learn/page";

describe("Learn and verify route", () => {
  it("leads with collector decisions and keeps proof available on demand", () => {
    const html = renderToStaticMarkup(<LearnPage />);

    expect(html).toContain("Learn and verify");
    expect(html).toContain("Buy $FUEL");
    expect(html).toContain("Launch is permanent");
    expect(html).not.toContain("a Orbiter");
    expect(html).toContain("All assets are valueless test assets");
    expect(html).toContain("Verify deployment contracts");
    expect(html).toContain("Protocol history");
    expect(html).toContain("Report a problem");
    expect(html).toContain(
      "no units are currently attached to that identity for claiming",
    );
    expect(html).not.toContain("no units have accrued");
    expect(html).toContain("sepolia.basescan.org/address/");
    expect(html).toContain("github.com/hrsh22/ethonline-26/issues");
    expect(html).toContain("All 27 deployed contracts");
    expect(html).toContain(
      "Private security reporting is not currently published",
    );
    expect(
      html.match(/sepolia\.basescan\.org\/address\//gu) ?? [],
    ).toHaveLength(27);
  });
});
