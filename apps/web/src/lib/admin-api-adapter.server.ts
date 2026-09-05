// A build-time tripwire: importing this module from a "use client" file
// fails the build instead of bundling cookie-parsing and upstream-
// forwarding machinery into the browser on nothing but a filename
// convention.
import "server-only";

import {
  ADMIN_AUTH_COOKIE_NAME,
  ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES,
} from "@orbit/config/admin-auth";
import { ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES } from "@orbit/config/admin-history";

import { publicApiUrl } from "@/lib/public-api";

export const ADMIN_PRIVATE_CACHE_CONTROL = "private, no-store";
export const ADMIN_CSRF_HEADER = "x-csrf-token";
export const ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS = 5_000;
export const ADMIN_JSON_BODY_LIMITS = {
  action: 512,
  challenge: 256,
  verify: ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES,
} as const;
export const ADMIN_UPSTREAM_JSON_LIMITS = {
  authentication: 32_768,
  history: ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES,
} as const;

type AdminErrorCode =
  | "forbidden"
  | "invalid_request"
  | "rate_limited"
  | "session_required"
  | "upstream_unavailable";

interface ForwardAdminOptions<T> {
  readonly body?: unknown;
  readonly copySessionCookie?: boolean;
  readonly csrf?: boolean;
  readonly decode: (value: unknown) => T;
  readonly method: "GET" | "POST";
  readonly maximumResponseBytes?: number;
  readonly path: string;
  readonly requireSession?: boolean;
}

const privateHeaders = (contentType = "application/json; charset=utf-8") => ({
  "cache-control": ADMIN_PRIVATE_CACHE_CONTROL,
  "content-type": contentType,
  vary: "Cookie",
  "x-content-type-options": "nosniff",
});

export const adminErrorResponse = (
  status: number,
  error: AdminErrorCode,
): Response => Response.json({ error }, { headers: privateHeaders(), status });

export const adminJsonResponse = (value: unknown, status = 200): Response =>
  Response.json(value, { headers: privateHeaders(), status });

export const adminNoContentResponse = (): Response =>
  new Response(null, {
    headers: {
      "cache-control": ADMIN_PRIVATE_CACHE_CONTROL,
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
    status: 204,
  });

const fixedUpstreamError = (response: Response): Response => {
  if (
    response.status === 400 ||
    response.status === 413 ||
    response.status === 415
  ) {
    return adminErrorResponse(400, "invalid_request");
  }
  if (response.status === 401) {
    return adminErrorResponse(401, "session_required");
  }
  if (response.status === 403) {
    return adminErrorResponse(403, "forbidden");
  }
  if (response.status === 429) {
    const result = adminErrorResponse(429, "rate_limited");
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null && /^\d{1,6}$/u.test(retryAfter)) {
      result.headers.set("retry-after", retryAfter);
    }
    return result;
  }
  return adminErrorResponse(503, "upstream_unavailable");
};

const sameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
};

export const requireSameOrigin = (request: Request): Response | undefined =>
  sameOrigin(request) ? undefined : adminErrorResponse(403, "forbidden");

const jsonMediaType = (request: Request): boolean =>
  request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";

export const readAdminJson = async <T>(
  request: Request,
  decode: (value: unknown) => T,
  maximumBytes: number,
): Promise<T | Response> => {
  if (!jsonMediaType(request)) {
    return adminErrorResponse(400, "invalid_request");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    return adminErrorResponse(400, "invalid_request");
  }
  try {
    if (request.body === null)
      throw new TypeError("Admin request body is empty");
    const reader = request.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let source = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RangeError("Admin request body is too large");
      }
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode();
    return decode(JSON.parse(source) as unknown);
  } catch {
    return adminErrorResponse(400, "invalid_request");
  }
};

export const readAdminUpstreamJson = async (
  response: Response,
  maximumBytes: number,
): Promise<unknown> => {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      BigInt(declaredLength) > BigInt(maximumBytes))
  ) {
    throw new RangeError("Admin upstream response is too large");
  }
  if (response.body === null) {
    throw new TypeError("Admin upstream response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let source = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new RangeError("Admin upstream response is too large");
    }
    source += decoder.decode(chunk.value, { stream: true });
  }
  source += decoder.decode();
  return JSON.parse(source) as unknown;
};

const sessionHandlePattern = /^[0-9a-f]{64}$/u;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const adminSessionCookie = (
  cookieHeader: string | null,
): string | undefined => {
  if (cookieHeader === null) return undefined;
  const handles: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === ADMIN_AUTH_COOKIE_NAME) handles.push(value);
  }
  const [handle] = handles;
  return handles.length === 1 &&
    handle !== undefined &&
    sessionHandlePattern.test(handle)
    ? `${ADMIN_AUTH_COOKIE_NAME}=${handle}`
    : undefined;
};

const expectedCookie = (request: Request): string | undefined =>
  adminSessionCookie(request.headers.get("cookie"));

interface ParsedSessionCookie {
  readonly expires: string | undefined;
  readonly maximumAge: string | undefined;
  readonly value: string;
}

const uniqueCookieAttributeNames = (attributes: readonly string[]): boolean => {
  const names = new Set<string>();
  for (const attribute of attributes) {
    const name = attribute.split("=", 1)[0]?.trim().toLowerCase();
    if (name === undefined || name.length === 0 || names.has(name)) {
      return false;
    }
    names.add(name);
  }
  return true;
};

const validCookieExpiry = (expires: string | undefined): expires is string =>
  expires !== undefined &&
  !/[\r\n;]/u.test(expires) &&
  Number.isFinite(Date.parse(expires.slice(expires.indexOf("=") + 1)));

const parseSessionCookie = (
  source: string | null,
): ParsedSessionCookie | undefined => {
  if (source === null || /[\r\n]/u.test(source)) return undefined;
  const [pair, ...attributes] = source.split(";").map((part) => part.trim());
  if (pair === undefined) return undefined;
  const separator = pair.indexOf("=");
  if (separator < 1 || pair.slice(0, separator) !== ADMIN_AUTH_COOKIE_NAME) {
    return undefined;
  }
  const value = pair.slice(separator + 1);
  if (!sessionHandlePattern.test(value)) return undefined;
  if (!uniqueCookieAttributeNames(attributes)) return undefined;
  const maximumAge = attributes.find((part) => /^max-age=\d+$/iu.test(part));
  const expires = attributes.find((part) => /^expires=/iu.test(part));
  if (maximumAge === undefined || !validCookieExpiry(expires)) return undefined;
  return {
    expires,
    maximumAge,
    value,
  };
};

const secureRequest = (request: Request): boolean =>
  !loopbackHosts.has(new URL(request.url).hostname);

const upstreamSetCookies = (upstream: Response): readonly string[] => {
  const headers = upstream.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };
  const available = headers.getSetCookie?.();
  if (available !== undefined) return available;
  const fallback = upstream.headers.get("set-cookie");
  if (fallback === null) return [];
  if (/[,]\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=/u.test(fallback)) return [];
  return [fallback];
};

const sessionCookie = (
  upstream: Response,
  request: Request,
): string | undefined => {
  const sources = upstreamSetCookies(upstream);
  if (sources.length !== 1) return undefined;
  const parsed = parseSessionCookie(sources[0] ?? null);
  if (parsed === undefined) return undefined;

  const output = [
    `${ADMIN_AUTH_COOKIE_NAME}=${parsed.value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (parsed.maximumAge !== undefined) output.push(parsed.maximumAge);
  if (parsed.expires !== undefined) output.push(parsed.expires);
  if (secureRequest(request)) output.push("Secure");
  return output.join("; ");
};

export const clearedAdminCookie = (request: Request): string => {
  return [
    `${ADMIN_AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ...(secureRequest(request) ? ["Secure"] : []),
  ].join("; ");
};

const withClearedCookie = (response: Response, request: Request): Response => {
  response.headers.set("set-cookie", clearedAdminCookie(request));
  return response;
};

export const forwardAdminLogout = async (
  request: Request,
  path: string,
): Promise<Response> => {
  const cookie = expectedCookie(request);
  const csrfToken = request.headers.get(ADMIN_CSRF_HEADER);
  if (cookie === undefined) {
    return withClearedCookie(
      adminErrorResponse(401, "session_required"),
      request,
    );
  }
  if (csrfToken === null || csrfToken.length < 16 || csrfToken.length > 512) {
    return withClearedCookie(adminErrorResponse(403, "forbidden"), request);
  }
  const headers = new Headers({
    accept: "application/json",
    cookie,
    origin: request.headers.get("origin") ?? "",
    [ADMIN_CSRF_HEADER]: csrfToken,
  });
  let upstream: Response;
  try {
    upstream = await fetch(
      new Request(publicApiUrl(path), {
        cache: "no-store",
        headers,
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS),
        ]),
      }),
    );
  } catch {
    return withClearedCookie(
      adminErrorResponse(503, "upstream_unavailable"),
      request,
    );
  }
  if (!upstream.ok) {
    return withClearedCookie(fixedUpstreamError(upstream), request);
  }
  if (upstream.status !== 204) {
    return withClearedCookie(
      adminErrorResponse(503, "upstream_unavailable"),
      request,
    );
  }
  return withClearedCookie(adminNoContentResponse(), request);
};

const historyParameters = new Set([
  "cursor",
  "fromBlock",
  "limit",
  "order",
  "toBlock",
]);
const unsignedHistoryParameters = new Set(["fromBlock", "limit", "toBlock"]);

const validHistoryParameter = (name: string, value: string): boolean => {
  if (unsignedHistoryParameters.has(name)) {
    return /^(?:0|[1-9][0-9]*)$/u.test(value);
  }
  if (name === "order") return value === "asc" || value === "desc";
  if (name === "cursor") return value.length > 0 && value.length <= 4_096;
  return false;
};

const validHistorySearch = (url: URL): boolean => {
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams) {
    if (
      !historyParameters.has(name) ||
      seen.has(name) ||
      !validHistoryParameter(name, value)
    ) {
      return false;
    }
    seen.add(name);
  }
  return true;
};

export const adminHistoryPath = (
  request: Request,
  path: string,
  paged: boolean,
): string | Response => {
  const url = new URL(request.url);
  if (url.href.length > 8_192) {
    return adminErrorResponse(400, "invalid_request");
  }
  if (!paged && url.searchParams.size !== 0) {
    return adminErrorResponse(400, "invalid_request");
  }
  if (!validHistorySearch(url)) {
    return adminErrorResponse(400, "invalid_request");
  }
  return path + url.search;
};

const forwardSessionCookie = (
  request: Request,
  required: boolean,
): string | Response | undefined => {
  if (!required) return undefined;
  return expectedCookie(request) ?? adminErrorResponse(401, "session_required");
};

const forwardCsrfToken = (
  request: Request,
  required: boolean,
): string | Response | undefined => {
  if (!required) return undefined;
  const token = request.headers.get(ADMIN_CSRF_HEADER);
  return token !== null && token.length >= 16 && token.length <= 512
    ? token
    : adminErrorResponse(403, "forbidden");
};

const forwardHeaders = <T>(
  request: Request,
  options: ForwardAdminOptions<T>,
): Headers | Response => {
  const cookie = forwardSessionCookie(request, options.requireSession === true);
  if (cookie instanceof Response) return cookie;
  const csrfToken = forwardCsrfToken(request, options.csrf === true);
  if (csrfToken instanceof Response) return csrfToken;
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const origin = request.headers.get("origin");
  if (origin !== null) headers.set("origin", origin);
  if (cookie !== undefined) headers.set("cookie", cookie);
  if (csrfToken !== undefined) {
    headers.set(ADMIN_CSRF_HEADER, csrfToken);
  }
  return headers;
};

const fetchAdminUpstream = async <T>(
  request: Request,
  headers: Headers,
  options: ForwardAdminOptions<T>,
): Promise<Response | undefined> => {
  try {
    return await fetch(
      new Request(publicApiUrl(options.path), {
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        cache: "no-store",
        headers,
        method: options.method,
        redirect: "error",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS),
        ]),
      }),
    );
  } catch {
    return undefined;
  }
};

const decodedAdminResponse = async <T>(
  upstream: Response,
  request: Request,
  options: ForwardAdminOptions<T>,
): Promise<Response> => {
  let decoded: T;
  try {
    decoded = options.decode(
      await readAdminUpstreamJson(
        upstream,
        options.maximumResponseBytes ??
          ADMIN_UPSTREAM_JSON_LIMITS.authentication,
      ),
    );
  } catch {
    return adminErrorResponse(503, "upstream_unavailable");
  }
  const response = adminJsonResponse(decoded, upstream.status);
  if (options.copySessionCookie !== true) return response;
  const cookieValue = sessionCookie(upstream, request);
  if (cookieValue === undefined) {
    return adminErrorResponse(503, "upstream_unavailable");
  }
  response.headers.set("set-cookie", cookieValue);
  return response;
};

export const forwardAdminRequest = async <T>(
  request: Request,
  options: ForwardAdminOptions<T>,
): Promise<Response> => {
  const headers = forwardHeaders(request, options);
  if (headers instanceof Response) return headers;
  const upstream = await fetchAdminUpstream(request, headers, options);
  if (upstream === undefined) {
    return adminErrorResponse(503, "upstream_unavailable");
  }
  if (!upstream.ok) return fixedUpstreamError(upstream);
  if (upstream.status !== 200) {
    return adminErrorResponse(503, "upstream_unavailable");
  }
  return decodedAdminResponse(upstream, request, options);
};
