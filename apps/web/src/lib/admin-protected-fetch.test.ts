/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION_INVALIDATED_EVENT,
  adminProtectedFetch,
} from "./admin-protected-fetch";

describe("protected admin fetch", () => {
  it.each([401, 403])(
    "broadcasts session invalidation for HTTP %s",
    async (status) => {
      const invalidated = vi.fn();
      window.addEventListener(ADMIN_SESSION_INVALIDATED_EVENT, invalidated);
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ error: "denied" }, { status }),
      );

      const response = await adminProtectedFetch(
        "/api/admin/history/protocol/operations",
        undefined,
        fetcher,
      );

      expect(response.status).toBe(status);
      expect(invalidated).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledWith(
        "/api/admin/history/protocol/operations",
        expect.objectContaining({
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      window.removeEventListener(ADMIN_SESSION_INVALIDATED_EVENT, invalidated);
    },
  );

  it("does not revoke the session for an unavailable dependency", async () => {
    const invalidated = vi.fn();
    window.addEventListener(ADMIN_SESSION_INVALIDATED_EVENT, invalidated);
    const response = await adminProtectedFetch(
      "/api/admin/history/protocol/operations",
      undefined,
      vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })),
    );
    expect(response.status).toBe(503);
    expect(invalidated).not.toHaveBeenCalled();
    window.removeEventListener(ADMIN_SESSION_INVALIDATED_EVENT, invalidated);
  });
});
