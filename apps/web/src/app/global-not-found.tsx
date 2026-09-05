import type { Metadata } from "next";

import { RecoveryDocument } from "@/components/recovery-document";
import { applicationUrl } from "@/lib/deployment";
import { publishedMetadataUrls } from "@/lib/published-metadata";

import { applicationFontVariables } from "./fonts";
import "./globals.css";
import { notFoundContent } from "./not-found-content";
import NotFoundContent from "./not-found";

// The global 404 does not inherit the root layout's metadata, so it needs the
// canonical base explicitly for generated icons and social images as well.
const publicAssets = publishedMetadataUrls(applicationUrl);

export const metadata: Metadata = {
  ...notFoundContent.metadata,
  ...(applicationUrl === undefined
    ? {}
    : { metadataBase: new URL(applicationUrl) }),
  ...(publicAssets === undefined
    ? {}
    : {
        icons: {
          apple: publicAssets.appleIcon,
          icon: publicAssets.icon,
        },
        openGraph: { images: [publicAssets.openGraphImage] },
        twitter: {
          card: "summary_large_image",
          images: [publicAssets.twitterImage],
        },
      }),
};

export default function GlobalNotFound() {
  return (
    <RecoveryDocument fontVariables={applicationFontVariables}>
      <NotFoundContent />
    </RecoveryDocument>
  );
}
