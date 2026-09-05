import type { MetadataRoute } from "next";

import { deploymentEnvironment } from "@/lib/deployment";
import { identity } from "@/lib/identity";

/**
 * The installable-application manifest. Kept in code so the name, colours, and
 * disclosure stay bound to the same identity configuration the UI renders.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#0e0f12",
    description: identity.copy.metadataDescription,
    display: "standalone",
    icons: [
      { sizes: "any", src: "/icon.svg", type: "image/svg+xml" },
      { sizes: "180x180", src: "/apple-icon", type: "image/png" },
    ],
    name: `${identity.brand} | ${deploymentEnvironment.applicationLabel}`,
    short_name: identity.brand,
    start_url: "/",
    theme_color: "#ff6a1f",
  };
}
