import type { Page } from "playwright";

/**
 * Deterministic fixtures. The application otherwise reads live Base Sepolia
 * state, which cannot produce a repeatable loading, empty, partial, stale, or
 * failure state in a browser run.
 */
export type WalletFixture =
  "disconnected" | "connecting" | "wrong-network" | "ordinary";

export type DataFixture =
  /** No interception. Reserved for a run against a real worker. */
  | "live"
  /**
   * The default for route coverage: the public API answers deterministically
   * so route results do not depend on a running funding or history worker.
   */
  | "stubbed"
  | "loading"
  | "empty"
  | "failed"
  | "stale"
  | "funded"
  | "cooldown"
  | "budget-disabled";

const PROTOCOL_CHAIN_ID = 84_532;
const ORDINARY_WALLET = "0x2000000000000000000000000000000000000002";

/**
 * Installs an EIP-1193 provider before any application script runs. Reown
 * discovers injected providers, so this exercises the real wallet code paths
 * without a browser extension or a live signer.
 */
export const installWalletFixture = async (
  page: Page,
  fixture: WalletFixture,
): Promise<void> => {
  await page.addInitScript(
    ({ chainId, wallet, mode }) => {
      if (mode === "disconnected") return;
      const accounts = mode === "connecting" ? [] : [wallet];
      const activeChainId = mode === "wrong-network" ? "0x1" : chainId;
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      const provider = {
        isMetaMask: true,
        request: async ({ method }: { readonly method: string }) => {
          if (mode === "connecting" && method === "eth_requestAccounts") {
            // A connection that never resolves models the connecting state.
            return new Promise(() => undefined);
          }
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return accounts;
          }
          if (method === "eth_chainId") return activeChainId;
          if (method === "net_version") return String(Number(activeChainId));
          if (method === "personal_sign") return `0x${"ab".repeat(65)}`;
          if (method === "wallet_switchEthereumChain") return null;
          return null;
        },
        on: (event: string, handler: (value: unknown) => void) => {
          const existing = listeners.get(event) ?? new Set();
          existing.add(handler);
          listeners.set(event, existing);
        },
        removeListener: (event: string, handler: (value: unknown) => void) => {
          listeners.get(event)?.delete(handler);
        },
      };
      Object.defineProperty(window, "ethereum", {
        configurable: true,
        value: provider,
      });
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              icon: "data:image/svg+xml;base64,",
              name: "Browser Matrix Wallet",
              rdns: "test.orbit.matrix",
              uuid: "00000000-0000-4000-8000-000000000000",
            },
            provider,
          },
        }),
      );
    },
    {
      chainId: `0x${PROTOCOL_CHAIN_ID.toString(16)}`,
      mode: fixture,
      wallet: ORDINARY_WALLET,
    },
  );
};

const fundingStatus = (fixture: DataFixture) => {
  if (fixture === "funded") {
    return {
      apiVersion: 1,
      recipient: {
        address: ORDINARY_WALLET,
        balances: {
          ethWei: "10000000000000000",
          wethWei: "100000000000000000",
        },
        remaining: { ethWei: "0", wethWei: "0" },
        state: "already-funded",
      },
      service: { chainId: PROTOCOL_CHAIN_ID, state: "ready" },
    };
  }
  if (fixture === "cooldown") {
    return {
      apiVersion: 1,
      error: {
        code: "funding-rate-limited",
        message: "This wallet is still in its testnet funding cooldown",
      },
    };
  }
  if (fixture === "budget-disabled") {
    return {
      apiVersion: 1,
      error: {
        code: "funding-daily-budget",
        message: "The service-wide daily testnet funding budget is exhausted",
      },
    };
  }
  if (fixture === "empty") {
    return {
      apiVersion: 1,
      recipient: { address: ORDINARY_WALLET, state: "unavailable" },
      service: { chainId: PROTOCOL_CHAIN_ID, state: "inventory-empty" },
    };
  }
  return {
    apiVersion: 1,
    recipient: { address: ORDINARY_WALLET, state: "eligible" },
    service: { chainId: PROTOCOL_CHAIN_ID, state: "ready" },
  };
};

const HISTORY_EMPTY = { apiVersion: 1, page: { items: [], nextCursor: null } };

/**
 * Intercepts the public API and the JSON-RPC transport. `live` leaves both
 * alone; every other fixture pins a repeatable state.
 */
export const installDataFixture = async (
  page: Page,
  fixture: DataFixture,
): Promise<void> => {
  if (fixture === "live") return;

  await page.route("**/v1/funding/**", async (route) => {
    if (fixture === "loading") {
      // A request that never settles models the loading state.
      return;
    }
    if (fixture === "failed") {
      await route.fulfill({
        status: 503,
        json: { apiVersion: 1, error: { code: "funding-unavailable" } },
      });
      return;
    }
    await route.fulfill({ status: 200, json: fundingStatus(fixture) });
  });

  await page.route("**/v1/history/**", async (route) => {
    if (fixture === "loading") return;
    if (fixture === "failed") {
      await route.fulfill({
        status: 503,
        json: { apiVersion: 1, error: { code: "history-unavailable" } },
      });
      return;
    }
    await route.fulfill({ status: 200, json: HISTORY_EMPTY });
  });

  // The RPC transport is how every onchain read reaches the page.
  await page.route(
    (url) =>
      url.protocol.startsWith("http") &&
      /rpc|infura|alchemy|base/iu.test(url.host),
    async (route) => {
      if (fixture === "loading") return;
      if (fixture === "failed" || fixture === "stale") {
        await route.fulfill({
          status: 200,
          json: {
            error: { code: -32_000, message: "rpc unavailable" },
            id: 1,
            jsonrpc: "2.0",
          },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        json: { id: 1, jsonrpc: "2.0", result: "0x" },
      });
    },
  );
};

export const walletFixtureLabels: Readonly<Record<WalletFixture, string>> = {
  disconnected: "disconnected wallet",
  connecting: "connecting wallet",
  "wrong-network": "wallet on another chain",
  ordinary: "ordinary connected wallet",
};

export const dataFixtureLabels: Readonly<Record<DataFixture, string>> = {
  live: "live reads",
  stubbed: "stubbed public API",
  loading: "reads in flight",
  empty: "empty inventory",
  failed: "failed reads",
  stale: "stale evidence",
  funded: "already funded",
  cooldown: "recipient cooldown",
  "budget-disabled": "service budget exhausted",
};
