import type { MetadataRoute } from "next";

import {
  publicApplicationDescription,
  publicApplicationTitle,
  publicBrand,
} from "@/lib/public-brand";

/**
 * The installable-application manifest. Kept in code so the name, colours, and
 * disclosure stay bound to the same identity configuration the UI renders.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#0e0f12",
    description: publicApplicationDescription,
    display: "standalone",
    icons: [
      { sizes: "any", src: "/icon.svg", type: "image/svg+xml" },
      { sizes: "180x180", src: "/apple-icon", type: "image/png" },
    ],
    name: publicApplicationTitle,
    short_name: publicBrand,
    start_url: "/",
    theme_color: "#ff6a1f",
  };
}
