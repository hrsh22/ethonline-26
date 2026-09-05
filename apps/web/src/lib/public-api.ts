import {
  normalizePublicApiBaseUrl,
  publicApiEndpoint,
} from "@orbit/config/public-api";

type Environment = Readonly<Record<string, string | undefined>>;

export const resolvePublicApiBaseUrl = (environment: Environment): string => {
  const value = environment.NEXT_PUBLIC_API_URL?.trim();
  if (value === undefined || value.length === 0) {
    throw new TypeError("NEXT_PUBLIC_API_URL is required");
  }
  return normalizePublicApiBaseUrl(value);
};

export const publicApiBaseUrl = resolvePublicApiBaseUrl({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

export const publicApiUrl = (path: string): string =>
  publicApiEndpoint(publicApiBaseUrl, path);
