/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StockBalanceSnapshot } from "@/hooks/use-stock-balances";

const state = vi.hoisted(() => ({ protocol: undefined as unknown }));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => state.protocol,
}));
vi.mock("@/components/connect-wallet-action", () => ({
  ConnectWalletAction: () => <button>Connect wallet</button>,
}));

import { StockBalancesPanel } from "./stock-balances-panel";

const owner = "0x2000000000000000000000000000000000000002" as const;
const otherOwner = "0x3000000000000000000000000000000000000003" as const;
const snapshot = (
  overrides: Partial<StockBalanceSnapshot> = {},
): StockBalanceSnapshot => ({
  owner,
  observedBlock: 100n,
  observedAt: 1_700_000_000,
  balances: (["AAPLc", "GOOGLc", "METAc", "NVDAc"] as const).map(
    (track, index) => ({
      track,
      trackId: (index + 1) as 1 | 2 | 3 | 4,
      tokenAddress: owner,
      status: "observed" as const,
      rawTokenUnits: index === 0 ? 1_250_000n : 0n,
      decimals: index === 0 ? 6 : 18,
    }),
  ),
  ...overrides,
});

describe("stock tokens held by the connected wallet", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let readStockBalances: ReturnType<typeof vi.fn>;
  let readSignal: AbortSignal | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    readStockBalances = vi.fn().mockResolvedValue(snapshot());
    state.protocol = {
      accessState: "ready",
      address: owner,
      // This panel intentionally works without a collectible or claims read.
      readerForSignal: (signal: AbortSignal) => {
        readSignal = signal;
        return { readStockBalances };
      },
    };
    readSignal = undefined;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const render = async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StockBalancesPanel />
        </QueryClientProvider>,
      );
    });
    await flush();
  };
  const refresh = async () => {
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Refresh stock balances"),
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await flush();
  };

  it("shows held balances with each token's decimals even with no collectible data", async () => {
    await render();
    expect(readStockBalances).toHaveBeenCalledWith(owner);
    expect(container.textContent).toContain("Stock tokens in your wallet");
    expect(container.textContent).toContain("1.25AAPLc");
    expect(container.textContent).toContain("0GOOGLc");
    expect(container.textContent).toContain(
      "separate from the unclaimed rewards",
    );
    expect(container.textContent).toContain(
      "no-value Base Sepolia test tokens",
    );
    expect(container.textContent).toContain("Checked at block 100");
  });

  it("keeps tiny nonzero balances visible and exposes exact precision", async () => {
    const value = snapshot();
    readStockBalances.mockResolvedValue({
      ...value,
      balances: value.balances.map((balance) => ({
        ...balance,
        rawTokenUnits: 1_234_567_891n,
        decimals: 18,
      })),
    });
    await render();
    expect(container.textContent).toContain("0.0000000012346");
    expect(
      container.querySelector('[title="0.000000001234567891"]'),
    ).not.toBeNull();
  });

  it("shows observed zero separately from one token's unavailable balance", async () => {
    const value = snapshot();
    readStockBalances.mockResolvedValue({
      ...value,
      balances: value.balances.map((balance) =>
        balance.trackId === 2
          ? {
              ...balance,
              status: "unavailable",
              rawTokenUnits: undefined,
              decimals: undefined,
            }
          : balance,
      ),
    });
    await render();
    expect(container.textContent).toContain(
      "Some stock balances could not be read",
    );
    expect(container.textContent).toContain("1.25AAPLc");
    expect(
      container.querySelector(
        '[aria-label="GOOGLc wallet balance unavailable"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("0GOOGLc");
    expect(container.textContent).not.toContain("does not hold any");
  });

  it("explains a fully observed empty wallet", async () => {
    const value = snapshot();
    readStockBalances.mockResolvedValue({
      ...value,
      balances: value.balances.map((balance) => ({
        ...balance,
        rawTokenUnits: 0n,
      })),
    });
    await render();
    expect(container.textContent).toContain(
      "This wallet does not hold any of the four stock tokens yet",
    );
  });

  it.each(["disconnected", "wrong-network", "deployment-pending"])(
    "does not read or show cached balances when access is %s",
    async (accessState) => {
      await render();
      readStockBalances.mockClear();
      state.protocol = { ...(state.protocol as object), accessState };
      await render();
      expect(readStockBalances).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("1.25AAPLc");
      expect(container.textContent).not.toContain("0AAPLc");
      expect(container.textContent?.includes("Connect wallet")).toBe(
        accessState === "disconnected",
      );
    },
  );

  it("hides the previous wallet immediately when the connected account changes", async () => {
    await render();
    readStockBalances.mockImplementation(() => new Promise(() => undefined));
    state.protocol = { ...(state.protocol as object), address: otherOwner };
    await render();
    expect(readStockBalances).toHaveBeenLastCalledWith(otherOwner);
    expect(container.textContent).toContain("Checking your stock balances");
    expect(container.textContent).not.toContain("1.25AAPLc");
    expect(container.textContent).not.toContain("0AAPLc");
  });

  it("marks retained balances as last checked when a refresh fails", async () => {
    await render();
    readStockBalances.mockRejectedValue(new Error("RPC unavailable"));
    await refresh();
    expect(container.textContent).toContain("Showing last checked balances");
    expect(container.textContent).toContain("1.25AAPLc");
    readStockBalances.mockResolvedValue(snapshot({ observedBlock: 101n }));
    await refresh();
    expect(container.textContent).not.toContain(
      "Showing last checked balances",
    );
    expect(container.textContent).toContain("Checked at block 101");
  });

  it("shows a retryable error rather than zero when the first read fails", async () => {
    readStockBalances.mockRejectedValue(new Error("RPC unavailable"));
    await render();
    expect(container.textContent).toContain("Stock balances unavailable");
    expect(container.textContent).not.toContain("0AAPLc");
    readStockBalances.mockResolvedValue(snapshot());
    await refresh();
    expect(container.textContent).toContain("1.25AAPLc");
  });

  it("refreshes after a confirmed claim and waits for its receipt block", async () => {
    await render();
    readStockBalances.mockResolvedValueOnce(snapshot({ observedBlock: 100n }));
    const afterClaim = snapshot({ observedBlock: 101n });
    readStockBalances.mockResolvedValue({
      ...afterClaim,
      balances: afterClaim.balances.map((balance) => ({
        ...balance,
        rawTokenUnits: 2_500_000n,
      })),
    });
    state.protocol = {
      ...(state.protocol as object),
      minimumCollectibleBlock: 101n,
    };
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StockBalancesPanel />
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).not.toContain("1.25AAPLc");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.textContent).toContain("2.5AAPLc");
    expect(container.textContent).toContain("Checked at block 101");
  });

  it("cancels the stock read when the user leaves the page", async () => {
    readStockBalances.mockImplementation(() => new Promise(() => undefined));
    await render();
    expect(readSignal?.aborted).toBe(false);
    act(() => root.render(null));
    await flush();
    expect(readSignal?.aborted).toBe(true);
  });
});
