/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useProtocolClient } from "@/providers/protocol-client-provider";

import { useCollectibleRead } from "./use-collectible-read";

type ProtocolClient = ReturnType<typeof useProtocolClient>;

describe("known collectible reads", () => {
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const container of containers.splice(0)) container.remove();
  });

  it("reads public identity state without requiring a connected wallet", async () => {
    const snapshot = { identityId: 2351 };
    const readCollectible = vi.fn().mockResolvedValue(snapshot);
    const protocol = {
      accessState: "disconnected",
      deploymentAvailable: true,
      reader: { readCollectible },
    } as unknown as ProtocolClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    containers.push(container);
    document.body.append(container);
    const root = createRoot(container);
    let observed: unknown;

    const Probe = () => {
      observed = useCollectibleRead(2351, protocol).data;
      return null;
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(readCollectible).toHaveBeenCalledWith(2351));
    await vi.waitFor(() => expect(observed).toEqual(snapshot));

    act(() => root.unmount());
    queryClient.clear();
  });
});
