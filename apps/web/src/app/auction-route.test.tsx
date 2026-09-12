import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auction/auction-panel", () => ({
  AuctionPanel: () => <section>Collector auction instrument</section>,
}));

import AuctionPage from "./(collector)/auction/page";

describe("collector auction route", () => {
  it("explains the clearing-price decision before the wallet instrument", () => {
    const html = renderToStaticMarkup(<AuctionPage />);
    expect(html).toContain(">Auction</h1>");
    expect(html).toContain("Follow the auction and manage your allocation");
    expect(html).toContain("Collector auction instrument");
  });
});
