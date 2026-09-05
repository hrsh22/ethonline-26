import type { AdminActionAuthorizationRequest } from "@orbit/config/admin-auth";
import type { ProtocolAction } from "@orbit/protocol/transactions";

export class AdminActionAuthorizationDeniedError extends Error {
  override readonly name = "AdminActionAuthorizationDeniedError";

  constructor(readonly action: AdminActionAuthorizationRequest) {
    super("This operator is not authorized for that action.");
  }
}

export const adminAuthorizationAction = (
  action: ProtocolAction,
): AdminActionAuthorizationRequest => {
  if (action.type === "set-pause") {
    return { module: action.module, type: "set-pause" };
  }
  if (
    action.type === "open-reward-epoch" ||
    action.type === "execute-track" ||
    action.type === "retry-track" ||
    action.type === "execute-pol" ||
    action.type === "withdraw-creator-fees" ||
    action.type === "set-claim-policy"
  ) {
    return { type: action.type };
  }
  throw new TypeError(
    "This protocol action is not exposed in the admin console",
  );
};
