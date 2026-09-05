import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { createPublicClient, http } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";
import { createConfig } from "wagmi";
import { getConnection } from "wagmi/actions";
import { injected } from "wagmi/connectors/injected";
import { bindReadSignal } from "@orbit/protocol/read-lifetime";

import { deploymentEnvironment } from "@/lib/deployment";
import {
  createWebReadRpcTransport,
  createWebTransactionRpcTransport,
} from "@/lib/web-rpc-policy";

type ProtocolTransport = ReturnType<typeof http>;

const webChainAdapters = {
  development: {
    chain: foundry,
    createFallbackConfig: (transport: ProtocolTransport) =>
      createConfig({
        chains: [foundry],
        connectors: [injected()],
        ssr: true,
        transports: { [foundry.id]: transport },
      }),
  },
  staging: {
    chain: baseSepolia,
    createFallbackConfig: (transport: ProtocolTransport) =>
      createConfig({
        chains: [baseSepolia],
        connectors: [injected()],
        ssr: true,
        transports: { [baseSepolia.id]: transport },
      }),
  },
  production: {
    chain: base,
    createFallbackConfig: (transport: ProtocolTransport) =>
      createConfig({
        chains: [base],
        connectors: [injected()],
        ssr: true,
        transports: { [base.id]: transport },
      }),
  },
} as const;

const webChainAdapter = webChainAdapters[deploymentEnvironment.name];
export const protocolChain = webChainAdapter.chain;

const configuredRpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (deploymentEnvironment.name === "staging"
    ? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL
    : undefined);
const protocolTransactionTransport =
  createWebTransactionRpcTransport(configuredRpcUrl);

// Public protocol reads must remain available before a wallet is connected and
// must not depend on the connector adapter creating a Wagmi public client.
export const createProtocolReadClient = (signal?: AbortSignal) =>
  createPublicClient({
    chain: protocolChain,
    transport: createWebReadRpcTransport(
      configuredRpcUrl,
      signal === undefined ? fetch : bindReadSignal(fetch, signal),
    ),
  });
export const protocolReadClient = createProtocolReadClient();

// Transaction preflight and confirmation intentionally use a separate client:
// after wallet submission, an aggressive UI-read timeout could otherwise make
// an already-mined transaction appear safe to submit again.
export const protocolTransactionClient = createPublicClient({
  chain: protocolChain,
  transport: protocolTransactionTransport,
});

export const reownProjectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();
export const isReownConfigured =
  reownProjectId !== undefined && reownProjectId.length > 0;

export const appKitNetworks: [AppKitNetwork, ...AppKitNetwork[]] = [
  protocolChain,
];

export const wagmiAdapter = reownProjectId
  ? new WagmiAdapter({
      networks: appKitNetworks,
      projectId: reownProjectId,
      ssr: true,
      transports: {
        [protocolChain.id]: protocolTransactionTransport,
      },
    })
  : undefined;

export const wagmiConfig =
  wagmiAdapter?.wagmiConfig ??
  webChainAdapter.createFallbackConfig(protocolTransactionTransport);

export const currentWalletConnection = () => getConnection(wagmiConfig);
