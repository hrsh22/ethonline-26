"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { AdminSessionLifecycle } from "@/components/admin/admin-session-lifecycle";
import { applicationUrl } from "@/lib/deployment";
import { identity } from "@/lib/identity";
import { publishedMetadataUrls } from "@/lib/published-metadata";
import { createWebQueryClient } from "@/lib/query-client";
import { privyAppId, protocolChain, wagmiConfig } from "@/lib/wagmi";
import { PrivyWalletSession } from "@/providers/privy-wallet-session";
import { ProtocolClientProvider } from "@/providers/protocol-client-provider";
import { WalletRestorationBoundary } from "@/providers/wallet-restoration";
import { useWalletSession } from "@/providers/wallet-session";

const metadata = publishedMetadataUrls(applicationUrl);
const privyChain = {
  id: protocolChain.id,
  name: protocolChain.name,
  nativeCurrency: protocolChain.nativeCurrency,
  rpcUrls: protocolChain.rpcUrls,
  ...(protocolChain.blockExplorers === undefined
    ? {}
    : {
        blockExplorers: {
          default: {
            name: protocolChain.blockExplorers.default.name,
            url: protocolChain.blockExplorers.default.url,
          },
        },
      }),
};
const privyConfig: PrivyClientConfig = {
  appearance: {
    theme: "#0b111b",
    accentColor: "#ff7a30",
    landingHeader: `Connect to ${identity.brand}`,
    loginMessage:
      "Use your wallet or create one with email. Base Sepolia test assets only.",
    ...(metadata === undefined ? {} : { logo: metadata.icon }),
    showWalletLoginFirst: true,
    walletChainType: "ethereum-only",
    walletList: [
      "detected_ethereum_wallets",
      "metamask",
      "coinbase_wallet",
      "wallet_connect",
    ],
  },
  loginMethods: ["wallet", "email"],
  defaultChain: privyChain,
  supportedChains: [privyChain],
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" },
    showWalletUIs: true,
    priceDisplay: { primary: "native-token", secondary: null },
  },
};

function CollectorProviders({ children }: { readonly children: ReactNode }) {
  const session = useWalletSession();
  return (
    <WalletRestorationBoundary sdkReady={session.ready}>
      <AdminSessionLifecycle />
      <ProtocolClientProvider>{children}</ProtocolClientProvider>
    </WalletRestorationBoundary>
  );
}

export function WalletProvider({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(createWebQueryClient);
  if (!privyAppId) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <CollectorProviders>{children}</CollectorProviders>
        </WagmiProvider>
      </QueryClientProvider>
    );
  }
  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>
          <PrivyWalletSession>
            <CollectorProviders>{children}</CollectorProviders>
          </PrivyWalletSession>
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
