import { describe, expect, it } from "vitest";

import { resolvePublicApiBaseUrl } from "./public-api";

describe("web public API configuration", () => {
  it("resolves the configured VM public API origin", () => {
    expect(
      resolvePublicApiBaseUrl({
        NEXT_PUBLIC_API_URL: "https://api.orbit.example",
      }),
    ).toBe("https://api.orbit.example");
  });

  it("fails closed when the public API origin is missing or unsafe", () => {
    expect(() => resolvePublicApiBaseUrl({})).toThrow(
      /NEXT_PUBLIC_API_URL is required/u,
    );
    expect(() =>
      resolvePublicApiBaseUrl({
        NEXT_PUBLIC_API_URL: "http://api.orbit.example",
      }),
    ).toThrow(/HTTPS origin/u);
  });
});
