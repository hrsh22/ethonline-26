import { describe, expect, it } from "vitest";

import {
  ADMIN_AUTH_CHAIN_ID,
  ADMIN_AUTH_COOKIE_NAME,
  ADMIN_AUTH_PATHS,
  ADMIN_DIAGNOSTIC_PATHS,
  ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES,
  createAdminChallengeMessage,
  adminConsoleRoles,
  decodeAdminActionAuthorizationRequest,
  decodeAdminChallengeRequest,
  decodeAdminVerifyRequest,
  requiredAdminRole,
  normalizeAdminAppOrigin,
} from "../src/admin-auth.js";
import { parseSiweMessage } from "viem/siwe";

const address = "0x8d01188806aa960f95a3fe4a343dfc26a8a7e6b5";

describe("admin authentication contract", () => {
  it.each([
    "https://admin.orbit.example",
    "https://orbit.example:8443",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ])("accepts SIWE-compatible admin origin %s", (origin) => {
    expect(normalizeAdminAppOrigin(origin)).toBe(origin);
  });

  it.each([
    "https://admin",
    "https://foo_bar.example",
    "https://-admin.example",
    "https://admin-.example",
    "https://admin.xn--p1ai",
    "https://admin.x",
    "http://[::1]:3000",
    "http://example.com",
    "https://admin.orbit.example/path",
    "https://user:secret@admin.orbit.example",
  ])("rejects unsupported admin origin %s", (origin) => {
    expect(() => normalizeAdminAppOrigin(origin)).toThrow(/admin app origin/iu);
  });

  it("builds a message that viem can parse only after origin validation", () => {
    for (const origin of [
      "https://admin.orbit.example",
      "https://orbit.example:8443",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]) {
      const message = createAdminChallengeMessage({
        address: "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5",
        appOrigin: origin,
        deploymentFingerprint: `0x${"f".repeat(64)}`,
        expirationTime: new Date("2026-08-31T08:05:00.000Z"),
        issuedAt: new Date("2026-08-31T08:00:00.000Z"),
        nonce: "ab".repeat(32),
      });
      expect(parseSiweMessage(message).domain).toBe(new URL(origin).host);
    }
    expect(() =>
      createAdminChallengeMessage({
        address: "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5",
        appOrigin: "https://admin",
        deploymentFingerprint: `0x${"f".repeat(64)}`,
        expirationTime: new Date("2026-08-31T08:05:00.000Z"),
        issuedAt: new Date("2026-08-31T08:00:00.000Z"),
        nonce: "ab".repeat(32),
      }),
    ).toThrow(/admin app origin/iu);
  });
  it("pins one chain, cookie, and exact route map", () => {
    expect(ADMIN_AUTH_CHAIN_ID).toBe(84_532);
    expect(ADMIN_AUTH_COOKIE_NAME).toBe("orbit_admin_session");
    expect(ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES).toBe(20_480);
    expect(ADMIN_AUTH_PATHS).toEqual({
      actionAuthorization: "/v1/admin/actions/authorize",
      challenge: "/v1/admin/auth/challenge",
      logout: "/v1/admin/auth/logout",
      session: "/v1/admin/auth/session",
      verify: "/v1/admin/auth/verify",
    });
    expect(ADMIN_DIAGNOSTIC_PATHS).toEqual({
      keeperAttempts: "/v1/admin/diagnostics/keeper-attempts",
      operations: "/v1/admin/diagnostics/operations",
    });
  });

  it("checksums an exact challenge address", () => {
    expect(decodeAdminChallengeRequest({ address })).toEqual({
      address: "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5",
    });
  });

  it.each([
    null,
    {},
    { address, chainId: 84_532 },
    { address: "not-an-address" },
    { address: "0x0000000000000000000000000000000000000000" },
  ])("rejects malformed challenge request %#", (request) => {
    expect(() => decodeAdminChallengeRequest(request)).toThrow();
  });

  it("decodes an exact signed-message verification request", () => {
    expect(
      decodeAdminVerifyRequest({
        message: "example.org wants you to sign in",
        signature: `0x${"ab".repeat(65)}`,
      }),
    ).toEqual({
      message: "example.org wants you to sign in",
      signature: `0x${"ab".repeat(65)}`,
    });
  });

  it.each([
    null,
    {},
    { message: "message", signature: "bad" },
    { message: "", signature: `0x${"ab".repeat(65)}` },
    {
      message: "message",
      signature: `0x${"ab".repeat(65)}`,
      token: "unsupported",
    },
  ])("rejects malformed verification request %#", (request) => {
    expect(() => decodeAdminVerifyRequest(request)).toThrow();
  });

  it.each([
    ["open-reward-epoch", "keeper"],
    ["execute-track", "keeper"],
    ["retry-track", "keeper"],
    ["execute-pol", "liquidity-executor"],
  ] as const)("maps %s to its exact role", (type, role) => {
    const action = decodeAdminActionAuthorizationRequest({ type });
    expect(requiredAdminRole(action)).toBe(role);
  });

  it.each([
    ["liquidToken", "liquid-token-owner"],
    ["rewards", "reward-ledger-owner"],
    ["converter", "converter-owner"],
    ["liquidity", "liquidity-owner"],
  ] as const)(
    "maps the %s pause control to its module owner",
    (module, role) => {
      const action = decodeAdminActionAuthorizationRequest({
        module,
        type: "set-pause",
      });
      expect(requiredAdminRole(action)).toBe(role);
    },
  );

  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "open-reward-epoch", module: "converter" },
    { type: "set-pause" },
    { type: "set-pause", module: "unknown" },
    { type: "execute-track", track: 1 },
  ])("rejects malformed action authorization request %#", (request) => {
    expect(() => decodeAdminActionAuthorizationRequest(request)).toThrow();
  });

  it("admits a creator-only authority for its own fee withdrawal", () => {
    // The creator must be able to reach the console to withdraw accrued fees.
    // Every action is still authorized against its exact capability, so this
    // session cannot perform keeper, owner, guardian, or executor actions.
    expect(
      adminConsoleRoles({
        creator: true,
        guardian: false,
        keeper: false,
        liquidityExecutor: false,
        owners: {
          converter: false,
          liquidToken: false,
          liquidity: false,
          rewards: false,
        },
        recovery: false,
      }),
    ).toEqual(["creator"]);
    expect(
      adminConsoleRoles({
        creator: true,
        guardian: true,
        keeper: true,
        liquidityExecutor: false,
        owners: {
          converter: false,
          liquidToken: true,
          liquidity: false,
          rewards: false,
        },
        recovery: true,
      }),
    ).toEqual([
      "liquid-token-owner",
      "guardian",
      "recovery",
      "keeper",
      "creator",
    ]);
  });
});

describe("creator capability", () => {
  it("reports creator as its own console role", () => {
    expect(
      adminConsoleRoles({
        owners: {
          liquidToken: false,
          rewards: false,
          converter: false,
          liquidity: false,
        },
        guardian: false,
        recovery: false,
        keeper: false,
        liquidityExecutor: false,
        creator: true,
      }),
    ).toEqual(["creator"]);
  });

  it("requires the creator capability for a fee withdrawal", () => {
    expect(requiredAdminRole({ type: "withdraw-creator-fees" })).toBe(
      "creator",
    );
  });

  it("does not let the creator capability satisfy other actions", () => {
    for (const type of [
      "open-reward-epoch",
      "execute-track",
      "retry-track",
      "execute-pol",
    ] as const) {
      expect(requiredAdminRole({ type })).not.toBe("creator");
    }
  });

  it("decodes the withdrawal request with no extra fields", () => {
    expect(
      decodeAdminActionAuthorizationRequest({
        type: "withdraw-creator-fees",
      }),
    ).toEqual({ type: "withdraw-creator-fees" });
    expect(() =>
      decodeAdminActionAuthorizationRequest({
        type: "withdraw-creator-fees",
        amount: "1",
      }),
    ).toThrow(TypeError);
  });
});
