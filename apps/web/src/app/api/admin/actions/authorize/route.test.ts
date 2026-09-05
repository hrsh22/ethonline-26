import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const endpoint = "https://app.orbit.example/api/admin/actions/authorize";
const block = { hash: `0x${"a".repeat(64)}`, number: "31000000" };
const handle = "b".repeat(64);

const request = (headers: Record<string, string> = {}) =>
  new Request(endpoint, {
    body: JSON.stringify({ type: "open-reward-epoch" }),
    headers: {
      cookie: `orbit_admin_session=${handle}; unrelated=secret`,
      "content-type": "application/json",
      origin: "https://app.orbit.example",
      "x-csrf-token": "c".repeat(32),
      ...headers,
    },
    method: "POST",
  });

describe("admin action authorization route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("relays a validated action with the exact session and CSRF headers", async () => {
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe(
        "http://127.0.0.1:8800/v1/admin/actions/authorize",
      );
      expect(upstream.headers.get("cookie")).toBe(
        `orbit_admin_session=${handle}`,
      );
      expect(upstream.headers.get("x-csrf-token")).toBe("c".repeat(32));
      expect(await upstream.json()).toEqual({ type: "open-reward-epoch" });
      return Response.json({
        apiVersion: 1,
        authorization: {
          action: { type: "open-reward-epoch" },
          authorized: true,
          observedBlock: block,
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      apiVersion: 1,
      authorization: {
        action: { type: "open-reward-epoch" },
        authorized: true,
        observedBlock: block,
      },
    });
  });

  it("rejects missing CSRF evidence before authorization", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request({ "x-csrf-token": "" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps an aborted API deadline to one fixed unavailable response", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (upstream: Request) => {
        expect(upstream.signal.aborted).toBe(true);
        throw new DOMException("aborted", "AbortError");
      }),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });
});
