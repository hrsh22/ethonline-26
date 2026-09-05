import {
  ADMIN_AUTH_PATHS,
  decodeAdminVerifyRequest,
} from "@orbit/config/admin-auth";

import {
  ADMIN_JSON_BODY_LIMITS,
  forwardAdminRequest,
  readAdminJson,
  requireSameOrigin,
} from "@/lib/admin-api-adapter.server";
import { decodeAdminSessionResponse } from "@/lib/admin-session-contract";
import { protocolDeploymentFingerprint } from "@/lib/deployment";

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError !== undefined) return originError;
  const body = await readAdminJson(
    request,
    decodeAdminVerifyRequest,
    ADMIN_JSON_BODY_LIMITS.verify,
  );
  if (body instanceof Response) return body;
  return forwardAdminRequest(request, {
    body,
    copySessionCookie: true,
    decode: (value) =>
      decodeAdminSessionResponse(value, protocolDeploymentFingerprint),
    method: "POST",
    path: ADMIN_AUTH_PATHS.verify,
  });
}
