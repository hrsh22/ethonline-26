import type { NextConfig } from "next";

import { webPublicConfiguration } from "./src/lib/browser-public-configuration";
import { requireProductionWebPublicConfiguration } from "./src/lib/web-public-configuration";

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

if (process.env.NODE_ENV === "production") {
  // The app origin is signed into operator control commands and published as
  // wallet metadata, while every public data request needs the API origin.
  requireProductionWebPublicConfiguration(webPublicConfiguration);
}

const nextConfig: NextConfig = {
  // The collaborative preview reaches this development machine over the LAN.
  // Next otherwise rejects its hydration chunks, fonts, and HMR requests.
  allowedDevOrigins: ["192.168.1.5"],
  // The floating badge covers wallet controls or mobile navigation.
  devIndicators: false,
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
