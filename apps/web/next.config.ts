import type { NextConfig } from "next";

import { normalizePublicApiBaseUrl } from "@orbit/config/public-api";

const frameProtectionHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
];

const configuredPublicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
if (process.env.NODE_ENV === "production") {
  if (
    configuredPublicApiUrl === undefined ||
    configuredPublicApiUrl.length === 0
  ) {
    throw new TypeError(
      "NEXT_PUBLIC_API_URL is required for a production web build",
    );
  }
  normalizePublicApiBaseUrl(configuredPublicApiUrl);
  // The app origin is signed into operator control commands and published as
  // WalletConnect metadata; a production build without it silently bound both
  // to localhost fallbacks.
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredAppUrl === undefined || configuredAppUrl.length === 0) {
    throw new TypeError(
      "NEXT_PUBLIC_APP_URL is required for a production web build",
    );
  }
  new URL(configuredAppUrl);
}

const nextConfig: NextConfig = {
  // The issue badge otherwise covers Disconnect at the bottom of the rail.
  devIndicators: { position: "bottom-right" },
  experimental: {
    globalNotFound: true,
  },
  headers() {
    return [
      {
        source: "/:path*",
        headers: frameProtectionHeaders,
      },
    ];
  },
  transpilePackages: ["@orbit/config", "@orbit/protocol"],
  typedRoutes: true,
};

export default nextConfig;
