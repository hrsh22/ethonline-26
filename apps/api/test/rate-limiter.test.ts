import { describe, expect, it } from "vitest";

import { createRequestRateLimiter } from "../src/rate-limiter.js";

describe("public API request rate limiter", () => {
  it("bounds a client per window and admits it after reset", () => {
    const limiter = createRequestRateLimiter({
      maximumClients: 10,
      maximumRequests: 2,
      windowMilliseconds: 1_000,
    });

    expect(limiter.consume("client", 0).allowed).toBe(true);
    expect(limiter.consume("client", 1).allowed).toBe(true);
    expect(limiter.consume("client", 2)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("client", 1_000).allowed).toBe(true);
  });

  it("fails closed at capacity instead of evicting live windows", () => {
    const limiter = createRequestRateLimiter({
      maximumClients: 2,
      maximumRequests: 1,
      windowMilliseconds: 10_000,
    });

    expect(limiter.consume("one", 0).allowed).toBe(true);
    expect(limiter.consume("two", 0).allowed).toBe(true);
    // A third client cannot displace a live window: admitting it by evicting
    // the oldest entry let a flood of fresh keys reset its own budget on
    // demand -- the earlier version of this test asserted exactly that bypass
    // as intended behaviour under the name "bounds retained client state".
    expect(limiter.consume("three", 0).allowed).toBe(false);
    // Existing clients keep their state and their limits.
    expect(limiter.consume("one", 1).allowed).toBe(false);
    // Once the windows expire, capacity frees and new clients are admitted.
    expect(limiter.consume("three", 10_001).allowed).toBe(true);
  });
});
