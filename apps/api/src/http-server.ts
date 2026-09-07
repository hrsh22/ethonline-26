import type { RewardFundingService } from "./graph-analytics.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { isIP, type AddressInfo } from "node:net";

import { Data, Effect, Scope } from "effect";
import { getAddress, zeroAddress } from "viem";

import {
  ADMIN_AUTH_PATHS,
  ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES,
  ADMIN_DIAGNOSTIC_PATHS,
  decodeAdminActionAuthorizationRequest,
  requiredAdminRole,
  decodeAdminChallengeRequest,
  decodeAdminVerifyRequest,
} from "@orbit/config/admin-auth";
import {
  ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES,
  decodeAdminHistoryResponse,
} from "@orbit/config/admin-history";
import {
  decodeOperatorCommandRequest,
  OPERATOR_CONTROL_PATHS,
  type OperatorCommandRequest,
} from "@orbit/config/operator-control";
import {
  decodeDeliveryStatus,
  decodePublicFundingRequest,
  PUBLIC_API_PATHS,
} from "@orbit/config/public-api";
import {
  decodeTestnetFundingResponse,
  type TestnetFundingErrorCode,
  type TestnetFundingResponse,
  type TestnetFundingServiceState,
} from "@orbit/config/testnet-funding";

import type {
  AdminAuthorizationInput,
  AdminAuthService,
  AuthenticatedAdminSession,
} from "./admin-auth.js";
import {
  clearAdminSessionCookie,
  readAdminSessionHandle,
  serializeAdminSessionCookie,
} from "./admin-session-cookie.js";
import type { PublicApiConfiguration } from "./configuration.js";
import {
  createRequestRateLimiter,
  type RequestRateLimiter,
} from "./rate-limiter.js";

export class PublicApiHttpError extends Data.TaggedError("PublicApiHttpError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface RunningPublicApiServer {
  readonly url: string;
}

export interface PublicApiRateLimiters {
  readonly adminChallenge: RequestRateLimiter;
  readonly adminProtected: RequestRateLimiter;
  readonly adminSession: RequestRateLimiter;
  readonly adminVerify: RequestRateLimiter;
  readonly public: RequestRateLimiter;
}

export interface PublicApiServerOptions {
  readonly rewardFunding?: RewardFundingService;
  readonly adminAuth?: AdminAuthService;
  readonly configuration: PublicApiConfiguration;
  readonly fetcher?: typeof fetch;
  readonly nowMilliseconds?: () => number;
  readonly rateLimiters?: PublicApiRateLimiters;
}

type Upstream = "funding" | "history" | "delivery";
type QueryPolicy = "funding-status" | "history-page" | "none";

interface PublicRoute {
  readonly method: "GET" | "POST";
  readonly queryPolicy: QueryPolicy;
  readonly upstream: Upstream;
  readonly upstreamPath: string;
}

const publicRoutes: ReadonlyMap<string, PublicRoute> = new Map([
  [
    PUBLIC_API_PATHS.delivery.status,
    {
      method: "GET",
      queryPolicy: "none",
      upstream: "delivery",
      upstreamPath: "/v1/delivery-status",
    },
  ],
  [
    PUBLIC_API_PATHS.history.status,
    {
      method: "GET",
      queryPolicy: "none",
      upstream: "history",
      upstreamPath: "/v1/status",
    },
  ],
  [
    PUBLIC_API_PATHS.history.marketSwaps,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/market/swaps",
    },
  ],
  [
    PUBLIC_API_PATHS.history.marketCandles,
    {
      method: "GET",
      queryPolicy: "none",
      upstream: "history",
      upstreamPath: "/v1/market/candles",
    },
  ],
  [
    PUBLIC_API_PATHS.history.marketFees,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/market/fees",
    },
  ],
  [
    PUBLIC_API_PATHS.history.protocolLiquidity,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/protocol/liquidity-cycles",
    },
  ],
  [
    PUBLIC_API_PATHS.history.discoveries,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/protocol/discoveries",
    },
  ],
  [
    PUBLIC_API_PATHS.history.permanentCommitments,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/protocol/permanent-commitments",
    },
  ],
  [
    PUBLIC_API_PATHS.history.rewards,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/protocol/rewards",
    },
  ],
  [
    PUBLIC_API_PATHS.funding.status,
    {
      method: "GET",
      queryPolicy: "funding-status",
      upstream: "funding",
      upstreamPath: "/v1/status",
    },
  ],
  [
    PUBLIC_API_PATHS.funding.challenge,
    {
      method: "GET",
      // The challenge is recipient-scoped, so it reuses the same narrow
      // recipient-only query allowlist as funding status.
      queryPolicy: "funding-status",
      upstream: "funding",
      upstreamPath: "/v1/challenge",
    },
  ],
  [
    PUBLIC_API_PATHS.funding.fund,
    {
      method: "POST",
      queryPolicy: "none",
      upstream: "funding",
      upstreamPath: "/v1/fund",
    },
  ],
]);

const adminDiagnosticRoutes: ReadonlyMap<string, PublicRoute> = new Map([
  [
    ADMIN_DIAGNOSTIC_PATHS.operations,
    {
      method: "GET",
      queryPolicy: "history-page",
      upstream: "history",
      upstreamPath: "/v1/protocol/operations",
    },
  ],
  [
    ADMIN_DIAGNOSTIC_PATHS.keeperAttempts,
    {
      method: "GET",
      queryPolicy: "none",
      upstream: "history",
      upstreamPath: "/v1/protocol/keeper-attempts",
    },
  ],
]);

const HISTORY_QUERY_PARAMETERS = new Set([
  "account",
  "cursor",
  "fromBlock",
  "limit",
  "order",
  "toBlock",
]);
const MAXIMUM_REQUEST_URL_LENGTH = 8_192;
const PUBLIC_FUNDING_RESPONSE_BODY_LIMIT_BYTES = 16_384;
/**
 * The largest indexed-history page is bounded by the worker's page size;
 * this leaves generous headroom. History previously had no byte bound at
 * all -- the one upstream whose responses the API forwards verbatim.
 */
const PUBLIC_HISTORY_RESPONSE_BODY_LIMIT_BYTES = 1_048_576;

/** Control-plane state with a 20-entry audit trail fits well inside this. */
const OPERATOR_CONTROL_RESPONSE_BODY_LIMIT_BYTES = 65_536;
const API_VERSION = 1;

class PublicRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface CorsPolicy {
  readonly origin: string | undefined;
}

interface PreparedUpstreamRequest {
  readonly body?: string;
  readonly route: PublicRoute;
  readonly search: string;
}

const securityHeaders = (cors: CorsPolicy): Record<string, string> => ({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  ...(cors.origin === undefined
    ? {}
    : {
        "access-control-allow-origin": cors.origin,
        vary: "Origin",
      }),
});

const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
  cors: CorsPolicy,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void => {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    ...securityHeaders(cors),
    ...additionalHeaders,
    "content-length": Buffer.byteLength(serialized),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(serialized);
};

const error = (
  response: ServerResponse,
  cors: CorsPolicy,
  status: number,
  code: string,
  message: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void =>
  json(
    response,
    status,
    { apiVersion: API_VERSION, error: { code, message } },
    cors,
    additionalHeaders,
  );

const adminSecurityHeaders = (
  request: IncomingMessage,
  cors: CorsPolicy,
): Record<string, string> => ({
  ...securityHeaders(cors),
  "cache-control": "private, no-store",
  vary: request.headers.origin === undefined ? "Cookie" : "Cookie, Origin",
});

const adminJson = (
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  cors: CorsPolicy,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void => {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    ...adminSecurityHeaders(request, cors),
    ...additionalHeaders,
    "content-length": Buffer.byteLength(serialized),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(serialized);
};

const adminNoContent = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void => {
  response.writeHead(204, {
    ...adminSecurityHeaders(request, cors),
    ...additionalHeaders,
  });
  response.end();
};

const adminError = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  status: number,
  code: string,
  message: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void =>
  adminJson(
    request,
    response,
    status,
    { apiVersion: API_VERSION, error: { code, message } },
    cors,
    additionalHeaders,
  );

const adminAuthorizationError = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  reason: "forbidden" | "unauthenticated",
): void => {
  if (reason === "unauthenticated") {
    adminError(
      request,
      response,
      cors,
      401,
      "admin-session-required",
      "An authenticated admin session is required",
    );
    return;
  }
  adminError(
    request,
    response,
    cors,
    403,
    "admin-forbidden",
    "The authenticated principal is not authorized",
  );
};

const adminUnavailable = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
): void =>
  adminError(
    request,
    response,
    cors,
    503,
    "admin-authority-unavailable",
    "Admin authority is unavailable",
  );

const safeAdminSession = (session: AuthenticatedAdminSession) => ({
  address: session.address,
  chainId: session.chainId,
  csrfToken: session.csrfToken,
  deploymentFingerprint: session.deploymentFingerprint,
  expiresAt: session.expiresAt,
  issuedAt: session.issuedAt,
  observedBlock: {
    hash: session.observedBlock.hash,
    number: session.observedBlock.number.toString(),
  },
  roles: session.roles,
});

const requestUrl = (request: IncomingMessage): URL => {
  const encoded = request.url ?? "/";
  if (encoded.length > MAXIMUM_REQUEST_URL_LENGTH) {
    throw new PublicRequestError(
      414,
      "request-url-too-long",
      "Request URL is too long",
    );
  }
  // A backslash is an authority delimiter for special schemes in WHATWG URL
  // parsing: "/\\a/v1/..." parses to pathname "/v1/...", so the raw target and
  // the routed path could disagree about whether a request was an admin one --
  // its errors then rendered with the public error shape, missing the private
  // cache headers every admin response must carry.
  if (
    !encoded.startsWith("/") ||
    encoded.startsWith("//") ||
    encoded.includes("\\")
  ) {
    throw new PublicRequestError(
      400,
      "invalid-request-target",
      "Request target must be an origin-form path",
    );
  }
  return new URL(encoded, "http://localhost");
};

const corsPolicy = (
  request: IncomingMessage,
  configuration: PublicApiConfiguration,
): CorsPolicy => {
  const origin = request.headers.origin;
  if (origin === undefined) return { origin: undefined };
  if (!configuration.allowedOrigins.has(origin)) {
    throw new PublicRequestError(
      403,
      "origin-not-allowed",
      "Request origin is not allowed",
    );
  }
  return { origin };
};

const ensureOnlyParameters = (url: URL, allowed: ReadonlySet<string>): void => {
  const seen = new Set<string>();
  for (const name of url.searchParams.keys()) {
    if (!allowed.has(name) || seen.has(name)) {
      throw new PublicRequestError(
        400,
        "invalid-query",
        `Query parameter ${name} is not supported or is repeated`,
      );
    }
    seen.add(name);
  }
};

const validateUnsigned = (value: string, name: string): void => {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new PublicRequestError(
      400,
      "invalid-query",
      `${name} must be an unsigned integer`,
    );
  }
};

const validateDiscoveryAccount = (url: URL) => {
  const account = url.searchParams.get("account");
  if (
    account !== null &&
    (url.pathname !== PUBLIC_API_PATHS.history.discoveries ||
      !/^0x[0-9a-fA-F]{40}$/.test(account))
  )
    throw new PublicRequestError(
      400,
      "invalid-query",
      "Invalid discovery account",
    );
};
const historySearch = (url: URL): string => {
  ensureOnlyParameters(url, HISTORY_QUERY_PARAMETERS);
  validateDiscoveryAccount(url);
  for (const name of ["fromBlock", "toBlock", "limit"] as const) {
    const value = url.searchParams.get(name);
    if (value !== null) validateUnsigned(value, name);
  }
  const order = url.searchParams.get("order");
  if (order !== null && order !== "asc" && order !== "desc") {
    throw new PublicRequestError(
      400,
      "invalid-query",
      "order must be asc or desc",
    );
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && (cursor.length === 0 || cursor.length > 4_096)) {
    throw new PublicRequestError(
      400,
      "invalid-query",
      "cursor has an invalid length",
    );
  }
  return url.search;
};

const fundingStatusSearch = (url: URL): string => {
  ensureOnlyParameters(url, new Set(["recipient"]));
  const value = url.searchParams.get("recipient");
  if (value === null) return "";
  let recipient: ReturnType<typeof getAddress>;
  try {
    recipient = getAddress(value);
  } catch {
    throw new PublicRequestError(
      400,
      "funding-invalid-request",
      "A valid nonzero wallet address is required",
    );
  }
  if (recipient === zeroAddress) {
    throw new PublicRequestError(
      400,
      "funding-invalid-request",
      "A valid nonzero wallet address is required",
    );
  }
  const search = new URLSearchParams({ recipient });
  return `?${search.toString()}`;
};

const emptySearch = (url: URL): string => {
  if (url.searchParams.size !== 0) {
    throw new PublicRequestError(
      400,
      "invalid-query",
      "This route accepts no query parameters",
    );
  }
  return "";
};

const searchFor = (url: URL, policy: QueryPolicy): string => {
  if (policy === "history-page") return historySearch(url);
  if (policy === "funding-status") return fundingStatusSearch(url);
  return emptySearch(url);
};

const readBody = (
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    request.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > maximumBytes) {
        exceeded = true;
        chunks.length = 0;
        // Reject immediately and stop reading: draining the rest politely
        // held the socket for up to the full request timeout per connection
        // while the sender streamed bytes that were being discarded. Pausing
        // (rather than destroying) lets the 413 reach the sender; Node then
        // tears the connection down itself because the body was never
        // consumed.
        reject(
          new PublicRequestError(
            413,
            "request-body-too-large",
            "Request body is too large",
          ),
        );
        request.pause();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceeded) {
        reject(
          new PublicRequestError(
            413,
            "request-body-too-large",
            "Request body is too large",
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          new PublicRequestError(
            400,
            "invalid-json",
            "Request body must be valid JSON",
          ),
        );
      }
    });
    request.on("error", reject);
  });

const fundingBody = async (
  request: IncomingMessage,
  maximumBytes: number,
): Promise<string> => {
  const mediaType = request.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new PublicRequestError(
      415,
      "unsupported-media-type",
      "Content-Type must be application/json",
    );
  }
  const body = await readBody(request, maximumBytes);
  try {
    // `source` is deliberately dropped -- it is a browser-side analytics field
    // the worker must never trust. The proof is the wallet-control signature
    // the worker verifies, so it must survive the hop: forwarding only the
    // recipient made the worker reject every request with
    // `funding-proof-required`, which the error projection then masked as
    // generic unavailability.
    const { proof, recipient } = decodePublicFundingRequest(body);
    return JSON.stringify({ proof, recipient });
  } catch {
    throw new PublicRequestError(
      400,
      "funding-invalid-request",
      "Funding request is invalid",
    );
  }
};

const adminBody = async <Value>(
  request: IncomingMessage,
  maximumBytes: number,
  decode: (value: unknown) => Value,
): Promise<Value> => {
  const mediaType = request.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new PublicRequestError(
      415,
      "admin-invalid-request",
      "Admin request content must be JSON",
    );
  }
  const body = await readBody(request, maximumBytes);
  try {
    return decode(body);
  } catch {
    throw new PublicRequestError(
      400,
      "admin-invalid-request",
      "Admin request is invalid",
    );
  }
};

const prepareUpstreamRequest = async (
  request: IncomingMessage,
  url: URL,
  route: PublicRoute,
  configuration: PublicApiConfiguration,
): Promise<PreparedUpstreamRequest> => ({
  route,
  search: searchFor(url, route.queryPolicy),
  ...(route.method === "POST"
    ? {
        body: await fundingBody(request, configuration.maximumRequestBodyBytes),
      }
    : {}),
});

const upstreamConfiguration = (
  configuration: PublicApiConfiguration,
  upstream: Upstream,
): { readonly token: string; readonly url: URL } => {
  if (upstream === "delivery") {
    if (configuration.operatorControl === undefined)
      throw new Error("Delivery evidence is unavailable");
    return configuration.operatorControl;
  }
  return upstream === "history"
    ? {
        token: configuration.historyReadApiToken,
        url: configuration.historyServiceUrl,
      }
    : {
        token: configuration.fundingApiToken,
        url: configuration.fundingServiceUrl,
      };
};

const upstreamUrl = (
  configuration: PublicApiConfiguration,
  prepared: PreparedUpstreamRequest,
): { readonly token: string; readonly url: URL } => {
  const selected = upstreamConfiguration(
    configuration,
    prepared.route.upstream,
  );
  const url = new URL(selected.url);
  url.pathname = prepared.route.upstreamPath;
  url.search = prepared.search;
  return { token: selected.token, url };
};

const upstreamJson = async (
  prepared: PreparedUpstreamRequest,
  options: PublicApiServerOptions,
  maximumResponseBytes?: number,
): Promise<{
  readonly body: unknown;
  readonly retryAfter?: string;
  readonly status: number;
}> => {
  const selected = upstreamUrl(options.configuration, prepared);
  const response = await (options.fetcher ?? fetch)(selected.url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${selected.token}`,
      ...(prepared.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    method: prepared.route.method,
    redirect: "error",
    signal: AbortSignal.timeout(
      options.configuration.upstreamTimeoutMilliseconds,
    ),
    ...(prepared.body === undefined ? {} : { body: prepared.body }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Upstream returned a non-JSON response");
  }
  const retryAfter = response.headers.get("retry-after");
  return {
    body:
      maximumResponseBytes === undefined
        ? await response.json()
        : await boundedResponseJson(response, maximumResponseBytes),
    status: response.status,
    ...(retryAfter !== null && /^[0-9]{1,10}$/u.test(retryAfter)
      ? { retryAfter }
      : {}),
  };
};

const boundedResponseJson = async (
  response: Response,
  maximumBytes: number,
): Promise<unknown> => {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) ||
      BigInt(contentLength) > BigInt(maximumBytes))
  ) {
    throw new Error("Upstream response exceeded its byte limit");
  }
  if (response.body === null) {
    throw new Error("Upstream returned an empty JSON response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("Upstream response exceeded its byte limit");
    }
    chunks.push(result.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const requestedFundingRecipient = (
  prepared: PreparedUpstreamRequest,
): ReturnType<typeof getAddress> | undefined => {
  if (prepared.route.method === "GET") {
    const value = new URLSearchParams(prepared.search).get("recipient");
    if (value === null) return undefined;
    return getAddress(value);
  }
  const body = JSON.parse(prepared.body ?? "null") as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    !("recipient" in body) ||
    typeof body.recipient !== "string"
  ) {
    throw new Error("Funding request lost its recipient binding");
  }
  return getAddress(body.recipient);
};

const projectFundingService = (service: TestnetFundingResponse["service"]) =>
  service === undefined
    ? undefined
    : {
        chainId: service.chainId,
        ...(service.cooldownSeconds === undefined
          ? {}
          : { cooldownSeconds: service.cooldownSeconds }),
        state: service.halted ? "disabled" : service.state,
        ...(service.limits === undefined
          ? {}
          : {
              limits: {
                ...(service.limits.lifetime === undefined
                  ? {}
                  : {
                      lifetime: {
                        ethWei: service.limits.lifetime.ethWei,
                        wethWei: service.limits.lifetime.wethWei,
                      },
                    }),
                dailyBudget: {
                  ethWei: service.limits.dailyBudget.ethWei,
                  wethWei: service.limits.dailyBudget.wethWei,
                },
                dailyGrantLimit: service.limits.dailyGrantLimit,
                clientWindowSeconds: service.limits.clientWindowSeconds,
                clientWindowLimit: service.limits.clientWindowLimit,
              },
            }),
        ...(service.targets === undefined
          ? {}
          : {
              targets: {
                ethWei: service.targets.ethWei,
                wethWei: service.targets.wethWei,
              },
            }),
      };

const projectFundingRecipient = (
  recipient: TestnetFundingResponse["recipient"],
) =>
  recipient === undefined
    ? undefined
    : {
        address: recipient.address,
        ...(recipient.balances === undefined
          ? {}
          : {
              balances: {
                ethWei: recipient.balances.ethWei,
                wethWei: recipient.balances.wethWei,
              },
            }),
        ...(recipient.nextEligibleAt === undefined
          ? {}
          : { nextEligibleAt: recipient.nextEligibleAt }),
        ...(recipient.remaining === undefined
          ? {}
          : {
              remaining: {
                ethWei: recipient.remaining.ethWei,
                wethWei: recipient.remaining.wethWei,
              },
            }),
        // Distinguishes "the grant confirmed" from "the wallet kept it"; the
        // browser cannot tell those apart from balances alone.
        ...(recipient.retainedTargets === undefined
          ? {}
          : { retainedTargets: recipient.retainedTargets }),
        state: recipient.state,
      };

/**
 * Error codes a collector can act on, forwarded verbatim; everything else is
 * masked as generic unavailability so worker internals never reach the
 * browser. The proof codes are about the caller's own signature -- expired,
 * replayed, malformed, or missing -- so masking them turned "sign a fresh
 * challenge" into "the faucet is down". `funding-rpc-unavailable` already has
 * a dedicated browser state that was unreachable while it was masked.
 */
const COLLECTOR_FUNDING_ERROR_CODES: ReadonlySet<TestnetFundingErrorCode> =
  new Set([
    "funding-busy",
    "funding-confirming",
    "funding-disabled",
    "funding-inventory-empty",
    "funding-lifetime-limit",
    "funding-proof-expired",
    "funding-proof-invalid",
    "funding-proof-replayed",
    "funding-proof-required",
    "funding-rate-limited",
    "funding-rpc-unavailable",
    "funding-unavailable",
  ]);

const projectFundingError = (error: TestnetFundingResponse["error"]) => {
  if (error === undefined) return undefined;
  const code = COLLECTOR_FUNDING_ERROR_CODES.has(error.code)
    ? error.code
    : "funding-unavailable";
  return {
    code,
    ...(code === "funding-rate-limited" && error.nextEligibleAt !== undefined
      ? { nextEligibleAt: error.nextEligibleAt }
      : {}),
  };
};

const projectFundingProgress = (decoded: TestnetFundingResponse) => ({
  ...(decoded.observedAt === undefined
    ? {}
    : { observedAt: decoded.observedAt }),
  ...(decoded.request === undefined || decoded.recipient === undefined
    ? {}
    : {
        request: {
          id: decoded.request.id,
          state: decoded.request.state,
          ...(decoded.request.delayed === undefined
            ? {}
            : { delayed: decoded.request.delayed }),
          ...(decoded.request.transactions === undefined
            ? {}
            : {
                transactions: decoded.request.transactions.map(
                  ({ kind, hash, state }) => ({
                    kind,
                    state,
                    ...(state === "prepared" || hash === undefined
                      ? {}
                      : { hash }),
                  }),
                ),
              }),
        },
      }),
});

const projectFundingStatus = (
  prepared: PreparedUpstreamRequest,
  body: unknown,
): unknown => {
  const decoded = decodeTestnetFundingResponse(body);
  const expectedRecipient = requestedFundingRecipient(prepared);
  const service = projectFundingService(decoded.service);
  if (expectedRecipient === undefined) {
    if (service === undefined) {
      throw new Error("Funding status response omitted its service result");
    }
    return { apiVersion: API_VERSION, service };
  }
  const recipient = projectFundingRecipient(decoded.recipient);
  if (
    recipient !== undefined &&
    getAddress(recipient.address) !== expectedRecipient
  ) {
    throw new Error("Funding response recipient did not match the request");
  }
  const fundingError = projectFundingError(decoded.error);
  if (recipient === undefined && fundingError === undefined) {
    throw new Error("Funding status response omitted its recipient result");
  }
  return {
    apiVersion: API_VERSION,
    ...projectFundingProgress(decoded),
    ...(service === undefined ? {} : { service }),
    ...(recipient === undefined ? {} : { recipient }),
    ...(fundingError === undefined ? {} : { error: fundingError }),
  };
};

const projectFundingResult = (
  prepared: PreparedUpstreamRequest,
  body: unknown,
): unknown => {
  const decoded = decodeTestnetFundingResponse(body);
  const expectedRecipient = requestedFundingRecipient(prepared);
  if (expectedRecipient === undefined) {
    throw new Error("Funding request lost its recipient binding");
  }
  const recipient = projectFundingRecipient(decoded.recipient);
  if (
    recipient !== undefined &&
    getAddress(recipient.address) !== expectedRecipient
  ) {
    throw new Error("Funding response recipient did not match the request");
  }
  const fundingError = projectFundingError(decoded.error);
  if (recipient === undefined && fundingError === undefined) {
    throw new Error("Funding response omitted its collector result");
  }
  return {
    apiVersion: API_VERSION,
    ...projectFundingProgress(decoded),
    ...(recipient === undefined ? {} : { recipient }),
    ...(fundingError === undefined ? {} : { error: fundingError }),
  };
};

const publicResponseBodyLimit = (route: PublicRoute): number =>
  route.upstream !== "history"
    ? PUBLIC_FUNDING_RESPONSE_BODY_LIMIT_BYTES
    : PUBLIC_HISTORY_RESPONSE_BODY_LIMIT_BYTES;

/**
 * A successful challenge response carries only the challenge to sign; it has
 * no recipient or error result. Routing it through the collector-result
 * projection rejected every successful upstream response as malformed, so the
 * browser could never obtain a challenge at all.
 */
const projectFundingChallenge = (
  prepared: PreparedUpstreamRequest,
  body: unknown,
): unknown => {
  const decoded = decodeTestnetFundingResponse(body);
  if (decoded.challenge !== undefined) {
    if (requestedFundingRecipient(prepared) === undefined) {
      throw new Error("Funding challenge request lost its recipient binding");
    }
    return { apiVersion: API_VERSION, challenge: decoded.challenge };
  }
  const fundingError = projectFundingError(decoded.error);
  if (fundingError === undefined) {
    throw new Error("Funding challenge response omitted its result");
  }
  return { apiVersion: API_VERSION, error: fundingError };
};

const projectPublicResponse = (
  prepared: PreparedUpstreamRequest,
  body: unknown,
): unknown => {
  if (prepared.route.upstream === "delivery") return decodeDeliveryStatus(body);
  if (prepared.route.upstream !== "funding") return body;
  if (prepared.route.upstreamPath === "/v1/challenge") {
    return projectFundingChallenge(prepared, body);
  }
  return prepared.route.upstreamPath === "/v1/status"
    ? projectFundingStatus(prepared, body)
    : projectFundingResult(prepared, body);
};

const proxy = async (
  response: ServerResponse,
  cors: CorsPolicy,
  prepared: PreparedUpstreamRequest,
  options: PublicApiServerOptions,
): Promise<void> => {
  try {
    const upstream = await upstreamJson(
      prepared,
      options,
      publicResponseBodyLimit(prepared.route),
    );
    // A non-200 history response is an internal condition -- the API validates
    // queries itself before proxying, so an upstream 400 means an internal
    // mismatch and an upstream 401 means the read credential rotated out of
    // step. Forwarding those bodies verbatim advertised credential failures
    // and index internals to the public.
    if (prepared.route.upstream !== "funding" && upstream.status !== 200) {
      throw new Error("History upstream returned a non-success status");
    }
    const body = projectPublicResponse(prepared, upstream.body);
    json(
      response,
      upstream.status,
      body,
      cors,
      upstream.retryAfter === undefined
        ? {}
        : { "retry-after": upstream.retryAfter },
    );
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    error(
      response,
      cors,
      timedOut ? 504 : 502,
      timedOut ? "upstream-timeout" : "upstream-unavailable",
      timedOut
        ? "The backend dependency did not respond in time"
        : "The backend dependency is unavailable",
    );
  }
};

const adminProxy = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  prepared: PreparedUpstreamRequest,
  options: PublicApiServerOptions,
  session: AuthenticatedAdminSession,
  path: string,
): Promise<void> => {
  try {
    const upstream = await upstreamJson(
      prepared,
      options,
      ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES,
    );
    if (upstream.status !== 200) {
      adminUnavailable(request, response, cors);
      return;
    }
    const body = decodeAdminHistoryResponse(
      path,
      upstream.body,
      session.deploymentFingerprint,
    );
    const currentSession = await authorizeAdminRead(
      request,
      response,
      cors,
      options,
    );
    if (currentSession === undefined) return;
    adminJson(
      request,
      response,
      200,
      body,
      cors,
      upstream.retryAfter === undefined
        ? {}
        : { "retry-after": upstream.retryAfter },
    );
  } catch {
    adminUnavailable(request, response, cors);
  }
};

const authorizeAdminRead = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  options: PublicApiServerOptions,
): Promise<AuthenticatedAdminSession | undefined> => {
  const sessionHandle = readAdminSessionHandle(request.headers.cookie);
  if (sessionHandle === undefined) {
    adminAuthorizationError(request, response, cors, "unauthenticated");
    return undefined;
  }
  if (options.adminAuth === undefined) {
    adminUnavailable(request, response, cors);
    return undefined;
  }
  try {
    const authorization = await options.adminAuth.authorize({
      access: { type: "read" },
      sessionHandle,
    });
    if (!authorization.ok) {
      adminAuthorizationError(request, response, cors, authorization.reason);
      return undefined;
    }
    return authorization.session;
  } catch {
    adminUnavailable(request, response, cors);
    return undefined;
  }
};

const forwardedClient = (request: IncomingMessage): string | undefined => {
  const value = request.headers["x-forwarded-for"];
  const candidate = (Array.isArray(value) ? value[0] : value)
    ?.split(",")[0]
    ?.trim();
  return candidate !== undefined && isIP(candidate) !== 0
    ? candidate
    : undefined;
};

const remoteClient = (
  request: IncomingMessage,
  trustProxy: boolean,
): string => {
  const remote = request.socket.remoteAddress ?? "unknown";
  if (
    !trustProxy ||
    (remote !== "127.0.0.1" &&
      remote !== "::1" &&
      remote !== "::ffff:127.0.0.1")
  ) {
    return remote;
  }
  return forwardedClient(request) ?? remote;
};

const applyRateLimit = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  options: PublicApiServerOptions,
  limiter: RequestRateLimiter,
  client: string,
  adminRequest: boolean,
): boolean => {
  const decision = limiter.consume(
    client,
    (options.nowMilliseconds ?? Date.now)(),
  );
  if (decision.allowed) return true;
  const headers = { "retry-after": String(decision.retryAfterSeconds) };
  if (adminRequest) {
    adminError(
      request,
      response,
      cors,
      429,
      "admin-rate-limit-exceeded",
      "Too many requests",
      headers,
    );
  } else {
    error(
      response,
      cors,
      429,
      "rate-limit-exceeded",
      "Too many requests",
      headers,
    );
  }
  return false;
};

const protectedAdminPaths = new Set<string>([
  ADMIN_AUTH_PATHS.actionAuthorization,
  ADMIN_AUTH_PATHS.logout,
  ADMIN_DIAGNOSTIC_PATHS.keeperAttempts,
  ADMIN_DIAGNOSTIC_PATHS.operations,
  // Omitting these dropped authenticated operator-control traffic into the
  // anonymous challenge bucket, sharing a budget with exactly the floods the
  // bucket split exists to keep away from authenticated operators.
  OPERATOR_CONTROL_PATHS.command,
  OPERATOR_CONTROL_PATHS.state,
]);

const rateLimiterFor = (
  request: IncomingMessage,
  url: URL,
  options: PublicApiServerOptions,
  limiters: PublicApiRateLimiters,
): {
  readonly adminRequest: boolean;
  readonly client: string;
  readonly limiter: RequestRateLimiter;
} => {
  const client = remoteClient(request, options.configuration.trustProxy);
  if (!isAdminPath(url.pathname)) {
    return { adminRequest: false, client, limiter: limiters.public };
  }
  if (url.pathname === ADMIN_AUTH_PATHS.verify) {
    return { adminRequest: true, client, limiter: limiters.adminVerify };
  }
  const sessionHandle = readAdminSessionHandle(request.headers.cookie);
  if (
    sessionHandle !== undefined &&
    url.pathname === ADMIN_AUTH_PATHS.session
  ) {
    return { adminRequest: true, client, limiter: limiters.adminSession };
  }
  if (sessionHandle !== undefined && protectedAdminPaths.has(url.pathname)) {
    return { adminRequest: true, client, limiter: limiters.adminProtected };
  }
  return { adminRequest: true, client, limiter: limiters.adminChallenge };
};

const dependencyReadiness = async (
  options: PublicApiServerOptions,
  upstream: Upstream,
  path: string,
): Promise<boolean> => {
  const selected = upstreamConfiguration(options.configuration, upstream);
  const url = new URL(selected.url);
  url.pathname = path;
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${selected.token}`,
      },
      signal: AbortSignal.timeout(
        options.configuration.upstreamTimeoutMilliseconds,
      ),
    });
    return response.ok;
  } catch {
    return false;
  }
};

type FundingDependencyState = TestnetFundingServiceState | "unavailable";

const fundingStateFrom = (
  response: TestnetFundingResponse,
): FundingDependencyState => {
  const service = response.service;
  if (service === undefined) return "unavailable";
  if (service.state !== "ready") return service.state;
  const { inventory, targets } = service;
  if (
    inventory === undefined ||
    inventory.state !== "available" ||
    targets === undefined
  ) {
    return "unavailable";
  }
  const targetWethWei = BigInt(targets.wethWei);
  const targetEthWei = BigInt(targets.ethWei);
  return targetWethWei > 0n &&
    targetEthWei > 0n &&
    BigInt(inventory.wethWei) >= targetWethWei &&
    BigInt(inventory.ethWei) >= targetEthWei
    ? "ready"
    : "unavailable";
};

const fundingDependencyReadiness = async (
  options: PublicApiServerOptions,
): Promise<FundingDependencyState> => {
  const selected = upstreamConfiguration(options.configuration, "funding");
  const url = new URL(selected.url);
  url.pathname = "/v1/status";
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${selected.token}`,
      },
      signal: AbortSignal.timeout(
        options.configuration.upstreamTimeoutMilliseconds,
      ),
    });
    if (!response.ok) return "unavailable";
    return fundingStateFrom(
      decodeTestnetFundingResponse(await response.json()),
    );
  } catch {
    return "unavailable";
  }
};

const readiness = async (
  response: ServerResponse,
  cors: CorsPolicy,
  options: PublicApiServerOptions,
): Promise<void> => {
  const [history, funding] = await Promise.all([
    dependencyReadiness(options, "history", "/readyz"),
    fundingDependencyReadiness(options),
  ]);
  const ready = history && funding === "ready";
  json(
    response,
    ready ? 200 : 503,
    {
      apiVersion: API_VERSION,
      dependencies: {
        funding,
        history: history ? "ready" : "unavailable",
      },
      state: ready ? "ready" : "unavailable",
    },
    cors,
  );
};

const preflight = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
): void => {
  if (cors.origin === undefined) {
    throw new PublicRequestError(
      403,
      "origin-required",
      "Preflight requires an allowed origin",
    );
  }
  const route =
    url.pathname === PUBLIC_API_PATHS.analytics.rewardFunding
      ? { method: "GET" }
      : publicRoutes.get(url.pathname);
  const requestedMethod = request.headers["access-control-request-method"];
  const requestedHeaders =
    request.headers["access-control-request-headers"]?.toLowerCase();
  if (
    route === undefined ||
    requestedMethod !== route.method ||
    (requestedHeaders !== undefined && requestedHeaders !== "content-type")
  ) {
    throw new PublicRequestError(
      403,
      "preflight-rejected",
      "Preflight request is not allowed",
    );
  }
  response.writeHead(204, {
    ...securityHeaders(cors),
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": route.method,
    "access-control-max-age": "600",
  });
  response.end();
};

const isAdminPath = (pathname: string): boolean =>
  pathname === "/v1/admin" || pathname.startsWith("/v1/admin/");

const isAdminRequestTarget = (request: IncomingMessage): boolean => {
  const encoded = request.url ?? "/";
  const queryStart = encoded.indexOf("?");
  const fragmentStart = encoded.indexOf("#");
  const pathEnd = [queryStart, fragmentStart]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), encoded.length);
  return isAdminPath(encoded.slice(0, pathEnd));
};

const requireAdminOrigin = (
  request: IncomingMessage,
  configuration: PublicApiConfiguration,
): void => {
  if (request.headers.origin !== configuration.adminAuth.appOrigin) {
    throw new PublicRequestError(
      403,
      "admin-forbidden",
      "The authenticated principal is not authorized",
    );
  }
};

const requireAdminMethod = (
  request: IncomingMessage,
  method: "GET" | "POST",
): void => {
  if (request.method !== method) {
    throw new PublicRequestError(
      405,
      "method-not-allowed",
      "Method not allowed",
    );
  }
};

const singleRequestHeader = (
  value: string | readonly string[] | undefined,
): string => (typeof value === "string" ? value : "");

const dispatchAdminChallenge = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  requireAdminMethod(request, "POST");
  requireAdminOrigin(request, options.configuration);
  emptySearch(url);
  if (options.adminAuth === undefined) {
    adminUnavailable(request, response, cors);
    return;
  }
  const input = await adminBody(
    request,
    options.configuration.maximumRequestBodyBytes,
    decodeAdminChallengeRequest,
  );
  try {
    const challenge = options.adminAuth.issueChallenge(input.address);
    adminJson(
      request,
      response,
      200,
      { apiVersion: API_VERSION, challenge },
      cors,
    );
  } catch {
    adminUnavailable(request, response, cors);
  }
};

const dispatchAdminVerify = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  requireAdminMethod(request, "POST");
  requireAdminOrigin(request, options.configuration);
  emptySearch(url);
  if (options.adminAuth === undefined) {
    adminUnavailable(request, response, cors);
    return;
  }
  const input = await adminBody(
    request,
    ADMIN_VERIFY_REQUEST_BODY_LIMIT_BYTES,
    decodeAdminVerifyRequest,
  );
  try {
    const verification = await options.adminAuth.verify(input);
    if (!verification.ok) {
      adminAuthorizationError(request, response, cors, verification.reason);
      return;
    }
    const sessionCookie = serializeAdminSessionCookie({
      appOrigin: options.configuration.adminAuth.appOrigin,
      expiresAt: new Date(verification.session.expiresAt),
      handle: verification.sessionHandle,
      issuedAt: new Date(verification.session.issuedAt),
    });
    adminJson(
      request,
      response,
      200,
      {
        apiVersion: API_VERSION,
        session: safeAdminSession(verification.session),
      },
      cors,
      { "set-cookie": sessionCookie },
    );
  } catch {
    adminUnavailable(request, response, cors);
  }
};

const dispatchAdminSession = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  requireAdminMethod(request, "GET");
  emptySearch(url);
  const session = await authorizeAdminRead(request, response, cors, options);
  if (session === undefined) return;
  adminJson(
    request,
    response,
    200,
    { apiVersion: API_VERSION, session: safeAdminSession(session) },
    cors,
  );
};

const dispatchAdminActionAuthorization = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  requireAdminMethod(request, "POST");
  requireAdminOrigin(request, options.configuration);
  emptySearch(url);
  const sessionHandle = readAdminSessionHandle(request.headers.cookie);
  if (sessionHandle === undefined) {
    adminAuthorizationError(request, response, cors, "unauthenticated");
    return;
  }
  if (options.adminAuth === undefined) {
    adminUnavailable(request, response, cors);
    return;
  }
  const action = await adminBody(
    request,
    options.configuration.maximumRequestBodyBytes,
    decodeAdminActionAuthorizationRequest,
  );
  try {
    const authorization = await options.adminAuth.authorize({
      access: {
        action,
        csrfToken: singleRequestHeader(request.headers["x-csrf-token"]),
        type: "action",
      },
      sessionHandle,
    });
    if (!authorization.ok) {
      adminAuthorizationError(request, response, cors, authorization.reason);
      return;
    }
    adminJson(
      request,
      response,
      200,
      {
        apiVersion: API_VERSION,
        authorization: {
          action,
          authorized: true,
          observedBlock: {
            hash: authorization.session.observedBlock.hash,
            number: authorization.session.observedBlock.number.toString(),
          },
        },
      },
      cors,
    );
  } catch {
    adminUnavailable(request, response, cors);
  }
};

/**
 * Proxies the control plane after this API's own session, role, and CSRF
 * checks. The authenticated actor and role travel as headers the control plane
 * trusts; it never derives them from the request body.
 */
const forwardOperatorControl = async (
  options: PublicApiServerOptions,
  control: { readonly token: string; readonly url: URL },
  input: {
    readonly actor: string;
    readonly payload: OperatorCommandRequest | undefined;
    readonly role: string;
  },
): Promise<{ readonly body: unknown; readonly status: number }> => {
  const mutation = input.payload !== undefined;
  const target = new URL(control.url);
  target.pathname = mutation ? "/v1/command" : "/v1/state";
  const upstream = await (options.fetcher ?? fetch)(target, {
    ...(mutation ? { body: JSON.stringify(input.payload) } : {}),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${control.token}`,
      // The control plane trusts these because this proxy verified them.
      "x-operator-actor": input.actor,
      "x-operator-role": input.role,
      ...(mutation ? { "content-type": "application/json" } : {}),
    },
    method: mutation ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(
      options.configuration.upstreamTimeoutMilliseconds,
    ),
  });
  return {
    body: operatorControlEnvelope(upstream, await upstreamBody(upstream)),
    status: upstream.status,
  };
};

/**
 * The control plane is trusted infrastructure, not a trusted response: its
 * body is byte-bounded, must be JSON, and lands *under* the envelope so an
 * upstream `apiVersion` cannot override the contract field the client
 * negotiates on. Every other upstream already got this treatment.
 */
const upstreamBody = (upstream: Response): Promise<unknown> => {
  const mediaType = upstream.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error("Operator control returned a non-JSON response");
  }
  return boundedResponseJson(
    upstream,
    OPERATOR_CONTROL_RESPONSE_BODY_LIMIT_BYTES,
  );
};

const operatorControlEnvelope = (
  upstream: Response,
  body: unknown,
): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Operator control returned a non-object response");
  }
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.apiVersion;
  return { ...rest, apiVersion: API_VERSION };
};

/** Undefined when the path is not a control-plane route. */
const operatorControlMutation = (url: URL): boolean | undefined => {
  if (url.pathname === OPERATOR_CONTROL_PATHS.command) return true;
  return url.pathname === OPERATOR_CONTROL_PATHS.state ? false : undefined;
};

const operatorControlAccess = (
  request: IncomingMessage,
  payload: OperatorCommandRequest | undefined,
): AdminAuthorizationInput["access"] =>
  payload === undefined
    ? { type: "read" }
    : {
        action: { command: payload.command, type: "operator-command" },
        csrfToken: singleRequestHeader(request.headers["x-csrf-token"]),
        type: "action",
      };

/**
 * The shape checks the control plane applies before it reads a session.
 *
 * The origin guard is a CSRF control, so it belongs on the command and not on
 * the read. A browser sends no Origin on a same-origin GET, so requiring one
 * on the state read rejected every read the console made -- and the console
 * treats a 403 as a dead session, so opening the operations panel signed the
 * operator out. Every other admin read (session, history) already omits it.
 */
const requireOperatorControlRequest = (
  request: IncomingMessage,
  url: URL,
  options: PublicApiServerOptions,
  mutation: boolean,
): void => {
  requireAdminMethod(request, mutation ? "POST" : "GET");
  if (mutation) requireAdminOrigin(request, options.configuration);
  emptySearch(url);
};

const dispatchOperatorControl = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
  mutation: boolean,
): Promise<void> => {
  requireOperatorControlRequest(request, url, options, mutation);
  const sessionHandle = readAdminSessionHandle(request.headers.cookie);
  if (sessionHandle === undefined) {
    adminAuthorizationError(request, response, cors, "unauthenticated");
    return;
  }
  const control = options.configuration.operatorControl;
  if (options.adminAuth === undefined || control === undefined) {
    adminUnavailable(request, response, cors);
    return;
  }
  const payload: OperatorCommandRequest | undefined = mutation
    ? await adminBody(
        request,
        options.configuration.maximumRequestBodyBytes,
        decodeOperatorCommandRequest,
      )
    : undefined;
  try {
    const authorization = await options.adminAuth.authorize({
      access: operatorControlAccess(request, payload),
      sessionHandle,
    });
    if (!authorization.ok) {
      adminAuthorizationError(request, response, cors, authorization.reason);
      return;
    }
    const upstream = await forwardOperatorControl(options, control, {
      actor: authorization.session.address,
      payload,
      // The audit record must name the role that *authorized* the command,
      // not whichever of the actor's roles sorts first -- a guardian-and-
      // keeper issuing a keeper command was recorded as acting as guardian.
      // Every operator command authorizes under the keeper capability
      // (requiredAdminRole), and the reads carry no persisted role.
      role:
        payload === undefined
          ? (authorization.session.roles[0] ?? "unknown")
          : requiredAdminRole({
              command: payload.command,
              type: "operator-command",
            }),
    });
    adminJson(request, response, upstream.status, upstream.body, cors);
  } catch {
    adminUnavailable(request, response, cors);
  }
};

const dispatchAdminLogout = (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): void => {
  requireAdminMethod(request, "POST");
  requireAdminOrigin(request, options.configuration);
  emptySearch(url);
  const sessionHandle = readAdminSessionHandle(request.headers.cookie);
  if (sessionHandle === undefined) {
    adminAuthorizationError(request, response, cors, "unauthenticated");
    return;
  }
  if (options.adminAuth === undefined) {
    adminUnavailable(request, response, cors);
    return;
  }
  try {
    const result = options.adminAuth.logout({
      csrfToken: singleRequestHeader(request.headers["x-csrf-token"]),
      sessionHandle,
    });
    if (!result.ok) {
      adminAuthorizationError(request, response, cors, result.reason);
      return;
    }
    adminNoContent(request, response, cors, {
      "set-cookie": clearAdminSessionCookie(
        options.configuration.adminAuth.appOrigin,
      ),
    });
  } catch {
    adminUnavailable(request, response, cors);
  }
};

const dispatchAdmin = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  if (url.pathname === ADMIN_AUTH_PATHS.challenge) {
    await dispatchAdminChallenge(request, response, cors, url, options);
    return;
  }
  if (url.pathname === ADMIN_AUTH_PATHS.verify) {
    await dispatchAdminVerify(request, response, cors, url, options);
    return;
  }
  if (url.pathname === ADMIN_AUTH_PATHS.session) {
    await dispatchAdminSession(request, response, cors, url, options);
    return;
  }
  if (url.pathname === ADMIN_AUTH_PATHS.actionAuthorization) {
    await dispatchAdminActionAuthorization(
      request,
      response,
      cors,
      url,
      options,
    );
    return;
  }
  if (operatorControlMutation(url) !== undefined) {
    await dispatchOperatorControl(
      request,
      response,
      cors,
      url,
      options,
      operatorControlMutation(url) === true,
    );
    return;
  }
  if (url.pathname === ADMIN_AUTH_PATHS.logout) {
    dispatchAdminLogout(request, response, cors, url, options);
    return;
  }
  const route = adminDiagnosticRoutes.get(url.pathname);
  if (route === undefined) {
    throw new PublicRequestError(404, "route-not-found", "Route not found");
  }
  if (request.method !== route.method) {
    throw new PublicRequestError(
      405,
      "method-not-allowed",
      "Method not allowed",
    );
  }
  const session = await authorizeAdminRead(request, response, cors, options);
  if (session === undefined) return;
  const prepared = await prepareUpstreamRequest(
    request,
    url,
    route,
    options.configuration,
  );
  await adminProxy(
    request,
    response,
    cors,
    prepared,
    options,
    session,
    url.pathname,
  );
};

const dispatchRewardFunding = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  if (request.method !== "GET")
    throw new PublicRequestError(
      405,
      "method-not-allowed",
      "Method not allowed",
    );
  if (url.search.length > 0)
    throw new PublicRequestError(
      400,
      "invalid-query",
      "Query parameters are not supported",
    );
  json(
    response,
    200,
    options.rewardFunding === undefined
      ? {
          state: "unavailable",
          reason: "not-configured",
          observedAt: Date.now(),
        }
      : await options.rewardFunding.read(),
    cors,
  );
};

const dispatchPublicProxy = async (
  request: IncomingMessage,
  response: ServerResponse,
  cors: CorsPolicy,
  url: URL,
  options: PublicApiServerOptions,
): Promise<void> => {
  const route = publicRoutes.get(url.pathname);
  if (route === undefined) {
    throw new PublicRequestError(404, "route-not-found", "Route not found");
  }
  if (request.method !== route.method) {
    throw new PublicRequestError(
      405,
      "method-not-allowed",
      "Method not allowed",
    );
  }
  const prepared = await prepareUpstreamRequest(
    request,
    url,
    route,
    options.configuration,
  );
  await proxy(response, cors, prepared, options);
};

const dispatch = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: PublicApiServerOptions,
  limiters: PublicApiRateLimiters,
): Promise<void> => {
  const url = requestUrl(request);
  const cors = corsPolicy(request, options.configuration);
  if (request.method === "OPTIONS") {
    preflight(request, response, cors, url);
    return;
  }
  if (request.method === "GET" && url.pathname === PUBLIC_API_PATHS.health) {
    json(response, 200, { apiVersion: API_VERSION, state: "alive" }, cors);
    return;
  }
  const rateLimit = rateLimiterFor(request, url, options, limiters);
  if (
    !applyRateLimit(
      request,
      response,
      cors,
      options,
      rateLimit.limiter,
      rateLimit.client,
      rateLimit.adminRequest,
    )
  ) {
    return;
  }
  if (request.method === "GET" && url.pathname === PUBLIC_API_PATHS.ready) {
    await readiness(response, cors, options);
    return;
  }
  if (rateLimit.adminRequest) {
    await dispatchAdmin(request, response, cors, url, options);
    return;
  }
  if (url.pathname === PUBLIC_API_PATHS.analytics.rewardFunding) {
    await dispatchRewardFunding(request, response, cors, url, options);
    return;
  }
  await dispatchPublicProxy(request, response, cors, url, options);
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: PublicApiServerOptions,
  limiters: PublicApiRateLimiters,
): Promise<void> => {
  try {
    await dispatch(request, response, options, limiters);
  } catch (cause) {
    if (response.headersSent) {
      response.destroy(cause instanceof Error ? cause : undefined);
      return;
    }
    const cors = (() => {
      try {
        return corsPolicy(request, options.configuration);
      } catch {
        return { origin: undefined };
      }
    })();
    const adminRequest = isAdminRequestTarget(request);
    if (cause instanceof PublicRequestError) {
      if (adminRequest) {
        if (cause.status === 403) {
          adminAuthorizationError(request, response, cors, "forbidden");
        } else {
          adminError(
            request,
            response,
            cors,
            cause.status,
            cause.code,
            cause.message,
          );
        }
      } else {
        error(response, cors, cause.status, cause.code, cause.message);
      }
      return;
    }
    if (adminRequest) {
      adminUnavailable(request, response, cors);
      return;
    }
    error(
      response,
      cors,
      500,
      "internal-error",
      "The public API could not process the request",
    );
  }
};

const stopServer = (
  server: ReturnType<typeof createServer>,
): Effect.Effect<void> =>
  Effect.async((resume) => {
    server.close(() => resume(Effect.void));
    server.closeIdleConnections();
  });

export const acquirePublicApiServer = (
  options: PublicApiServerOptions,
): Effect.Effect<RunningPublicApiServer, PublicApiHttpError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.async<
      RunningPublicApiServer & {
        readonly server: ReturnType<typeof createServer>;
      },
      PublicApiHttpError
    >((resume) => {
      const limiters =
        options.rateLimiters ??
        ({
          adminChallenge: createRequestRateLimiter(
            options.configuration.rateLimit,
          ),
          adminProtected: createRequestRateLimiter(
            options.configuration.rateLimit,
          ),
          adminSession: createRequestRateLimiter(
            options.configuration.rateLimit,
          ),
          adminVerify: createRequestRateLimiter(
            options.configuration.rateLimit,
          ),
          public: createRequestRateLimiter(options.configuration.rateLimit),
        } satisfies PublicApiRateLimiters);
      const server = createServer((request, response) => {
        void handleRequest(request, response, options, limiters);
      });
      server.headersTimeout = 5_000;
      server.keepAliveTimeout = 5_000;
      server.maxRequestsPerSocket = 100;
      server.requestTimeout =
        options.configuration.upstreamTimeoutMilliseconds + 5_000;
      const fail = (cause: Error): void => {
        resume(
          Effect.fail(
            new PublicApiHttpError({
              message: "Could not start public API",
              cause,
            }),
          ),
        );
      };
      server.once("error", fail);
      server.listen(
        options.configuration.port,
        options.configuration.host,
        () => {
          server.removeListener("error", fail);
          const address = server.address() as AddressInfo;
          resume(
            Effect.succeed({
              server,
              url: `http://${options.configuration.host}:${address.port}`,
            }),
          );
        },
      );
      return Effect.sync(() => server.close());
    }),
    ({ server }) => stopServer(server),
  ).pipe(Effect.map(({ url }) => ({ url })));
