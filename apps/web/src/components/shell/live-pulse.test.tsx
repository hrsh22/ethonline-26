/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
const fixture = vi.hoisted(() => ({ protocol: {} as unknown }));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => fixture.protocol,
}));
import { LivePulse } from "./live-pulse";

it("ages onchain health locally and separates an offline delivery service", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const now = 1_800_000_000_000;
  vi.setSystemTime(now);
  fixture.protocol = {
    publicStatus: {
      health: "healthy",
      freshness: "fresh",
      observedAt: now / 1_000,
      observedBlock: 123n,
    },
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      apiVersion: 1,
      chainId: 84532,
      deploymentFingerprint: protocolDeploymentFingerprint,
      observedAt: now,
      expiresAt: now + 30_000,
      policy: { mode: "live", oneShot: "none" },
      liveness: { state: "offline" },
      dependencyReadiness: "unknown",
      workEligibility: "unknown",
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <LivePulse />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.textContent).toContain("Onchain healthy");
    expect(container.textContent).toContain("Delivery offline");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(container.textContent).toContain("Last checked");
    // Only the cheap service endpoint may poll; no onchain RPC is scheduled.
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).endsWith("/v1/delivery/status"),
      ),
    ).toBe(true);
  } finally {
    act(() => root.unmount());
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it.each([
  ["stopped", "online", 0, undefined, "Delivery stopped"],
  ["dry-run", "online", 0, undefined, "Delivery checking"],
  ["live", "degraded", 90_000, undefined, "Delivery unknown"],
  ["live", "online", 0, "failed", "Delivery delayed"],
] as const)(
  "keeps %s policy and %s heartbeat independent",
  async (mode, liveness, age, outcome, expected) => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    fixture.protocol = {
      publicStatus: {
        health: "healthy",
        freshness: "fresh",
        observedAt: now / 1_000,
        observedBlock: 123n,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          chainId: 84532,
          deploymentFingerprint: protocolDeploymentFingerprint,
          observedAt: now,
          expiresAt: now + 30_000,
          policy: { mode, oneShot: "none" },
          liveness: {
            state: liveness,
            heartbeatAt: now - age,
            expiresAt: now - age + 60_000,
          },
          dependencyReadiness: "unknown",
          workEligibility: "unknown",
          ...(outcome === undefined
            ? {}
            : {
                latestRun: {
                  outcome,
                  startedAt: now - 2_000,
                  finishedAt: now - 1_000,
                },
              }),
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <LivePulse />
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(container.textContent).toContain("Onchain healthy");
      expect(container.textContent).toContain(expected);
    } finally {
      act(() => root.unmount());
      client.clear();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  },
);
