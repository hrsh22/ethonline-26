/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LaunchCompletion } from "./launch-completion";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

describe("Launch completion evidence", () => {
  it("waits for ownership then keeps the same identity and exact consequence", () => {
    const protocol = {
      transaction: { status: "confirmed" },
      transactionMetadata: {
        actionType: "commit-collectible",
        identityIds: [1639],
        operationId: "launch-1639",
      },
      walletSynchronizing: false,
      walletRead: {
        status: "loaded",
        stale: false,
        snapshot: {
          collectibles: { permanentHoldingsStatus: "complete", permanent: [] },
        },
      },
    } as unknown as ReturnType<typeof useProtocolClient>;
    const pending = renderToStaticMarkup(
      <LaunchCompletion protocol={protocol} />,
    );
    expect(pending).toContain(
      "collection synchronization is still in progress",
    );
    expect(pending).not.toContain("Launch complete");
    const verified = {
      ...protocol,
      walletRead: {
        status: "loaded",
        stale: false,
        snapshot: {
          collectibles: {
            permanentHoldingsStatus: "complete",
            permanent: [{ identityId: 1639, rewardTrack: "METAｃ" }],
          },
        },
      },
    } as unknown as ReturnType<typeof useProtocolClient>;
    const completed = renderToStaticMarkup(
      <LaunchCompletion protocol={verified} />,
    );
    expect(completed).toContain("View Orbiter #1639");
    expect(completed).toContain("Launch burned 1 FUEL");
    expect(completed).toContain("Reward Track: METAｃ");
    expect(completed).toContain("/fleet/1639");
  });
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it.each([false, true])(
  "reveals once per saved operation; reduced motion=%s",
  async (reduced) => {
    localStorage.clear();
    const animate = vi.fn();
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    const protocol = {
      address: "0xabc",
      transaction: { status: "confirmed" },
      transactionMetadata: {
        actionType: "commit-collectible",
        identityIds: [1639],
        operationId: "launch-1639",
      },
      walletRead: {
        status: "loaded",
        stale: false,
        snapshot: {
          collectibles: {
            permanentHoldingsStatus: "complete",
            permanent: [{ identityId: 1639, rewardTrack: "METAc" }],
          },
        },
      },
    } as unknown as ReturnType<typeof useProtocolClient>;
    const container = document.createElement("div");
    let root = createRoot(container);
    await act(async () =>
      root.render(<LaunchCompletion protocol={protocol} />),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Orbiter #1639",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/fleet/1639",
    );
    expect(animate).toHaveBeenCalledTimes(reduced ? 0 : 1);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(<LaunchCompletion protocol={protocol} />),
    );
    expect(animate).toHaveBeenCalledTimes(reduced ? 0 : 1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    Reflect.deleteProperty(Element.prototype, "animate");
  },
);
