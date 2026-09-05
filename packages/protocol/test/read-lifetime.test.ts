import { afterEach, describe, expect, it, vi } from "vitest";

import { bindReadSignal, runPublicRead } from "../src/read-lifetime.js";

afterEach(() => vi.useRealTimers());

describe("public read lifetime", () => {
  it.each(["timeout", "navigation"] as const)(
    "%s aborts pending HTTP work before a later page starts, and retry has a fresh lifetime",
    async (reason) => {
      vi.useFakeTimers();
      const navigation = new AbortController();
      const requests: string[] = [];
      let aborted = false;
      const fetcher: typeof fetch = async (url, init) => {
        requests.push(String(url));
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(init.signal?.reason);
            },
            { once: true },
          );
        });
      };
      const result = runPublicRead(
        async (signal) => {
          const read = bindReadSignal(fetcher, signal);
          await read("https://history.test/page1");
          await read("https://history.test/page2");
        },
        { signal: navigation.signal, timeoutMilliseconds: 100 },
      );
      const rejection = expect(result).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      if (reason === "navigation") navigation.abort();
      else await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(aborted).toBe(true);
      expect(requests).toEqual(["https://history.test/page1"]);
      await expect(
        runPublicRead(async (signal) => {
          signal.throwIfAborted();
          return "retried";
        }),
      ).resolves.toBe("retried");
    },
  );

  it("preserves typed history failures for canonicality handling", async () => {
    const failure = new RangeError("indexed snapshot changed");
    await expect(
      runPublicRead(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
