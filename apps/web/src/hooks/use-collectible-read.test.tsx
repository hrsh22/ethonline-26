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
      readerForSignal: () => ({ readCollectible }),
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
  it("cancels an identity read when navigation removes its observer", async () => {
    let readSignal: AbortSignal | undefined;
    const readCollectible = vi.fn(() => new Promise(() => undefined));
    const protocol = {
      deploymentAvailable: true,
      reader: { readCollectible },
      readerForSignal: (signal: AbortSignal) => {
        readSignal = signal;
        return { readCollectible };
      },
    } as unknown as ProtocolClient;
    const queryClient = new QueryClient();
    const container = document.createElement("div");
    containers.push(container);
    const root = createRoot(container);
    const Probe = () => {
      useCollectibleRead(42, protocol);
      return null;
    };
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(readSignal).toBeDefined());
    act(() => root.unmount());
    await vi.waitFor(() => expect(readSignal?.aborted).toBe(true));
    queryClient.clear();
  });

  it("rejects cached pre-transfer ownership until the confirmed block is observed", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    containers.push(container);
    const root = createRoot(container);
    let block = 99n;
    const readCollectible = vi.fn(async () => ({
      identityId: 42,
      observedBlock: block,
      owner: block < 100n ? "sender" : "recipient",
    }));
    let protocol = {
      deploymentAvailable: true,
      reader: { readCollectible },
      readerForSignal: () => ({ readCollectible }),
    } as unknown as ProtocolClient;
    let observed: ReturnType<typeof useCollectibleRead>;
    const Probe = () => {
      observed = useCollectibleRead(42, protocol);
      return (
        <span>
          {observed.isError ? "Checking ownership" : observed.data?.identityId}
        </span>
      );
    };
    const render = async () => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        ),
      );
    };
    try {
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(observed!.data).toMatchObject({ owner: "sender" });
      protocol = { ...protocol, minimumCollectibleBlock: 100n };
      await render();
      expect(observed!.data).toBeUndefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(observed!.isError).toBe(true);
      expect(observed!.data).toBeUndefined();
      block = 100n;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_010);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(observed!.data).toMatchObject({
        owner: "recipient",
        observedBlock: 100n,
      });
      expect(readCollectible).toHaveBeenCalledTimes(6);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(readCollectible).toHaveBeenCalledTimes(6);
    } finally {
      act(() => root.unmount());
      queryClient.clear();
      vi.useRealTimers();
    }
  });

  it("ends a stalled detail read, recovers visibly, then stays idle", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const container = document.createElement("div");
    containers.push(container);
    const root = createRoot(container);
    let attempts = 0;
    let readSignal: AbortSignal | undefined;
    let observed: ReturnType<typeof useCollectibleRead>;
    const reader = {
      readCollectible: () =>
        ++attempts === 1
          ? new Promise(() => undefined)
          : Promise.resolve({ identityId: 42 }),
    };
    const protocol = {
      deploymentAvailable: true,
      reader,
      readerForSignal: (signal: AbortSignal) => {
        readSignal = signal;
        return reader;
      },
    } as unknown as ProtocolClient;
    const Probe = () => {
      observed = useCollectibleRead(42, protocol);
      return null;
    };
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_010);
      });
      expect(readSignal?.aborted).toBe(true);
      expect(observed!.isError).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_010);
      });
      expect(observed!.data).toEqual({ identityId: 42 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(attempts).toBe(2);
    } finally {
      act(() => root.unmount());
      queryClient.clear();
      vi.useRealTimers();
    }
  });
});
