export interface PublishedMetadataUrls {
  readonly appleIcon: string;
  readonly icon: string;
  readonly openGraphImage: string;
  readonly twitterImage: string;
}

/**
 * Absolute public assets shared by Next metadata and wallet discovery.
 * External consumers cannot resolve route-relative assets against the user's
 * current browser URL, so one canonical origin owns every published URL.
 */
export const publishedMetadataUrls = (
  origin: string | undefined,
): PublishedMetadataUrls | undefined => {
  if (origin === undefined) return undefined;
  const canonicalOrigin = new URL(origin).origin;
  return {
    appleIcon: `${canonicalOrigin}/apple-icon`,
    icon: `${canonicalOrigin}/icon.svg`,
    openGraphImage: `${canonicalOrigin}/opengraph-image`,
    // One generated social card serves both protocols; publishing a distinct
    // route without a corresponding Next asset would leave a silent 404.
    twitterImage: `${canonicalOrigin}/opengraph-image`,
  };
};
