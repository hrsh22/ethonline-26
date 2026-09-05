import {
  OPERATOR_CONTROL_PATHS,
  decodeOperatorCommandRequest,
} from "@orbit/config/operator-control";

import {
  forwardAdminRequest,
  readAdminJson,
  requireSameOrigin,
} from "@/lib/admin-api-adapter.server";
import { decodeOperatorControlEnvelope } from "@/lib/operator-control-contract";

/** Same-origin relay for operator commands; see the state route for why. */
export async function POST(request: Request): Promise<Response> {
  const originError = requireSameOrigin(request);
  if (originError !== undefined) return originError;
  const body = await readAdminJson(
    request,
    decodeOperatorCommandRequest,
    4_096,
  );
  if (body instanceof Response) return body;
  return forwardAdminRequest(request, {
    body,
    csrf: true,
    decode: decodeOperatorControlEnvelope,
    method: "POST",
    path: OPERATOR_CONTROL_PATHS.command,
    requireSession: true,
  });
}
