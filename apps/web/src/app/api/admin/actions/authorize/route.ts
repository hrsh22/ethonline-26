import {
  ADMIN_AUTH_PATHS,
  decodeAdminActionAuthorizationRequest,
} from "@orbit/config/admin-auth";

import {
  ADMIN_JSON_BODY_LIMITS,
  forwardAdminRequest,
  readAdminJson,
  requireSameOrigin,
} from "@/lib/admin-api-adapter.server";
import { decodeAdminAuthorizationResponse } from "@/lib/admin-session-contract";

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError !== undefined) return originError;
  const body = await readAdminJson(
    request,
    decodeAdminActionAuthorizationRequest,
    ADMIN_JSON_BODY_LIMITS.action,
  );
  if (body instanceof Response) return body;
  return forwardAdminRequest(request, {
    body,
    csrf: true,
    decode: (value) => decodeAdminAuthorizationResponse(value, body),
    method: "POST",
    path: ADMIN_AUTH_PATHS.actionAuthorization,
    requireSession: true,
  });
}
