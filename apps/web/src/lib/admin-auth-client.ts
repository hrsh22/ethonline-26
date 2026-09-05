import type {
  AdminActionAuthorizationRequest,
  AdminChallengeRequest,
  AdminVerifyRequest,
} from "@orbit/config/admin-auth";

import {
  decodeAdminAuthorizationResponse,
  decodeAdminChallengeResponse,
  decodeAdminSessionResponse,
  type AdminSessionDTO,
} from "@/lib/admin-session-contract";
import { protocolDeploymentFingerprint } from "@/lib/deployment";

const adminBrowserPaths = {
  actionAuthorization: "/api/admin/actions/authorize",
  challenge: "/api/admin/auth/challenge",
  logout: "/api/admin/auth/logout",
  session: "/api/admin/auth/session",
  verify: "/api/admin/auth/verify",
} as const;

type AdminClientErrorCode =
  | "forbidden"
  | "invalid_request"
  | "rate_limited"
  | "session_required"
  | "upstream_unavailable";

export class AdminClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: AdminClientErrorCode,
  ) {
    super(
      status === 403
        ? "This wallet does not have current admin access"
        : "Admin authentication is unavailable",
    );
    this.name = "AdminClientError";
  }
}

const responseError = async (response: Response): Promise<AdminClientError> => {
  let code: AdminClientErrorCode = "upstream_unavailable";
  try {
    const value = (await response.json()) as { readonly error?: unknown };
    if (
      value.error === "forbidden" ||
      value.error === "invalid_request" ||
      value.error === "rate_limited" ||
      value.error === "session_required" ||
      value.error === "upstream_unavailable"
    ) {
      code = value.error;
    }
  } catch {
    // The browser receives one fixed local error even if an intermediary failed.
  }
  return new AdminClientError(response.status, code);
};

const post = async (
  path: string,
  body: unknown,
  fetcher: typeof fetch,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> => {
  let response: Response;
  try {
    response = await fetcher(path, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...additionalHeaders },
      method: "POST",
    });
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
  if (!response.ok) throw await responseError(response);
  return response;
};

export const authorizeAdminAction = async (
  action: AdminActionAuthorizationRequest,
  csrfToken: string,
  fetcher: typeof fetch = fetch,
) => {
  const response = await post(
    adminBrowserPaths.actionAuthorization,
    action,
    fetcher,
    { "x-csrf-token": csrfToken },
  );
  try {
    return decodeAdminAuthorizationResponse(await response.json(), action)
      .authorization;
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
};

export const requestAdminChallenge = async (
  address: AdminChallengeRequest["address"],
  fetcher: typeof fetch = fetch,
): Promise<ReturnType<typeof decodeAdminChallengeResponse>["challenge"]> => {
  const response = await post(
    adminBrowserPaths.challenge,
    { address },
    fetcher,
  );
  try {
    return decodeAdminChallengeResponse(await response.json()).challenge;
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
};

export const verifyAdminSignature = async (
  input: AdminVerifyRequest,
  fetcher: typeof fetch = fetch,
): Promise<AdminSessionDTO> => {
  const response = await post(adminBrowserPaths.verify, input, fetcher);
  try {
    return decodeAdminSessionResponse(
      await response.json(),
      protocolDeploymentFingerprint,
    ).session;
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
};

export const readAdminSession = async (
  fetcher: typeof fetch = fetch,
): Promise<AdminSessionDTO> => {
  let response: Response;
  try {
    response = await fetcher(adminBrowserPaths.session, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method: "GET",
    });
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
  if (!response.ok) throw await responseError(response);
  try {
    return decodeAdminSessionResponse(
      await response.json(),
      protocolDeploymentFingerprint,
    ).session;
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
};

export const logoutAdminSession = async (
  csrfToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetcher(adminBrowserPaths.logout, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
      method: "POST",
    });
  } catch {
    throw new AdminClientError(503, "upstream_unavailable");
  }
  if (response.status === 204 || response.status === 401) return;
  throw await responseError(response);
};
