import { describe, expect, it } from "vitest";

import { publishedMetadataUrls } from "./published-metadata";

describe("published metadata URLs", () => {
  it("publishes every generated asset on the canonical HTTPS origin", () => {
    const urls = publishedMetadataUrls("https://orbit.example/path");

    expect(urls).toEqual({
      appleIcon: "https://orbit.example/apple-icon",
      icon: "https://orbit.example/icon.svg",
      openGraphImage: "https://orbit.example/opengraph-image",
      twitterImage: "https://orbit.example/opengraph-image",
    });
    for (const url of Object.values(urls ?? {})) {
      expect(new URL(url).protocol).toBe("https:");
      expect(url).not.toContain("localhost");
    }
  });

  it("does not invent an origin when the deployment has none", () => {
    expect(publishedMetadataUrls(undefined)).toBeUndefined();
  });
});
