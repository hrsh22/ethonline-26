import type { Page } from "playwright";

import { deploymentManifestFingerprint } from "@orbit/config/deployment-manifest";
import { decodeTestnetFundingResponse } from "@orbit/config/testnet-funding";
import type { PublicStatusModel } from "@orbit/protocol/public-status-codec";

import { protocolDeploymentManifests } from "../src/generated/deployment-manifests.ts";
import { writePublicEvidenceCache } from "../src/lib/public-evidence-cache.ts";
import { adminRpcResponse } from "./admin-fixture.ts";

/**
 * Deterministic fixtures. The application otherwise reads live Base Sepolia
 * state, which cannot produce a repeatable loading, empty, partial, stale, or
 * failure state in a browser run.
 */
export type WalletFixture =
  "disconnected" | "connecting" | "wrong-network" | "ordinary" | "transacting";

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
  | "market"
  | "failed"
  | "cached-stale"
  | "admin-inputs"
  | "funded"
  | "cooldown";

const manifest = protocolDeploymentManifests.staging;
const PROTOCOL_CHAIN_ID = manifest.chainId;
const ORDINARY_WALLET = "0x2000000000000000000000000000000000000002";

export const cachedPublicSnapshot = {
  health: "healthy",
  freshness: "fresh",
  network: "base-sepolia",
  observedAt: 1_700_000_000,
  observedBlock: 123_456n,
  collection: { permanent: 4, transient: 8, pending: 32, available: 4_400 },
  funds: {
    creatorWeth: 3n * 10n ** 18n,
    liquidityLockedWeth: 6n * 10n ** 18n,
    liquidityWaitingWeth: 5n * 10n ** 18n,
    rewardWethWaiting: 2n * 10n ** 18n,
  },
  rewardActivity: {
    epochCount: 0n,
    historyStatus: "complete",
    history: [],
    latestOpening: undefined,
    recentConversions: [],
    collectorLiability: [],
  },
} satisfies PublicStatusModel;

/**
 * Installs an EIP-1193 provider before any application script runs. Privy
 * discovers injected providers, so this exercises the real wallet code paths
 * without a browser extension or a live signer.
 */
export const installWalletFixture = async (
  page: Page,
  fixture: WalletFixture,
): Promise<void> => {
  await page.addInitScript(
    ({ chainId, wallet, mode }) => {
      if (window !== window.top || mode === "disconnected") return;
      // The fixture wallet, like an extension, retains its granted account
      // across document navigation. This is not application wallet state.
      let accounts: string[] =
        sessionStorage.getItem("matrix-wallet-connected") === "yes"
          ? [wallet]
          : [];
      let activeChainId = chainId;
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      const emit = (event: string, value: unknown) =>
        listeners.get(event)?.forEach((handler) => handler(value));
      const provider = {
        isMetaMask: true,
        // Keep the isolated EIP-1193 method allowlist auditable in one place.
        // eslint-disable-next-line complexity
        request: async ({
          method,
          params,
        }: {
          readonly method: string;
          readonly params?: readonly { readonly chainId: string }[];
        }) => {
          if (mode === "connecting" && method === "eth_requestAccounts") {
            // A connection that never resolves models the connecting state.
            return new Promise(() => undefined);
          }
          if (method === "eth_requestAccounts") {
            accounts = [wallet];
            sessionStorage.setItem("matrix-wallet-connected", "yes");
            emit("accountsChanged", accounts);
          }
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return accounts;
          if (method === "eth_chainId") return activeChainId;
          if (method === "net_version") return String(Number(activeChainId));
          if (method === "wallet_switchEthereumChain") {
            activeChainId = params![0]!.chainId;
            emit("chainChanged", activeChainId);
            return null;
          }
          if (method === "wallet_getCapabilities") return {};
          if (mode === "transacting" && method === "personal_sign")
            return `0x${"1".repeat(130)}`;
          if (mode === "transacting" && method === "eth_sendTransaction") {
            const response = await fetch(
              "https://browser-matrix.invalid/transaction",
              { method: "POST", body: JSON.stringify(params?.[0]) },
            );
            if (!response.ok)
              throw new Error("Test transaction handler unavailable");
            const result = await response.json();
            if (result.error)
              throw Object.assign(new Error(result.error.message), {
                code: result.error.code,
              });
            return result.hash;
          }
          // Only the isolated controller above accepts transactions. No real broadcast.
          throw Object.assign(
            new Error(`Unsupported wallet method: ${method}`),
            { code: 4200 },
          );
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
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
                name: "Browser Matrix Wallet",
                rdns: "test.orbit.matrix",
                uuid: "00000000-0000-4000-8000-000000000000",
              },
              provider,
            },
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
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

const checkpoint = String(Number(manifest.launch.blockNumber) + 100);
const historyManifest = {
  chainId: manifest.chainId,
  network: manifest.network,
  fingerprint: deploymentManifestFingerprint(manifest),
  commitment: manifest.identity.manifestHash,
  launchBlock: String(manifest.launch.blockNumber),
  canonicalPool: manifest.canonicalPool,
  sources: {
    poolManager: manifest.contracts.uniswapV4PoolManager,
    canonicalFeeHook: manifest.contracts.canonicalFeeHook,
    protocolLiquidityVault: manifest.contracts.protocolLiquidityVault,
    epochConverter: manifest.contracts.epochConverter,
    fuelCore: manifest.contracts.fuelCore,
    rewardLedger: manifest.contracts.rewardLedger,
  },
};

/** Wire-format responses are consumed by the app's actual indexed-history reader. */
export const historyFixtureResponse = (
  url: URL,
  populated = false,
): Response => {
  const envelope = {
    manifest: historyManifest,
    snapshot: {
      generation: "browser-matrix",
      canonicalRevision: 0,
      blockNumber: checkpoint,
      blockHash: `0x${"1".repeat(64)}`,
    },
    status: {
      state: "complete",
      coverage: {
        fromBlock: String(manifest.launch.blockNumber),
        indexedThroughBlock: checkpoint,
        indexedThroughTime: "1788600000",
      },
      head: { observedBlock: checkpoint, lagBlocks: "0" },
    },
  };
  if (url.pathname === "/v1/history/status") return Response.json(envelope);
  if (url.pathname === "/v1/history/market/candles") {
    return Response.json({
      manifest: historyManifest,
      feed: { source: "uniswap-v4-subgraph", state: "unconfigured" },
    });
  }
  if (
    ![
      "/v1/history/market/swaps",
      "/v1/history/market/fees",
      "/v1/history/protocol/liquidity-cycles",
      "/v1/history/protocol/permanent-commitments",
      "/v1/history/protocol/discoveries",
      "/v1/history/protocol/rewards",
    ].includes(url.pathname)
  )
    return Response.json(
      { error: { code: "history-route-not-found" } },
      { status: 404 },
    );
  return Response.json({
    ...envelope,
    items:
      !populated ||
      !["/v1/history/market/swaps", "/v1/history/market/fees"].includes(
        url.pathname,
      )
        ? []
        : [0, 1].map((index) => ({
            blockNumber: String(Number(checkpoint) - 2 + index),
            blockHash: `0x${String(index + 2).repeat(64)}`,
            parentHash: `0x${String(index + 1).repeat(64)}`,
            blockTimestamp: String(1788599880 + index * 60),
            transactionHash: `0x${String(index + 4).repeat(64)}`,
            transactionIndex: 0,
            logIndex: 0,
            sourceAddress: url.pathname.endsWith("swaps")
              ? manifest.contracts.uniswapV4PoolManager
              : manifest.contracts.canonicalFeeHook,
            eventName: url.pathname.endsWith("swaps") ? "swap" : "fee-accrued",
            removed: false,
            payload: url.pathname.endsWith("swaps")
              ? {
                  amount0: "-1000000000000000000",
                  amount1: "1000000000000000000",
                  sqrtPriceX96: "79228162514264337593543950336",
                  liquidity: "1000000000000000000",
                  tick: 0,
                  fee: 0,
                }
              : {
                  wethVolume: "1000000000000000000",
                  totalFee: "30000000000000000",
                  rewardAmount: "20000000000000000",
                  liquidityAmount: "8500000000000000",
                  creatorAmount: "1500000000000000",
                },
          })),
    page: { hasMore: false },
    status: {
      ...envelope.status,
      requested: {
        fromBlock:
          url.searchParams.get("fromBlock") ??
          String(manifest.launch.blockNumber),
        toBlock: url.searchParams.get("toBlock") ?? checkpoint,
      },
    },
  });
};

/**
 * Intercepts the public API and the JSON-RPC transport. `live` leaves both
 * alone; every other fixture pins a repeatable state.
 */
export const installDataFixture = async (
  page: Page,
  fixture: DataFixture,
): Promise<void> => {
  if (fixture === "live") return;

  if (fixture === "cached-stale") {
    const entries = new Map<string, string>();
    writePublicEvidenceCache(
      {
        getItem: () => null,
        setItem: (key, value) => {
          entries.set(key, value);
        },
      },
      deploymentManifestFingerprint(manifest),
      cachedPublicSnapshot,
      1_700_000_005_000,
    );
    await page.addInitScript(
      (saved) => {
        for (const [key, value] of saved) localStorage.setItem(key, value);
      },
      [...entries],
    );
  }

  await page.route("**/v1/delivery/status", async (route) => {
    const now = Date.now();
    await route.fulfill({
      status: 200,
      json: {
        apiVersion: 1,
        chainId: manifest.chainId,
        deploymentFingerprint: deploymentManifestFingerprint(manifest),
        observedAt: now,
        expiresAt: now + 30_000,
        policy: { mode: "live", oneShot: "none" },
        liveness: {
          state: "online",
          heartbeatAt: now,
          expiresAt: now + 30_000,
        },
        dependencyReadiness: "unknown",
        workEligibility: "unknown",
      },
    });
  });

  // Public SDK bootstrap only. Wallet discovery and connection still go through
  // Privy's real EIP-6963 connector; no user, OTP, token, or session is fabricated.
  await page.route("https://auth.privy.io/api/v1/apps/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const appId = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      status: 200,
      json: {
        id: appId,
        name: "Browser Matrix",
        wallet_auth: true,
        email_auth: true,
        external_wallets_for_signup_enabled: true,
        show_wallet_login_first: true,
        allowed_domains: ["http://127.0.0.1:3108", "http://localhost:3000"],
        allowlist_config: {
          error_title: null,
          error_detail: null,
          cta_text: null,
          cta_link: null,
        },
        embedded_wallet_config: {
          ethereum: { create_on_login: "users-without-wallets" },
          solana: { create_on_login: "off" },
          user_owned_recovery_options: ["user-passcode"],
          require_user_owned_recovery_on_create: false,
          mode: "user-controlled-server-wallets-only",
        },
        enforce_wallet_uis: true,
        legacy_wallet_ui_config: false,
        enabled_captcha_provider: null,
        mfa_methods: [],
        custom_oauth_providers: [],
        smart_wallet_config: { enabled: false },
      },
    });
  });
  // External-wallet cases never use the remote embedded-wallet execution frame.
  // Acknowledge only transport readiness; reject all embedded-wallet operations.
  // Email creation and the real remote frame are validated live separately.
  await page.route("https://auth.privy.io/apps/*/embedded-wallets?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Embedded wallet boundary</title>
        <script>
          addEventListener("message", (message) => {
            if (message.source !== parent || !message.data?.event?.startsWith("privy:")) return;
            const { id, event } = message.data;
            parent.postMessage(event === "privy:iframe:ready"
              ? { id, event, data: {} }
              : { id, event, error: { type: "unsupported", message: "Embedded wallet operations are outside the external-wallet fixture" } }, message.origin);
          });
        </script>`,
    }),
  );
  // The production test origin is metadata, not a public DNS deployment.
  // Serve its actual icon through the running application without changing the asset.
  await page.route("https://orbit.test/icon.svg", async (route) => {
    const response = await page.request.get(
      new URL("/icon.svg", page.url()).href,
    );
    await route.fulfill({ response });
  });
  // Logout acknowledges teardown only; it does not create or authenticate a session.
  await page.route("https://auth.privy.io/api/v1/sessions/logout", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, json: {} })
      : route.continue(),
  );
  await page.route("https://auth.privy.io/api/v1/analytics_events", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, json: {} })
      : route.continue(),
  );

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
    if (new URL(route.request().url()).pathname !== "/v1/funding/status") {
      await route.fulfill({
        status: 405,
        json: { apiVersion: 1, error: { code: "funding-method-not-allowed" } },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: decodeTestnetFundingResponse(fundingStatus(fixture)),
    });
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
    const response = historyFixtureResponse(
      new URL(route.request().url()),
      fixture === "market",
    );
    await route.fulfill({
      status: response.status,
      json: await response.json(),
    });
  });

  // The RPC transport is how every onchain read reaches the page.
  await page.route(
    (url) =>
      url.protocol.startsWith("http") &&
      /rpc|infura|alchemy|base/iu.test(url.host),
    async (route) => {
      if (fixture === "loading") return;
      const request = route.request();
      if (request.method() !== "POST") return route.continue();
      const calls = request.postDataJSON() as
        { id: number; method: string } | { id: number; method: string }[];
      if (fixture === "admin-inputs") {
        await route.fulfill({
          status: 200,
          json: Array.isArray(calls)
            ? calls.map(adminRpcResponse)
            : adminRpcResponse(calls),
        });
        return;
      }
      const reply = ({ id, method }: { id: number; method: string }) => ({
        id,
        jsonrpc: "2.0",
        ...(method === "eth_chainId"
          ? { result: `0x${PROTOCOL_CHAIN_ID.toString(16)}` }
          : {
              error: {
                code: -32_000,
                message: "Onchain reads are unavailable in the HTTP fixture",
              },
            }),
      });
      await route.fulfill({
        status: 200,
        json: Array.isArray(calls) ? calls.map(reply) : reply(calls),
      });
    },
  );
};

export const walletFixtureLabels: Readonly<Record<WalletFixture, string>> = {
  disconnected: "disconnected wallet",
  connecting: "connecting wallet",
  "wrong-network": "wallet on another chain",
  transacting: "isolated transaction wallet",
  ordinary: "ordinary connected wallet",
};

export const dataFixtureLabels: Readonly<Record<DataFixture, string>> = {
  live: "live reads",
  stubbed: "stubbed public API",
  loading: "reads in flight",
  empty: "empty inventory",
  market: "canonical swaps with matched fees",
  failed: "failed reads",
  "cached-stale": "persisted snapshot with failed live refresh",
  "admin-inputs": "authenticated keeper/creator with a partial health snapshot",
  funded: "already funded",
  cooldown: "recipient cooldown",
};
