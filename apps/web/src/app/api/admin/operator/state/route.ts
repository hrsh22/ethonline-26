import { OPERATOR_CONTROL_PATHS } from "@orbit/config/operator-control";

import { forwardAdminRequest } from "@/lib/admin-api-adapter.server";
import { decodeOperatorControlEnvelope } from "@/lib/operator-control-contract";

/**
 * Same-origin relay to the public API's operator-control proxy. The admin
 * session cookie is SameSite=Strict on this origin, so a browser call straight
 * to the API origin never carries it: every read came back 401, and the 401
 * handler revoked the session -- signing the operator out for opening the
 * console. Operator control goes through this relay like every other admin
 * call.
 */
export function GET(request: Request): Promise<Response> {
  return forwardAdminRequest(request, {
    decode: decodeOperatorControlEnvelope,
    maximumResponseBytes: 65_536,
    method: "GET",
    path: OPERATOR_CONTROL_PATHS.state,
    requireSession: true,
  });
}
