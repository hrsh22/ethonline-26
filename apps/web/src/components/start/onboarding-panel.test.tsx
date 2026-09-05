/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ protocol: undefined as unknown }));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => testState.protocol,
}));

vi.mock("@/components/wallet-control", () => ({
  WalletControl: () => <button type="button">Wallet control</button>,
}));

import { OnboardingPanel } from "./onboarding-panel";

const address = "0x2000000000000000000000000000000000000002" as const;

const protocol = (
  accessState:
    "disconnected" | "wrong-network" | "deployment-pending" | "ready",
  progress: "empty" | "pending" | "grounded" | "orbiter" = "empty",
  selectedAddress: Address = address,
  settlementBalanceWei = 0n,
  liquidTokenAmounts: {
    readonly balance: string;
    readonly remaining: string;
  } = { balance: "0.4", remaining: "0.6" },
) => ({
  accessState,
  address: accessState === "disconnected" ? undefined : selectedAddress,
  connected: accessState !== "disconnected",
  refresh: vi.fn().mockResolvedValue(undefined),
  walletRead:
    accessState === "ready"
      ? {
          status: "loaded" as const,
          snapshot: {
            liquidToken: {
              // Base units: the journey view no longer formats these itself.
              rawWei: parseUnits(liquidTokenAmounts.balance, 18),
              wholeUnits: 0,
              nextDiscoveryDraw: {
                thresholdWei: 10n ** 18n,
                remainingWei: parseUnits(liquidTokenAmounts.remaining, 18),
              },
            },
            settlementToken: { rawWei: settlementBalanceWei },
            collectibles: {
              pendingDiscovery: { count: progress === "pending" ? 1 : 0 },
              transient: progress === "grounded" ? [{ identityId: 1493 }] : [],
              permanent: progress === "orbiter" ? [{ identityId: 1493 }] : [],
              permanentHoldingsStatus: "complete" as const,
            },
          },
        }
      : { status: "blocked" as const, accessState },
});

const fundingResponse = (
  state: "eligible" | "already-funded",
  balances?: { readonly ethWei: string; readonly wethWei: string },
) =>
  Response.json({
    apiVersion: 1,
    service: { chainId: 84_532, state: "ready" },
    recipient: {
      address,
      state,
      ...(balances === undefined ? {} : { balances }),
    },
  });

describe("three-phase collector journey", () => {
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
      defaultOptions: { queries: { retry: false } },
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
          <OnboardingPanel />
        </QueryClientProvider>,
      ),
    );
  };

  const flushPanel = async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  it("shows only Fund, Discover, and Launch for a disconnected wallet", async () => {
    testState.protocol = protocol("disconnected");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();

    expect(container.querySelectorAll("li[data-state]")).toHaveLength(3);
    expect(
      [...container.querySelectorAll("li[data-state] h2")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Fund", "Discover", "Launch"]);
    expect(container.textContent).toContain("Connect a wallet to begin");
    expect(container.textContent).toContain("Wallet control");
    expect(container.textContent).not.toContain("$FUEL balance0");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("routes an eligible wallet to Faucet without submitting from Start", async () => {
    testState.protocol = protocol("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fundingResponse("eligible"));
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();
    await flushPanel();

    expect(container.textContent).toContain("$FUEL balance0.4");
    expect(container.textContent).toContain("$FUEL still needed0.6");
    expect(container.querySelector("a[href='/faucet']")?.textContent).toBe(
      "Open Faucet",
    );
    expect(container.textContent).toContain("random");
    expect(container.textContent).toContain("Burns exactly one $FUEL forever");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toContain("/status?recipient=");
  });

  it("routes a funded wallet to Trade to buy the missing FUEL", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(fundingResponse("already-funded")),
    );

    await renderPanel();
    await flushPanel();

    expect(container.querySelector("a[href='/exchange']")?.textContent).toBe(
      "Buy $FUEL on Trade",
    );
    expect(container.querySelector("li[data-state]")?.textContent).toContain(
      "random Discovery",
    );
    expect(container.querySelector("button")?.textContent).not.toBe(
      "Fund test wallet",
    );
  });

  it("routes a partially funded wallet straight to Trade when WETH and gas remain", async () => {
    testState.protocol = protocol(
      "ready",
      "empty",
      address,
      50_000_000_000_000_000n,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        fundingResponse("eligible", {
          ethWei: "5000000000000000",
          wethWei: "50000000000000000",
        }),
      ),
    );

    await renderPanel();
    await flushPanel();

    expect(container.querySelector("a[href='/exchange']")?.textContent).toBe(
      "Buy $FUEL on Trade",
    );
    expect(container.querySelector("a[href='/faucet']")).toBeNull();
  });

  it("collapses Fund and tracks an in-flight random Discovery", async () => {
    testState.protocol = protocol("ready", "pending");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(fundingResponse("eligible")),
    );

    await renderPanel();
    await flushPanel();

    const phases = [...container.querySelectorAll("li[data-state]")];
    expect(phases[0]?.getAttribute("data-state")).toBe("complete");
    expect(phases[1]?.getAttribute("data-state")).toBe("current");
    expect(phases[2]?.getAttribute("data-state")).toBe("waiting");
    expect(container.querySelector("a[href='/fleet']")?.textContent).toBe(
      "Check Discovery in My Collection",
    );
  });

  it("puts the irreversible warning directly before the selected craft action", async () => {
    testState.protocol = protocol("ready", "grounded");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(fundingResponse("eligible")),
    );

    await renderPanel();
    await flushPanel();

    const phases = [...container.querySelectorAll("li[data-state]")];
    expect(phases[0]?.getAttribute("data-state")).toBe("complete");
    expect(phases[1]?.getAttribute("data-state")).toBe("complete");
    expect(phases[2]?.getAttribute("data-state")).toBe("current");
    const launch = phases[2];
    expect(launch?.textContent).toContain("Burns exactly one $FUEL forever");
    expect(
      launch?.querySelector("a[href='/fleet/1493']")?.textContent,
    ).toContain("Review Launch");
  });

  it("shows a concise success state after an Orbiter exists", async () => {
    testState.protocol = protocol("ready", "orbiter");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(fundingResponse("eligible")),
    );

    await renderPanel();
    await flushPanel();

    expect(container.querySelectorAll("li[data-state]")).toHaveLength(0);
    expect(container.textContent).toContain("Orbiter #1493 is permanent");
    expect(container.querySelector("a[href='/fleet/1493']")?.textContent).toBe(
      "Open Orbiter #1493",
    );
    expect(container.textContent).not.toContain("funding cooldown");
  });

  it("does not read funding state on the wrong network", async () => {
    testState.protocol = protocol("wrong-network");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await renderPanel();

    expect(container.textContent).toContain("Switch to Base Sepolia");
    expect(container.textContent).toContain("Wallet control");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("leads with the current step before the full plan", async () => {
    testState.protocol = protocol("disconnected");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());

    await renderPanel();

    // There is one list. The current phase carries the action, so the task
    // leads without a separate block repeating its title, description, and
    // button — which is how this route showed three identical connect buttons.
    const phases = [...container.querySelectorAll("ol > li")];
    expect(phases).toHaveLength(3);
    const withAction = phases.filter(
      (phase) => phase.querySelector("button, a") !== null,
    );
    expect(withAction).toHaveLength(1);
    expect(withAction[0]).toBe(phases[0]);
  });

  it("opens with the live board, then the plan", async () => {
    testState.protocol = protocol("disconnected");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());

    await renderPanel();

    // Data first: the board says where this wallet stands (or why that cannot
    // be read) before the three phases explain what to do about it.
    const plan = container.querySelector("ol");
    const progress = container.querySelector("[data-progress-state]");
    expect(plan).not.toBeNull();
    expect(progress).not.toBeNull();
    expect(progress?.compareDocumentPosition(plan as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("explains blocked progress instead of rendering placeholder glyphs", async () => {
    testState.protocol = protocol("disconnected");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());

    await renderPanel();

    const progress = container.querySelector("[data-progress-state]");
    expect(progress?.getAttribute("data-progress-state")).toBe("unavailable");
    expect(progress?.textContent).toContain("unavailable");
    expect(progress?.textContent).not.toContain("\u2014");
    expect(progress?.querySelector("dd")).toBeNull();
  });

  it("announces a wallet read in flight once, without placeholder values", async () => {
    testState.protocol = {
      ...(protocol("ready") as Record<string, unknown>),
      walletRead: { status: "loading" as const },
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());

    await renderPanel();

    // The audited panel rendered three skeleton bars *and* the explanation at
    // the same time, so a pending read showed both. The condition is stated
    // once, and no value slot is rendered at all.
    const progress = container.querySelector("[data-progress-state]");
    expect(progress?.getAttribute("data-progress-state")).toBe("loading");
    expect(progress?.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(progress?.querySelector("dd")).toBeNull();
    expect(progress?.textContent).not.toContain("\u2014");
  });

  it("shows live values once the wallet read succeeds", async () => {
    testState.protocol = protocol("ready");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(fundingResponse("already-funded")),
    );

    await renderPanel();
    await flushPanel();

    const progress = container.querySelector("[data-progress-state]");
    expect(progress?.getAttribute("data-progress-state")).toBe("ready");
    expect(progress?.textContent).toContain("0.4000");
  });

  it("compacts long token values without hiding their exact amount", async () => {
    const balance = "0.724218211757156969";
    const remaining = "0.275781788242843031";
    testState.protocol = protocol("ready", "empty", address, 0n, {
      balance,
      remaining,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(fundingResponse("already-funded")),
    );

    await renderPanel();
    await flushPanel();

    // Rounded to significant digits, with the exact expansion carried on the
    // element. The old formatter truncated at six fraction digits behind an
    // approximation sign, which turned 1.234e-7 into "≈0.000000".
    const values = [
      ...container.querySelectorAll("[data-progress-state] dd span[title]"),
    ];
    expect(values[0]?.textContent).toBe("0.72422");
    expect(values[0]?.getAttribute("title")).toBe(balance);
    expect(values[1]?.textContent).toBe("0.27578");
    expect(values[1]?.getAttribute("title")).toBe(remaining);
  });
});
