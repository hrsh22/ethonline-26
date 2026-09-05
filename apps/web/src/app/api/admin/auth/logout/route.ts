import { ADMIN_AUTH_PATHS } from "@orbit/config/admin-auth";

import {
  forwardAdminLogout,
  requireSameOrigin,
} from "@/lib/admin-api-adapter.server";

export function POST(request: Request): Promise<Response> | Response {
  const originError = requireSameOrigin(request);
  if (originError !== undefined) return originError;
  return forwardAdminLogout(request, ADMIN_AUTH_PATHS.logout);
}
