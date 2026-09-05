import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

import { POST } from "./route";

const address = "0x1111111111111111111111111111111111111111";
const handle = "a".repeat(64);
const session = {
  address,
  chainId: 84_532,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: `0x${"f".repeat(64)}`,
  expiresAt: "2026-08-31T05:15:00.000Z",
  issuedAt: "2026-08-31T05:00:00.000Z",
  observedBlock: { hash: `0x${"a".repeat(64)}`, number: "31000000" },
  roles: ["keeper"],
};

describe("admin verification route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the safe session DTO and reissues only the opaque host cookie", async () => {
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe("http://127.0.0.1:8800/v1/admin/auth/verify");
      expect(upstream.headers.get("cookie")).toBeNull();
      expect(upstream.headers.get("authorization")).toBeNull();
      expect(await upstream.json()).toEqual({
        message: "EIP-4361 message",
        signature: "0x1234",
      });
      return Response.json(
        { apiVersion: 1, session },
        {
          headers: {
            "set-cookie": `orbit_admin_session=${handle}; Domain=api.orbit.example; Path=/v1/admin; SameSite=None; Max-Age=900; Expires=Mon, 31 Aug 2026 05:15:00 GMT; HttpOnly; Secure`,
            "x-private-upstream": "must-not-leak",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new Request("https://app.orbit.example/api/admin/auth/verify", {
        body: JSON.stringify({
          message: "EIP-4361 message",
          signature: "0x1234",
        }),
        headers: {
          authorization: "Bearer attacker-value",
          cookie: "orbit_admin_session=stale; unrelated=secret",
          "content-type": "application/json",
          origin: "https://app.orbit.example",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiVersion: 1, session });
    expect(response.headers.get("x-private-upstream")).toBeNull();
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`orbit_admin_session=${handle}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("api.orbit.example");
  });

  it("fails closed when a successful API response omits the session cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ apiVersion: 1, session })),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/admin/auth/verify", {
        body: JSON.stringify({
          message: "EIP-4361 message",
          signature: "0x1234",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("rejects an ambiguous upstream response with more than one cookie", async () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      `orbit_admin_session=${handle}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900; Expires=Mon, 31 Aug 2026 05:15:00 GMT`,
    );
    headers.append("set-cookie", "worker_debug=secret; Path=/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ apiVersion: 1, session }, { headers })),
    );

    const response = await POST(
      new Request("https://app.orbit.example/api/admin/auth/verify", {
        body: JSON.stringify({
          message: "EIP-4361 message",
          signature: "0x1234",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://app.orbit.example",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not issue a cookie for a session bound to another deployment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            apiVersion: 1,
            session: {
              ...session,
              deploymentFingerprint: `0x${"e".repeat(64)}`,
            },
          },
          {
            headers: {
              "set-cookie": `orbit_admin_session=${handle}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900; Expires=Mon, 31 Aug 2026 05:15:00 GMT`,
            },
          },
        ),
      ),
    );

    const response = await POST(
      new Request("https://app.orbit.example/api/admin/auth/verify", {
        body: JSON.stringify({
          message: "EIP-4361 message",
          signature: "0x1234",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://app.orbit.example",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
