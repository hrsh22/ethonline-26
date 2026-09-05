import {
  getAddress,
  isAddress,
  isHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { createSiweMessage } from "viem/siwe";

export const ADMIN_AUTH_CHAIN_ID = 84_532;
export const ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS = 60_000;
export const ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS = 600_000;
// Browser clocks may trail the API clock slightly; larger future-issued values fail closed.
export const ADMIN_AUTH_CHALLENGE_CLOCK_SKEW_MILLISECONDS = 30_000;
export const ADMIN_AUTH_CHALLENGE_STATEMENT =
  "Authorize access to the Orbit administrator console.";
export const ADMIN_AUTH_COOKIE_NAME = "orbit_admin_session";
export const ADMIN_AUTH_SIGN_IN_PATH = "/admin/sign-in";
export const ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES = 20_480;

export const adminAuthDeploymentResource = (
  deploymentFingerprint: Hex,
): string => `urn:orbit:deployment:${deploymentFingerprint.slice(2)}`;

export const normalizeAdminAppOrigin = (value: string): string => {
  const message =
    "Admin app origin must be an exact HTTPS domain or localhost/127.0.0.1 HTTP origin";
  try {
    const origin = new URL(value);
    const local =
      origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
    const production =
      origin.protocol === "https:" && origin.hostname.includes(".");
    if (
      origin.origin !== value ||
      origin.username.length !== 0 ||
      origin.password.length !== 0 ||
      (!production && !(local && origin.protocol === "http:"))
    ) {
      throw new Error(message);
    }
    createSiweMessage({
      address: "0x0000000000000000000000000000000000000001",
      chainId: ADMIN_AUTH_CHAIN_ID,
      domain: origin.host,
      expirationTime: new Date("2030-01-01T00:01:00.000Z"),
      issuedAt: new Date("2030-01-01T00:00:00.000Z"),
      nonce: "00000000",
      scheme: origin.protocol.slice(0, -1),
      uri: new URL(ADMIN_AUTH_SIGN_IN_PATH, origin).toString(),
      version: "1",
    });
    return origin.origin;
  } catch {
    throw new Error(message);
  }
};

export const createAdminChallengeMessage = (input: {
  readonly address: Address;
  readonly appOrigin: string;
  readonly deploymentFingerprint: Hex;
  readonly expirationTime: Date;
  readonly issuedAt: Date;
  readonly nonce: string;
}): string => {
  const origin = new URL(normalizeAdminAppOrigin(input.appOrigin));
  return createSiweMessage({
    address: input.address,
    chainId: ADMIN_AUTH_CHAIN_ID,
    domain: origin.host,
    expirationTime: input.expirationTime,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    requestId: input.deploymentFingerprint,
    resources: [adminAuthDeploymentResource(input.deploymentFingerprint)],
    scheme: origin.protocol.slice(0, -1),
    statement: ADMIN_AUTH_CHALLENGE_STATEMENT,
    uri: new URL(ADMIN_AUTH_SIGN_IN_PATH, origin).toString(),
    version: "1",
  });
};

import {
  OPERATOR_COMMANDS,
  type OperatorCommandName,
} from "./operator-control.js";

export const ADMIN_AUTH_PATHS = {
  actionAuthorization: "/v1/admin/actions/authorize",
  challenge: "/v1/admin/auth/challenge",
  logout: "/v1/admin/auth/logout",
  session: "/v1/admin/auth/session",
  verify: "/v1/admin/auth/verify",
} as const;

export const ADMIN_DIAGNOSTIC_PATHS = {
  keeperAttempts: "/v1/admin/diagnostics/keeper-attempts",
  operations: "/v1/admin/diagnostics/operations",
} as const;

export type AdminConsoleRoleId =
  | "liquid-token-owner"
  | "reward-ledger-owner"
  | "converter-owner"
  | "liquidity-owner"
  | "guardian"
  | "recovery"
  | "keeper"
  | "liquidity-executor"
  | "creator";

export interface AdminCapabilityFlags {
  readonly owners: {
    readonly liquidToken: boolean;
    readonly rewards: boolean;
    readonly converter: boolean;
    readonly liquidity: boolean;
  };
  readonly guardian: boolean;
  readonly recovery: boolean;
  readonly keeper: boolean;
  readonly liquidityExecutor: boolean;
  readonly creator: boolean;
}

/* Every console role, as a runtime list.
 *
 * The record shape is what makes it safe: `Record<AdminConsoleRoleId, true>`
 * refuses to compile if a role is missing. The web app kept its own hand-built
 * `Set` of these ids and that set omitted "creator", so every authority
 * holding the creator role had its session rejected as invalid and could not
 * sign into the console at all. A `readonly AdminConsoleRoleId[]` annotation
 * would not have caught it: it checks that each member is a role, not that
 * every role is a member. */
const adminConsoleRoleIdKeys = {
  "liquid-token-owner": true,
  "reward-ledger-owner": true,
  "converter-owner": true,
  "liquidity-owner": true,
  guardian: true,
  recovery: true,
  keeper: true,
  "liquidity-executor": true,
  creator: true,
} as const satisfies Readonly<Record<AdminConsoleRoleId, true>>;

export const ADMIN_CONSOLE_ROLE_IDS: readonly AdminConsoleRoleId[] =
  Object.keys(adminConsoleRoleIdKeys) as readonly AdminConsoleRoleId[];

export const adminConsoleRoles = (
  capabilities: AdminCapabilityFlags,
): AdminConsoleRoleId[] => [
  ...(capabilities.owners.liquidToken ? (["liquid-token-owner"] as const) : []),
  ...(capabilities.owners.rewards ? (["reward-ledger-owner"] as const) : []),
  ...(capabilities.owners.converter ? (["converter-owner"] as const) : []),
  ...(capabilities.owners.liquidity ? (["liquidity-owner"] as const) : []),
  ...(capabilities.guardian ? (["guardian"] as const) : []),
  ...(capabilities.recovery ? (["recovery"] as const) : []),
  ...(capabilities.keeper ? (["keeper"] as const) : []),
  ...(capabilities.liquidityExecutor ? (["liquidity-executor"] as const) : []),
  ...(capabilities.creator ? (["creator"] as const) : []),
];

export interface AdminChallengeRequest {
  readonly address: Address;
}

export interface AdminVerifyRequest {
  readonly message: string;
  readonly signature: `0x${string}`;
}

export type AdminActionAuthorizationRequest =
  | {
      readonly type:
        | "open-reward-epoch"
        | "execute-track"
        | "retry-track"
        | "execute-pol"
        | "withdraw-creator-fees"
        | "set-claim-policy";
    }
  | {
      readonly type: "set-pause";
      readonly module: "liquidToken" | "rewards" | "converter" | "liquidity";
    }
  | {
      /** A control-plane command, authorized as the appointed executor. */
      readonly type: "operator-command";
      readonly command: OperatorCommandName;
    };

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const hasExactKeys = (
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected].sort().every((key, index) => actual[index] === key)
  );
};

export const decodeAdminChallengeRequest = (
  value: unknown,
): AdminChallengeRequest => {
  const input = record(value, "Admin challenge request");
  if (
    !hasExactKeys(input, ["address"]) ||
    typeof input.address !== "string" ||
    !isAddress(input.address)
  ) {
    throw new TypeError(
      "Admin challenge request must contain one valid address",
    );
  }
  const address = getAddress(input.address);
  if (address === zeroAddress) {
    throw new TypeError("Admin challenge address must not be zero");
  }
  return { address };
};

export const decodeAdminVerifyRequest = (
  value: unknown,
): AdminVerifyRequest => {
  const input = record(value, "Admin verification request");
  if (
    !hasExactKeys(input, ["message", "signature"]) ||
    typeof input.message !== "string" ||
    input.message.length === 0 ||
    input.message.length > 8_192 ||
    typeof input.signature !== "string" ||
    !isHex(input.signature) ||
    input.signature.length < 4 ||
    input.signature.length > 8_194
  ) {
    throw new TypeError(
      "Admin verification request must contain one message and hex signature",
    );
  }
  return {
    message: input.message,
    signature: input.signature,
  };
};

const simpleAdminActions = new Set([
  "open-reward-epoch",
  "execute-track",
  "retry-track",
  "execute-pol",
  "withdraw-creator-fees",
  "set-claim-policy",
]);
const pauseModules = new Set([
  "liquidToken",
  "rewards",
  "converter",
  "liquidity",
]);

const decodeOperatorCommandAction = (
  input: Readonly<Record<string, unknown>>,
): AdminActionAuthorizationRequest | undefined =>
  hasExactKeys(input, ["command", "type"]) &&
  input.type === "operator-command" &&
  typeof input.command === "string" &&
  (OPERATOR_COMMANDS as readonly string[]).includes(input.command)
    ? {
        command: input.command as OperatorCommandName,
        type: "operator-command",
      }
    : undefined;

export const decodeAdminActionAuthorizationRequest = (
  value: unknown,
): AdminActionAuthorizationRequest => {
  const input = record(value, "Admin action authorization request");
  if (
    hasExactKeys(input, ["type"]) &&
    typeof input.type === "string" &&
    simpleAdminActions.has(input.type)
  ) {
    return {
      type: input.type as Exclude<
        AdminActionAuthorizationRequest["type"],
        "operator-command" | "set-pause"
      >,
    };
  }
  const operatorCommand = decodeOperatorCommandAction(input);
  if (operatorCommand !== undefined) return operatorCommand;
  if (
    hasExactKeys(input, ["module", "type"]) &&
    input.type === "set-pause" &&
    typeof input.module === "string" &&
    pauseModules.has(input.module)
  ) {
    return {
      module: input.module as Extract<
        AdminActionAuthorizationRequest,
        { readonly type: "set-pause" }
      >["module"],
      type: "set-pause",
    };
  }
  throw new TypeError("Admin action authorization request is invalid");
};

export const requiredAdminRole = (
  action: AdminActionAuthorizationRequest,
): AdminConsoleRoleId => {
  if (action.type === "operator-command") return "keeper";
  if (action.type !== "set-pause") {
    if (action.type === "execute-pol") return "liquidity-executor";
    // Creator-fee withdrawal is destination-only onchain; it must not inherit
    // any unrelated operator capability.
    if (action.type === "withdraw-creator-fees") return "creator";
    // Historical configurable deployments used the liquid-token owner as their
    // policy administrator. New deployments are always-allow, so this branch is
    // retained only to operate and inspect an older manifest; preparation still
    // requires its recorded administrator and the legacy gate enforces onlyOwner.
    if (action.type === "set-claim-policy") return "liquid-token-owner";
    return "keeper";
  }
  const roles = {
    liquidToken: "liquid-token-owner",
    rewards: "reward-ledger-owner",
    converter: "converter-owner",
    liquidity: "liquidity-owner",
  } as const satisfies Readonly<
    Record<
      Extract<
        AdminActionAuthorizationRequest,
        { readonly type: "set-pause" }
      >["module"],
      AdminConsoleRoleId
    >
  >;
  return roles[action.module];
};
