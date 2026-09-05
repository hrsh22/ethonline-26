import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

import {
  authorizeAdminAction,
  requestAdminChallenge,
  verifyAdminSignature,
} from "./admin-auth-client";

const address = "0x1111111111111111111111111111111111111111";
const challenge = {
  apiVersion: 1,
  challenge: {
    expiresAt: "2026-08-31T05:05:00.000Z",
    message: "EIP-4361 challenge",
  },
} as const;
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

describe("same-origin admin auth client", () => {
  it("requests and verifies through fixed BFF paths with no API credential", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(challenge))
      .mockResolvedValueOnce(Response.json({ apiVersion: 1, session }));

    await expect(requestAdminChallenge(address, fetcher)).resolves.toEqual(
      challenge.challenge,
    );
    await expect(
      verifyAdminSignature(
        { message: challenge.challenge.message, signature: "0x1234" },
        fetcher,
      ),
    ).resolves.toEqual(session);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/admin/auth/challenge",
      expect.objectContaining({
        body: JSON.stringify({ address }),
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/admin/auth/verify",
      expect.objectContaining({
        body: JSON.stringify({
          message: challenge.challenge.message,
          signature: "0x1234",
        }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
    }
  });

  it("rejects malformed or denied BFF responses with a fixed client error", async () => {
    const malformed = vi.fn<typeof fetch>(async () =>
      Response.json({
        apiVersion: 1,
        challenge: { message: "missing expiry" },
      }),
    );
    const denied = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "forbidden" }, { status: 403 }),
    );

    await expect(requestAdminChallenge(address, malformed)).rejects.toThrow(
      "Admin authentication is unavailable",
    );
    await expect(requestAdminChallenge(address, denied)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("rejects a verify DTO for another deployment", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        apiVersion: 1,
        session: {
          ...session,
          deploymentFingerprint: `0x${"e".repeat(64)}`,
        },
      }),
    );

    await expect(
      verifyAdminSignature(
        { message: challenge.challenge.message, signature: "0x1234" },
        fetcher,
      ),
    ).rejects.toMatchObject({
      code: "upstream_unavailable",
      status: 503,
    });
  });

  it("authorizes one exact action with the session CSRF token", async () => {
    const action = { type: "set-pause", module: "rewards" } as const;
    const authorization = {
      apiVersion: 1,
      authorization: {
        action,
        authorized: true,
        observedBlock: session.observedBlock,
      },
    } as const;
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(authorization),
    );

    await expect(
      authorizeAdminAction(action, session.csrfToken, fetcher),
    ).resolves.toEqual(authorization.authorization);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/actions/authorize",
      expect.objectContaining({
        body: JSON.stringify(action),
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-csrf-token"),
    ).toBe(session.csrfToken);
  });
});
