// A build-time tripwire: importing this module from a "use client" file
// fails the build instead of bundling cookie-parsing and upstream-
// forwarding machinery into the browser on nothing but a filename
// convention.
import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_AUTH_PATHS } from "@orbit/config/admin-auth";

import {
  ADMIN_UPSTREAM_JSON_LIMITS,
  ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS,
  adminSessionCookie,
  readAdminUpstreamJson,
} from "@/lib/admin-api-adapter.server";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
import { publicApiUrl } from "@/lib/public-api";
import {
  decodeAdminSessionResponse,
  safeAdminReturnPath,
  type AdminSessionDTO,
} from "@/lib/admin-session-contract";

const readAdminSession = cache(
  async (): Promise<AdminSessionDTO | undefined> => {
    const cookie = adminSessionCookie((await headers()).get("cookie"));
    if (cookie === undefined) return undefined;
    let response: Response;
    try {
      response = await fetch(
        new Request(publicApiUrl(ADMIN_AUTH_PATHS.session), {
          cache: "no-store",
          headers: {
            accept: "application/json",
            cookie,
          },
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS),
        }),
      );
    } catch {
      return undefined;
    }
    if (response.status !== 200) return undefined;
    try {
      return decodeAdminSessionResponse(
        await readAdminUpstreamJson(
          response,
          ADMIN_UPSTREAM_JSON_LIMITS.authentication,
        ),
        protocolDeploymentFingerprint,
      ).session;
    } catch {
      return undefined;
    }
  },
);

export const requireAdminSession = async (
  returnPath: string,
): Promise<AdminSessionDTO> => {
  const session = await readAdminSession();
  if (session === undefined) {
    const next = encodeURIComponent(safeAdminReturnPath(returnPath));
    redirect(`/admin/sign-in?next=${next}`);
  }
  return session;
};
