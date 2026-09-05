import {
  ADMIN_AUTH_CHAIN_ID,
  ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS,
  ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS,
  ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS,
  ADMIN_CONSOLE_ROLE_IDS,
  createAdminChallengeMessage,
  decodeAdminActionAuthorizationRequest,
  type AdminActionAuthorizationRequest,
  type AdminConsoleRoleId,
  normalizeAdminAppOrigin,
} from "@orbit/config/admin-auth";
import {
  getAddress,
  isAddress,
  isHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { parseSiweMessage } from "viem/siwe";

export interface AdminObservedBlockDTO {
  readonly hash: `0x${string}`;
  readonly number: string;
}

export interface AdminSessionDTO {
  readonly address: Address;
  readonly chainId: typeof ADMIN_AUTH_CHAIN_ID;
  readonly csrfToken: string;
  readonly deploymentFingerprint: Hex;
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly observedBlock: AdminObservedBlockDTO;
  readonly roles: readonly AdminConsoleRoleId[];
}

export interface AdminSessionResponse {
  readonly apiVersion: 1;
  readonly session: AdminSessionDTO;
}

export interface AdminChallengeResponse {
  readonly apiVersion: 1;
  readonly challenge: {
    readonly expiresAt: string;
    readonly message: string;
  };
}

export interface AdminChallengeExpectation {
  readonly address: Address;
  readonly appOrigin: string;
  readonly deploymentFingerprint: Hex | undefined;
  readonly now: Date;
}

export class AdminChallengeValidationError extends Error {
  constructor() {
    super("Admin challenge is invalid");
    this.name = "AdminChallengeValidationError";
  }
}

export interface AdminAuthorizationResponse {
  readonly apiVersion: 1;
  readonly authorization: {
    readonly action: AdminActionAuthorizationRequest;
    readonly authorized: true;
    readonly observedBlock: AdminObservedBlockDTO;
  };
}

/* The canonical list, not a second copy of it. This set used to be written
   out here and was missing "creator", so a session for any authority holding
   the creator role decoded as invalid and the console redirected straight
   back to sign-in. */
const roleIds = new Set<AdminConsoleRoleId>(ADMIN_CONSOLE_ROLE_IDS);

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Admin API response must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
};

const exactKeys = (
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const timestamp = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError("Admin API timestamp is invalid");
  }
  return value;
};

const nonBlank = (value: unknown, maximum: number): string => {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw new TypeError("Admin API string is invalid");
  }
  return value;
};

const deploymentFingerprint = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError("Admin deployment fingerprint is invalid");
  }
  return value as Hex;
};

const observedBlock = (value: unknown): AdminObservedBlockDTO => {
  const input = record(value);
  if (
    !exactKeys(input, ["hash", "number"]) ||
    typeof input.number !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(input.number) ||
    typeof input.hash !== "string" ||
    !isHex(input.hash) ||
    input.hash.length !== 66
  ) {
    throw new TypeError("Admin API observed block is invalid");
  }
  return { hash: input.hash, number: input.number };
};

const sessionAddress = (value: unknown): Address => {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new TypeError("Admin session address is invalid");
  }
  return getAddress(value);
};

const sessionRoles = (value: unknown): readonly AdminConsoleRoleId[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Admin session roles are invalid");
  }
  const roles = value as unknown[];
  if (
    roles.some(
      (role) =>
        typeof role !== "string" || !roleIds.has(role as AdminConsoleRoleId),
    ) ||
    new Set(roles).size !== roles.length
  ) {
    throw new TypeError("Admin session roles are invalid");
  }
  return roles as AdminConsoleRoleId[];
};

export const decodeAdminChallengeResponse = (
  value: unknown,
): AdminChallengeResponse => {
  const envelope = record(value);
  const challenge = record(envelope.challenge);
  if (
    !exactKeys(envelope, ["apiVersion", "challenge"]) ||
    envelope.apiVersion !== 1 ||
    !exactKeys(challenge, ["expiresAt", "message"])
  ) {
    throw new TypeError("Admin challenge response is invalid");
  }
  return {
    apiVersion: 1,
    challenge: {
      expiresAt: timestamp(challenge.expiresAt),
      message: nonBlank(challenge.message, 8_192),
    },
  };
};

const validDate = (value: Date | undefined): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const challengeTimingIsAllowed = (
  issuedAt: Date,
  expirationTime: Date,
  now: Date,
): boolean => {
  const lifetime = expirationTime.getTime() - issuedAt.getTime();
  return [
    issuedAt.getTime() <=
      now.getTime() + ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS,
    expirationTime.getTime() > now.getTime(),
    lifetime >= ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS,
    lifetime <= ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS,
    now.getTime() - issuedAt.getTime() <=
      ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS +
        ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS,
  ].every(Boolean);
};

const expectedChallengeBinding = (expectation: AdminChallengeExpectation) => {
  if (!validDate(expectation.now)) throw new Error("invalid current time");
  const expectedDeploymentFingerprint = deploymentFingerprint(
    expectation.deploymentFingerprint,
  );
  if (!isAddress(expectation.address)) throw new Error("invalid address");
  const expectedAddress = getAddress(expectation.address);
  if (expectedAddress === zeroAddress) throw new Error("zero address");
  const origin = new URL(normalizeAdminAppOrigin(expectation.appOrigin));
  return { expectedAddress, expectedDeploymentFingerprint, origin } as const;
};

const challengeLifetime = (
  issuedAt: Date | undefined,
  expirationTime: Date | undefined,
  notBefore: Date | undefined,
  envelopeExpiry: string,
  now: Date,
): { readonly expirationTime: Date; readonly issuedAt: Date } => {
  if (!validDate(issuedAt)) throw new Error("invalid issued time");
  if (!validDate(expirationTime)) throw new Error("invalid expiration time");
  if (notBefore !== undefined) throw new Error("unsupported not-before");
  if (!challengeTimingIsAllowed(issuedAt, expirationTime, now)) {
    throw new Error("challenge lifetime is outside policy");
  }
  if (expirationTime.toISOString() !== envelopeExpiry) {
    throw new Error("expiration mismatch");
  }
  return { expirationTime, issuedAt };
};

export const validateAdminChallengeForSigning = (
  challenge: AdminChallengeResponse["challenge"],
  expectation: AdminChallengeExpectation,
): AdminChallengeResponse["challenge"] => {
  try {
    const { expectedAddress, expectedDeploymentFingerprint, origin } =
      expectedChallengeBinding(expectation);
    const parsed = parseSiweMessage(challenge.message);
    if (typeof parsed.nonce !== "string") throw new Error("invalid nonce");
    const { expirationTime, issuedAt } = challengeLifetime(
      parsed.issuedAt,
      parsed.expirationTime,
      parsed.notBefore,
      challenge.expiresAt,
      expectation.now,
    );
    const expectedMessage = createAdminChallengeMessage({
      address: expectedAddress,
      appOrigin: origin.origin,
      deploymentFingerprint: expectedDeploymentFingerprint,
      expirationTime,
      issuedAt,
      nonce: parsed.nonce,
    });
    if (challenge.message !== expectedMessage) {
      throw new Error("challenge does not match its expected binding");
    }
    return challenge;
  } catch {
    throw new AdminChallengeValidationError();
  }
};

export const decodeAdminSessionResponse = (
  value: unknown,
  expectedDeploymentFingerprint: Hex | undefined,
): AdminSessionResponse => {
  const envelope = record(value);
  const session = record(envelope.session);
  if (
    !exactKeys(envelope, ["apiVersion", "session"]) ||
    envelope.apiVersion !== 1 ||
    !exactKeys(session, [
      "address",
      "chainId",
      "csrfToken",
      "deploymentFingerprint",
      "expiresAt",
      "issuedAt",
      "observedBlock",
      "roles",
    ]) ||
    session.chainId !== ADMIN_AUTH_CHAIN_ID
  ) {
    throw new TypeError("Admin session response is invalid");
  }
  const decodedDeploymentFingerprint = deploymentFingerprint(
    session.deploymentFingerprint,
  );
  if (
    expectedDeploymentFingerprint === undefined ||
    decodedDeploymentFingerprint !== expectedDeploymentFingerprint
  ) {
    throw new TypeError(
      "Admin session deployment fingerprint does not match the local deployment",
    );
  }
  return {
    apiVersion: 1,
    session: {
      address: sessionAddress(session.address),
      chainId: ADMIN_AUTH_CHAIN_ID,
      csrfToken: nonBlank(session.csrfToken, 512),
      deploymentFingerprint: decodedDeploymentFingerprint,
      expiresAt: timestamp(session.expiresAt),
      issuedAt: timestamp(session.issuedAt),
      observedBlock: observedBlock(session.observedBlock),
      roles: sessionRoles(session.roles),
    },
  };
};

export const decodeAdminAuthorizationResponse = (
  value: unknown,
  expectedAction: AdminActionAuthorizationRequest,
): AdminAuthorizationResponse => {
  const envelope = record(value);
  const authorization = record(envelope.authorization);
  let action: AdminActionAuthorizationRequest;
  try {
    action = decodeAdminActionAuthorizationRequest(authorization.action);
  } catch {
    throw new TypeError("Admin action authorization response is invalid");
  }
  if (
    !exactKeys(envelope, ["apiVersion", "authorization"]) ||
    envelope.apiVersion !== 1 ||
    !exactKeys(authorization, ["action", "authorized", "observedBlock"]) ||
    authorization.authorized !== true ||
    action.type !== expectedAction.type ||
    (action.type === "set-pause" &&
      (expectedAction.type !== "set-pause" ||
        action.module !== expectedAction.module))
  ) {
    throw new TypeError("Admin action authorization response is invalid");
  }
  return {
    apiVersion: 1,
    authorization: {
      action: expectedAction,
      authorized: true,
      observedBlock: observedBlock(authorization.observedBlock),
    },
  };
};

export type AdminReturnPath = "/admin" | "/admin/diagnostics";

export const safeAdminReturnPath = (
  value: string | null | undefined,
): AdminReturnPath =>
  value === "/admin/diagnostics" ? "/admin/diagnostics" : "/admin";
