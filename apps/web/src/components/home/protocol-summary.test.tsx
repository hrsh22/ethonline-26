import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({ protocol: undefined as unknown }));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => protocolState.protocol,
}));

import { FeeRoutingPanel, RewardTracksPanel } from "./home-boards";
import { ProtocolSummary } from "./protocol-summary";

describe("protocol summary", () => {
  it("keeps block-level proof on Status instead of the home summary", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      publicStatus: {
        health: "healthy",
        freshness: "fresh",
        observedBlock: 123n,
        collection: {
          available: 4_400,
          permanent: 4,
          transient: 8,
        },
        funds: {},
      },
      publicStatusError: null,
      publicStatusPending: false,
    };

    const html = renderToStaticMarkup(<ProtocolSummary />);

    expect(html).toContain("4,400");
    expect(html).toContain('href="/status"');
    expect(html).not.toContain("Observed block");
    expect(html).not.toContain("123");
  });

  it("does not call an unobserved launch state not launched while health loads", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      publicStatus: undefined,
      publicStatusError: null,
      publicStatusPending: true,
    };

    const html = renderToStaticMarkup(<ProtocolSummary />);

    expect(html).toContain("Loading");
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('role="status"');
    // Known deployment facts remain useful while live counts refresh; the
    // first viewport never becomes a row of em dashes.
    expect(html).toContain("4,444");
    expect(html).toContain("Base Sepolia");
    expect(html).not.toContain("Not launched");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("Not loaded");
    expect(html).not.toContain("—");
  });

  it("never exposes raw health-read failures on the public home page", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      publicStatus: undefined,
      publicStatusError: new Error("private RPC URL failed"),
      publicStatusPending: false,
    };

    const html = renderToStaticMarkup(<ProtocolSummary />);

    expect(html).toContain("Read failed");
    expect(html).toContain('data-state="error"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("private RPC URL failed");
    expect(html).not.toContain("Not launched");
    expect(html).not.toContain("Refreshing…");
    expect(html).toContain("Read failed");
  });

  it("does not claim a refresh is active when deployment is unavailable", () => {
    protocolState.protocol = {
      deploymentAvailable: false,
      publicStatus: undefined,
      publicStatusError: null,
      publicStatusPending: false,
      publicStatusRefreshing: false,
    };

    const html = renderToStaticMarkup(<ProtocolSummary />);

    expect(html).toContain("Base Sepolia deployment pending");
    expect(html).not.toContain("Refreshing…");
  });

  it("keeps prior census values visibly stale when the public refresh fails", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      publicStatus: {
        health: "healthy",
        collection: {
          available: 4_400,
          permanent: 4,
          transient: 8,
          pending: 32,
        },
        funds: { rewardPotWeth: 2n * 10n ** 18n },
      },
      publicStatusError: new Error("private RPC detail"),
      publicStatusPending: false,
      publicStatusRefreshing: false,
    };
    const html = renderToStaticMarkup(<ProtocolSummary />);
    expect(html).toContain("Showing last-known snapshot");
    expect(html).toContain("4,400");
    expect(html).not.toContain("private RPC detail");
  });
});

describe("reward tracks board", () => {
  it("pairs each track label with that track's own liability", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      publicStatus: {
        rewardActivity: {
          collectorLiability: [
            { track: "NVDAc", amount: 4n * 10n ** 18n },
            { track: "AAPLc", amount: 1n * 10n ** 18n },
            { track: "METAc", amount: 3n * 10n ** 18n },
            { track: "GOOGLc", amount: 2n * 10n ** 18n },
          ],
        },
      },
      publicStatusError: null,
      publicStatusPending: false,
    };

    const dom = new JSDOM(renderToStaticMarkup(<RewardTracksPanel />));
    const terms = [...dom.window.document.querySelectorAll("dt")];

    // Liability belongs to the named track, independent of response order.
    for (const [label, amount] of [
      ["AAPLc", "1"],
      ["GOOGLc", "2"],
      ["METAc", "3"],
      ["NVDAc", "4"],
    ]) {
      const term = terms.find((node) => node.textContent === label);
      expect(
        term?.nextElementSibling?.textContent?.replace(/\s/gu, ""),
      ).toContain(`${amount}${label}`);
    }
    expect(dom.window.document.body.textContent).not.toContain(
      "Not observed yet",
    );
    dom.window.close();
  });

  it("marks a genuinely unread track as unavailable rather than zero", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      publicStatus: { rewardActivity: { collectorLiability: [] } },
      publicStatusError: null,
      publicStatusPending: false,
    };

    const html = renderToStaticMarkup(<RewardTracksPanel />);

    expect(html).toContain("Not observed yet");
    expect(html).not.toContain(">0<");
  });
});

it("keeps home fee pots distinct from aggregated waiting funds", () => {
  protocolState.protocol = {
    publicStatus: {
      funds: {
        rewardPotWeth: 2n * 10n ** 18n,
        rewardWethWaiting: 22n * 10n ** 18n,
        liquidityQueuedWeth: 5n * 10n ** 18n,
        liquidityWaitingWeth: 55n * 10n ** 18n,
        creatorWeth: 3n * 10n ** 18n,
        liquidityLockedWeth: 6n * 10n ** 18n,
      },
    },
  };
  const dom = new JSDOM(renderToStaticMarkup(<FeeRoutingPanel />));
  const values = [...dom.window.document.querySelectorAll("dd")].map(
    (node) => node.textContent,
  );
  expect(values).toEqual(["2 WETH", "5 WETH", "3 WETH", "6 WETH"]);
  dom.window.close();
});
