import { describe, expect, it } from "vitest";

import {
  AdminChallengeValidationError,
  decodeAdminSessionResponse,
  validateAdminChallengeForSigning,
} from "./admin-session-contract";
import {
  ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS,
  ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS,
  ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS,
  ADMIN_CONSOLE_ROLE_IDS,
  createAdminChallengeMessage,
} from "@orbit/config/admin-auth";

const localDeploymentFingerprint = `0x${"f".repeat(64)}` as `0x${string}`;
const challengeDeploymentFingerprint = `0x${"11".repeat(32)}` as const;
const challengeAddress = "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5";
const challengeIssuedAt = "2026-08-31T08:00:00.000Z";
const challengeExpiresAt = "2026-08-31T08:05:00.000Z";
const challengeMessage = `${
  "https://admin.orbit.example wants you to sign in with your Ethereum account:\n" +
  `${challengeAddress}\n\n` +
  "Authorize access to the Orbit administrator console.\n\n" +
  "URI: https://admin.orbit.example/admin/sign-in\n" +
  "Version: 1\n" +
  "Chain ID: 84532\n" +
  `Nonce: ${"ab".repeat(32)}\n` +
  `Issued At: ${challengeIssuedAt}\n` +
  `Expiration Time: ${challengeExpiresAt}\n` +
  `Request ID: ${challengeDeploymentFingerprint}\n` +
  "Resources:\n" +
  `- urn:orbit:deployment:${"11".repeat(32)}`
}`;
const challenge = {
  expiresAt: challengeExpiresAt,
  message: challengeMessage,
};
const challengeExpectation = {
  address: challengeAddress,
  appOrigin: "https://admin.orbit.example",
  deploymentFingerprint: challengeDeploymentFingerprint,
  now: new Date("2026-08-31T08:01:00.000Z"),
} as const;
const session = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 84_532,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: localDeploymentFingerprint,
  expiresAt: "2026-08-31T05:15:00.000Z",
  issuedAt: "2026-08-31T05:00:00.000Z",
  observedBlock: { hash: `0x${"a".repeat(64)}`, number: "31000000" },
  roles: ["keeper"],
};

describe("admin challenge before wallet signature", () => {
  const timedChallenge = (issuedAt: Date, expirationTime: Date) => ({
    expiresAt: expirationTime.toISOString(),
    message: createAdminChallengeMessage({
      address: challengeAddress,
      appOrigin: challengeExpectation.appOrigin,
      deploymentFingerprint: challengeDeploymentFingerprint,
      expirationTime,
      issuedAt,
      nonce: "ab".repeat(32),
    }),
  });

  it("accepts one canonical deployment-bound EIP-4361 challenge", () => {
    expect(
      validateAdminChallengeForSigning(challenge, challengeExpectation),
    ).toEqual(challenge);
  });

  it.each([
    ["malformed message", { ...challenge, message: "not a SIWE message" }],
    [
      "noncanonical connected address",
      {
        ...challenge,
        message: challengeMessage.replace(
          challengeAddress,
          challengeAddress.toLowerCase(),
        ),
      },
    ],
    [
      "wrong address",
      {
        ...challenge,
        message: challengeMessage.replace(
          challengeAddress,
          "0x0000000000000000000000000000000000000001",
        ),
      },
    ],
    [
      "wrong scheme",
      {
        ...challenge,
        message: challengeMessage.replace(
          "https://admin.orbit.example wants",
          "http://admin.orbit.example wants",
        ),
      },
    ],
    [
      "wrong domain",
      {
        ...challenge,
        message: challengeMessage.replace(
          "https://admin.orbit.example wants",
          "https://evil.example wants",
        ),
      },
    ],
    [
      "wrong sign-in URI",
      {
        ...challenge,
        message: challengeMessage.replace(
          "URI: https://admin.orbit.example/admin/sign-in",
          "URI: https://admin.orbit.example/admin",
        ),
      },
    ],
    [
      "wrong version",
      {
        ...challenge,
        message: challengeMessage.replace("Version: 1", "Version: 2"),
      },
    ],
    [
      "wrong chain",
      {
        ...challenge,
        message: challengeMessage.replace("Chain ID: 84532", "Chain ID: 1"),
      },
    ],
    [
      "wrong statement",
      {
        ...challenge,
        message: challengeMessage.replace(
          "Authorize access to the Orbit administrator console.",
          "Authorize another application.",
        ),
      },
    ],
    [
      "malformed issued time",
      {
        ...challenge,
        message: challengeMessage.replace(
          challengeIssuedAt,
          "not-an-issued-time",
        ),
      },
    ],
    [
      "future issued time",
      {
        ...challenge,
        message: challengeMessage.replace(
          challengeIssuedAt,
          "2026-08-31T08:02:00.000Z",
        ),
      },
    ],
    [
      "missing expiration",
      {
        ...challenge,
        message: challengeMessage.replace(
          `\nExpiration Time: ${challengeExpiresAt}`,
          "",
        ),
      },
    ],
    [
      "unsupported not-before",
      {
        ...challenge,
        message: challengeMessage.replace(
          `Expiration Time: ${challengeExpiresAt}`,
          `Expiration Time: ${challengeExpiresAt}\nNot Before: ${challengeIssuedAt}`,
        ),
      },
    ],
    [
      "wrong deployment request ID",
      {
        ...challenge,
        message: challengeMessage.replace(
          `Request ID: ${challengeDeploymentFingerprint}`,
          `Request ID: 0x${"22".repeat(32)}`,
        ),
      },
    ],
    [
      "wrong deployment resource",
      {
        ...challenge,
        message: challengeMessage.replace(
          `urn:orbit:deployment:${"11".repeat(32)}`,
          `urn:orbit:deployment:${"22".repeat(32)}`,
        ),
      },
    ],
    [
      "extra resource",
      {
        ...challenge,
        message: `${challengeMessage}\n- https://evil.example/resource`,
      },
    ],
    [
      "unsupported trailing field",
      {
        ...challenge,
        message: `${challengeMessage}\nUnsupported: value`,
      },
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(() =>
      validateAdminChallengeForSigning(candidate, challengeExpectation),
    ).toThrow(AdminChallengeValidationError);
  });

  it("rejects expired, envelope-mismatched, and locally unbound challenges", () => {
    for (const [candidate, expectation] of [
      [
        challenge,
        { ...challengeExpectation, now: new Date(challengeExpiresAt) },
      ],
      [
        { ...challenge, expiresAt: "2026-08-31T08:06:00.000Z" },
        challengeExpectation,
      ],
      [
        challenge,
        { ...challengeExpectation, deploymentFingerprint: undefined },
      ],
    ] as const) {
      expect(() =>
        validateAdminChallengeForSigning(candidate, expectation),
      ).toThrow(AdminChallengeValidationError);
    }
  });

  it("accepts configured lifetime boundaries and small future clock skew", () => {
    const now = challengeExpectation.now;
    for (const [issuedAt, lifetime] of [
      [now, ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS],
      [now, ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS],
      [
        new Date(now.getTime() + ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS),
        ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS,
      ],
    ] as const) {
      const expirationTime = new Date(issuedAt.getTime() + lifetime);
      expect(
        validateAdminChallengeForSigning(
          timedChallenge(issuedAt, expirationTime),
          challengeExpectation,
        ),
      ).toBeDefined();
    }
  });

  it("rejects challenges outside the lifetime, skew, and freshness policy", () => {
    const now = challengeExpectation.now;
    for (const [issuedAt, expirationTime] of [
      [
        now,
        new Date(
          now.getTime() + ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS - 1,
        ),
      ],
      [
        now,
        new Date(
          now.getTime() + ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS + 1,
        ),
      ],
      [
        new Date(
          now.getTime() + ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS + 1,
        ),
        new Date(
          now.getTime() +
            ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS +
            1 +
            ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS,
        ),
      ],
      [
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2030-01-01T00:00:00.000Z"),
      ],
    ] as const) {
      expect(() =>
        validateAdminChallengeForSigning(
          timedChallenge(issuedAt, expirationTime),
          challengeExpectation,
        ),
      ).toThrow(AdminChallengeValidationError);
    }
  });
});

describe("admin browser-safe session DTO", () => {
  it("accepts a session holding every role the protocol can grant", () => {
    /*
     * The only fixture here used to be `["keeper"]`, and this decoder kept its
     * own hand-written set of role ids that omitted "creator". Every authority
     * holding the creator role — the deployer on the live testnet deployment
     * does — had its session rejected as invalid, so `requireAdminSession`
     * redirected the console straight back to sign-in and the operator could
     * not get in at all. No gate saw it: nothing renders the console signed
     * in, and a `readonly AdminConsoleRoleId[]` annotation checks that each
     * member is a role, not that every role is a member.
     */
    expect(ADMIN_CONSOLE_ROLE_IDS).toContain("creator");
    expect(
      decodeAdminSessionResponse(
        {
          apiVersion: 1,
          session: { ...session, roles: ADMIN_CONSOLE_ROLE_IDS },
        },
        session.deploymentFingerprint,
      ).session.roles,
    ).toEqual(ADMIN_CONSOLE_ROLE_IDS);

    for (const role of ADMIN_CONSOLE_ROLE_IDS) {
      expect(
        decodeAdminSessionResponse(
          { apiVersion: 1, session: { ...session, roles: [role] } },
          session.deploymentFingerprint,
        ).session.roles,
      ).toEqual([role]);
    }
  });

  it("accepts only one exact 32-byte deployment fingerprint", () => {
    expect(
      decodeAdminSessionResponse(
        { apiVersion: 1, session },
        session.deploymentFingerprint,
      ).session.deploymentFingerprint,
    ).toBe(session.deploymentFingerprint);

    for (const deploymentFingerprint of [
      "f".repeat(64),
      `0x${"f".repeat(62)}`,
      `0x${"g".repeat(64)}`,
    ]) {
      expect(() =>
        decodeAdminSessionResponse(
          {
            apiVersion: 1,
            session: { ...session, deploymentFingerprint },
          },
          session.deploymentFingerprint,
        ),
      ).toThrow(/deployment fingerprint/u);
    }
  });

  it("rejects a valid session fingerprint that is not the local deployment", () => {
    expect(() =>
      decodeAdminSessionResponse(
        { apiVersion: 1, session },
        `0x${"e".repeat(64)}`,
      ),
    ).toThrow(/does not match/u);
    expect(() =>
      decodeAdminSessionResponse({ apiVersion: 1, session }, undefined),
    ).toThrow(/does not match/u);
    expect(() =>
      decodeAdminSessionResponse(
        {
          apiVersion: 1,
          session: {
            ...session,
            deploymentFingerprint: `0x${"F".repeat(64)}`,
          },
        },
        localDeploymentFingerprint,
      ),
    ).toThrow(/does not match/u);
  });
});
