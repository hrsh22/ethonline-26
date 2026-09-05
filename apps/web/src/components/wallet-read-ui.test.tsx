/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  protocol: undefined as unknown,
  refreshWallet: vi.fn(),
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => testState.protocol,
}));

import { AccessNotice } from "./access-notice";
import { FleetPanel } from "./fleet/fleet-panel";

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

    expect(container.textContent).toContain(
      "Wallet holdings could not be loaded",
    );
    expect(container.textContent).not.toContain(
      "No ORBIT 4444 Collectibles are held by this wallet yet.",
    );
    expect(container.textContent).toContain("Collection read failed");
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
      "Permanent holdings are not available yet",
    );
    expect(
      container.querySelector("[role='status'][data-state='partial']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Collection is incomplete");
    expect(
      container.querySelectorAll("[role='status'][data-state='partial']"),
    ).toHaveLength(1);
  });

  it.each([
    ["loading", "loading", "Loading connected collection"],
    ["blocked", "blocked", "Connect a wallet"],
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

  it("shows what the Fleet contains before asking for a wallet", async () => {
    testState.protocol = {
      ...failedProtocol(),
      accessState: "disconnected",
      connected: false,
      walletRead: { status: "blocked", accessState: "disconnected" },
    };

    await act(async () => root.render(<FleetPanel />));

    expect(container.textContent).toContain("4,444");
    expect(container.textContent).toContain("Grounded Craft");
    expect(container.textContent).toContain("Orbiter");
    expect(container.querySelectorAll("[data-public-fleet-mark]")).toHaveLength(
      3,
    );
    expect(
      container.querySelector('[aria-label="Collection summary"]'),
    ).toBeNull();
  });

  it("offers an explicit retry after a failed wallet read", async () => {
    await act(async () => root.render(<AccessNotice />));

    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry wallet read",
    );
    expect(
      container.querySelector("[role='alert'][data-state='error']"),
    ).not.toBeNull();
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(testState.refreshWallet).toHaveBeenCalledOnce();
  });
});
