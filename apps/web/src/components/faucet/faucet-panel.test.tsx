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
    expect(container.textContent).toContain("Gas and trading");
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
            limits: {
              dailyBudget: {
                ethWei: "1000000000000000000",
                wethWei: "20000000000000000000",
              },
              dailyGrantLimit: 100,
              clientWindowSeconds: 3_600,
              clientWindowLimit: 10,
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
    expect(metric?.textContent).toContain("After a balance falls below target");
    expect(metric?.textContent).not.toContain("—");
    expect(container.textContent).toContain("Wallet lifetime grant capNone");
    expect(container.textContent).toContain(
      "Recurring top-ups; wallet cooldown still applies",
    );
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
    expect(container.textContent).toContain("0.009 ETH to reach target");
    expect(container.textContent).toContain("0.025 WETH");
    expect(container.textContent).toContain("0.075 WETH to reach target");
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
    expect(container.textContent).toContain("Test wallet funded");
    expect(container.textContent).toContain("Buy $FUEL on Trade");
    expect(container.textContent).toContain("0.01 ETH");
    expect(container.textContent).toContain("0 ETH to reach target");
    expect(container.textContent).toContain("0.1 WETH");
    expect(container.textContent).toContain("0 WETH to reach target");
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
      expect(container.textContent).not.toContain("Checking your top-up");
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
      expect(container.textContent).toContain("Test wallet funded");
      const eligibleAgain = [...container.querySelectorAll("dt")].find(
        (term) => term.textContent === "Eligible again",
      )?.nextElementSibling;
      expect(eligibleAgain?.textContent).not.toContain("Now");
      expect(eligibleAgain?.querySelector("[aria-label]")).not.toBeNull();
    },
  );

  it("replaces an inventory rejection with newer status without another proof or POST", async () => {
    testState.protocol = protocol("ready");
    let available = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/challenge"))
        return Response.json({ challenge: { message: "one proof" } });
      if (init?.method === "POST")
        return Response.json({
          apiVersion: 1,
          observedAt: 200,
          error: { code: "funding-inventory-empty" },
        });
      return Response.json({
        apiVersion: 1,
        observedAt: available ? 300 : 100,
        service: { chainId: 84532, state: "ready" },
        recipient: { address, state: "eligible" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const waitForState = async (state: string) => {
      await vi.waitFor(async () => {
        // React Query batches observer notifications after the fetch resolves.
        await flushPanel();
        expect(
          container.querySelector(`[data-funding-state='${state}']`),
        ).not.toBeNull();
      });
    };
    await renderPanel();
    await waitForState("eligible");
    await flushPanel(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Top up this wallet")
        ?.click(),
    );
    await waitForState("inventory-empty");
    available = true;
    await flushPanel(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Check again")
        ?.click(),
    );
    await waitForState("eligible");
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/challenge")),
    ).toHaveLength(1);
  });

  it("follows an accepted request automatically, shows each asset, and stops reads after completion", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      testState.protocol = protocol("ready");
      let reads = 0;
      const fetcher = vi.fn<typeof fetch>(async () => {
        reads += 1;
        return Response.json({
          apiVersion: 1,
          observedAt: reads * 100,
          recipient: { address, state: reads === 1 ? "pending" : "funded" },
          request: {
            id: "tracked-grant",
            state: reads === 1 ? "pending" : "funded",
            transactions: [
              { kind: "weth", state: "confirmed" },
              { kind: "eth", state: reads === 1 ? "broadcast" : "confirmed" },
            ],
          },
        });
      });
      vi.stubGlobal("fetch", fetcher);
      await renderPanel();
      await flushPanel();
      expect(container.textContent).toContain("WETH: Received");
      expect(container.textContent).toContain("ETH: Confirming");
      expect(container.textContent).not.toContain("Retry top-up");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await flushPanel();
      expect(
        container.querySelector("[data-funding-state='funded']"),
      ).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(reads).toBe(2);
      expect(
        fetcher.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a completed grant when an older pending POST arrives late", async () => {
    testState.protocol = protocol("ready");
    let finishPost: ((response: Response) => void) | undefined;
    let completed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/challenge"))
        return Response.json({ challenge: { message: "one proof" } });
      if (init?.method === "POST")
        return new Promise<Response>((resolve) => {
          finishPost = resolve;
        });
      return Response.json(
        completed
          ? {
              apiVersion: 1,
              observedAt: 300,
              recipient: { address, state: "funded" },
              request: { id: "grant", state: "funded" },
            }
          : {
              apiVersion: 1,
              observedAt: 100,
              recipient: { address, state: "eligible" },
            },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await renderPanel();
    await flushPanel();
    await flushPanel(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Top up this wallet")
        ?.click(),
    );
    completed = true;
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["testnet-funding-status"],
      });
    });
    await flushPanel(() =>
      finishPost?.(
        Response.json({
          apiVersion: 1,
          observedAt: 200,
          recipient: { address, state: "pending" },
          request: { id: "grant", state: "pending" },
        }),
      ),
    );
    expect(
      container.querySelector("[data-funding-state='funded']"),
    ).not.toBeNull();
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("does not show the old recipient's late acceptance after a wallet switch", async () => {
    const other = "0x3000000000000000000000000000000000000003" as const;
    testState.protocol = protocol("ready");
    let finishPost: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/challenge"))
        return Response.json({ challenge: { message: "one proof" } });
      if (init?.method === "POST")
        return new Promise<Response>((resolve) => {
          finishPost = resolve;
        });
      return Response.json({
        apiVersion: 1,
        recipient: {
          address: String(url).includes(other) ? other : address,
          state: "eligible",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await renderPanel();
    await flushPanel();
    await flushPanel(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Top up this wallet")
        ?.click(),
    );
    testState.protocol = protocol("ready", other);
    await renderPanel();
    await flushPanel();
    await flushPanel(() =>
      finishPost?.(
        Response.json({
          apiVersion: 1,
          recipient: { address, state: "pending" },
          request: { id: "other-wallet-grant", state: "pending" },
        }),
      ),
    );
    expect(
      container.querySelector("[data-funding-state='eligible']"),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "Your top-up is being processed",
    );
  });

  it("checks status without another proof when the POST transport fails", async () => {
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
    expect(container.textContent).toContain("Checking your top-up");
    expect(container.textContent).toContain("Check again");
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
      "Checking your top-up",
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

  it("explains why a partially funded wallet cannot receive another top-up", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: {
            chainId: 84_532,
            state: "ready",
            targets: {
              ethWei: "10000000000000000",
              wethWei: "100000000000000000",
            },
            cooldownSeconds: 86_400,
            limits: {
              lifetime: {
                ethWei: "20000000000000000",
                wethWei: "200000000000000000",
              },
              dailyBudget: {
                ethWei: "200000000000000000",
                wethWei: "2000000000000000000",
              },
              dailyGrantLimit: 20,
              clientWindowSeconds: 3_600,
              clientWindowLimit: 5,
            },
          },
          recipient: {
            address,
            state: "limit-reached",
            nextEligibleAt: null,
            balances: {
              ethWei: "10277000000000000",
              wethWei: "94020000000000000",
            },
            remaining: {
              ethWei: "0",
              wethWei: "5980000000000000",
            },
          },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    const limitState = container.querySelector(
      "[data-funding-state='lifetime-exhausted']",
    );
    expect(limitState?.textContent).toContain(
      "The next top-up would exceed this wallet’s lifetime grant cap for at least one asset.",
    );
    expect(limitState?.textContent).toContain("Waiting does not reset them.");
    expect(container.textContent).toContain("0.01 ETH");
    expect(container.textContent).toContain("0.1 WETH");
    expect(container.textContent).toContain("0.02 ETH");
    expect(container.textContent).toContain("0.2 WETH");
    expect(container.textContent).toContain(
      "24 hours after a successful top-up",
    );
    expect(container.textContent).toContain("No automatic reset");
  });

  it("distinguishes a global pause from a wallet limit", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "disabled" },
          recipient: { address, state: "unavailable" },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    const paused = container.querySelector("[data-funding-state='disabled']");
    expect(paused?.textContent).toContain(
      "Self-service funding is paused for every wallet.",
    );
    expect(paused?.textContent).toContain(
      "this wallet’s balance and limits did not cause the pause",
    );
    expect(container.textContent).toContain("When service resumes");
  });

  it("shows the reset for a service-wide daily limit", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          apiVersion: 1,
          service: { chainId: 84_532, state: "ready" },
          error: {
            code: "funding-daily-grant-limit",
            windowResetsAt: 1_700_086_400_000,
          },
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    expect(container.textContent).toContain("Faucet daily limit reached");
    expect(container.textContent).toContain("Try again after the daily reset.");
    expect(container.querySelector("time")?.dateTime).toBe(
      "2023-11-15T22:13:20.000Z",
    );
  });

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

    const reads = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(reads);
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
