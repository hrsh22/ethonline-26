/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UserRejectedRequestError, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  fundedThroughBlock: 4_242n,
  protocol: undefined as unknown,
  signMessage: vi.fn(async () => `0x${"ab".repeat(65)}`),
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => testState.protocol,
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => ({
    getBlockNumber: () => Promise.resolve(testState.fundedThroughBlock),
  }),
  useSignMessage: () => ({ signMessageAsync: testState.signMessage }),
}));

vi.mock("@/components/wallet-control", () => ({
  WalletControl: () => <button type="button">Wallet control</button>,
}));

import { applicationCopy } from "@/lib/identity";
import { FaucetPanel } from "./faucet-panel";

const address = "0x2000000000000000000000000000000000000002" as const;

const protocol = (
  accessState:
    "disconnected" | "wrong-network" | "deployment-pending" | "ready",
  selectedAddress: Address = address,
) => ({
  accessState,
  address: accessState === "disconnected" ? undefined : selectedAddress,
  refreshWallet: vi.fn().mockResolvedValue(undefined),
  walletRead:
    accessState === "ready"
      ? ({
          status: "loaded" as const,
          snapshot: {
            liquidToken: {
              formatted: "0.7242",
              rawWei: 724_200_000_000_000_000n,
            },
          },
        } as const)
      : ({ status: "blocked" as const, accessState } as const),
});

describe("collector testnet faucet", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const renderPanel = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <FaucetPanel />
        </QueryClientProvider>,
      ),
    );
  };

  const flushPanel = async (action?: () => void) => {
    await act(async () => {
      action?.();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  it("explains every test asset boundary before asking for a wallet", async () => {
    testState.protocol = protocol("disconnected");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();

    const headings = [
      ...container.querySelectorAll("[data-faucet-asset] h2"),
    ].map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Base Sepolia ETH",
      "Test WETH",
      "$FUEL",
      "Collectibles",
    ]);
    expect(container.textContent).toContain("Gas only");
    expect(container.textContent).toContain("Buy it on Trade");
    expect(container.textContent).toContain("Never minted by this faucet");
    expect(container.textContent).toContain(
      "Connect a wallet to check eligibility",
    );
    expect(
      container.querySelector('[aria-labelledby="faucet-top-up-amounts"]'),
    ).toBeNull();
    const requestState = container.querySelector(
      "[data-funding-state='disconnected']",
    );
    expect(requestState?.getAttribute("role")).toBe("status");
    expect(requestState?.getAttribute("aria-live")).toBe("polite");
    // The wallet action lives inside the announced request state, so the
    // reader hears the condition and the way out together.
    expect(requestState?.querySelector("button")?.textContent).toContain(
      "Wallet control",
    );
    expect(container.textContent?.toLowerCase()).not.toContain("private key");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the top-up unavailable until Base Sepolia is selected", async () => {
    testState.protocol = protocol("wrong-network");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();

    expect(
      container.querySelector("[data-funding-state='wrong-network']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Switch to Base Sepolia");
    expect(container.textContent).toContain("Wallet control");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not dash the cooldown for a wallet that is not in one", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: {
            chainId: 84_532,
            cooldownSeconds: 86_400,
            state: "ready",
            targets: {
              ethWei: "10000000000000000",
              wethWei: "100000000000000000",
            },
          },
          recipient: {
            address,
            state: "already-funded",
            nextEligibleAt: null,
            balances: {
              ethWei: "10000000000000000",
              wethWei: "100000000000000000",
            },
            remaining: { ethWei: "0", wethWei: "0" },
          },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    // Explicit null means the service verified no active cooldown.
    const metric = [...container.querySelectorAll("div")].find((node) =>
      node.textContent?.startsWith(applicationCopy.faucet.nextEligible),
    );
    expect(metric?.textContent).toContain(applicationCopy.faucet.eligibleNow);
    expect(metric?.textContent).not.toContain("—");
  });

  it("shows exact inventory-backed balances and completes one bounded top-up", async () => {
    testState.protocol = protocol("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          apiVersion: 1,
          service: {
            chainId: 84_532,
            state: "ready",
            targets: {
              ethWei: "10000000000000000",
              wethWei: "100000000000000000",
            },
          },
          recipient: {
            address,
            state: "eligible",
            balances: {
              ethWei: "1000000000000000",
              wethWei: "25000000000000000",
            },
            remaining: {
              ethWei: "9000000000000000",
              wethWei: "75000000000000000",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ challenge: { message: "orbit funding proof" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          apiVersion: 1,
          request: { id: "request-1", state: "funded" },
          recipient: {
            address,
            state: "funded",
            nextEligibleAt: 1_700_086_400_000,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          recipient: {
            address,
            state: "already-funded",
            nextEligibleAt: 1_700_086_400_000,
            balances: {
              ethWei: "10000000000000000",
              wethWei: "100000000000000000",
            },
            remaining: { ethWei: "0", wethWei: "0" },
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();
    await flushPanel();

    expect(container.textContent).toContain("0.001 ETH");
    expect(container.textContent).toContain("0.009 ETH remaining");
    expect(container.textContent).toContain("0.025 WETH");
    expect(container.textContent).toContain("0.075 WETH remaining");
    const eligibleAgain = [...container.querySelectorAll("dt")].find(
      (term) => term.textContent === "Eligible again",
    )?.nextElementSibling;
    expect(eligibleAgain?.textContent).toBe("Now");
    const fund = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Top up this wallet",
    );
    expect(fund).toBeDefined();
    await flushPanel(() => fund?.click());

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8800/v1/funding/fund",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      container.querySelector("[data-funding-state='funded']"),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Wallet funded for the test journey",
    );
    expect(container.textContent).toContain("Buy $FUEL on Trade");
    expect(container.textContent).toContain("0.01 ETH");
    expect(container.textContent).toContain("0 ETH remaining");
    expect(container.textContent).toContain("0.1 WETH");
    expect(container.textContent).toContain("0 WETH remaining");
    expect(container.querySelector("time")?.dateTime).toBe(
      "2023-11-15T22:13:20.000Z",
    );
    // The protocol wallet read is taken at the indexed block, which trails the
    // chain. Refreshing without a floor read the balance from before the
    // transfer and never polled again, so a funded collector saw 0 WETH on
    // Trade until a manual reload.
    expect(
      (
        testState.protocol as {
          readonly refreshWallet: ReturnType<typeof vi.fn>;
        }
      ).refreshWallet,
    ).toHaveBeenCalledWith(testState.fundedThroughBlock);
  });

  it.each([
    new UserRejectedRequestError(new Error("User rejected the request")),
    { code: 4001, message: "User rejected the request" },
  ])(
    "sends no funding request after a rejected proof and lets the wallet try again %#",
    async (rejection) => {
      testState.protocol = protocol("ready");
      testState.signMessage.mockRejectedValueOnce(rejection);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            apiVersion: 1,
            service: { chainId: 84_532, state: "ready" },
            recipient: { address, state: "eligible" },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ challenge: { message: "first funding proof" } }),
        )
        .mockResolvedValueOnce(
          Response.json({ challenge: { message: "fresh funding proof" } }),
        )
        .mockResolvedValue(
          Response.json({
            apiVersion: 1,
            request: { id: "request-after-rejection", state: "funded" },
            recipient: { address, state: "funded" },
          }),
        );
      vi.stubGlobal("fetch", fetcher);

      await renderPanel();
      await flushPanel();
      const fund = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Top up this wallet",
      );
      await flushPanel(() => fund?.click());

      const cancelled = container.querySelector("[role='status'][aria-live]");
      expect(cancelled?.textContent).toContain("Wallet signing cancelled");
      expect(cancelled?.textContent).toContain(
        "This attempt did not request a top-up or send assets.",
      );
      expect(container.textContent).not.toContain("Top-up needs a safe retry");
      expect(
        fetcher.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(false);

      const retry = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Retry top-up",
      );
      expect(retry).toBeDefined();
      await flushPanel(() => retry?.click());

      expect(fetcher).toHaveBeenCalledWith(
        "http://127.0.0.1:8800/v1/funding/fund",
        expect.objectContaining({
          body: expect.stringContaining("fresh funding proof"),
          method: "POST",
        }),
      );
      expect(container.textContent).toContain(
        "Wallet funded for the test journey",
      );
      const eligibleAgain = [...container.querySelectorAll("dt")].find(
        (term) => term.textContent === "Eligible again",
      )?.nextElementSibling;
      expect(eligibleAgain?.textContent).not.toContain("Now");
      expect(eligibleAgain?.querySelector("[aria-label]")).not.toBeNull();
    },
  );

  it("offers a safe top-up retry when the POST transport fails", async () => {
    testState.protocol = protocol("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          recipient: { address, state: "eligible" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ challenge: { message: "orbit funding proof" } }),
      )
      .mockRejectedValueOnce(new Error("funding transport offline"));
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();
    await flushPanel();
    const fund = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Top up this wallet",
    );
    await flushPanel(() => fund?.click());

    expect(
      container.querySelector("[data-funding-state='retryable']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Top-up needs a safe retry");
    expect(container.textContent).toContain("Retry top-up");
    const retryable = container.querySelector(
      "[data-funding-state='retryable']",
    );
    expect(retryable?.getAttribute("role")).toBe("alert");
    expect(retryable?.getAttribute("aria-live")).toBe("assertive");
  });

  it("labels a status transport outage as temporary and safely retryable", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("status offline")),
    );

    await renderPanel();
    await flushPanel();

    expect(
      container.querySelector("[data-funding-state='unavailable']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Faucet temporarily unavailable");
    expect(container.textContent).toContain("Check again");
    const unavailable = container.querySelector(
      "[data-funding-state='unavailable']",
    );
    expect(unavailable?.getAttribute("role")).toBe("alert");
    expect(unavailable?.getAttribute("aria-live")).toBe("assertive");
  });

  it.each([
    [
      {
        apiVersion: 1,
        service: { chainId: 84_532, state: "inventory-empty" },
        recipient: { address, state: "unavailable" },
      },
      "inventory-empty",
      "Faucet inventory is empty",
    ],
    [
      {
        apiVersion: 1,
        service: { chainId: 84_532, state: "disabled" },
        recipient: { address, state: "unavailable" },
      },
      "disabled",
      "Faucet is disabled",
    ],
    [
      {
        apiVersion: 1,
        recipient: { address, state: "rate-limited" },
        error: { code: "funding-rate-limited", nextEligibleAt: 2_000_000_000 },
      },
      "cooldown",
      "Wallet is in cooldown",
    ],
    [
      {
        apiVersion: 1,
        recipient: { address, state: "limit-reached" },
      },
      "lifetime-exhausted",
      "Wallet reached its top-up limit",
    ],
    [
      {
        apiVersion: 1,
        error: { code: "funding-rpc-unavailable" },
      },
      "rpc-unavailable",
      "Base Sepolia balance check unavailable",
    ],
    [
      {
        apiVersion: 1,
        request: { id: "request-retry", state: "retryable" },
        error: { code: "funding-failed" },
      },
      "retryable",
      "Top-up needs a safe retry",
    ],
  ] as const)(
    "renders %s as a distinct public state",
    async (body, state, title) => {
      testState.protocol = protocol("ready");
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)),
      );

      await renderPanel();
      await flushPanel();

      expect(
        container.querySelector(`[data-funding-state='${state}']`),
      ).not.toBeNull();
      expect(container.textContent).toContain(title);
    },
  );

  it("interprets the worker cooldown boundary as epoch milliseconds", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          recipient: {
            address,
            state: "rate-limited",
            nextEligibleAt: 1_700_086_400_000,
          },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    expect(container.querySelector("time")?.dateTime).toBe(
      "2023-11-15T22:13:20.000Z",
    );
  });
  it("leads with eligibility and the action before asset education", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          recipient: { address, state: "eligible" },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    // Addressed by role and accessible name; the disclosure is a shared
    // primitive now, not a `<details>` with a route class.
    const request = container.querySelector("[data-funding-state]");
    const assets = container.querySelector(
      `[aria-label="${applicationCopy.faucet.assetBoundaryLabel}"]`,
    );
    expect(request).not.toBeNull();
    expect(assets).not.toBeNull();
    expect(request?.compareDocumentPosition(assets as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows the wallet's $FUEL holding on the card that says to buy it", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          recipient: { address, state: "eligible" },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    // The route's terminal action is buying $FUEL, and the card explaining it
    // used to carry prose only -- the holding lived two routes away.
    const fuelCard = [
      ...container.querySelectorAll("[data-faucet-asset]"),
    ].find((card) => card.querySelector("h2")?.textContent === "$FUEL");
    expect(fuelCard?.textContent).toContain("0.7242 $FUEL");
    // The faucet never dispenses $FUEL, so the card must not imply a top-up.
    expect(fuelCard?.textContent).not.toContain("remaining");
  });

  it("does not re-read funding status on a standing timer", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          recipient: { address, state: "eligible" },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: ["testnet-funding-status", address] });
    const options = query?.options as
      { readonly refetchInterval?: number | false } | undefined;
    expect(options?.refetchInterval).toBe(false);
  });

  it("keeps asset education collapsed as supporting disclosure", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          recipient: { address, state: "eligible" },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    const trigger = [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.trim() ===
        applicationCopy.faucet.assetBoundaryLabel,
    );
    expect(trigger).toBeDefined();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    // The cards remain reachable, just not ahead of the task: the panel keeps
    // them in the document with `hidden="until-found"` while collapsed.
    const assets = container.querySelector(
      `[aria-label="${applicationCopy.faucet.assetBoundaryLabel}"]`,
    );
    expect(assets?.querySelectorAll("article")).toHaveLength(4);
  });
});
