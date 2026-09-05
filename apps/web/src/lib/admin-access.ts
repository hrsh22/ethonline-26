import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";

import type { CollectorAccessState } from "./collector-access";

export type AdminAccessState =
  | Exclude<CollectorAccessState, "ready">
  | "loading"
  | "read-failed"
  | "unauthorized"
  | "authorized";

export interface AdminCapabilities {
  readonly owner: boolean;
  readonly keeper: boolean;
  readonly liquidityExecutor: boolean;
  readonly guardian: boolean;
  readonly recovery: boolean;
  readonly creator: boolean;
}

interface AdminAccessInput {
  readonly accessState: CollectorAccessState;
  readonly authenticatedRoles?: readonly AdminConsoleRoleId[] | undefined;
  readonly capabilities?: AdminCapabilities | undefined;
  readonly healthError?: Error | null | undefined;
  readonly healthPending?: boolean | undefined;
}

const hasAdminCapability = (capabilities: AdminCapabilities): boolean =>
  capabilities.owner ||
  capabilities.keeper ||
  capabilities.liquidityExecutor ||
  capabilities.guardian ||
  capabilities.recovery ||
  // The creator must be able to reach the console to withdraw accrued fees.
  // Every action is still authorized against its exact capability.
  capabilities.creator;

/**
 * Console roles for capability-scoped rendering. Authenticated session roles
 * are authoritative; observed capabilities are only a pre-session fallback and
 * never widen what the server will authorize.
 */
export const adminConsoleCapabilityRoles = ({
  authenticatedRoles,
  capabilities,
}: Pick<
  AdminAccessInput,
  "authenticatedRoles" | "capabilities"
>): readonly AdminConsoleRoleId[] => {
  if (authenticatedRoles !== undefined) return authenticatedRoles;
  if (capabilities === undefined) return [];
  return [
    ...(capabilities.owner
      ? ([
          "liquid-token-owner",
          "reward-ledger-owner",
          "converter-owner",
          "liquidity-owner",
        ] as const)
      : []),
    ...(capabilities.guardian ? (["guardian"] as const) : []),
    ...(capabilities.recovery ? (["recovery"] as const) : []),
    ...(capabilities.keeper ? (["keeper"] as const) : []),
    ...(capabilities.liquidityExecutor
      ? (["liquidity-executor"] as const)
      : []),
    ...(capabilities.creator ? (["creator"] as const) : []),
  ];
};

export const getAdminAccessState = ({
  accessState,
  authenticatedRoles,
  capabilities,
  healthError,
  healthPending,
}: AdminAccessInput): AdminAccessState => {
  if (accessState !== "ready") return accessState;
  if (healthPending === true) return "loading";
  if (healthError !== undefined && healthError !== null) return "read-failed";
  if (authenticatedRoles !== undefined) {
    return authenticatedRoles.length > 0 ? "authorized" : "unauthorized";
  }
  if (capabilities !== undefined) {
    return hasAdminCapability(capabilities) ? "authorized" : "unauthorized";
  }
  return "loading";
};
