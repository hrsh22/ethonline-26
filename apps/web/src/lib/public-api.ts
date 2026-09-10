import { publicApiEndpoint } from "@orbit/config/public-api";

import { webPublicConfiguration } from "./browser-public-configuration";
import {
  parseWebPublicConfiguration,
  type WebPublicEnvironmentBindings,
} from "./web-public-configuration";

const requirePublicApiBaseUrl = (value: string | undefined): string => {
  if (value === undefined) {
    throw new TypeError("NEXT_PUBLIC_API_URL is required");
  }
  return value;
};

export const resolvePublicApiBaseUrl = (
  environment: WebPublicEnvironmentBindings,
): string =>
  requirePublicApiBaseUrl(
    parseWebPublicConfiguration(environment).publicApiBaseUrl,
  );

export const publicApiBaseUrl = requirePublicApiBaseUrl(
  webPublicConfiguration.publicApiBaseUrl,
);

export const publicApiUrl = (path: string): string =>
  publicApiEndpoint(publicApiBaseUrl, path);
