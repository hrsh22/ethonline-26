import type { Metadata } from "next";

import { applicationUrl } from "@/lib/deployment";
import { publishedMetadataUrls } from "@/lib/published-metadata";
import {
  publicApplicationDescription,
  publicApplicationTitle,
  publicBrand,
} from "@/lib/public-brand";
import { WalletProvider } from "@/providers/wallet-provider";

import { applicationFontVariables } from "./fonts";
import "./globals.css";

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
    title: publicBrand,
  },
  description: publicApplicationDescription,
  ...(publicAssets === undefined
    ? {}
    : {
        icons: {
          apple: publicAssets.appleIcon,
          icon: publicAssets.icon,
        },
      }),
  openGraph: {
    description: publicApplicationDescription,
    siteName: publicBrand,
    title: publicApplicationTitle,
    type: "website",
    ...(publicAssets === undefined
      ? {}
      : { images: [publicAssets.openGraphImage] }),
  },
  title: {
    default: publicApplicationTitle,
    template: `%s | ${publicBrand}`,
  },
  twitter: {
    card: "summary_large_image",
    description: publicApplicationDescription,
    title: publicApplicationTitle,
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
