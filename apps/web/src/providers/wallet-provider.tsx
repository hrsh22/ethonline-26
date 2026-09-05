"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { applicationUrl } from "@/lib/deployment";
import { identity } from "@/lib/identity";
import { createWebQueryClient } from "@/lib/query-client";
import { publishedMetadataUrls } from "@/lib/published-metadata";
import { AdminSessionLifecycle } from "@/components/admin/admin-session-lifecycle";
import {
  appKitNetworks,
  isReownConfigured,
  protocolChain,
  reownProjectId,
  wagmiAdapter,
  wagmiConfig,
} from "@/lib/wagmi";
import { ProtocolClientProvider } from "@/providers/protocol-client-provider";
import { WalletRestorationBoundary } from "@/providers/wallet-restoration";

/**
 * Absolute URLs for the generated app icons. Relative paths are dropped
 * rather than sent, because a wallet cannot resolve them.
 */
const walletApplicationIcons = (): string[] => {
  const publicAssets = publishedMetadataUrls(applicationUrl);
  return publicAssets === undefined
    ? []
    : [publicAssets.icon, publicAssets.appleIcon];
};

/* createAppKit registers the wallet modal singleton as a side effect; the
 * returned instance is not needed once the theme is pinned to light. */
(() => {
  if (!(isReownConfigured && reownProjectId && wagmiAdapter)) return;
  type AppKitAdapter = NonNullable<
    Parameters<typeof createAppKit>[0]["adapters"]
  >[number];

  createAppKit({
    // Reown 1.8.23 leaves the inherited namespace optional on WagmiAdapter,
    // while createAppKit's public ChainAdapter type marks it as required.
    adapters: [wagmiAdapter as AppKitAdapter],
    allWallets: "SHOW",
    // Keep the familiar browser-wallet path first. WalletConnect remains
    // available for mobile and the full directory stays behind "All wallets".
    featuredWalletIds: [
      "c57ca95e09a9d53d97618988a70b7f7aeb64a77500d26cb7297fb82960a8a3e6",
    ],
    defaultNetwork: protocolChain,
    enableBaseAccount: false,
    enableCoinbase: false,
    enableNetworkSwitch: false,
    features: {
      analytics: false,
      email: false,
      emailShowWallets: false,
      history: false,
      onramp: false,
      socials: false,
      swaps: false,
    },
    metadata: {
      name: identity.brand,
      description: identity.copy.metadataDescription,
      // The wallet modal and any connected-dApp listing need absolute icon
      // URLs. An empty list left the application unbranded in the wallet.
      icons: walletApplicationIcons(),
      url: applicationUrl ?? "http://localhost:3000",
    },
    networks: appKitNetworks,
    projectId: reownProjectId,
    // The collector ships a single dark theme, so the wallet modal is pinned
    // to dark rather than following the OS preference. The accent and radius
    // mirror the Graphite tokens; Reown cannot read custom properties, so
    // these literals are asserted against foundations.css by its theme test.
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#ff6a1f",
      "--w3m-color-mix": "#0e0f12",
      "--w3m-color-mix-strength": 30,
      "--w3m-border-radius-master": "1px",
      "--w3m-font-family": "var(--font-jetbrains), monospace",
    },
  });
})();

export function WalletProvider({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(createWebQueryClient);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletRestorationBoundary>
          <AdminSessionLifecycle />
          <ProtocolClientProvider>{children}</ProtocolClientProvider>
        </WalletRestorationBoundary>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
