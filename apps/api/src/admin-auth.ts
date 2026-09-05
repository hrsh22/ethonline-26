import { createHash } from "node:crypto";

import {
  ADMIN_AUTH_CHAIN_ID,
  adminConsoleRoles,
  createAdminChallengeMessage,
  requiredAdminRole,
  type AdminActionAuthorizationRequest,
  type AdminCapabilityFlags,
  type AdminConsoleRoleId,
  type AdminVerifyRequest,
} from "@orbit/config/admin-auth";
import { getAddress, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import type { AdminAuthStore, StoredAdminSession } from "./admin-auth-store.js";

const SECRET_BYTES = 32;

export interface AdminAuthorityBlock {
  readonly hash: Hex;
  readonly number: bigint;
}

export interface AdminAuthoritySnapshot {
  readonly bindingsFingerprint: Hex;
  readonly block: AdminAuthorityBlock;
  readonly capabilities: AdminCapabilityFlags;
  readonly consoleRoles: readonly AdminConsoleRoleId[];
}

export interface AdminAuthorityReader {
  readonly observe: () => Promise<AdminAuthorityBlock>;
  readonly read: (
    address: Address,
    block: AdminAuthorityBlock,
  ) => Promise<AdminAuthoritySnapshot>;
  readonly verify: (input: {
    readonly address: Address;
    readonly block: AdminAuthorityBlock;
    readonly message: string;
    readonly signature: Hex;
  }) => Promise<boolean>;
}

export interface AdminAuthServiceOptions {
  readonly appOrigin: string;
  readonly authorityReader: AdminAuthorityReader;
  readonly challengeTtlMilliseconds: number;
  readonly deploymentFingerprint: Hex;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly sessionTtlMilliseconds: number;
  readonly store: AdminAuthStore;
}

export interface AdminChallenge {
  readonly expiresAt: string;
  readonly message: string;
}

export interface AuthenticatedAdminSession {
  readonly address: Address;
  readonly capabilities: AdminCapabilityFlags;
  readonly chainId: typeof ADMIN_AUTH_CHAIN_ID;
  readonly csrfToken: string;
  readonly deploymentFingerprint: Hex;
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly observedBlock: AdminAuthorityBlock;
  readonly roles: readonly AdminConsoleRoleId[];
}

export type AdminSessionCreationResult =
  | {
      readonly ok: true;
      readonly session: AuthenticatedAdminSession;
      readonly sessionHandle: string;
    }
  | {
      readonly ok: false;
      readonly reason: "forbidden" | "unauthenticated";
    };

export interface AdminAuthorizationInput {
  readonly access:
    | { readonly type: "read" }
    | {
        readonly action: AdminActionAuthorizationRequest;
        readonly csrfToken: string;
        readonly type: "action";
      };
  readonly sessionHandle: string;
}

export type AdminAuthorizationResult =
  | { readonly ok: true; readonly session: AuthenticatedAdminSession }
  | {
      readonly ok: false;
      readonly reason: "forbidden" | "unauthenticated";
    };

export interface AdminLogoutInput {
  readonly csrfToken: string;
  readonly sessionHandle: string;
}

export type AdminLogoutResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "forbidden" | "unauthenticated";
    };

export interface AdminAuthService {
  readonly authorize: (
    input: AdminAuthorizationInput,
  ) => Promise<AdminAuthorizationResult>;
  readonly issueChallenge: (address: Address) => AdminChallenge;
  readonly logout: (input: AdminLogoutInput) => AdminLogoutResult;
  readonly verify: (
    input: AdminVerifyRequest,
  ) => Promise<AdminSessionCreationResult>;
}

const randomSecret = (
  randomBytes: AdminAuthServiceOptions["randomBytes"],
): string => {
  const bytes = randomBytes(SECRET_BYTES);
  if (bytes.byteLength !== SECRET_BYTES) {
    throw new Error("Admin auth random source did not return 32 bytes");
  }
  return Buffer.from(bytes).toString("hex");
};

const csrfForSession = (sessionHandle: string): string =>
  createHash("sha256")
    .update("orbit-admin-auth:presenter-csrf\0", "utf8")
    .update(sessionHandle, "utf8")
    .digest("hex");

const verifiedConsoleRoles = (
  authority: AdminAuthoritySnapshot,
): readonly AdminConsoleRoleId[] => {
  const expected = adminConsoleRoles(authority.capabilities);
  if (
    expected.length !== authority.consoleRoles.length ||
    !expected.every((role) => authority.consoleRoles.includes(role))
  ) {
    return [];
  }
  return expected;
};

const sameStoredSession = (
  left: StoredAdminSession,
  right: StoredAdminSession,
): boolean =>
  left.address === right.address &&
  left.bindingsFingerprint === right.bindingsFingerprint &&
  left.createdAt === right.createdAt &&
  left.deploymentFingerprint === right.deploymentFingerprint &&
  left.expiresAt === right.expiresAt;

const nonceFromMessage = (message: string): string | undefined => {
  try {
    return parseSiweMessage(message).nonce;
  } catch {
    return undefined;
  }
};

export const createAdminAuthService = (
  options: AdminAuthServiceOptions,
): AdminAuthService => {
  const challengeMessage = (input: {
    readonly address: Address;
    readonly expirationTime: Date;
    readonly issuedAt: Date;
    readonly nonce: string;
  }): string =>
    createAdminChallengeMessage({
      ...input,
      appOrigin: options.appOrigin,
      deploymentFingerprint: options.deploymentFingerprint,
    });

  return {
    authorize: async (input) => {
      const now = options.now();
      const stored = options.store.readSession(
        input.sessionHandle,
        now.getTime(),
      );
      if (stored === undefined) {
        return { ok: false, reason: "unauthenticated" };
      }
      if (
        input.access.type === "action" &&
        !options.store.matchesCsrf(
          input.sessionHandle,
          input.access.csrfToken,
          now.getTime(),
        )
      ) {
        return { ok: false, reason: "forbidden" };
      }
      const block = await options.authorityReader.observe();
      const authority = await options.authorityReader.read(
        stored.address,
        block,
      );
      const refreshed = options.store.readSession(
        input.sessionHandle,
        options.now().getTime(),
      );
      if (refreshed === undefined) {
        return { ok: false, reason: "unauthenticated" };
      }
      if (!sameStoredSession(refreshed, stored)) {
        return { ok: false, reason: "unauthenticated" };
      }
      if (authority.bindingsFingerprint !== stored.bindingsFingerprint) {
        options.store.revokeSession(input.sessionHandle, now.getTime());
        return { ok: false, reason: "forbidden" };
      }
      const roles = verifiedConsoleRoles(authority);
      if (roles.length === 0) {
        options.store.revokeSession(input.sessionHandle, now.getTime());
        return { ok: false, reason: "forbidden" };
      }
      if (
        input.access.type === "action" &&
        !roles.includes(requiredAdminRole(input.access.action))
      ) {
        return { ok: false, reason: "forbidden" };
      }
      return {
        ok: true,
        session: {
          address: stored.address,
          capabilities: authority.capabilities,
          chainId: ADMIN_AUTH_CHAIN_ID,
          csrfToken: csrfForSession(input.sessionHandle),
          deploymentFingerprint: stored.deploymentFingerprint,
          expiresAt: new Date(stored.expiresAt).toISOString(),
          issuedAt: new Date(stored.createdAt).toISOString(),
          observedBlock: authority.block,
          roles,
        },
      };
    },
    issueChallenge: (requestedAddress) => {
      const address = getAddress(requestedAddress);
      const nonce = randomSecret(options.randomBytes);
      const issuedAt = options.now();
      const expirationTime = new Date(
        issuedAt.getTime() + options.challengeTtlMilliseconds,
      );
      const message = challengeMessage({
        address,
        expirationTime,
        issuedAt,
        nonce,
      });
      options.store.createChallenge({
        address,
        deploymentFingerprint: options.deploymentFingerprint,
        expiresAt: expirationTime.getTime(),
        issuedAt: issuedAt.getTime(),
        nonce,
      });
      return { expiresAt: expirationTime.toISOString(), message };
    },
    logout: (input) => {
      const now = options.now().getTime();
      if (options.store.readSession(input.sessionHandle, now) === undefined) {
        return { ok: false, reason: "unauthenticated" };
      }
      if (
        !options.store.matchesCsrf(input.sessionHandle, input.csrfToken, now)
      ) {
        return { ok: false, reason: "forbidden" };
      }
      return options.store.revokeSession(input.sessionHandle, now)
        ? { ok: true }
        : { ok: false, reason: "unauthenticated" };
    },
    verify: async (input) => {
      const nonce = nonceFromMessage(input.message);
      if (nonce === undefined) {
        return { ok: false, reason: "unauthenticated" };
      }
      const challenge = options.store.readChallenge(
        nonce,
        options.now().getTime(),
      );
      if (challenge === undefined) {
        return { ok: false, reason: "unauthenticated" };
      }
      const expectedMessage = challengeMessage({
        address: challenge.address,
        expirationTime: new Date(challenge.expiresAt),
        issuedAt: new Date(challenge.issuedAt),
        nonce,
      });
      if (input.message !== expectedMessage) {
        return { ok: false, reason: "unauthenticated" };
      }
      const block = await options.authorityReader.observe();
      const signatureValid = await options.authorityReader.verify({
        address: challenge.address,
        block,
        message: input.message,
        signature: input.signature,
      });
      if (!signatureValid) {
        return { ok: false, reason: "unauthenticated" };
      }
      const authority = await options.authorityReader.read(
        challenge.address,
        block,
      );
      const roles = verifiedConsoleRoles(authority);
      if (roles.length === 0) {
        return options.store.consumeChallenge({
          address: challenge.address,
          nonce,
          now: options.now().getTime(),
        })
          ? { ok: false, reason: "forbidden" }
          : { ok: false, reason: "unauthenticated" };
      }
      const sessionHandle = randomSecret(options.randomBytes);
      const csrfToken = csrfForSession(sessionHandle);
      const issuedAt = options.now();
      const expiresAt = new Date(
        issuedAt.getTime() + options.sessionTtlMilliseconds,
      );
      const created = options.store.consumeChallengeAndCreateSession({
        address: challenge.address,
        bindingsFingerprint: authority.bindingsFingerprint,
        createdAt: issuedAt.getTime(),
        csrfToken,
        expiresAt: expiresAt.getTime(),
        nonce,
        now: issuedAt.getTime(),
        sessionHandle,
      });
      if (!created) return { ok: false, reason: "unauthenticated" };
      return {
        ok: true,
        session: {
          address: challenge.address,
          capabilities: authority.capabilities,
          chainId: ADMIN_AUTH_CHAIN_ID,
          csrfToken,
          deploymentFingerprint: options.deploymentFingerprint,
          expiresAt: expiresAt.toISOString(),
          issuedAt: issuedAt.toISOString(),
          observedBlock: authority.block,
          roles,
        },
        sessionHandle,
      };
    },
  };
};
