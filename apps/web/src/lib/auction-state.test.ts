import { describe, expect, it } from "vitest";

import {
  auctionPhase,
  auctionProgress,
  nextBidAction,
  type CollectorAuctionSnapshot,
} from "./auction-state";

const snapshot = (
  overrides: Partial<CollectorAuctionSnapshot> = {},
): CollectorAuctionSnapshot => ({
  auctionAddress: "0x00000000000000000000000000000000000000aa",
  observedBlock: 150n,
  startBlock: 100n,
  endBlock: 200n,
  claimBlock: 220n,
  finalized: false,
  graduated: false,
  currency: {
    address: "0x00000000000000000000000000000000000000bb",
    symbol: "WETH",
    decimals: 18,
  },
  token: { symbol: "$FUEL", decimals: 18 },
  totalTokens: 1_000n,
  tokensSold: 400n,
  currencyRaised: 25n,
  clearingPriceFormatted: "0.0062",
  floorPriceFormatted: "0.0057",
  walletCurrencyBalance: 10n * 10n ** 18n,
  tokenAllowance: 0n,
  auctionAllowance: 0n,
  escrow: {
    address: "0x00000000000000000000000000000000000000cc",
    deployed: true,
    readyToBid: true,
    currencyBalance: 0n,
    fuelBalance: 0n,
    maximumFuelWithdrawal: 64n * 10n ** 18n,
  },
  marketOpen: false,
  bids: [],
  ...overrides,
});

describe("collector auction state", () => {
  it("derives the lifecycle from observed and claim blocks", () => {
    expect(auctionPhase(snapshot({ observedBlock: 99n }))).toBe("upcoming");
    expect(auctionPhase(snapshot())).toBe("live");
    expect(auctionPhase(snapshot({ observedBlock: 200n }))).toBe("settling");
    expect(
      auctionPhase(
        snapshot({
          observedBlock: 205n,
          finalized: true,
          bids: [
            {
              bidId: 7n,
              committedCurrency: 4n,
              maxPriceFormatted: "0.006",
              exited: false,
              claimableTokens: 0n,
            },
          ],
        }),
      ),
    ).toBe("refunds");
    expect(
      auctionPhase(
        snapshot({ observedBlock: 205n, finalized: true, graduated: true }),
      ),
    ).toBe("claim-wait");
    expect(
      auctionPhase(
        snapshot({
          observedBlock: 220n,
          finalized: true,
          graduated: true,
          bids: [
            {
              bidId: 7n,
              committedCurrency: 4n,
              maxPriceFormatted: "0.006",
              exited: true,
              claimableTokens: 3n,
            },
          ],
        }),
      ),
    ).toBe("claims");
  });

  it("clamps auction progress at its block boundaries", () => {
    expect(auctionProgress(snapshot({ observedBlock: 1n }))).toBe(0);
    expect(auctionProgress(snapshot())).toBe(50);
    expect(auctionProgress(snapshot({ observedBlock: 999n }))).toBe(100);
  });

  it("approves only the entered amount before producing the matching bid", () => {
    const amount = 2n * 10n ** 18n;
    expect(nextBidAction(snapshot(), amount, "0.007").action).toEqual({
      type: "approve-token",
      amount,
    });
    expect(
      nextBidAction(snapshot({ tokenAllowance: amount }), amount, "0.007")
        .action,
    ).toEqual({ type: "approve-auction", amount });
    expect(
      nextBidAction(
        snapshot({ tokenAllowance: amount, auctionAllowance: amount }),
        amount,
        "0.007",
      ).action,
    ).toEqual({ type: "bid", amount, maxPriceFormatted: "0.007" });
  });

  it("blocks malformed prices and bids above the wallet balance", () => {
    expect(nextBidAction(snapshot(), 1n, "not-a-price").state.reason).toMatch(
      /maximum price/i,
    );
    const shortfall = nextBidAction(
      snapshot(),
      11n * 10n ** 18n,
      "0.007",
    ).state;
    expect(shortfall.reason).toMatch(/balance/i);
    expect(shortfall.condition).toBe("insufficient-weth");
    expect(nextBidAction(snapshot(), 1n, "0.0062").state.reason).toMatch(
      /above the current clearing price/i,
    );
  });
});
