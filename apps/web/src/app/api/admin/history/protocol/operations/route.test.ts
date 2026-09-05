import { afterEach, describe, expect, it, vi } from "vitest";

import { operationsHistoryResponse } from "../test-fixtures";

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

import { GET } from "./route";

const handle = "a".repeat(64);

describe("protected operations history route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards only a validated page query and the named session cookie", async () => {
    const payload = {
      ...operationsHistoryResponse,
      ignoredTopLevel: "must not cross the BFF boundary",
      items: operationsHistoryResponse.items.map((item) => ({
        ...item,
        ignoredItemField: true,
        payload: {
          ...item.payload,
          ignoredPayloadField: "must not cross the BFF boundary",
        },
      })),
      manifest: {
        ...operationsHistoryResponse.manifest,
        canonicalPool: {
          ...operationsHistoryResponse.manifest.canonicalPool,
          ignoredPoolField: true,
        },
        ignoredManifestField: true,
      },
      page: {
        ...operationsHistoryResponse.page,
        ignoredPageField: true,
      },
      status: {
        ...operationsHistoryResponse.status,
        ignoredStatusField: true,
      },
    };
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe(
        "http://127.0.0.1:8800/v1/admin/diagnostics/operations?fromBlock=10&toBlock=20&limit=5&order=desc",
      );
      expect(upstream.headers.get("cookie")).toBe(
        `orbit_admin_session=${handle}`,
      );
      expect(upstream.headers.get("authorization")).toBeNull();
      return Response.json(payload);
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/operations?fromBlock=10&toBlock=20&limit=5&order=desc",
        { headers: { cookie: `orbit_admin_session=${handle}` } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(operationsHistoryResponse);
  });

  it("fails closed when protected history belongs to another deployment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...operationsHistoryResponse,
          manifest: {
            ...operationsHistoryResponse.manifest,
            fingerprint: `0x${"e".repeat(64)}`,
          },
        }),
      ),
    );

    const response = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/operations",
        { headers: { cookie: `orbit_admin_session=${handle}` } },
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("rejects unsupported or repeated query parameters locally", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const headers = { cookie: `orbit_admin_session=${handle}` };

    const unsupported = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/operations?admin=true",
        { headers },
      ),
    );
    const repeated = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/operations?limit=5&limit=6",
        { headers },
      ),
    );

    expect(unsupported.status).toBe(400);
    expect(repeated.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
