/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuctionAdapter } from "@/lib/auction-adapter";
import type { CollectorAuctionSnapshot } from "@/lib/auction-state";

const testState = vi.hoisted(() => ({ protocol: undefined as unknown }));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => testState.protocol,
}));

import { AuctionPanel } from "./auction-panel";

const account = "0x00000000000000000000000000000000000000aa" as const;
const auctionAddress = "0x00000000000000000000000000000000000000bb" as const;

const liveSnapshot = (): CollectorAuctionSnapshot => ({
  auctionAddress,
  observedBlock: 150n,
  startBlock: 100n,
  endBlock: 200n,
  claimBlock: 220n,
  finalized: false,
  graduated: false,
  currency: {
    address: "0x00000000000000000000000000000000000000cc",
    symbol: "WETH",
    decimals: 18,
  },
  token: { symbol: "$FUEL", decimals: 18 },
  totalTokens: 900n * 10n ** 18n,
  tokensSold: 400n * 10n ** 18n,
  currencyCommitted: 12n * 10n ** 18n,
  minimumRaise: 10n * 10n ** 18n,
  currencyRaised: 3n * 10n ** 18n,
  clearingPriceQ96: (6n * (1n << 96n)) / 1_000n,
  floorPriceQ96: (5n * (1n << 96n)) / 1_000n,
  tickSpacingQ96: (1n << 96n) / 1_000n,
  clearingPriceFormatted: "0.006",
  floorPriceFormatted: "0.005",
  suggestedMaxPriceFormatted: "0.007",
  walletCurrencyBalance: 5n * 10n ** 18n,
  walletGasBalance: 10n ** 16n,
  tokenAllowance: 0n,
  auctionAllowance: 0n,
  escrow: {
    address: "0x00000000000000000000000000000000000000dd",
    deployed: true,
    readyToBid: true,
    currencyBalance: 0n,
    fuelBalance: 0n,
    maximumFuelWithdrawal: 64n * 10n ** 18n,
  },
  marketOpen: false,
  bids: [],
});

const enter = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
};

const adapterFor = (snapshot: CollectorAuctionSnapshot) => {
  const execute = vi.fn<AuctionAdapter["execute"]>(
    async (_account, _action, onState) => {
      const hash = `0x${"ab".repeat(32)}` as const;
      onState({ status: "pending", label: "Auction action" });
      onState({ status: "simulated", label: "Auction action" });
      onState({ status: "submitted", label: "Auction action", hash });
      onState({ status: "confirmed", label: "Auction action", hash });
      return { blockNumber: 151n, hash };
    },
  );
  return {
    configured: true,
    deploymentKey: "test",
    read: vi.fn(async () => snapshot),
    execute,
    recover: vi.fn(async () => ({ blockNumber: 151n })),
  } satisfies AuctionAdapter;
};

describe("collector auction panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    testState.protocol = { accessState: "ready", address: account };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the live tape and requests an exact approval before bidding", async () => {
    const adapter = adapterFor(liveSnapshot());
    await act(async () => root.render(<AuctionPanel adapter={adapter} />));
    await act(async () =>
      vi.waitFor(() =>
        expect(container.querySelector(".auction-tape")).not.toBeNull(),
      ),
    );

    expect(container.textContent).toContain("Bidding live");
    expect(container.textContent).toContain("Committed");
    expect(container.textContent).toContain("12 WETH");
    expect(container.textContent).toContain("Minimum to succeed");
    expect(container.textContent).toContain("Commitment cushion");
    expect(container.textContent).toContain("2 WETH");
    expect(container.textContent).toContain("120.00% of the minimum submitted");
    expect(container.textContent).toContain(
      "Bidding needs test WETH plus Base Sepolia ETH for network fees.",
    );
    expect(
      container.querySelector("a[href='/faucet?returnTo=/auction']")
        ?.textContent,
    ).toBe("Get test funds");
    expect(container.textContent).toContain("50.00%");
    expect(
      container.querySelector<HTMLInputElement>("#auction-bid-amount")?.value,
    ).toBe("0.001");
    expect(
      container.querySelector<HTMLInputElement>("#auction-max-price")?.value,
    ).toBe("0.007");
    expect(container.textContent).toContain("Bid steps");
    expect(container.textContent).toContain("Approve 0.001 WETH for Permit2");
    expect(container.textContent).toContain("Network fee balance");
    expect(container.textContent).toContain("0.01 ETH");
    await act(async () =>
      enter(
        container.querySelector<HTMLInputElement>("#auction-bid-amount")!,
        "2",
      ),
    );
    await act(async () =>
      enter(
        container.querySelector<HTMLInputElement>("#auction-max-price")!,
        "0.007",
      ),
    );
    const approve = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Approve 2 WETH for Permit2"),
    );
    expect(approve).toBeDefined();
    await act(async () => approve?.click());
    expect(adapter.execute).toHaveBeenCalledWith(
      account,
      { type: "approve-token", amount: 2n * 10n ** 18n },
      expect.any(Function),
    );
    expect(container.textContent).toContain(
      "Each allowance is capped at this bid amount",
    );
  });

  it("stops before a doomed approval when the wallet has no gas ETH", async () => {
    const adapter = adapterFor({ ...liveSnapshot(), walletGasBalance: 0n });
    await act(async () => root.render(<AuctionPanel adapter={adapter} />));
    await act(async () =>
      vi.waitFor(() => expect(container.textContent).toContain("Bidding live")),
    );

    expect(container.textContent).toContain(
      "You need Base Sepolia ETH for network fees.",
    );
    expect(container.textContent).toContain("Get test ETH");
    expect(container.textContent).not.toContain("Approve Permit2");
  });

  it("turns an opaque wallet internal error into step-specific recovery", async () => {
    const adapter = adapterFor(liveSnapshot());
    adapter.execute.mockRejectedValueOnce(
      new Error("An internal error was received. Request Arguments: ..."),
    );
    await act(async () => root.render(<AuctionPanel adapter={adapter} />));
    await act(async () =>
      vi.waitFor(() => expect(container.textContent).toContain("Bidding live")),
    );

    const approve = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Approve 0.001 WETH for Permit2"),
    );
    await act(async () => approve?.click());

    expect(container.textContent).toContain(
      "Approve Permit2 could not complete",
    );
    expect(container.textContent).toContain("Base Sepolia ETH for gas");
    expect(container.textContent).not.toContain("Request Arguments");
  });

  it("makes a loaded WETH shortfall recoverable without inferring unknown balances", async () => {
    const adapter = adapterFor(liveSnapshot());
    await act(async () => root.render(<AuctionPanel adapter={adapter} />));
    await act(async () =>
      vi.waitFor(() => expect(container.textContent).toContain("Bidding live")),
    );

    await act(async () =>
      enter(
        container.querySelector<HTMLInputElement>("#auction-bid-amount")!,
        "6",
      ),
    );

    expect(container.textContent).toContain("Your WETH balance is too low.");
    expect(
      [...container.querySelectorAll("a[href='/faucet?returnTo=/auction']")]
        .map((link) => link.textContent)
        .includes("Get test WETH"),
    ).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    const failedAdapter = adapterFor(liveSnapshot());
    failedAdapter.read.mockRejectedValueOnce(
      new Error("WETH read unavailable"),
    );
    await act(async () =>
      root.render(<AuctionPanel adapter={failedAdapter} />),
    );
    await act(async () =>
      vi.waitFor(() =>
        expect(container.textContent).toContain("Auction read failed"),
      ),
    );
    expect(container.textContent).not.toContain("Get test WETH");
  });

  it("shows automatic settlement without asking a collector to finalize", async () => {
    const adapter = adapterFor({
      ...liveSnapshot(),
      observedBlock: 201n,
    });
    await act(async () => root.render(<AuctionPanel adapter={adapter} />));
    await act(async () =>
      vi.waitFor(() =>
        expect(container.textContent).toContain("Finalizing automatically"),
      ),
    );

    expect(container.textContent).toContain("No wallet action is required.");
    expect(container.textContent).not.toContain("Finalize auction");
  });

  it("offers each settled claim as its own bounded delivery", async () => {
    const snapshot: CollectorAuctionSnapshot = {
      ...liveSnapshot(),
      observedBlock: 225n,
      finalized: true,
      graduated: true,
      bids: [
        {
          bidId: 17n,
          committedCurrency: 2n * 10n ** 18n,
          maxPriceFormatted: "0.007",
          exited: true,
          claimableTokens: 300n * 10n ** 18n,
        },
      ],
    };
    const adapter = adapterFor(snapshot);
    await act(async () => root.render(<AuctionPanel adapter={adapter} />));
    await act(async () =>
      vi.waitFor(() => expect(container.textContent).toContain("Claims ready")),
    );
    const claim = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Claim to delivery"),
    );
    await act(async () => claim?.click());
    expect(adapter.execute).toHaveBeenCalledWith(
      account,
      { type: "claim", bidId: 17n },
      expect.any(Function),
    );
  });
});
