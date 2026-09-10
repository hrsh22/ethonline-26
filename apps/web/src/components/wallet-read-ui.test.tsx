/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  protocol: undefined as unknown,
  refreshWallet: vi.fn(),
}));

vi.mock("@/hooks/use-discovery-history", () => ({
  useDiscoveryHistory: () => ({ data: undefined, isError: false }),
}));
vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "unknown" }),
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => testState.protocol,
}));

import { AccessNotice } from "./access-notice";
import { FleetPanel } from "./fleet/fleet-panel";
import { WalletSessionContext } from "@/providers/wallet-session";

const failedProtocol = () => ({
  accessState: "ready" as const,
  connected: true,
  refreshWallet: testState.refreshWallet,
  walletRead: { status: "failed" as const, error: new Error("rpc") },
});

const partialProtocol = () => ({
  accessState: "ready" as const,
  connected: true,
  refreshWallet: testState.refreshWallet,
  walletRead: {
    status: "loaded" as const,
    snapshot: {
      liquidToken: {
        /* The summary typesets from base units now, so a fixture that carries
         * only the pre-formatted string would render a known balance as
         * unreadable. */
        rawWei: 2n * 10n ** 18n,
        formatted: "2",
        nextDiscoveryDraw: {
          thresholdWei: 3n * 10n ** 18n,
          thresholdFormatted: "3",
          remainingWei: 1n * 10n ** 18n,
          remainingFormatted: "1",
        },
      },
      settlementToken: { rawWei: 0n },
      collectibles: {
        transient: [],
        permanent: [],
        permanentHoldingsStatus: "unavailable" as const,
        pendingDiscovery: { count: 0 },
      },
      partialFailures: ["ownership history unavailable"],
    },
  },
});

describe("wallet read states", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    testState.refreshWallet.mockReset();
    testState.refreshWallet.mockResolvedValue(undefined);
    testState.protocol = failedProtocol();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not turn a failed holdings read into zero balances or an empty wallet", async () => {
    await act(async () => root.render(<FleetPanel />));

    expect(container.textContent).toContain("We couldn't load your collection");
    expect(container.textContent).not.toContain(
      "No ORBIT 4444 Collectibles are held by this wallet yet.",
    );
    expect(container.textContent).toContain(
      "Your collection is temporarily unavailable",
    );
    expect(
      container.querySelectorAll("[role='alert'][data-state='error']"),
    ).toHaveLength(1);
  });

  it("keeps loaded balances visible while marking permanent holdings incomplete", async () => {
    testState.protocol = partialProtocol();

    await act(async () => root.render(<FleetPanel />));

    // A known balance stays readable even though the permanent side did not
    // resolve; only the unresolved slot reads as unavailable.
    expect(container.textContent).toContain("$FUEL balance2.0000");
    expect(container.textContent).toContain("Orbiter—");
    expect(container.textContent).toContain(
      "Your Orbiters haven't finished loading",
    );
    expect(
      container.querySelector("[role='status'][data-state='partial']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Updating your collection");
    expect(
      container.querySelectorAll("[role='status'][data-state='partial']"),
    ).toHaveLength(1);
  });

  it.each([
    ["loading", "loading", "Loading connected collection"],
    ["blocked", "notice", "Connect a wallet"],
  ] as const)(
    "announces the %s collection state through shared feedback",
    async (status, tone, title) => {
      testState.protocol = {
        ...failedProtocol(),
        accessState: status === "blocked" ? "disconnected" : "ready",
        connected: status !== "blocked",
        walletRead:
          status === "blocked"
            ? { status, accessState: "disconnected" }
            : { status },
      };

      await act(async () => root.render(<FleetPanel />));

      expect(
        [...container.querySelectorAll(`[data-state='${tone}']`)].some((node) =>
          node.textContent?.includes(title),
        ),
      ).toBe(true);
    },
  );

  it("opens directly on wallet access without a global collection tutorial", async () => {
    testState.protocol = {
      ...failedProtocol(),
      accessState: "disconnected",
      connected: false,
      walletRead: { status: "blocked", accessState: "disconnected" },
    };

    await act(async () => root.render(<FleetPanel />));

    expect(container.textContent).toContain("Connect a wallet");
    expect(container.textContent).not.toContain("4,444");
    expect(container.querySelectorAll("[data-public-fleet-mark]")).toHaveLength(
      0,
    );
    expect(
      container.querySelector('[aria-label="Collection summary"]'),
    ).toBeNull();
  });

  it("offers an explicit retry after a failed wallet read", async () => {
    testState.protocol = { ...failedProtocol(), walletSynchronizing: true };
    await act(async () => root.render(<AccessNotice />));

    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Refresh wallet",
    );
    expect(
      container.querySelector("[role='alert'][data-state='error']"),
    ).not.toBeNull();
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(testState.refreshWallet).toHaveBeenCalledOnce();
  });

  it.each([FleetPanel, AccessNotice])(
    "does not contradict a pending wallet connection",
    async (Content) => {
      testState.protocol = {
        ...failedProtocol(),
        accessState: "disconnected",
        connected: false,
        walletRead: { status: "blocked", accessState: "disconnected" },
      };
      await act(async () =>
        root.render(
          <WalletSessionContext.Provider
            value={{
              ready: false,
              connecting: true,
              rejected: false,
              modalOpen: false,
              disconnectStatus: "idle",
              connect: vi.fn(),
              disconnect: vi.fn(),
            }}
          >
            <Content />
          </WalletSessionContext.Provider>,
        ),
      );
      expect(container.textContent).toContain("Connecting wallet");
      expect(container.textContent).not.toContain("Wallet not connected");
      expect(container.querySelectorAll('[data-state="loading"]')).toHaveLength(
        1,
      );
    },
  );
});
