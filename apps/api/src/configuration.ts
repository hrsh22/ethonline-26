import { basename, dirname, isAbsolute, parse, resolve } from "node:path";

import { normalizePublicApiBaseUrl } from "@orbit/config/public-api";
import {
  ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS,
  ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS,
  normalizeAdminAppOrigin,
} from "@orbit/config/admin-auth";
import {
  parseHistoryCredential,
  parseHistoryLoopbackUrl,
} from "@orbit/config/history-runtime";

export interface PublicApiConfiguration {
  readonly adminAuth: {
    readonly appOrigin: string;
    readonly challengeTtlMilliseconds: number;
    readonly databasePath: string;
    readonly manifestPath: string;
    readonly rpcUrl: URL;
    readonly sessionTtlMilliseconds: number;
  };
  readonly allowedOrigins: ReadonlySet<string>;
  readonly fundingApiToken: string;
  readonly fundingServiceUrl: URL;
  readonly historyReadApiToken: string;
  readonly historyServiceUrl: URL;
  readonly host: "127.0.0.1";
  readonly maximumRequestBodyBytes: number;
  /**
   * The operator control plane. Absent when this deployment has no operator to
   * control, in which case the control routes report the service unavailable
   * rather than guessing a loopback address.
   */
  readonly operatorControl:
    { readonly token: string; readonly url: URL } | undefined;
  readonly port: number;
  readonly rateLimit: {
    readonly maximumClients: number;
    readonly maximumRequests: number;
    readonly windowMilliseconds: number;
  };
  readonly trustProxy: boolean;
  readonly upstreamTimeoutMilliseconds: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

const optional = (
  environment: Environment,
  name: string,
): string | undefined => {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const required = (environment: Environment, name: string): string => {
  const value = optional(environment, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const boundedInteger = (
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
};

const booleanValue = (
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean => {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
};

const parsedUrl = (value: string, message: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw new Error(message);
  }
};

const loopbackHttpUrl = (value: string, name: string): URL => {
  const url = parsedUrl(value, `${name} must be a root HTTP URL on 127.0.0.1`);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username.length !== 0 ||
    url.password.length !== 0 ||
    url.search.length !== 0 ||
    url.hash.length !== 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(`${name} must be a root HTTP URL on 127.0.0.1`);
  }
  return url;
};

const browserOrigin = (value: string): string => {
  const message =
    "PUBLIC_API_ALLOWED_ORIGINS must contain exact HTTPS origins or local HTTP origins";
  try {
    return normalizePublicApiBaseUrl(value);
  } catch {
    throw new Error(message);
  }
};

const allowedOrigins = (value: string): ReadonlySet<string> => {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length !== 0)
    .map(browserOrigin);
  if (values.length === 0) {
    throw new Error("PUBLIC_API_ALLOWED_ORIGINS must not be empty");
  }
  if (new Set(values).size !== values.length) {
    throw new Error("PUBLIC_API_ALLOWED_ORIGINS must not contain duplicates");
  }
  return new Set(values);
};

const adminAppOrigin = (value: string): string => {
  try {
    return normalizeAdminAppOrigin(value);
  } catch {
    throw new Error(
      "ADMIN_AUTH_APP_ORIGIN must be an exact HTTPS origin or local HTTP origin",
    );
  }
};

const adminRpcUrl = (value: string): URL => {
  const url = parsedUrl(
    value,
    "ADMIN_AUTH_RPC_URL must be an HTTPS URL or loopback HTTP URL",
  );
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username.length !== 0 ||
    url.password.length !== 0 ||
    url.hash.length !== 0
  ) {
    throw new Error(
      "ADMIN_AUTH_RPC_URL must be an HTTPS URL or loopback HTTP URL without credentials or a fragment",
    );
  }
  return url;
};

const adminDatabasePath = (value: string): string => {
  if (!isAbsolute(value)) {
    throw new Error(
      "ADMIN_AUTH_DATABASE_PATH must be an absolute .sqlite file path in a dedicated directory",
    );
  }
  const normalized = resolve(value);
  const root = parse(normalized).root;
  const parent = dirname(normalized);
  if (
    normalized === root ||
    parent === root ||
    !/^[A-Za-z0-9._-]+\.sqlite$/u.test(basename(normalized))
  ) {
    throw new Error(
      "ADMIN_AUTH_DATABASE_PATH must be an absolute .sqlite file path in a dedicated directory",
    );
  }
  return normalized;
};

const secret = (environment: Environment, name: string): string => {
  const value = required(environment, name);
  if (value.length < 32)
    throw new Error(`${name} must contain at least 32 characters`);
  return value;
};

const historyServiceUrl = (environment: Environment): URL => {
  const value = environment.HISTORY_INDEX_URL;
  if (value === undefined || value.length === 0) {
    throw new Error("HISTORY_INDEX_URL is required");
  }
  return new URL(parseHistoryLoopbackUrl(value));
};

/**
 * The control plane is loopback-only, like the funding and history services.
 * A non-loopback host would expose a signing-capable surface to the network.
 */
const operatorControl = (
  environment: Environment,
): { readonly token: string; readonly url: URL } | undefined => {
  const url = environment.OPERATOR_CONTROL_URL?.trim();
  const token = environment.OPERATOR_CONTROL_API_TOKEN?.trim();
  if (url === undefined || url.length === 0) return undefined;
  if (token === undefined || token.length < 32) {
    throw new Error(
      "OPERATOR_CONTROL_API_TOKEN must be at least 32 characters when OPERATOR_CONTROL_URL is set",
    );
  }
  // Held to the same standard as the funding and history upstreams: http
  // only, the pinned loopback literal rather than a resolver-dependent
  // `localhost`, no credentials, no query, no fragment, no path.
  return { token, url: loopbackHttpUrl(url, "OPERATOR_CONTROL_URL") };
};

export const resolvePublicApiConfiguration = (
  environment: Environment,
): PublicApiConfiguration => {
  const host = optional(environment, "PUBLIC_API_HOST") ?? "127.0.0.1";
  if (host !== "127.0.0.1") {
    throw new Error("PUBLIC_API_HOST must be 127.0.0.1");
  }
  const origins = allowedOrigins(
    required(environment, "PUBLIC_API_ALLOWED_ORIGINS"),
  );
  const appOrigin = adminAppOrigin(
    required(environment, "ADMIN_AUTH_APP_ORIGIN"),
  );
  if (!origins.has(appOrigin)) {
    throw new Error("ADMIN_AUTH_APP_ORIGIN must be an allowed origin");
  }
  return {
    adminAuth: {
      appOrigin,
      challengeTtlMilliseconds:
        boundedInteger(
          optional(environment, "ADMIN_AUTH_CHALLENGE_TTL_SECONDS"),
          300,
          "ADMIN_AUTH_CHALLENGE_TTL_SECONDS",
          ADMIN_AUTH_CHALLENGE_MINIMUM_TTL_MILLISECONDS / 1_000,
          ADMIN_AUTH_CHALLENGE_MAXIMUM_TTL_MILLISECONDS / 1_000,
        ) * 1_000,
      databasePath: adminDatabasePath(
        required(environment, "ADMIN_AUTH_DATABASE_PATH"),
      ),
      manifestPath: required(environment, "ADMIN_AUTH_MANIFEST_PATH"),
      rpcUrl: adminRpcUrl(required(environment, "ADMIN_AUTH_RPC_URL")),
      sessionTtlMilliseconds:
        boundedInteger(
          optional(environment, "ADMIN_AUTH_SESSION_TTL_SECONDS"),
          900,
          "ADMIN_AUTH_SESSION_TTL_SECONDS",
          300,
          3_600,
        ) * 1_000,
    },
    allowedOrigins: origins,
    fundingApiToken: secret(environment, "TESTNET_FUNDING_API_TOKEN"),
    fundingServiceUrl: loopbackHttpUrl(
      required(environment, "TESTNET_FUNDING_SERVICE_URL"),
      "TESTNET_FUNDING_SERVICE_URL",
    ),
    historyReadApiToken: parseHistoryCredential(
      environment.HISTORY_READ_API_TOKEN,
      "HISTORY_READ_API_TOKEN",
    ),
    historyServiceUrl: historyServiceUrl(environment),
    operatorControl: operatorControl(environment),
    host,
    maximumRequestBodyBytes: boundedInteger(
      optional(environment, "PUBLIC_API_MAXIMUM_REQUEST_BODY_BYTES"),
      2_048,
      "PUBLIC_API_MAXIMUM_REQUEST_BODY_BYTES",
      256,
      65_536,
    ),
    port: boundedInteger(
      optional(environment, "PUBLIC_API_PORT"),
      8_800,
      "PUBLIC_API_PORT",
      1,
      65_535,
    ),
    rateLimit: {
      maximumClients: boundedInteger(
        optional(environment, "PUBLIC_API_RATE_LIMIT_MAXIMUM_CLIENTS"),
        10_000,
        "PUBLIC_API_RATE_LIMIT_MAXIMUM_CLIENTS",
        100,
        1_000_000,
      ),
      maximumRequests: boundedInteger(
        optional(environment, "PUBLIC_API_RATE_LIMIT_MAXIMUM_REQUESTS"),
        120,
        "PUBLIC_API_RATE_LIMIT_MAXIMUM_REQUESTS",
        1,
        100_000,
      ),
      windowMilliseconds:
        boundedInteger(
          optional(environment, "PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS"),
          60,
          "PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS",
          1,
          86_400,
        ) * 1_000,
    },
    trustProxy: booleanValue(
      optional(environment, "PUBLIC_API_TRUST_PROXY"),
      false,
      "PUBLIC_API_TRUST_PROXY",
    ),
    upstreamTimeoutMilliseconds: boundedInteger(
      optional(environment, "PUBLIC_API_UPSTREAM_TIMEOUT_MILLISECONDS"),
      10_000,
      "PUBLIC_API_UPSTREAM_TIMEOUT_MILLISECONDS",
      100,
      60_000,
    ),
  };
};
