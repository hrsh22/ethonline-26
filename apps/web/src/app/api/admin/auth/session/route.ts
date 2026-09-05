import { ADMIN_AUTH_PATHS } from "@orbit/config/admin-auth";

import { forwardAdminRequest } from "@/lib/admin-api-adapter.server";
import { decodeAdminSessionResponse } from "@/lib/admin-session-contract";
import { protocolDeploymentFingerprint } from "@/lib/deployment";

export function GET(request: Request): Promise<Response> {
  return forwardAdminRequest(request, {
    decode: (value) =>
      decodeAdminSessionResponse(value, protocolDeploymentFingerprint),
    method: "GET",
    path: ADMIN_AUTH_PATHS.session,
    requireSession: true,
  });
}
