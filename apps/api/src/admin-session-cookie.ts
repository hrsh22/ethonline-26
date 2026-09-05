import { ADMIN_AUTH_COOKIE_NAME } from "@orbit/config/admin-auth";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const sessionHandlePattern = /^[0-9a-f]{64}$/u;

const cookieOrigin = (value: string): URL => {
  const origin = new URL(value);
  const loopbackHttp =
    origin.protocol === "http:" && loopbackHosts.has(origin.hostname);
  if (
    (origin.protocol !== "https:" && !loopbackHttp) ||
    origin.username.length !== 0 ||
    origin.password.length !== 0 ||
    (origin.pathname !== "/" && origin.pathname !== "") ||
    origin.search.length !== 0 ||
    origin.hash.length !== 0
  ) {
    throw new TypeError("Admin session cookie origin is unsafe");
  }
  return origin;
};

const secureAttribute = (origin: URL): readonly string[] =>
  origin.protocol === "https:" ? ["Secure"] : [];

export const readAdminSessionHandle = (
  cookieHeader: string | undefined,
): string | undefined => {
  if (cookieHeader === undefined || /[\r\n]/u.test(cookieHeader)) {
    return undefined;
  }
  const matches: string[] = [];
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name === ADMIN_AUTH_COOKIE_NAME) matches.push(value);
  }
  const [handle] = matches;
  return matches.length === 1 &&
    handle !== undefined &&
    sessionHandlePattern.test(handle)
    ? handle
    : undefined;
};

export const serializeAdminSessionCookie = ({
  appOrigin,
  expiresAt,
  handle,
  issuedAt,
}: {
  readonly appOrigin: string;
  readonly expiresAt: Date;
  readonly handle: string;
  readonly issuedAt: Date;
}): string => {
  if (!sessionHandlePattern.test(handle)) {
    throw new TypeError("Admin session handle is invalid");
  }
  const maximumAge = Math.floor(
    (expiresAt.getTime() - issuedAt.getTime()) / 1_000,
  );
  if (!Number.isSafeInteger(maximumAge) || maximumAge <= 0) {
    throw new TypeError("Admin session cookie lifetime is invalid");
  }
  const origin = cookieOrigin(appOrigin);
  return [
    `${ADMIN_AUTH_COOKIE_NAME}=${handle}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maximumAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    ...secureAttribute(origin),
  ].join("; ");
};

export const clearAdminSessionCookie = (appOrigin: string): string => {
  const origin = cookieOrigin(appOrigin);
  return [
    `${ADMIN_AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ...secureAttribute(origin),
  ].join("; ");
};
