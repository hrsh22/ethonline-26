import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const endpoint = "https://app.orbit.example/api/admin/auth/challenge";
const address = "0x1111111111111111111111111111111111111111";

const request = (body: unknown, origin = "https://app.orbit.example") =>
  new Request(endpoint, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
    },
    method: "POST",
  });

describe("admin challenge route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards one validated request without credentials and returns private data", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const upstream = input instanceof Request ? input : new Request(input);
      expect(upstream.url).toBe(
        "http://127.0.0.1:8800/v1/admin/auth/challenge",
      );
      expect(upstream.method).toBe("POST");
      expect(upstream.headers.get("origin")).toBe("https://app.orbit.example");
      expect(upstream.headers.get("cookie")).toBeNull();
      expect(upstream.headers.get("authorization")).toBeNull();
      expect(await upstream.json()).toEqual({ address });
      return Response.json({
        apiVersion: 1,
        challenge: {
          expiresAt: "2026-09-05T05:05:00.000Z",
          message:
            "app.orbit.example wants you to sign in with your Ethereum account",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request({ address }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      apiVersion: 1,
      challenge: {
        expiresAt: "2026-09-05T05:05:00.000Z",
        message:
          "app.orbit.example wants you to sign in with your Ethereum account",
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin and malformed requests before the API boundary", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const crossOrigin = await POST(
      request({ address }, "https://attacker.example"),
    );
    const malformed = await POST(request({ address: "not-an-address" }));

    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ error: "forbidden" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, "8"])(
    "bounds the actual request body when content-length is %s",
    async (declaredLength) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        origin: "https://app.orbit.example",
      };
      if (declaredLength !== undefined) {
        headers["content-length"] = declaredLength;
      }
      const oversized = new Request(endpoint, {
        body: JSON.stringify({ address, padding: "x".repeat(1_024) }),
        headers,
        method: "POST",
      });

      const response = await POST(oversized);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
