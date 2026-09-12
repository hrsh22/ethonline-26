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
  it("offers direct Trade and Explore without an onboarding ladder", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).not.toContain('href="/start"');
    expect(html).not.toContain("How collecting works");
    expect(html).toContain('href="/explore"');
    expect(html).toContain('href="/exchange">Trade $FUEL</a>');
    expect(html).toContain("Find the craft worth keeping.");
    expect(html).toContain("From first Discovery to forever.");
    expect(html).not.toContain("Editorial artwork");
    expect(html).not.toContain("Public collection signal");
  });

  it("keeps the Exchange route focused on the trade task", () => {
    const html = renderToStaticMarkup(<ExchangePage />);

    // The route title names the task and matches its shell destination; the
    // assets it trades belong in the lede, not in an h1 that wraps twice.
    expect(html).toContain(">Trade</h1>");
    expect(html).toContain(
      "Buy FUEL to discover craft, or sell from your balance.",
    );
    expect(html).toContain("Focused trade form");
    expect(html).not.toContain("Complete indexed market history");
  });

  it("gives complete public telemetry its own Market route", () => {
    const html = renderToStaticMarkup(<MarketPage />);

    expect(html).toContain("Market activity and liquidity");
    expect(html).toContain("Complete indexed market history");
  });
});
