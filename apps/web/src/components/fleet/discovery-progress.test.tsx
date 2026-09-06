import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryProgress } from "./discovery-progress";

vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "stopped" }),
}));
vi.mock("@/components/collector-help", () => ({ CollectorHelp: () => null }));

describe("Discovery progress", () => {
  it("keeps partial processing distinct from delivery and names service action", () => {
    const html = renderToStaticMarkup(
      <DiscoveryProgress
        observedAt={4600}
        pending={{
          count: 2,
          label: "Pending Discovery",
          phase: "finalizing",
          batch: {
            vrfRequestId: 17n,
            sequence: 1n,
            requestedAt: 1000n,
            fulfilledAt: 2000n,
            state: "ready",
            count: 3,
            finalizedCount: 1,
            delayed: false,
            delayReported: false,
            fullyCancelled: false,
          },
        }}
      />,
    );
    expect(html).toContain("1 of 3 results processed");
    expect(html).toContain("Discovery request 17");
    expect(html).toContain("operator must resume processing");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("1 of 3 delivered");
  });
});

it.each([1, 60])(
  "shows %i minutes of waiting without inventing completion",
  (minutes) => {
    const html = renderToStaticMarkup(
      <DiscoveryProgress
        observedAt={1000 + minutes * 60}
        pending={{
          count: 1,
          label: "Pending Discovery",
          phase: "waiting-for-randomness",
          batch: {
            vrfRequestId: 17n,
            sequence: 1n,
            requestedAt: 1000n,
            fulfilledAt: undefined,
            state: "awaiting-randomness",
            count: 1,
            finalizedCount: 0,
            delayed: false,
            delayReported: false,
            fullyCancelled: false,
          },
        }}
      />,
    );
    expect(html).toContain(`${minutes} min elapsed`);
    expect(html).toContain("Waiting for independently verified randomness");
    expect(html.includes("15-minute delay threshold")).toBe(minutes >= 15);
    expect(html).not.toContain("% complete");
    expect(html).not.toContain("View Orbiter");
  },
);
