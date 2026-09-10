import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

import { GET } from "./route";

const handle = "a".repeat(64);
const session = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 84_532,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: `0x${"f".repeat(64)}`,
  expiresAt: "2026-09-05T05:15:00.000Z",
  issuedAt: "2026-09-05T05:00:00.000Z",
  observedBlock: { hash: `0x${"a".repeat(64)}`, number: "31000000" },
  roles: ["keeper"],
};

describe("admin session route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("relays only the named host session and keeps introspection private", async () => {
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe("http://127.0.0.1:8800/v1/admin/auth/session");
      expect(upstream.method).toBe("GET");
      expect(upstream.headers.get("cookie")).toBe(
        `orbit_admin_session=${handle}`,
      );
      expect(upstream.headers.get("authorization")).toBeNull();
      return Response.json({ apiVersion: 1, session });
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(
      new Request("https://app.orbit.example/api/admin/auth/session", {
        headers: {
          authorization: "Bearer attacker-value",
          cookie: `unrelated=do-not-forward; orbit_admin_session=${handle}; another=secret`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ apiVersion: 1, session });
  });

  it("returns a fixed 401 without contacting the API when no session exists", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(
      new Request("https://app.orbit.example/api/admin/auth/session"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "session_required" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects duplicated or malformed session cookies before forwarding", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    for (const cookie of [
      `orbit_admin_session=${handle}; orbit_admin_session=${"b".repeat(64)}`,
      "orbit_admin_session=not-an-opaque-handle",
    ]) {
      const response = await GET(
        new Request("https://app.orbit.example/api/admin/auth/session", {
          headers: { cookie },
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("vary")).toBe("Cookie");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a successful session response for another deployment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          apiVersion: 1,
          session: {
            ...session,
            deploymentFingerprint: `0x${"e".repeat(64)}`,
          },
        }),
      ),
    );

    const response = await GET(
      new Request("https://app.orbit.example/api/admin/auth/session", {
        headers: { cookie: `orbit_admin_session=${handle}` },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("bounds actual streamed response bytes even without Content-Length", async () => {
    const source = `${JSON.stringify({ apiVersion: 1, session })}${" ".repeat(40_000)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(source));
                controller.close();
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const response = await GET(
      new Request("https://app.orbit.example/api/admin/auth/session", {
        headers: { cookie: `orbit_admin_session=${handle}` },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });
});
