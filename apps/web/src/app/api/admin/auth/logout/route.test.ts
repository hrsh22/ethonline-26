import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const handle = "a".repeat(64);
const request = () =>
  new Request("https://app.orbit.example/api/admin/auth/logout", {
    headers: {
      cookie: `orbit_admin_session=${handle}; unrelated=secret`,
      origin: "https://app.orbit.example",
      "x-csrf-token": "c".repeat(32),
    },
    method: "POST",
  });

describe("admin logout route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes upstream, clears the host cookie, and returns fixed no-content", async () => {
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe("http://127.0.0.1:8800/v1/admin/auth/logout");
      expect(upstream.headers.get("cookie")).toBe(
        `orbit_admin_session=${handle}`,
      );
      expect(upstream.headers.get("x-csrf-token")).toBe("c".repeat(32));
      return new Response(null, {
        headers: { "set-cookie": "worker-secret=must-not-leak" },
        status: 204,
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("orbit_admin_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("worker-secret");
  });

  it("still clears a revoked browser session while returning a fixed 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toEqual({ error: "session_required" });
  });

  it("rejects a cross-origin logout without changing the browser cookie", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const crossOrigin = new Request(
      "https://app.orbit.example/api/admin/auth/logout",
      {
        headers: {
          cookie: `orbit_admin_session=${handle}`,
          origin: "https://attacker.example",
          "x-csrf-token": "c".repeat(32),
        },
        method: "POST",
      },
    );

    const response = await POST(crossOrigin);

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
