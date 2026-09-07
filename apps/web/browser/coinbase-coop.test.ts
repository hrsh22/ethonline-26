import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

// Exercise the exact Coinbase dependency loaded by Privy, including our patch.
// A 404 document still has meaningful security headers; do not bypass the check.
const require = createRequire(import.meta.url);
const privyRequire = createRequire(require.resolve("@privy-io/react-auth"));
const checkerUrl = pathToFileURL(
  join(
    dirname(privyRequire.resolve("@coinbase/wallet-sdk")),
    "util/checkCrossOriginOpenerPolicy.js",
  ),
).href;
const checker = (await import(checkerUrl)) as {
  checkCrossOriginOpenerPolicy: () => Promise<void>;
  getCrossOriginOpenerPolicy: () => string;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  [404, "same-origin-allow-popups", false],
  [404, "same-origin", true],
  [503, "same-origin-allow-popups", true],
] as const)(
  "checks real COOP headers on status %s with policy %s",
  async (status, policy, fails) => {
    vi.stubGlobal("window", {
      location: { origin: "https://orbit.test", pathname: "/fleet/invalid" },
    });
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status,
          headers: { "Cross-Origin-Opener-Policy": policy },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await checker.checkCrossOriginOpenerPolicy();
    expect(fetcher).toHaveBeenCalledWith("https://orbit.test/fleet/invalid", {
      method: "HEAD",
    });
    expect(checker.getCrossOriginOpenerPolicy()).toBe(
      status === 503 ? "error" : policy,
    );
    expect(error).toHaveBeenCalledTimes(fails ? 1 : 0);
  },
);
