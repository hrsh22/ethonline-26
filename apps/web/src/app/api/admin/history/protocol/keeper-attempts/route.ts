import { ADMIN_DIAGNOSTIC_PATHS } from "@orbit/config/admin-auth";
import { decodeAdminKeeperAttemptsHistoryResponse } from "@orbit/config/admin-history";

import {
  ADMIN_UPSTREAM_JSON_LIMITS,
  adminHistoryPath,
  forwardAdminRequest,
} from "@/lib/admin-api-adapter.server";
import { protocolDeploymentFingerprint } from "@/lib/deployment";

export function GET(request: Request): Promise<Response> | Response {
  const path = adminHistoryPath(
    request,
    ADMIN_DIAGNOSTIC_PATHS.keeperAttempts,
    false,
  );
  if (path instanceof Response) return path;
  return forwardAdminRequest(request, {
    decode: (value) => {
      if (protocolDeploymentFingerprint === undefined) {
        throw new TypeError("Admin history deployment is not configured");
      }
      return decodeAdminKeeperAttemptsHistoryResponse(
        value,
        protocolDeploymentFingerprint,
      );
    },
    maximumResponseBytes: ADMIN_UPSTREAM_JSON_LIMITS.history,
    method: "GET",
    path,
    requireSession: true,
  });
}
