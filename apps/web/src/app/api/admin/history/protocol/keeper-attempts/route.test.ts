import { afterEach, describe, expect, it, vi } from "vitest";

import { keeperAttemptsHistoryResponse } from "../test-fixtures";

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

import { GET } from "./route";

const handle = "a".repeat(64);

describe("protected keeper-attempt history route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the exact protected feed but no query-shaped proxy", async () => {
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe(
        "http://127.0.0.1:8800/v1/admin/diagnostics/keeper-attempts",
      );
      return Response.json({
        ...keeperAttemptsHistoryResponse,
        evidence: {
          ...keeperAttemptsHistoryResponse.evidence,
          ignoredEvidenceField: true,
          freshness: {
            ...keeperAttemptsHistoryResponse.evidence.freshness,
            ignoredFreshnessField: true,
          },
          tracks: {
            ...keeperAttemptsHistoryResponse.evidence.tracks,
            1: {
              ...keeperAttemptsHistoryResponse.evidence.tracks[1],
              ignoredTrackField: true,
              latest: {
                ...keeperAttemptsHistoryResponse.evidence.tracks[1].latest,
                ignoredAttemptField: true,
              },
            },
          },
        },
        ignoredTopLevel: true,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const headers = { cookie: `orbit_admin_session=${handle}` };

    const valid = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/keeper-attempts",
        { headers },
      ),
    );
    const invalid = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/keeper-attempts?path=/internal",
        { headers },
      ),
    );

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual(keeperAttemptsHistoryResponse);
    expect(invalid.status).toBe(400);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails closed when keeper evidence belongs to another deployment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...keeperAttemptsHistoryResponse,
          manifest: {
            ...keeperAttemptsHistoryResponse.manifest,
            fingerprint: `0x${"e".repeat(64)}`,
          },
        }),
      ),
    );

    const response = await GET(
      new Request(
        "https://app.orbit.example/api/admin/history/protocol/keeper-attempts",
        { headers: { cookie: `orbit_admin_session=${handle}` } },
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  });
});
