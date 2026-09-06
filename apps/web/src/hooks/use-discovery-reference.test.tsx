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
