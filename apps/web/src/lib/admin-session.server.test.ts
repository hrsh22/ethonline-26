import { afterEach, describe, expect, it, vi } from "vitest";

const nextState = vi.hoisted(() => ({
  cookieHeader: undefined as string | undefined,
  redirectedTo: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      nextState.cookieHeader === undefined
        ? undefined
        : { cookie: nextState.cookieHeader },
    ),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    nextState.redirectedTo = path;
    throw new Error(`redirect:${path}`);
  },
}));

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

import { requireAdminSession } from "./admin-session.server";

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
const handle = "a".repeat(64);

describe("admin server session DAL", () => {
  afterEach(() => {
    nextState.cookieHeader = undefined;
    nextState.redirectedTo = undefined;
    vi.unstubAllGlobals();
  });

  it("redirects before an upstream read when the host session is absent", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(requireAdminSession("/admin/diagnostics")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin%2Fdiagnostics",
    );
    expect(nextState.redirectedTo).toBe(
      "/admin/sign-in?next=%2Fadmin%2Fdiagnostics",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only a live decoded session after direct API introspection", async () => {
    nextState.cookieHeader = `orbit_admin_session=${handle}`;
    const fetcher = vi.fn(async (upstream: Request) => {
      expect(upstream.url).toBe("http://127.0.0.1:8800/v1/admin/auth/session");
      expect(upstream.headers.get("cookie")).toBe(
        `orbit_admin_session=${handle}`,
      );
      expect(upstream.headers.get("authorization")).toBeNull();
      expect(upstream.cache).toBe("no-store");
      return Response.json({ apiVersion: 1, session });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(requireAdminSession("/admin")).resolves.toEqual(session);
  });

  it("fails closed on revocation and sanitizes an unrecognized return path", async () => {
    nextState.cookieHeader = `orbit_admin_session=${"b".repeat(64)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );

    await expect(requireAdminSession("//attacker.example")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
  });

  it("rejects a session issued for a different deployment manifest", async () => {
    nextState.cookieHeader = `orbit_admin_session=${handle}`;
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

    await expect(requireAdminSession("/admin")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
  });

  it("requires an exact 200 response for session introspection", async () => {
    nextState.cookieHeader = `orbit_admin_session=${handle}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ apiVersion: 1, session }, { status: 201 }),
      ),
    );

    await expect(requireAdminSession("/admin")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
  });

  it("bounds streamed session responses without trusting Content-Length", async () => {
    nextState.cookieHeader = `orbit_admin_session=${handle}`;
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

    await expect(requireAdminSession("/admin")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
  });

  it("rejects cookie tossing with duplicate session names", async () => {
    nextState.cookieHeader = `orbit_admin_session=${handle}; orbit_admin_session=${"b".repeat(64)}`;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(requireAdminSession("/admin")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds a stalled session introspection request", async () => {
    nextState.cookieHeader = `orbit_admin_session=${handle}`;
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (upstream: Request) => {
        expect(upstream.signal.aborted).toBe(true);
        throw new DOMException("aborted", "AbortError");
      }),
    );

    await expect(requireAdminSession("/admin")).rejects.toThrow(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
  });
});
