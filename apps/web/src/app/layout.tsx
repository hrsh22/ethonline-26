import type { Metadata } from "next";

import { applicationUrl, deploymentEnvironment } from "@/lib/deployment";
import { identity } from "@/lib/identity";
import { publishedMetadataUrls } from "@/lib/published-metadata";
import { WalletProvider } from "@/providers/wallet-provider";

import { applicationFontVariables } from "./fonts";
import "./globals.css";

const applicationTitle = `${identity.brand} | ${deploymentEnvironment.applicationLabel}`;
const publicAssets = publishedMetadataUrls(applicationUrl);

export const metadata: Metadata = {
  // metadataBase resolves the generated icon and social-card routes to absolute
  // URLs, which every social and wallet consumer requires.
  ...(applicationUrl === undefined
    ? {}
    : { metadataBase: new URL(applicationUrl) }),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: identity.brand,
  },
  description: identity.copy.metadataDescription,
  ...(publicAssets === undefined
    ? {}
    : {
        icons: {
          apple: publicAssets.appleIcon,
          icon: publicAssets.icon,
        },
      }),
  openGraph: {
    description: identity.copy.metadataDescription,
    siteName: identity.brand,
    title: applicationTitle,
    type: "website",
    ...(publicAssets === undefined
      ? {}
      : { images: [publicAssets.openGraphImage] }),
  },
  title: {
    default: applicationTitle,
    template: `%s | ${identity.brand}`,
  },
  twitter: {
    card: "summary_large_image",
    description: identity.copy.metadataDescription,
    title: applicationTitle,
    ...(publicAssets === undefined
      ? {}
      : { images: [publicAssets.twitterImage] }),
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={applicationFontVariables}
      data-scroll-behavior="smooth"
    >
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
