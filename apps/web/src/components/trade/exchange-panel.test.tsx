/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const testState = vi.hoisted(() => ({
  quoteExactInput: vi.fn(),
  protocol: undefined as unknown,
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => testState.protocol,
}));

import { ExchangePanel } from "./exchange-panel";

const enterAmount = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText",
    }),
  );
};

const quote = {
  liquidTokenForWeth: false,
  amountIn: 1_000_000_000_000_000_000n,
  amountInFormatted: "1",
  amountOut: 1_200_000_000_000_000_000n,
  amountOutFormatted: "1.2",
  tradingFee: 30_000_000_000_000_000n,
  tradingFeeFormatted: "0.03",
  observedBlock: 46_081_327n,
  expiresAtBlock: 46_081_332n,
  tradingFeeBps: 300,
  marketLabel: "Canonical Market",
  discovery: {
    account: "0x0000000000000000000000000000000000004444",
    accountHoldings: {
      pendingDiscoveryCount: 1,
      transientCollectibleCount: 1,
    },
    sender: {
      account: "0x0000000000000000000000000000000000000017",
      balance: 1_000n * 10n ** 18n,
      discoveryExempt: true,
      mutations: 0,
    },
    recipient: {
      account: "0x0000000000000000000000000000000000004444",
      balance: 2_000_000_000_000_000_000n,
      discoveryExempt: false,
      mutations: 1,
    },
    mutations: 1,
    maximumMutations: 64,
    executable: true,
    maximumLiquidTokenAmount: 64_999_999_999_999_999_999n,
  },
} as const;

const createProtocol = () => ({
  accessState: "ready" as const,
  address: "0x0000000000000000000000000000000000004444" as const,
  chainId: 84_532,
  connected: true,
  deploymentAvailable: true,
  exchangeQuoteRevision: 0,
  reader: {
    quoteExactInput: testState.quoteExactInput,
  },
  health: {
    market: {
      price: {
        wethPerLiquidTokenFormatted: "0.008723113145591267",
        wethPerLiquidTokenWei: 8_723_113_145_591_267n,
      },
    },
  },
  healthPending: false,
  healthError: null,
  nativeBalanceRead: {
    status: "loaded" as const,
    balance: {
      formatted: "5",
      observedBlock: quote.observedBlock - 1n,
      rawWei: 5_000_000_000_000_000_000n,
    },
  },
  walletRead: {
    status: "loaded" as const,
    snapshot: {
      observedBlock: quote.observedBlock - 1n,
      liquidToken: {
        formatted: "2",
        rawWei: 2_000_000_000_000_000_000n,
      },
      settlementToken: {
        formatted: "5",
        rawWei: 5_000_000_000_000_000_000n,
      },
      collectibles: {
        transient: [{ identityId: 1 }, { identityId: 2 }],
        permanent: [],
        pendingDiscovery: { count: 0 },
        permanentHoldingsStatus: "complete" as const,
      },
      partialFailures: [],
    },
  },
  transaction: { status: "idle" as const },
  refresh: vi.fn(),
  refreshWallet: vi.fn(),
  getActionState: vi.fn(),
  execute: vi.fn(),
  retry: vi.fn(),
});

describe("Exchange panel", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  const balanceCell = (asset: string) => {
    const row = [
      ...container.querySelectorAll("[data-balances-list] > div"),
    ].find(
      (candidate) => candidate.querySelector("dt span")?.textContent === asset,
    );
    return {
      paying: row?.getAttribute("data-paying"),
      value: row?.querySelector("dd")?.textContent,
    };
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    testState.quoteExactInput.mockReset();
    testState.quoteExactInput.mockResolvedValue(quote);
    testState.protocol = createProtocol();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("starts blank without requesting or enabling an unsafe default trade", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(testState.quoteExactInput).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>("#exchange-amount")?.value,
    ).toBe("");
    const submit = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-exchange-actions] button",
      ),
    ].find(
      (button) =>
        button.textContent === "Buy $FUEL" ||
        button.textContent === "Sell $FUEL",
    );
    expect(submit?.disabled).toBe(true);
    const reasonId = submit?.getAttribute("aria-describedby");
    expect(reasonId).toBe("exchange-submit-disabled-reason");
    expect(container.querySelector(`#${reasonId}`)?.textContent).toContain(
      "Enter an amount and wait for a current quote",
    );
    expect(container.textContent).toContain(
      "Enter an amount to get an automatic live quote.",
    );
    expect(container.textContent).not.toContain(
      "quotes become available after the sealed Base Sepolia deployment is recorded",
    );
  });

  it("labels and disables the action while a transaction is pending", async () => {
    testState.protocol = {
      ...createProtocol(),
      transaction: { status: "pending" as const, label: "Buy $FUEL" },
    };

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    const pendingButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-exchange-actions] button",
      ),
    ].find(
      (button) =>
        button.textContent === "Buying $FUEL…" ||
        button.textContent === "Selling $FUEL…",
    );
    expect(pendingButton).toBeDefined();
    expect(pendingButton?.disabled).toBe(true);
    expect(pendingButton?.getAttribute("aria-describedby")).toBe(
      "exchange-submit-disabled-reason",
    );
    expect(container.textContent).toContain(
      "Wait for the current transaction to finish",
    );
  });

  it("keeps the action disabled after simulation while wallet submission is in flight", async () => {
    testState.protocol = {
      ...createProtocol(),
      transaction: { status: "simulated" as const, label: "Buy $FUEL" },
    };

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const simulatedButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-exchange-actions] button",
      ),
    ].find(
      (button) =>
        button.textContent === "Buying $FUEL…" ||
        button.textContent === "Selling $FUEL…",
    );
    expect(simulatedButton).toBeDefined();
    expect(simulatedButton?.disabled).toBe(true);
  });

  it("shows both sides of the pair and marks the one being paid", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    // Only the asset being paid used to be rendered, so a seller could not read
    // the WETH a sale would land in without switching direction and back.
    // Balances are padded to a fixed fraction so a column of them aligns.
    expect(balanceCell("WETH")).toEqual({ paying: "true", value: "5.0000" });
    expect(balanceCell("$FUEL")).toEqual({ paying: "false", value: "2.0000" });

    const sellButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sell $FUEL",
    );
    expect(sellButton).toBeDefined();
    await act(async () => sellButton?.click());

    expect(balanceCell("WETH")).toEqual({ paying: "false", value: "5.0000" });
    expect(balanceCell("$FUEL")).toEqual({ paying: "true", value: "2.0000" });
  });

  it("names the block the balances were read at and re-reads them on demand", async () => {
    const protocol = createProtocol();
    testState.protocol = protocol;
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    // A balance with no stated block is indistinguishable from a stale one.
    expect(
      container.querySelector("[data-balances-observed]")?.textContent,
    ).toBe(
      `Read at block${(quote.observedBlock - 1n).toLocaleString("en-US")}`,
    );
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Refresh balances",
    );
    expect(refresh).toBeDefined();
    await act(async () => refresh?.click());
    expect(protocol.refreshWallet).toHaveBeenCalledTimes(1);
    expect(protocol.refresh).not.toHaveBeenCalled();

    protocol.nativeBalanceRead.balance.observedBlock = quote.observedBlock - 3n;
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const ethRow = [
      ...container.querySelectorAll("[data-balances-list] > div"),
    ].find((row) => row.querySelector("dt span")?.textContent === "ETH");
    expect(ethRow?.textContent).toContain(
      `Read at block${(quote.observedBlock - 3n).toLocaleString("en-US")}`,
    );
    expect(
      container.querySelector("[data-balances-observed]")?.textContent,
    ).toBe(
      `WETH / $FUELRead at block${(quote.observedBlock - 1n).toLocaleString("en-US")}`,
    );
  });

  it("shows pending receipt synchronization beside otherwise loaded balances", async () => {
    const protocol = {
      ...createProtocol(),
      walletSynchronizing: true,
      transaction: {
        status: "confirmed" as const,
        label: "Buy $FUEL",
        hash: `0x${"12".repeat(32)}` as const,
      },
    };
    testState.protocol = protocol;
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    expect(container.textContent).toContain("Confirmed on Base Sepolia");
    expect(container.textContent).toContain(
      "Updating wallet data from the confirmed block",
    );
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry wallet read",
    );
    expect(refresh).toBeDefined();
    await act(async () => refresh?.click());
    expect(protocol.refreshWallet).toHaveBeenCalledOnce();
    expect(protocol.execute).not.toHaveBeenCalled();
  });

  it("disables balance refresh until wallet reads are available", async () => {
    testState.protocol = {
      ...createProtocol(),
      accessState: "disconnected" as const,
      address: undefined,
      connected: false,
      walletRead: {
        status: "blocked" as const,
        accessState: "disconnected" as const,
      },
      nativeBalanceRead: {
        status: "blocked" as const,
        accessState: "disconnected" as const,
      },
    };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Refresh balances",
    );
    expect(refresh?.disabled).toBe(true);
  });

  it("distinguishes a failed wallet read from a zero balance", async () => {
    testState.protocol = {
      ...createProtocol(),
      walletRead: { status: "failed" as const, error: new Error("rpc") },
    };

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    // The reason is stated once, by the panel, and each unreadable balance
    // shows an em dash carrying that reason — never a zero a trader would act
    // on. The audited board substituted the words "Read failed" into all three
    // value slots instead.
    expect(container.textContent).toContain(
      "Wallet balance unavailable — retry the wallet read before trading.",
    );
    expect(balanceCell("WETH").value).toBe("\u2014");
    expect(balanceCell("$FUEL").value).toBe("\u2014");
    expect(container.textContent).not.toContain("0 WETH");
    expect(
      container.querySelectorAll("[role='alert'], [role='status']"),
    ).toHaveLength(1);
  });

  it("announces a loading wallet balance only once", async () => {
    testState.protocol = {
      ...createProtocol(),
      walletRead: { status: "loading" as const },
    };

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    expect(container.textContent).toContain("Reading the wallet balance");
    expect(
      container.querySelectorAll("[role='alert'], [role='status']"),
    ).toHaveLength(1);
  });

  it("explains a missing market reader beside the disabled amount field", async () => {
    testState.protocol = {
      ...createProtocol(),
      reader: undefined,
    };

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );

    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    expect(input?.getAttribute("aria-describedby")).toBe(
      "exchange-amount-feedback",
    );
    expect(container.textContent).toContain(
      "The live Canonical Market reader is unavailable.",
    );
    expect(testState.quoteExactInput).not.toHaveBeenCalled();
  });

  it("recovers an over-balance FUEL sale by switching to the buy side", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const sellButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sell $FUEL",
    );
    await act(async () => sellButton?.click());
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "6");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    // The WETH faucet cannot fix a FUEL shortfall, and this direction used to
    // end at "not enough" with no way out at all.
    expect(container.textContent).toContain("Not enough $FUEL");
    expect(container.querySelector("a[href='/faucet']")).toBeNull();
    const recovery = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Buy $FUEL first",
    );
    expect(recovery).toBeDefined();
    await act(async () => recovery?.click());
    const buyToggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Buy $FUEL",
    );
    expect(buyToggle?.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps an over-balance WETH buy local, disabled, and recoverable through the faucet", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "6");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect(testState.quoteExactInput).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Not enough WETH");
    expect(container.querySelector("a[href='/faucet']")?.textContent).toBe(
      "Get test WETH",
    );
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      )?.disabled,
    ).toBe(true);
  });

  it("uses the observed FUEL balance for sell eligibility without offering the WETH faucet", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const sellButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sell $FUEL",
    );
    await act(async () => sellButton?.click());
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "3");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect(testState.quoteExactInput).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Not enough $FUEL");
    expect(container.textContent).toContain("Enter 2 $FUEL or less.");
    expect(container.querySelector("a[href='/faucet']")).toBeNull();
  });

  it("explains invalid precision beside the amount without querying", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1.0000000000000000001");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect(testState.quoteExactInput).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Enter a positive decimal with up to 18 places.",
    );
  });

  it("automatically renders a current quote and explicit review before enabling submit", async () => {
    testState.quoteExactInput.mockResolvedValue({
      ...quote,
      amountIn: 10_000_000_000_000_000n,
      amountInFormatted: "0.01",
      amountOut: 1_200_000_000_000_000_000n,
      amountOutFormatted: "1.2",
      tradingFee: 300_000_000_000_000n,
      tradingFeeFormatted: "0.0003",
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "0.01");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(testState.quoteExactInput).toHaveBeenCalledWith(
      false,
      10_000_000_000_000_000n,
      createProtocol().address,
    );
    const quoteQuery = queryClient
      .getQueryCache()
      .getAll()
      .find((query) => query.queryKey[0] === "canonical-market-quote");
    expect(quoteQuery?.options).toMatchObject({
      refetchInterval: false,
      retry: 0,
    });
    expect(container.textContent).toContain(
      "You pay 0.01 WETH and receive 1.2 $FUEL. The 3.00% fee is 0.0003 WETH. Buying this amount schedules 1 random Discovery.",
    );
    const decisionReview = container.querySelector("[data-trade-review]");
    const exchangeActions = container.querySelector("[data-exchange-actions]");
    const tradeTerms = container.querySelector("[data-trade-terms]");
    expect(decisionReview).not.toBeNull();
    expect(decisionReview?.textContent).toContain("Minimum received");
    expect(decisionReview?.textContent).toContain("Quote freshness");
    expect(decisionReview?.textContent).toContain("0s old · block 46,081,327");
    expect(exchangeActions).not.toBeNull();
    expect(tradeTerms).not.toBeNull();
    expect(
      decisionReview!.compareDocumentPosition(exchangeActions!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      exchangeActions!.compareDocumentPosition(tradeTerms!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      )?.disabled,
    ).toBe(false);
  });

  it("removes the reviewed quote and disables submit while a transaction-time drift refreshes", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(testState.quoteExactInput).toHaveBeenCalledOnce(),
      );
    });

    const submitButton = () =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      );
    await act(async () => {
      await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    });

    let resolveRefreshedQuote: (value: typeof quote) => void = () => undefined;
    testState.quoteExactInput.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefreshedQuote = resolve;
        }),
    );
    testState.protocol = {
      ...createProtocol(),
      exchangeQuoteRevision: 1,
      transaction: {
        status: "failed" as const,
        label: "Buy $FUEL",
        message:
          "The live quote or collection impact changed. Review the refreshed trade details, then submit again.",
      },
    };
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(testState.quoteExactInput).toHaveBeenCalledTimes(2),
      );
    });

    expect(submitButton()?.disabled).toBe(true);
    expect(container.textContent).toContain("Getting a current quote…");
    expect(container.textContent).not.toContain(
      "You pay 1 WETH and receive 1.2 $FUEL",
    );

    await act(async () => {
      resolveRefreshedQuote(quote);
      await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    });
  });

  it("binds the quote to the wallet and blocks an impossible discovery transfer", async () => {
    const recipientBalance = 833_929_404_331_779_245_120n;
    const maximumLiquidTokenAmount =
      65n * 10n ** 18n - (recipientBalance % 10n ** 18n) - 1n;
    testState.quoteExactInput.mockResolvedValue({
      ...quote,
      amountOut: 107_750_806_090_999_699_498n,
      amountOutFormatted: "107.750806090999699498",
      discovery: {
        account: createProtocol().address,
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
          account: createProtocol().address,
          balance: recipientBalance,
          discoveryExempt: false,
          mutations: 108,
        },
        mutations: 108,
        maximumMutations: 64,
        executable: false,
        maximumLiquidTokenAmount,
      },
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(testState.quoteExactInput).toHaveBeenCalledWith(
      false,
      1_000_000_000_000_000_000n,
      createProtocol().address,
    );
    expect(container.textContent).toContain(
      "This trade crosses 108 whole-unit discovery boundaries",
    );
    // Readable, not the exact expansion. The bound is a guardrail a trader
    // acts on, and eighteen decimals of it is unreadable in a sentence.
    expect(container.textContent).toContain("64.0706 $FUEL");
    // The capped quote itself still shows in the read-only receive field.
    expect(
      container.querySelector<HTMLInputElement>("[data-quote-output] input")
        ?.value,
    ).toContain("107.7508");
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      )?.disabled,
    ).toBe(true);
  });

  it("requests new wallet-bound evidence when the connected account changes", async () => {
    testState.quoteExactInput.mockImplementation(
      async (
        _direction: boolean,
        amountIn: bigint,
        account: `0x${string}`,
      ) => ({
        ...quote,
        amountIn,
        discovery: {
          ...quote.discovery,
          account,
          recipient: { ...quote.discovery.recipient, account },
        },
      }),
    );
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });

    const nextAddress = "0x0000000000000000000000000000000000005555" as const;
    testState.protocol = { ...createProtocol(), address: nextAddress };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(testState.quoteExactInput).toHaveBeenCalledWith(
      false,
      1_000_000_000_000_000_000n,
      nextAddress,
    );
  });

  it("immediately invalidates a ready quote when the same wallet balance advances across the next boundary", async () => {
    const initialWalletBalance = 250_000_000_000_000_000n;
    const refreshedWalletBalance = 750_000_000_000_000_000n;
    const quotedAtBoundary = {
      ...quote,
      amountOut: 64_250_000_000_000_000_000n,
      amountOutFormatted: "64.25",
      discovery: {
        ...quote.discovery,
        accountHoldings: {
          pendingDiscoveryCount: 0,
          transientCollectibleCount: 0,
        },
        recipient: {
          ...quote.discovery.recipient,
          balance: initialWalletBalance,
          mutations: 64,
        },
        mutations: 64,
        maximumLiquidTokenAmount: 64_749_999_999_999_999_999n,
      },
    };
    let resolveRefreshedQuote: ((value: unknown) => void) | undefined;
    testState.quoteExactInput
      .mockResolvedValueOnce(quotedAtBoundary)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefreshedQuote = resolve;
          }),
      );
    const initialProtocol = createProtocol();
    testState.protocol = {
      ...initialProtocol,
      walletRead: {
        status: "loaded" as const,
        snapshot: {
          ...initialProtocol.walletRead.snapshot,
          observedBlock: quote.observedBlock - 1n,
          liquidToken: {
            formatted: "0.25",
            rawWei: initialWalletBalance,
          },
        },
      },
    };

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const submitButton = () =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      );
    await act(async () => {
      await vi.waitFor(() => expect(submitButton()?.disabled).toBe(false));
    });

    const refreshedProtocol = createProtocol();
    testState.protocol = {
      ...refreshedProtocol,
      walletRead: {
        status: "loaded" as const,
        snapshot: {
          ...refreshedProtocol.walletRead.snapshot,
          observedBlock: quote.observedBlock + 1n,
          liquidToken: {
            formatted: "0.75",
            rawWei: refreshedWalletBalance,
          },
        },
      },
    };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() =>
        expect(testState.quoteExactInput).toHaveBeenCalledTimes(2),
      );
    });

    expect(submitButton()?.disabled).toBe(true);
    expect(container.textContent).toContain("Getting a current quote…");
    expect(container.textContent).not.toContain("64.25");
    expect(
      container.querySelector<HTMLInputElement>("[data-quote-output] input")
        ?.value,
    ).toBe("");

    const refreshedQuote = {
      ...quotedAtBoundary,
      observedBlock: quote.observedBlock + 2n,
      expiresAtBlock: quote.expiresAtBlock + 2n,
      discovery: {
        ...quotedAtBoundary.discovery,
        recipient: {
          ...quotedAtBoundary.discovery.recipient,
          balance: refreshedWalletBalance,
          mutations: 65,
        },
        mutations: 65,
        executable: false,
        maximumLiquidTokenAmount: 64_249_999_999_999_999_999n,
      },
    };
    testState.quoteExactInput.mockResolvedValue(refreshedQuote);
    await act(async () => {
      resolveRefreshedQuote?.(refreshedQuote);
      await vi.waitFor(() =>
        expect(container.textContent).toContain(
          "This trade crosses 65 whole-unit discovery boundaries",
        ),
      );
    });

    expect(submitButton()?.disabled).toBe(true);
  });

  it("submits the exact reviewed quote with the bounded minimum output", async () => {
    const protocol = createProtocol();
    testState.protocol = protocol;
    testState.quoteExactInput.mockResolvedValue({
      ...quote,
      amountIn: 10_000_000_000_000_000n,
      amountInFormatted: "0.01",
      amountOut: 1_200_000_000_000_000_000n,
      amountOutFormatted: "1.2",
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "0.01");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const submitButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-exchange-actions] button",
      ),
    ].find(
      (button) =>
        button.textContent === "Buy $FUEL" ||
        button.textContent === "Sell $FUEL",
    );
    await act(async () => submitButton?.click());

    expect(protocol.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "swap-exact-input",
        quote: expect.objectContaining({ amountIn: 10_000_000_000_000_000n }),
        exactAmountIn: 10_000_000_000_000_000n,
        minimumAmountOut: 1_188_000_000_000_000_000n,
        recipient: protocol.address,
        liquidTokenForWeth: false,
        useNative: false,
      }),
      "Buy $FUEL",
    );
  });

  it("masks a failed quote, keeps submit disabled, and offers explicit recovery", async () => {
    testState.quoteExactInput.mockRejectedValue(
      new Error("private upstream rpc detail"),
    );
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "0.01");
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // The transport owns the one bounded network retry. The query layer must
    // not multiply a rate-limit failure before offering manual recovery.
    expect(testState.quoteExactInput).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "Live quote unavailable — retry the quote.",
    );
    expect(container.textContent).not.toContain("private upstream rpc detail");
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Retry quote",
      ),
    ).toBeDefined();
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      )?.disabled,
    ).toBe(true);
  });

  it("does not present an expired quote as active evidence", async () => {
    const protocol = createProtocol();
    testState.protocol = {
      ...protocol,
      health: {
        ...protocol.health,
        deployment: { observedBlock: quote.expiresAtBlock + 1n },
      },
    };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain(
      "Quote stale — retry before submitting.",
    );
    const staleFeedback = [
      ...container.querySelectorAll("[role='status']"),
    ].find((element) => element.textContent?.includes("Quote stale"));
    expect(staleFeedback).toBeDefined();
    expect(
      [...container.querySelectorAll("[role='alert']")].some((element) =>
        element.textContent?.includes("Quote stale"),
      ),
    ).toBe(false);
    expect(container.textContent).not.toContain(quote.amountOutFormatted);
    expect(
      container.querySelector<HTMLInputElement>("[data-quote-output] input")
        ?.value,
    ).toBe("");
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      )?.disabled,
    ).toBe(true);
  });

  it("adds no heading the page outline has to skip a level to reach", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Review trade");

    // The route renders one h1 above this panel, so the panel's own headings
    // continue that outline. A level skipped here fails the production
    // accessibility gate, which is the slowest place to discover it.
    const levels = [
      ...container.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ].map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.length).toBeGreaterThan(0);
    for (const [index, level] of levels.entries()) {
      expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 1) + 1);
    }
  });

  it("ages out a quote even when the health block does not advance", async () => {
    testState.quoteExactInput.mockResolvedValue({
      ...quote,
      expiresAtBlock: quote.observedBlock + 2n,
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Review trade");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1_050));
    });

    expect(container.textContent).toContain(
      "Quote stale — retry before submitting.",
    );
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[data-exchange-actions] button",
        ),
      ].find(
        (button) =>
          button.textContent === "Buy $FUEL" ||
          button.textContent === "Sell $FUEL",
      )?.disabled,
    ).toBe(true);
  });

  it("explains large random-Discovery and sell-side impact from quote-pinned evidence", async () => {
    testState.quoteExactInput.mockResolvedValue({
      ...quote,
      amountOut: 11_000_000_000_000_000_000n,
      amountOutFormatted: "11",
      discovery: {
        ...quote.discovery,
        recipient: {
          ...quote.discovery.recipient,
          mutations: 11,
        },
        mutations: 11,
      },
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
    const amountInput =
      container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (amountInput !== null) {
        enterAmount(amountInput, "1");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(amountInput?.value).toBe("1");
    expect(testState.quoteExactInput).toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Large collection change: this trade schedules 11 random Discoveries.",
    );

    testState.protocol = {
      ...createProtocol(),
      walletRead: {
        status: "loaded" as const,
        snapshot: {
          ...createProtocol().walletRead.snapshot,
          collectibles: {
            ...createProtocol().walletRead.snapshot.collectibles,
            pendingDiscovery: { count: 1 },
            transient: [{ identityId: 1 }],
          },
        },
      },
    };
    const sellButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sell $FUEL",
    );
    testState.quoteExactInput.mockResolvedValue({
      ...quote,
      liquidTokenForWeth: true,
      amountOut: 8_000_000_000_000_000n,
      amountOutFormatted: "0.008",
      tradingFee: 240_000_000_000_000n,
      tradingFeeFormatted: "0.00024",
      discovery: {
        ...quote.discovery,
        sender: {
          account: createProtocol().address,
          balance: 2_000_000_000_000_000_000n,
          discoveryExempt: false,
          mutations: 1,
        },
        recipient: {
          ...quote.discovery.sender,
          mutations: 0,
        },
        mutations: 1,
        maximumLiquidTokenAmount: 2_000_000_000_000_000_000n,
      },
    });
    await act(async () => {
      sellButton?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain(
      "This sale cancels 1 Pending Discovery. No Grounded Craft is dissolved.",
    );
  });
  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExchangePanel />
        </QueryClientProvider>,
      ),
    );
  };

  const renderWithQuote = async (value: string) => {
    await render();
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, value);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  it("never shows a numeric output that reads as a real zero quote", async () => {
    await render();

    const output = container.querySelector("[data-quote-output]");
    expect(output?.getAttribute("data-state")).toBe("empty");
    // The receive side is a read-only field: empty, with a placeholder that
    // asks for an amount rather than a `0.00` that reads as a real quote.
    const receive = output?.querySelector<HTMLInputElement>("input");
    expect(receive?.readOnly).toBe(true);
    expect(receive?.value).toBe("");
    expect(receive?.placeholder).toBe("No quote yet");
    expect(output?.textContent).not.toContain("0.00");
  });

  it("fills the amount from the spendable balance with Max", async () => {
    await render();

    const max = container.querySelector<HTMLButtonElement>("[data-max-action]");
    expect(max?.getAttribute("aria-label")).toBe("Use the full WETH balance");
    await act(async () => max?.click());
    expect(
      container.querySelector<HTMLInputElement>("#exchange-amount")?.value,
    ).toBe("5");
  });

  it("submits a native ETH buy through the router without a WETH approval", async () => {
    const protocol = testState.protocol as ReturnType<typeof createProtocol>;
    await render();
    const native = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Pay using"] button',
      ),
    ].find((button) => button.textContent === "ETH");
    await act(async () => native?.click());
    const input = container.querySelector<HTMLInputElement>("#exchange-amount");
    await act(async () => {
      if (input !== null) enterAmount(input, "1");
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const submit = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-exchange-actions] button",
      ),
    ].find((button) => button.textContent === "Buy $FUEL");
    await act(async () => submit?.click());

    expect(protocol.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        exactAmountIn: 1_000_000_000_000_000_000n,
        type: "swap-exact-input",
        useNative: true,
      }),
      "Buy $FUEL",
    );
    expect(
      container.querySelector<HTMLInputElement>("#exchange-amount")?.value,
    ).toBe("");
  });

  it("clears a successfully submitted amount instead of leaving a stale trade in the form", async () => {
    const protocol = testState.protocol as ReturnType<typeof createProtocol>;
    await renderWithQuote("1");
    const submit = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "[data-exchange-actions] button",
      ),
    ].find((button) => button.textContent === "Buy $FUEL");

    await act(async () => submit?.click());

    expect(protocol.execute).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLInputElement>("#exchange-amount")?.value,
    ).toBe("");
    expect(
      container
        .querySelector("[data-quote-output]")
        ?.getAttribute("data-state"),
    ).toBe("empty");
  });

  it("offers Max for the held liquid token when selling", async () => {
    await render();
    const sell = [
      ...container.querySelectorAll("[aria-label] button[aria-pressed]"),
    ].find((button) => button.textContent === "Sell $FUEL");
    await act(async () => (sell as HTMLButtonElement | undefined)?.click());

    const max = container.querySelector<HTMLButtonElement>("[data-max-action]");
    expect(max?.getAttribute("aria-label")).toBe("Use the full $FUEL balance");
    await act(async () => max?.click());
    expect(
      container.querySelector<HTMLInputElement>("#exchange-amount")?.value,
    ).toBe("2");
  });

  it("states the trade terms in display units before submission", async () => {
    await renderWithQuote("1");

    const terms = container.querySelector("[data-trade-terms]");
    expect(terms).not.toBeNull();
    const text = terms?.textContent ?? "";
    expect(text).toContain("Execution price");
    expect(text).toContain("Minimum received");
    expect(text).toContain("Quoted at block");
    expect(text).toContain("46081327");
    expect(text).toContain("Slippage tolerance");
    expect(text).toContain("1%");
    expect(text).toContain("Must confirm within");
    expect(text).toContain("10 minutes");
  });

  it("explains the fixed slippage policy rather than leaving it implicit", async () => {
    await renderWithQuote("1");

    expect(
      container.querySelector("[data-trade-terms]")?.textContent,
    ).toContain("the swap reverts instead of filling at a worse rate");
  });

  it("reports price impact against the marginal reference price", async () => {
    await renderWithQuote("1");

    expect(
      container.querySelector("[data-trade-terms]")?.textContent,
    ).toContain("Price impact");
  });
});
