import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ held: false }));
vi.mock("@/hooks/use-discovery-history", () => ({
  useDiscoveryHistory: () => ({
    data: {
      requests: [
        {
          requestId: `0x${"1".repeat(64)}`,
          acquisitionHash: `0x${"2".repeat(64)}`,
          outcome: "delivered",
          identityId: 1639,
        },
        { requestId: `0x${"3".repeat(64)}`, outcome: "cancelled" },
      ],
      coverage: "complete",
      observedAt: 4600n,
    },
  }),
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({
    walletRead: {
      status: "loaded",
      stale: false,
      snapshot: {
        collectibles: {
          permanentHoldingsStatus: "complete",
          transient: fixture.held
            ? [{ identityId: 1639, rewardTrack: "METAc" }]
            : [],
          permanent: [],
        },
      },
    },
  }),
}));
import { DiscoveryOutcomes } from "./discovery-outcomes";
it("links acquisition to terminal evidence while waiting for ownership before the delivered card", () => {
  fixture.held = false;
  const syncing = renderToStaticMarkup(<DiscoveryOutcomes />);
  expect(syncing).toContain("Discovery revealed #1639");
  expect(syncing).toContain("Current ownership is not yet verified");
  expect(syncing).toContain("Discovery cancelled: FUEL backing moved");
  expect(syncing).not.toContain("View delivered craft");
  fixture.held = true;
  const delivered = renderToStaticMarkup(<DiscoveryOutcomes />);
  expect(delivered).toContain("View delivered craft #1639");
  expect(delivered).toContain("Delivery and current ownership are verified");
  expect(delivered).not.toContain("Protocol request");
  expect(delivered).not.toContain(`0x${"1".repeat(64)}`);
  expect(delivered).toContain(
    `https://sepolia.basescan.org/tx/0x${"2".repeat(64)}`,
  );
});
