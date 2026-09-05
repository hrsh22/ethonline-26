import {
  ADMIN_AUTH_PATHS,
  decodeAdminChallengeRequest,
} from "@orbit/config/admin-auth";

import {
  ADMIN_JSON_BODY_LIMITS,
  forwardAdminRequest,
  readAdminJson,
  requireSameOrigin,
} from "@/lib/admin-api-adapter.server";
import { decodeAdminChallengeResponse } from "@/lib/admin-session-contract";

export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError !== undefined) return originError;
  const body = await readAdminJson(
    request,
    decodeAdminChallengeRequest,
    ADMIN_JSON_BODY_LIMITS.challenge,
  );
  if (body instanceof Response) return body;
  return forwardAdminRequest(request, {
    body,
    decode: decodeAdminChallengeResponse,
    method: "POST",
    path: ADMIN_AUTH_PATHS.challenge,
  });
}
