import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { createPublicClient } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";
import { createConfig } from "wagmi";
import { getConnection } from "wagmi/actions";
import { bindReadSignal } from "@orbit/protocol/read-lifetime";

import { deploymentEnvironment } from "@/lib/deployment";
import { webPublicConfiguration } from "@/lib/browser-public-configuration";
import {
  createWebReadRpcTransport,
  createWebTransactionRpcTransport,
} from "@/lib/web-rpc-policy";

const webChains = {
  development: foundry,
  staging: baseSepolia,
  production: base,
} as const;
export const protocolChain = webChains[deploymentEnvironment.name];

const configuredRpcUrl = webPublicConfiguration.rpcUrl;
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

export const privyAppId = webPublicConfiguration.privyAppId;
export const isWalletConfigured = Boolean(privyAppId);

// Privy owns connector discovery and reconnect ordering. The unconfigured
// provider supports public reads, but offers no unusable wallet action.
export const wagmiConfig = (
  isWalletConfigured ? createPrivyConfig : createConfig
)({
  chains: [protocolChain],
  ssr: true,
  transports: {
    [foundry.id]: protocolTransactionTransport,
    [baseSepolia.id]: protocolTransactionTransport,
    [base.id]: protocolTransactionTransport,
  },
});

export const currentWalletConnection = () => getConnection(wagmiConfig);
