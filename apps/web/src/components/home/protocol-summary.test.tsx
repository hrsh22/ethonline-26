import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({ protocol: undefined as unknown }));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => protocolState.protocol,
}));

import { RewardTracksPanel } from "./home-boards";
import { ProtocolSummary } from "./protocol-summary";

describe("protocol summary", () => {
  it("keeps block-level proof on Status instead of the home summary", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      health: {
        health: { status: "healthy", observedBlock: 123n },
        deployment: { launched: true },
        collection: {
          availableIdentityCount: 4_400,
          permanentCount: 4,
          transientCount: 8,
        },
      },
      healthError: null,
      healthPending: false,
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
      health: undefined,
      healthError: null,
      healthPending: true,
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
      health: undefined,
      healthError: new Error("private RPC URL failed"),
      healthPending: false,
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
      health: undefined,
      healthError: null,
      healthPending: false,
      healthRefreshing: false,
    };

    const html = renderToStaticMarkup(<ProtocolSummary />);

    expect(html).toContain("Base Sepolia deployment pending");
    expect(html).not.toContain("Refreshing…");
  });
});

describe("reward tracks board", () => {
  it("pairs each track label with that track's own liability", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      health: {
        rewards: {
          tracks: [1, 2, 3, 4].map((track) => ({
            track,
            rawLiability: BigInt(track) * 10n ** 18n,
          })),
        },
      },
      healthError: null,
      healthPending: false,
    };

    const html = renderToStaticMarkup(<RewardTracksPanel />);

    // `rewards.tracks` is a dense array in track order. Indexing it by the
    // track id read one track high, so AAPLc showed GOOGLc's liability and the
    // fourth track was permanently "Unavailable" on a healthy read.
    for (const [label, amount] of [
      ["AAPLc", "1"],
      ["GOOGLc", "2"],
      ["METAc", "3"],
      ["NVDAc", "4"],
    ]) {
      const row = html.slice(html.indexOf(`>${label}<`));
      expect(row.slice(0, 400)).toContain(amount);
    }
    expect(html).not.toContain("Not observed yet");
  });

  it("marks a genuinely unread track as unavailable rather than zero", () => {
    protocolState.protocol = {
      deploymentAvailable: true,
      health: { rewards: { tracks: [] } },
      healthError: null,
      healthPending: false,
    };

    const html = renderToStaticMarkup(<RewardTracksPanel />);

    expect(html).toContain("Not observed yet");
    expect(html).not.toContain(">0<");
  });
});
