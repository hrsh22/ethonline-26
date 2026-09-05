import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity", async () => {
  const config = await import("@orbit/config/identity");
  const identity = config.selectIdentityConfiguration("neutral-test");
  return {
    applicationCopy: config.createIdentityApplicationCopy(identity),
    identity,
  };
});

import LearnPage from "./(collector)/learn/page";

describe("neutral Learn copy", () => {
  it("renders through the identity adapter without ORBIT vocabulary or doubled terms", () => {
    const html = renderToStaticMarkup(<LearnPage />);

    expect(html).toContain("Buy Test Liquid Token");
    expect(html).toContain("Commit is permanent");
    expect(html).toContain("Transient Collectible");
    expect(html).toContain("Permanent Collectible");
    expect(html).not.toMatch(
      /ORBIT|\$FUEL|Grounded Craft|Orbiter|Fleet|Reward Stocks|Station|Observatory/u,
    );
    expect(html).not.toContain("permanent Permanent Collectible");
  });
});
