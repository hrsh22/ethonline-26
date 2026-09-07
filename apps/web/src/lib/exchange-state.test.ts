import { describe, expect, it } from "vitest";

import { deriveLiquidTokenTransferMutationCapacity } from "@orbit/protocol/domain";

import {
  deriveExchangeTradeTerms,
  exchangeMinimumAmountOut,
  EXCHANGE_SLIPPAGE_POLICY,
  deriveExchangeIntent,
  deriveExchangeReviewState,
  type ExchangeQuote,
} from "./exchange-state";

const loadedWallet = {
  status: "loaded" as const,
  account: "0x0000000000000000000000000000000000000001" as const,
  observedBlock: 99n,
  liquidTokenBalanceWei: 2_000_000_000_000_000_000n,
  nativeBalanceWei: 5_000_000_000_000_000_000n,
  wethBalanceWei: 90_000_000_000_000_000n,
  pendingDiscoveryCount: 0,
  transientCollectibleCount: 2,
};

const quoteReceivedAtMilliseconds = 1_000;
const reviewNowMilliseconds = 2_000;
const defaultDiscovery: NonNullable<ExchangeQuote["discovery"]> = {
  account: "0x0000000000000000000000000000000000000001",
  accountHoldings: {
    pendingDiscoveryCount: 0,
    transientCollectibleCount: 0,
  },
  sender: {
    account: "0x0000000000000000000000000000000000000017",
    balance: 1_000_000_000_000_000_000_000n,
    discoveryExempt: true,
    mutations: 0,
  },
  recipient: {
    account: "0x0000000000000000000000000000000000000001",
    balance: 0n,
    discoveryExempt: false,
    mutations: 0,
  },
  mutations: 0,
  maximumMutations: 64,
  executable: true,
  maximumLiquidTokenAmount: 64_999_999_999_999_999_999n,
};
const discoveryForWallet = (
  direction: "buy" | "sell",
  wallet: {
    readonly account: `0x${string}`;
    readonly liquidTokenBalanceWei: bigint;
  },
  liquidTokenAmount: bigint,
  accountHoldings = {
    pendingDiscoveryCount: 0,
    transientCollectibleCount: Number(
      wallet.liquidTokenBalanceWei / 10n ** 18n,
    ),
  },
): NonNullable<ExchangeQuote["discovery"]> => {
  const walletLeg = {
    account: wallet.account,
    balance: wallet.liquidTokenBalanceWei,
    discoveryExempt: false,
    mutations: 0,
  } as const;
  const sender = direction === "sell" ? walletLeg : defaultDiscovery.sender;
  const recipient = direction === "buy" ? walletLeg : defaultDiscovery.sender;
  const capacity = deriveLiquidTokenTransferMutationCapacity({
    sender,
    recipient,
    liquidTokenAmount,
  });
  return {
    account: wallet.account,
    accountHoldings,
    sender: { ...sender, mutations: capacity.senderMutations },
    recipient: { ...recipient, mutations: capacity.recipientMutations },
    mutations: capacity.mutations,
    maximumMutations: capacity.maximumMutations,
    executable: capacity.executable,
    maximumLiquidTokenAmount: capacity.maximumLiquidTokenAmount,
  };
};
const loadedQuote = (
  quote: ExchangeQuote,
  receivedAtMilliseconds = quoteReceivedAtMilliseconds,
  wallet = loadedWallet,
) => ({
  status: "loaded" as const,
  quote: {
    ...quote,
    discovery: quote.discovery ?? defaultDiscovery,
  },
  receivedAtMilliseconds,
  walletScope: {
    account: wallet.account,
    observedBlock: wallet.observedBlock,
    liquidTokenBalanceWei: wallet.liquidTokenBalanceWei,
  },
});

const requireReadyReview = (
  state: ReturnType<typeof deriveExchangeReviewState>,
) => {
  if (state.status !== "ready") {
    throw new Error(`Expected a ready review, received ${state.status}`);
  }
  return state.review;
};

describe("exchange intent", () => {
  it("keeps a fresh blank form quiet and does not request a quote", () => {
    expect(
      deriveExchangeIntent({
        accessState: "ready",
        amount: "",
        direction: "buy",
        readerAvailable: true,
        wallet: loadedWallet,
      }),
    ).toMatchObject({
      status: "empty",
      quoteEnabled: false,
    });
  });

  it("parses a decimal amount into exact wei before requesting a quote", () => {
    expect(
      deriveExchangeIntent({
        accessState: "ready",
        amount: "0.09",
        direction: "buy",
        readerAvailable: true,
        wallet: loadedWallet,
      }),
    ).toMatchObject({
      status: "ready",
      amountIn: 90_000_000_000_000_000n,
      quoteEnabled: true,
    });
  });

  it("rejects zero and non-decimal input without rounding or quoting it", () => {
    const results = ["0", "-1", "1e2", "1.0000000000000000001"].map((amount) =>
      deriveExchangeIntent({
        accessState: "ready",
        amount,
        direction: "buy",
        readerAvailable: true,
        wallet: loadedWallet,
      }),
    );

    expect(results).toEqual([
      { status: "invalid", quoteEnabled: false },
      { status: "invalid", quoteEnabled: false },
      { status: "invalid", quoteEnabled: false },
      { status: "invalid", quoteEnabled: false },
    ]);
  });

  it("blocks a WETH buy that exceeds the exact observed balance", () => {
    expect(
      deriveExchangeIntent({
        accessState: "ready",
        amount: "0.090000000000000001",
        direction: "buy",
        readerAvailable: true,
        wallet: loadedWallet,
      }),
    ).toMatchObject({
      status: "insufficient-balance",
      amountIn: 90_000_000_000_000_001n,
      availableBalanceWei: 90_000_000_000_000_000n,
      asset: "settlement",
      quoteEnabled: false,
      recovery: "faucet",
    });
  });

  it("uses native ETH as the WETH-side input while reserving transaction gas", () => {
    expect(
      deriveExchangeIntent({
        accessState: "ready",
        amount: "4.9999",
        direction: "buy",
        readerAvailable: true,
        settlementMode: "native",
        wallet: loadedWallet,
      }),
    ).toMatchObject({
      status: "insufficient-balance",
      asset: "native",
      availableBalanceWei: 4_999_800_000_000_000_000n,
    });

    expect(
      deriveExchangeIntent({
        accessState: "ready",
        amount: "4.9998",
        direction: "buy",
        readerAvailable: true,
        settlementMode: "native",
        wallet: loadedWallet,
      }),
    ).toMatchObject({
      status: "ready",
      settlementMode: "native",
    });
  });

  it("blocks a FUEL sale that exceeds the exact observed balance without offering the WETH faucet", () => {
    expect(
      deriveExchangeIntent({
        accessState: "ready",
        amount: "2.000000000000000001",
        direction: "sell",
        readerAvailable: true,
        wallet: loadedWallet,
      }),
    ).toStrictEqual({
      status: "insufficient-balance",
      amountIn: 2_000_000_000_000_000_001n,
      availableBalanceWei: 2_000_000_000_000_000_000n,
      asset: "liquid-token",
      quoteEnabled: false,
      // The WETH faucet cannot fix a FUEL shortfall; the buy side of this
      // same panel can.
      recovery: "buy",
    });
  });

  it("does not quote without the required wallet, network, reader, and balance evidence", () => {
    const base = {
      amount: "0.01",
      direction: "buy" as const,
      readerAvailable: true,
      wallet: loadedWallet,
    };

    const results = [
      deriveExchangeIntent({
        ...base,
        accessState: "disconnected",
        wallet: { status: "blocked" },
      }),
      deriveExchangeIntent({
        ...base,
        accessState: "wrong-network",
        wallet: { status: "blocked" },
      }),
      deriveExchangeIntent({
        ...base,
        accessState: "deployment-pending",
        readerAvailable: false,
        wallet: { status: "blocked" },
      }),
      deriveExchangeIntent({
        ...base,
        accessState: "ready",
        readerAvailable: false,
      }),
      deriveExchangeIntent({
        ...base,
        accessState: "ready",
        wallet: { status: "loading" },
      }),
      deriveExchangeIntent({
        ...base,
        accessState: "ready",
        wallet: { status: "failed" },
      }),
    ];

    expect(results).toEqual([
      { status: "disconnected", quoteEnabled: false },
      { status: "wrong-network", quoteEnabled: false },
      { status: "deployment-pending", quoteEnabled: false },
      { status: "reader-unavailable", quoteEnabled: false },
      { status: "balance-loading", quoteEnabled: false },
      { status: "balance-unavailable", quoteEnabled: false },
    ]);
  });
});

describe("exchange review state", () => {
  it("invalidates a cached quote when the same wallet advances to a balance that crosses another boundary", () => {
    const quotedWallet = {
      ...loadedWallet,
      observedBlock: 100n,
      liquidTokenBalanceWei: 250_000_000_000_000_000n,
      wethBalanceWei: 2n * 10n ** 18n,
    };
    const refreshedWallet = {
      ...quotedWallet,
      observedBlock: 101n,
      liquidTokenBalanceWei: 750_000_000_000_000_000n,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "1",
      direction: "buy",
      readerAvailable: true,
      wallet: refreshedWallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 1n * 10n ** 18n,
            amountInFormatted: "1",
            amountOut: 64_250_000_000_000_000_000n,
            amountOutFormatted: "64.25",
            tradingFee: 30_000_000_000_000_000n,
            tradingFeeFormatted: "0.03",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: {
              account: quotedWallet.account,
              accountHoldings: {
                pendingDiscoveryCount: 0,
                transientCollectibleCount: 0,
              },
              sender: {
                account: "0x0000000000000000000000000000000000000017",
                balance: 1_000n * 10n ** 18n,
                discoveryExempt: true,
                mutations: 0,
              },
              recipient: {
                account: quotedWallet.account,
                balance: quotedWallet.liquidTokenBalanceWei,
                discoveryExempt: false,
                mutations: 64,
              },
              mutations: 64,
              maximumMutations: 64,
              executable: true,
              maximumLiquidTokenAmount: 64_749_999_999_999_999_999n,
            },
          },
          quoteReceivedAtMilliseconds,
          quotedWallet,
        ),
        transactionPending: false,
      }),
    ).toEqual({
      status: "stale-quote",
      submitEnabled: false,
      retryAvailable: true,
    });
  });

  it("describes sell impact from quote-pinned discovery evidence, not cached collectible counts", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 2_750_000_000_000_000_000n,
      pendingDiscoveryCount: 99,
      transientCollectibleCount: 99,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "1",
      direction: "sell",
      readerAvailable: true,
      wallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: true,
            amountIn: 1n * 10n ** 18n,
            amountInFormatted: "1",
            amountOut: 8_000_000_000_000_000n,
            amountOutFormatted: "0.008",
            tradingFee: 240_000_000_000_000n,
            tradingFeeFormatted: "0.00024",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: {
              account: wallet.account,
              accountHoldings: {
                pendingDiscoveryCount: 1,
                transientCollectibleCount: 1,
              },
              sender: {
                account: wallet.account,
                balance: wallet.liquidTokenBalanceWei,
                discoveryExempt: false,
                mutations: 1,
              },
              recipient: {
                account: "0x0000000000000000000000000000000000000017",
                balance: 1_000n * 10n ** 18n,
                discoveryExempt: true,
                mutations: 0,
              },
              mutations: 1,
              maximumMutations: 64,
              executable: true,
              maximumLiquidTokenAmount: 2_750_000_000_000_000_000n,
            },
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      status: "ready",
      submitEnabled: true,
      review: {
        sentence:
          "You pay 1 $FUEL and receive 0.008 WETH. The 3.00% fee is 0.00024 WETH. This sale cancels 1 Pending Discovery. No Grounded Craft is dissolved.",
      },
    });
  });

  it("expires a quote by age when the health block is unavailable", () => {
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet: loadedWallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: 5_001,
        observedBlock: undefined,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 10_000_000_000_000_000n,
            amountInFormatted: "0.01",
            amountOut: 1_200_000_000_000_000_000n,
            amountOutFormatted: "1.2",
            tradingFee: 300_000_000_000_000n,
            tradingFeeFormatted: "0.0003",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
          },
          1_000,
        ),
        transactionPending: false,
      }),
    ).toEqual({
      status: "stale-quote",
      submitEnabled: false,
      retryAvailable: true,
    });
  });

  it("produces an explicit fee and random-Discovery review for a current buy quote", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 0n,
      transientCollectibleCount: 0,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 10_000_000_000_000_000n,
            amountInFormatted: "0.01",
            amountOut: 1_200_000_000_000_000_000n,
            amountOutFormatted: "1.2",
            tradingFee: 300_000_000_000_000n,
            tradingFeeFormatted: "0.0003",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: discoveryForWallet(
              "buy",
              wallet,
              1_200_000_000_000_000_000n,
            ),
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      status: "ready",
      submitEnabled: true,
      review: {
        sentence:
          "You pay 0.01 WETH and receive 1.2 $FUEL. The 3.00% fee is 0.0003 WETH. Buying this amount schedules 1 random Discovery.",
      },
    });
  });

  it("blocks a fresh quote that cannot cross the wallet discovery boundary", () => {
    const balance = 833_929_404_331_779_245_120n;
    const maximumLiquidTokenAmount =
      65n * 10n ** 18n - (balance % 10n ** 18n) - 1n;
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: balance,
      wethBalanceWei: 2n * 10n ** 18n,
      transientCollectibleCount: 833,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "1",
      direction: "buy",
      readerAvailable: true,
      wallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 1n * 10n ** 18n,
            amountInFormatted: "1",
            amountOut: 107_750_806_090_999_699_498n,
            amountOutFormatted: "107.750806090999699498",
            tradingFee: 30_000_000_000_000_000n,
            tradingFeeFormatted: "0.03",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: {
              account: "0x0000000000000000000000000000000000000001",
              accountHoldings: {
                pendingDiscoveryCount: 400,
                transientCollectibleCount: 433,
              },
              sender: {
                account: "0x0000000000000000000000000000000000000017",
                balance: 1_000n * 10n ** 18n,
                discoveryExempt: true,
                mutations: 0,
              },
              recipient: {
                account: "0x0000000000000000000000000000000000000001",
                balance,
                discoveryExempt: false,
                mutations: 108,
              },
              mutations: 108,
              maximumMutations: 64,
              executable: false,
              maximumLiquidTokenAmount,
            },
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toEqual({
      status: "discovery-limit",
      submitEnabled: false,
      mutations: 108,
      maximumMutations: 64,
      maximumLiquidTokenAmount,
    });
  });

  it("fails closed when otherwise-current discovery evidence belongs to another wallet", () => {
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet: loadedWallet,
    });
    const quoteRead = loadedQuote({
      liquidTokenForWeth: false,
      amountIn: 10_000_000_000_000_000n,
      amountInFormatted: "0.01",
      amountOut: 1_200_000_000_000_000_000n,
      amountOutFormatted: "1.2",
      tradingFee: 300_000_000_000_000n,
      tradingFeeFormatted: "0.0003",
      observedBlock: 100n,
      expiresAtBlock: 105n,
      tradingFeeBps: 300,
      discovery: {
        ...defaultDiscovery,
        account: "0x0000000000000000000000000000000000000002",
      },
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead,
        transactionPending: false,
      }),
    ).toEqual({
      status: "discovery-invalid",
      submitEnabled: false,
      retryAvailable: true,
    });
  });

  it("fails closed when a quote claims an over-limit mutation count is executable", () => {
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet: loadedWallet,
    });
    const quoteRead = loadedQuote({
      liquidTokenForWeth: false,
      amountIn: 10_000_000_000_000_000n,
      amountInFormatted: "0.01",
      amountOut: 65n * 10n ** 18n,
      amountOutFormatted: "65",
      tradingFee: 300_000_000_000_000n,
      tradingFeeFormatted: "0.0003",
      observedBlock: 100n,
      expiresAtBlock: 105n,
      tradingFeeBps: 300,
      discovery: {
        ...defaultDiscovery,
        recipient: { ...defaultDiscovery.recipient, mutations: 65 },
        mutations: 65,
        executable: true,
      },
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead,
        transactionPending: false,
      }),
    ).toEqual({
      status: "discovery-invalid",
      submitEnabled: false,
      retryAvailable: true,
    });
  });

  it("fails closed when pinned holdings do not back the wallet's whole-unit balance", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 2_750_000_000_000_000_000n,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "1",
      direction: "sell",
      readerAvailable: true,
      wallet,
    });
    const discovery = discoveryForWallet(
      "sell",
      wallet,
      1_000_000_000_000_000_000n,
      {
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 1,
      },
    );

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: true,
            amountIn: 1_000_000_000_000_000_000n,
            amountInFormatted: "1",
            amountOut: 8_000_000_000_000_000n,
            amountOutFormatted: "0.008",
            tradingFee: 240_000_000_000_000n,
            tradingFeeFormatted: "0.00024",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery,
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toEqual({
      status: "discovery-invalid",
      submitEnabled: false,
      retryAvailable: true,
    });
  });

  it("fails closed when an exempt wallet quote claims collectible backing", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 0n,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet,
    });
    const discovery = {
      ...discoveryForWallet("buy", wallet, 1_200_000_000_000_000_000n),
      accountHoldings: {
        pendingDiscoveryCount: 1,
        transientCollectibleCount: 0,
      },
      recipient: {
        ...defaultDiscovery.recipient,
        discoveryExempt: true,
      },
      mutations: 0,
      maximumLiquidTokenAmount: defaultDiscovery.sender.balance,
    };

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 10_000_000_000_000_000n,
            amountInFormatted: "0.01",
            amountOut: 1_200_000_000_000_000_000n,
            amountOutFormatted: "1.2",
            tradingFee: 300_000_000_000_000n,
            tradingFeeFormatted: "0.0003",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery,
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      status: "discovery-invalid",
      submitEnabled: false,
    });
  });

  it("allows an exempt wallet with whole Liquid Tokens and no collectible backing", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 10n * 10n ** 18n,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet,
    });
    const discovery = {
      account: wallet.account,
      accountHoldings: {
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 0,
      },
      sender: {
        account: defaultDiscovery.sender.account,
        balance: 4_000n * 10n ** 18n,
        discoveryExempt: true,
        mutations: 0,
      },
      recipient: {
        account: wallet.account,
        balance: wallet.liquidTokenBalanceWei,
        discoveryExempt: true,
        mutations: 0,
      },
      mutations: 0,
      maximumMutations: 64,
      executable: true,
      maximumLiquidTokenAmount: 4_000n * 10n ** 18n,
    } as const;

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 10_000_000_000_000_000n,
            amountInFormatted: "0.01",
            amountOut: 65n * 10n ** 18n,
            amountOutFormatted: "65",
            tradingFee: 300_000_000_000_000n,
            tradingFeeFormatted: "0.0003",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery,
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      status: "ready",
      submitEnabled: true,
      review: {
        sentence: expect.stringContaining("discovery-exempt"),
      },
    });
  });

  it("keeps submission disabled for missing, loading, failed, stale, and pending quote states", () => {
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.01",
      direction: "buy",
      readerAvailable: true,
      wallet: {
        ...loadedWallet,
        liquidTokenBalanceWei: 0n,
      },
    });
    const quote = {
      liquidTokenForWeth: false,
      amountIn: 10_000_000_000_000_000n,
      amountInFormatted: "0.01",
      amountOut: 1_200_000_000_000_000_000n,
      amountOutFormatted: "1.2",
      tradingFee: 300_000_000_000_000n,
      tradingFeeFormatted: "0.0003",
      observedBlock: 100n,
      expiresAtBlock: 105n,
      tradingFeeBps: 300,
    };
    const derive = (
      quoteRead: Parameters<typeof deriveExchangeReviewState>[0]["quoteRead"],
      options: { observedBlock?: bigint; transactionPending?: boolean } = {},
    ) =>
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: options.observedBlock ?? 102n,
        quoteRead,
        transactionPending: options.transactionPending ?? false,
      });

    expect([
      derive({ status: "idle" }),
      derive({ status: "loading" }),
      derive({ status: "failed" }),
      derive(loadedQuote({ ...quote, amountIn: quote.amountIn + 1n })),
      derive(loadedQuote(quote), { observedBlock: 106n }),
      derive(loadedQuote({ ...quote, liquidTokenForWeth: true })),
      derive(loadedQuote(quote), { transactionPending: true }),
    ]).toEqual([
      { status: "missing-quote", submitEnabled: false },
      { status: "quote-loading", submitEnabled: false },
      {
        status: "quote-unavailable",
        submitEnabled: false,
        retryAvailable: true,
      },
      { status: "stale-quote", submitEnabled: false, retryAvailable: true },
      { status: "stale-quote", submitEnabled: false, retryAvailable: true },
      { status: "stale-quote", submitEnabled: false, retryAvailable: true },
      { status: "transaction-pending", submitEnabled: false },
    ]);
  });

  it("reviews an exact FUEL sale with quote-pinned whole-unit boundary impact", () => {
    const wallet = {
      ...loadedWallet,
      pendingDiscoveryCount: 1,
      transientCollectibleCount: 1,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "1.5",
      direction: "sell",
      readerAvailable: true,
      wallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: true,
            amountIn: 1_500_000_000_000_000_000n,
            amountInFormatted: "1.5",
            amountOut: 12_000_000_000_000_000n,
            amountOutFormatted: "0.012",
            tradingFee: 360_000_000_000_000n,
            tradingFeeFormatted: "0.00036",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: discoveryForWallet(
              "sell",
              wallet,
              1_500_000_000_000_000_000n,
              {
                pendingDiscoveryCount: 1,
                transientCollectibleCount: 1,
              },
            ),
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      status: "ready",
      submitEnabled: true,
      review: {
        sentence:
          "You pay 1.5 $FUEL and receive 0.012 WETH. The 3.00% fee is 0.00036 WETH. This sale cancels 1 Pending Discovery and dissolves 1 Grounded Craft.",
      },
    });
  });

  it("adds a proportionate warning when a buy would schedule many random Discoveries", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 0n,
      transientCollectibleCount: 0,
      wethBalanceWei: 2_000_000_000_000_000_000n,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "1",
      direction: "buy",
      readerAvailable: true,
      wallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 1_000_000_000_000_000_000n,
            amountInFormatted: "1",
            amountOut: 11_000_000_000_000_000_000n,
            amountOutFormatted: "11",
            tradingFee: 30_000_000_000_000_000n,
            tradingFeeFormatted: "0.03",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: discoveryForWallet(
              "buy",
              wallet,
              11_000_000_000_000_000_000n,
            ),
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      status: "ready",
      review: {
        warning:
          "Large collection change: this trade schedules 11 random Discoveries. Use a smaller amount if you only want one Grounded Craft.",
      },
    });
  });

  it.each([
    {
      balance: 200_000_000_000_000_000n,
      output: 300_000_000_000_000_000n,
      exactOutput: "0.3",
      displayOutput: "0.3",
      remaining: "0.5",
    },
    {
      balance: 0n,
      output: 88_675_214_684_693_132n,
      exactOutput: "0.088675214684693132",
      displayOutput: "0.088675",
      remaining: "0.91133",
    },
  ])(
    "explains the rounded-up remaining boundary ($remaining) when a fractional buy schedules no Discovery",
    ({ balance, output, exactOutput, displayOutput, remaining }) => {
      const wallet = {
        ...loadedWallet,
        liquidTokenBalanceWei: balance,
        transientCollectibleCount: 0,
      };
      const intent = deriveExchangeIntent({
        accessState: "ready",
        amount: "0.001",
        direction: "buy",
        readerAvailable: true,
        wallet,
      });

      const result = deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: false,
            amountIn: 1_000_000_000_000_000n,
            amountInFormatted: "0.001",
            amountOut: output,
            amountOutFormatted: exactOutput,
            tradingFee: 30_000_000_000_000n,
            tradingFeeFormatted: "0.00003",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: discoveryForWallet("buy", wallet, output),
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      });

      expect(requireReadyReview(result).sentence).toBe(
        `You pay 0.001 WETH and receive ${displayOutput} $FUEL. The 3.00% fee is 0.00003 WETH. After this trade, ${remaining} $FUEL remains before the next random Discovery.`,
      );
    },
  );

  it("states when a fractional sale preserves every collectible", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 2_400_000_000_000_000_000n,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "0.2",
      direction: "sell",
      readerAvailable: true,
      wallet,
    });

    const result = deriveExchangeReviewState({
      intent,
      nowMilliseconds: reviewNowMilliseconds,
      observedBlock: 102n,
      quoteRead: loadedQuote(
        {
          liquidTokenForWeth: true,
          amountIn: 200_000_000_000_000_000n,
          amountInFormatted: "0.2",
          amountOut: 1_600_000_000_000_000n,
          amountOutFormatted: "0.0016",
          tradingFee: 48_000_000_000_000n,
          tradingFeeFormatted: "0.000048",
          observedBlock: 100n,
          expiresAtBlock: 105n,
          tradingFeeBps: 300,
          discovery: discoveryForWallet(
            "sell",
            wallet,
            200_000_000_000_000_000n,
          ),
        },
        quoteReceivedAtMilliseconds,
        wallet,
      ),
      transactionPending: false,
    });

    expect(requireReadyReview(result).sentence).toBe(
      "You pay 0.2 $FUEL and receive 0.0016 WETH. The 3.00% fee is 0.000048 WETH. This sale stays within the current fractional balance. It does not cancel a Pending Discovery or dissolve a Grounded Craft.",
    );
  });

  it("warns proportionately before a sale removes many whole-unit holdings", () => {
    const wallet = {
      ...loadedWallet,
      liquidTokenBalanceWei: 12_000_000_000_000_000_000n,
      transientCollectibleCount: 12,
    };
    const intent = deriveExchangeIntent({
      accessState: "ready",
      amount: "11",
      direction: "sell",
      readerAvailable: true,
      wallet,
    });

    expect(
      deriveExchangeReviewState({
        intent,
        nowMilliseconds: reviewNowMilliseconds,
        observedBlock: 102n,
        quoteRead: loadedQuote(
          {
            liquidTokenForWeth: true,
            amountIn: 11_000_000_000_000_000_000n,
            amountInFormatted: "11",
            amountOut: 80_000_000_000_000_000n,
            amountOutFormatted: "0.08",
            tradingFee: 2_400_000_000_000_000n,
            tradingFeeFormatted: "0.0024",
            observedBlock: 100n,
            expiresAtBlock: 105n,
            tradingFeeBps: 300,
            discovery: discoveryForWallet(
              "sell",
              wallet,
              11_000_000_000_000_000_000n,
            ),
          },
          quoteReceivedAtMilliseconds,
          wallet,
        ),
        transactionPending: false,
      }),
    ).toMatchObject({
      review: {
        warning:
          "Large collection change: this trade removes 11 whole-unit holdings. Check the collection impact before submitting.",
      },
    });
  });
});

describe("exchange trade terms", () => {
  const quote = (
    overrides: Partial<Parameters<typeof deriveExchangeTradeTerms>[0]> = {},
  ) =>
    ({
      liquidTokenForWeth: false,
      amountIn: 10n ** 18n,
      amountInFormatted: "1",
      amountOut: 100n * 10n ** 18n,
      amountOutFormatted: "100",
      tradingFee: 3n * 10n ** 16n,
      tradingFeeFormatted: "0.03",
      observedBlock: 46_176_595n,
      expiresAtBlock: 46_176_600n,
      tradingFeeBps: 300,
      ...overrides,
    }) as Parameters<typeof deriveExchangeTradeTerms>[0];

  it("states the minimum received under the fixed tolerance", () => {
    const terms = deriveExchangeTradeTerms(quote());
    expect(terms.minimumReceived).toBe("99 $FUEL");
    expect(terms.slippageTolerance).toBe("1%");
    expect(terms.deadline).toBe("10 minutes");
  });

  it("derives the average execution price for a buy", () => {
    const terms = deriveExchangeTradeTerms(quote());
    expect(terms.executionPrice).toBe("0.01 WETH per $FUEL");
    expect(terms.payAsset).toBe("WETH");
    expect(terms.receiveAsset).toBe("$FUEL");
  });

  it("derives the average execution price for a sell", () => {
    const terms = deriveExchangeTradeTerms(
      quote({
        liquidTokenForWeth: true,
        amountIn: 100n * 10n ** 18n,
        amountOut: 10n ** 18n,
      }),
    );
    expect(terms.executionPrice).toBe("0.01 WETH per $FUEL");
    expect(terms.payAsset).toBe("$FUEL");
    expect(terms.receiveAsset).toBe("WETH");
    expect(terms.minimumReceived).toBe("0.99 WETH");
  });

  it("reports the quoted block and fee in display units", () => {
    const terms = deriveExchangeTradeTerms(quote());
    expect(terms.quoteBlock).toBe("46176595");
    expect(terms.feeAmount).toBe("0.03 WETH");
    expect(terms.feePercent).toBe("3.00%");
  });

  it("omits price impact when no reference price is available", () => {
    expect(deriveExchangeTradeTerms(quote()).priceImpact).toBeUndefined();
    expect(deriveExchangeTradeTerms(quote(), 0n).priceImpact).toBeUndefined();
  });

  it("measures price impact against the marginal reference price", () => {
    // Execution 0.01 WETH per token against a 0.008 reference is +25%.
    const terms = deriveExchangeTradeTerms(quote(), 8n * 10n ** 15n);
    expect(terms.priceImpact).toBe("25%");
  });

  it("applies the same bounded minimum the submit path uses", () => {
    expect(exchangeMinimumAmountOut(100n * 10n ** 18n)).toBe(99n * 10n ** 18n);
    expect(exchangeMinimumAmountOut(0n)).toBe(0n);
    expect(EXCHANGE_SLIPPAGE_POLICY.toleranceBps).toBe(100);
    expect(EXCHANGE_SLIPPAGE_POLICY.deadlineSeconds).toBe(600);
  });
});
