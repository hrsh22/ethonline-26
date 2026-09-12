/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { useProtocolClient } from "@/providers/protocol-client-provider";
import { useDiscoveryReference } from "./use-discovery-reference";

type Protocol = ReturnType<typeof useProtocolClient>;
function Reference({ protocol }: { readonly protocol: Protocol }) {
  return <span>{useDiscoveryReference(protocol) ?? "none"}</span>;
}
const protocol = (address: string, request: bigint | undefined) =>
  ({
    address,
    walletRead: {
      status: "loaded",
      snapshot: {
        collectibles: {
          pendingDiscovery: {
            count: request === undefined ? undefined : 1,
            batch:
              request === undefined ? undefined : { vrfRequestId: request },
          },
        },
      },
    },
  }) as unknown as Protocol;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe("Discovery reference continuity", () => {
  it("does not discard unresolved work based on a stale zero and records later acquisitions", async () => {
    localStorage.clear();
    const container = document.createElement("div");
    const root = createRoot(container);
    const staleZero = protocol("0xabc", undefined);
    Object.assign(staleZero.walletRead, {
      stale: true,
      snapshot: { collectibles: { pendingDiscovery: { count: 0 } } },
    });
    try {
      await act(async () =>
        root.render(<Reference protocol={protocol("0xabc", 17n)} />),
      );
      await act(async () => root.render(<Reference protocol={staleZero} />));
      expect(container.textContent).toBe("17");
      await act(async () =>
        root.render(<Reference protocol={protocol("0xabc", 18n)} />),
      );
      expect(container.textContent).toBe("18");
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("does not resurrect completed discovery on a public page or after remount", async () => {
    localStorage.clear();
    const container = document.createElement("div");
    let root = createRoot(container);
    const complete = protocol("0xabc", undefined);
    Object.assign(complete.walletRead, {
      snapshot: {
        partialFailures: [],
        collectibles: { pendingDiscovery: { count: 0 } },
      },
    });
    const publicPage = {
      address: "0xabc",
      walletRead: { status: "blocked" },
    } as unknown as Protocol;
    try {
      await act(async () =>
        root.render(<Reference protocol={protocol("0xabc", 17n)} />),
      );
      expect(container.textContent).toBe("17");
      await act(async () => root.render(<Reference protocol={complete} />));
      expect(container.textContent).toBe("none");
      await act(async () => root.render(<Reference protocol={publicPage} />));
      expect(container.textContent).toBe("none");
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<Reference protocol={publicPage} />));
      expect(container.textContent).toBe("none");
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("retains observed work on remount without leaking it to another wallet", async () => {
    localStorage.clear();
    const container = document.createElement("div");
    let root = createRoot(container);
    await act(async () =>
      root.render(<Reference protocol={protocol("0xabc", 17n)} />),
    );
    expect(container.textContent).toBe("17");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(<Reference protocol={protocol("0xabc", undefined)} />),
    );
    expect(container.textContent).toBe("17");
    await act(async () =>
      root.render(<Reference protocol={protocol("0xdef", undefined)} />),
    );
    expect(container.textContent).toBe("none");
    await act(async () => root.unmount());
  });
});
