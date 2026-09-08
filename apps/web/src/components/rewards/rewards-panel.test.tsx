import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({
  protocol: undefined as unknown,
}));

vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "unknown" }),
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => protocolState.protocol,
}));

import { applicationCopy } from "@/lib/identity";

import { RewardsPanel } from "./rewards-panel";

describe("rewards transaction controls", () => {
  it("disables an eligible claim while another transaction is in flight", () => {
    protocolState.protocol = {
      accessState: "ready",
      execute: vi.fn(),
      retry: vi.fn(),
      transaction: { status: "simulated", label: "Launch Grounded Craft" },
      walletRead: {
        status: "loaded",
        snapshot: {
          partialFailures: [],
          collectibles: {
            permanentHoldingsStatus: "complete",
            permanent: [
              {
                identityId: 42,
                stateLabel: "Orbiter",
                claimEligible: true,
                pendingRewards: [{ track: "AAPLc", rawTokenUnits: 1n }],
              },
            ],
          },
        },
      },
    };

    const html = renderToStaticMarkup(<RewardsPanel />);

    const claimButton =
      /<button(?<attributes>[^>]*)>Claim eligible rewards/u.exec(html);
    expect(claimButton?.groups?.attributes).toContain('disabled=""');
    const reasonId = /aria-describedby="(?<id>[^"]+)"/u.exec(
      claimButton?.groups?.attributes ?? "",
    )?.groups?.id;
    expect(reasonId).toBeDefined();
    expect(html).toContain(`id="${reasonId}"`);
    expect(html).toContain("Wait for the current transaction to finish");
    expect(html).toContain('role="note"');
    // The reason used to be rendered twice with the same element id -- once
    // beside the trigger and once again after the review dialog -- so the
    // sentence appeared duplicated and the id was ambiguous.
    expect(html.match(/id="rewards-claim-disabled-reason"/gu)).toHaveLength(1);
    expect(
      html.match(/Wait for the current transaction to finish/gu),
    ).toHaveLength(1);
  });

  it("keeps known rewards visible when another identity's rewards or eligibility are unavailable", () => {
    protocolState.protocol = {
      accessState: "ready",
      execute: vi.fn(),
      retry: vi.fn(),
      transaction: { status: "idle" },
      walletRead: {
        status: "loaded",
        snapshot: {
          partialFailures: [],
          collectibles: {
            permanentHoldingsStatus: "complete",
            permanent: [
              {
                identityId: 42,
                stateLabel: "Orbiter",
                claimEligible: true,
                pendingRewardsStatus: "observed",
                pendingRewards: [{ track: "AAPLc", rawTokenUnits: 10n ** 18n }],
              },
              {
                identityId: 43,
                stateLabel: "Orbiter",
                claimEligible: false,
                claimEligibilityStatus: "unavailable",
                pendingRewardsStatus: "unavailable",
                pendingRewards: [],
              },
            ],
          },
        },
      },
    };
    const html = renderToStaticMarkup(<RewardsPanel />);
    expect(html).toContain("Reward data is incomplete");
    expect(html).toContain("Rewards unavailable for #43");
    expect(html).toContain("Eligibility is updating");
    expect(html).toContain("Known claimable");
    expect(html).not.toContain("No claimable rewards");
    expect(html).not.toContain(applicationCopy.rewards.gatedExplanation);
  });

  it.each([false, true])(
    "explains a verified zero with an Orbiter present: %s",
    (hasOrbiter) => {
      protocolState.protocol = {
        accessState: "ready",
        execute: vi.fn(),
        retry: vi.fn(),
        transaction: { status: "idle" },
        walletRead: {
          status: "loaded",
          snapshot: {
            partialFailures: [],
            collectibles: {
              permanentHoldingsStatus: "complete",
              permanent: hasOrbiter
                ? [
                    {
                      identityId: 42,
                      stateLabel: "Orbiter",
                      claimEligible: true,
                      pendingRewardsStatus: "observed",
                      pendingRewards: [],
                    },
                  ]
                : [],
            },
          },
        },
      };
      const html = renderToStaticMarkup(<RewardsPanel />);
      expect(html).toContain(
        hasOrbiter
          ? "Your Orbiter is eligible, but no rewards are currently available to claim"
          : "This wallet holds no Orbiters",
      );
      expect(html).toContain('href="/learn#help-rewards"');
      expect(html).toContain("Valueless test tokens");
      for (const name of ["Apple", "Alphabet", "Meta", "NVIDIA"])
        expect(html).toContain(name);
    },
  );

  it("speaks about rewards, not the collection, when the wallet is not read", () => {
    protocolState.protocol = {
      accessState: "disconnected",
      execute: vi.fn(),
      retry: vi.fn(),
      transaction: { status: "idle" },
      walletRead: { status: "blocked" },
    };

    const html = renderToStaticMarkup(<RewardsPanel />);

    /* This route borrowed the collection's copy, so a disconnected wallet was
       told to connect in order to load its collection -- on the rewards page.
       Asserting on the collection's own string keeps the guard honest if that
       copy is reworded again. */
    expect(html).toContain("Stock Reward");
    // Allocation education lives in Learn, not ahead of a wallet's claims.
    expect(html).not.toContain("Reward allocation by track");
    expect(html).not.toContain("data-reward-track=");
    expect(html).toContain('href="/learn#help-rewards"');
    // No wallet has been observed, so no claimable figure may be shown --
    // not even a zero.
    expect(html).not.toContain(applicationCopy.rewards.claimable);
    expect(html).not.toContain(applicationCopy.fleet.connect);
  });

  it.each([
    ["loading", "loading", "Loading rewards"],
    ["failed", "error", "Rewards unavailable"],
    ["blocked", "notice", "Connect a wallet"],
  ] as const)(
    "uses shared %s feedback for wallet state",
    (walletStatus, tone, title) => {
      protocolState.protocol = {
        accessState: walletStatus === "blocked" ? "disconnected" : "ready",
        execute: vi.fn(),
        retry: vi.fn(),
        transaction: { status: "idle" },
        walletRead:
          walletStatus === "blocked"
            ? { accessState: "disconnected", status: walletStatus }
            : { status: walletStatus },
      };

      const html = renderToStaticMarkup(<RewardsPanel />);

      expect(html).toContain(`data-state="${tone}"`);
      expect(html).toContain(title);
      expect(html.match(/role="(?:alert|status)"/gu)).toHaveLength(1);
    },
  );

  it("names a wrong network instead of calling the wallet disconnected", () => {
    protocolState.protocol = {
      accessState: "wrong-network",
      execute: vi.fn(),
      retry: vi.fn(),
      transaction: { status: "idle" },
      walletRead: { accessState: "wrong-network", status: "blocked" },
    };

    const html = renderToStaticMarkup(<RewardsPanel />);

    // A wallet on the wrong chain is connected, so offering a connect action
    // it has already taken left it with no way to clear the block.
    expect(html).toContain(applicationCopy.access.wrongNetworkTitle);
    expect(html).toContain(applicationCopy.access.wrongNetworkBody);
    expect(html).not.toContain(applicationCopy.access.disconnectedTitle);
    expect(html).not.toContain("Connect wallet");
  });

  it.each([
    ["complete", "empty", "No claimable rewards"],
    ["unavailable", "partial", "Reward data is incomplete"],
  ] as const)(
    "uses shared %s holdings feedback",
    (holdingsStatus, tone, title) => {
      protocolState.protocol = {
        accessState: "ready",
        execute: vi.fn(),
        retry: vi.fn(),
        transaction: { status: "idle" },
        walletRead: {
          status: "loaded",
          snapshot: {
            partialFailures: [],
            collectibles: {
              permanentHoldingsStatus: holdingsStatus,
              permanent: [],
            },
          },
        },
      };

      const html = renderToStaticMarkup(<RewardsPanel />);

      expect(html).toContain(`data-state="${tone}"`);
      expect(html).toContain(title);
      expect(html.match(/role="(?:alert|status)"/gu)).toHaveLength(1);
    },
  );
});
