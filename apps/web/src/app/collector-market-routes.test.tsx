import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/trade/exchange-panel", () => ({
  ExchangePanel: () => <section>Focused trade form</section>,
}));

vi.mock("@/components/market/market-dashboard", () => ({
  MarketDashboard: () => (
    <section>
      <h1>Market activity and liquidity</h1>
      Complete indexed market history
    </section>
  ),
}));

vi.mock("@/components/home/home-boards", () => ({
  FeeRoutingPanel: () => null,
  RewardTracksPanel: () => null,
  SpecimenPanel: () => null,
}));

vi.mock("@/components/home/protocol-summary", () => ({
  ProtocolSummary: () => <section>Public collection signal</section>,
}));

import ExchangePage from "./(collector)/exchange/page";
import HomePage from "./(collector)/page";
import MarketPage from "./(collector)/market/page";

describe("collector trade and market routes", () => {
  it("starts a new collector in the guided journey and keeps Trade secondary", () => {
    const html = renderToStaticMarkup(<HomePage />);

    const start = html.indexOf('href="/start"');
    const trade = html.indexOf('href="/exchange"');
    expect(start).toBeGreaterThan(-1);
    expect(trade).toBeGreaterThan(start);
    expect(html).toContain('href="/start">Start collecting</a>');
    expect(html).toContain('href="/exchange">Trade $FUEL</a>');
    expect(html).toContain("Every whole $FUEL reveals a random Grounded Craft");
  });

  it("keeps the Exchange route focused on the trade task", () => {
    const html = renderToStaticMarkup(<ExchangePage />);

    // The route title names the task and matches its shell destination; the
    // assets it trades belong in the lede, not in an h1 that wraps twice.
    expect(html).toContain(">Trade</h1>");
    expect(html).toContain("Buy and sell $FUEL for ETH or WETH");
    expect(html).toContain("Focused trade form");
    expect(html).not.toContain("Complete indexed market history");
  });

  it("gives complete public telemetry its own Market route", () => {
    const html = renderToStaticMarkup(<MarketPage />);

    expect(html).toContain("Market activity and liquidity");
    expect(html).toContain("Complete indexed market history");
  });
});
