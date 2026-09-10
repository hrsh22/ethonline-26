import type { DeploymentEnvironmentName } from "@orbit/config/deployment-environments";
import { normalizePublicApiBaseUrl } from "@orbit/config/public-api";

export interface WebPublicEnvironmentBindings {
  readonly NEXT_PUBLIC_API_URL?: string | undefined;
  readonly NEXT_PUBLIC_APP_URL?: string | undefined;
  readonly NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?: string | undefined;
  readonly NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT?: string | undefined;
  readonly NEXT_PUBLIC_PRIVY_APP_ID?: string | undefined;
  readonly NEXT_PUBLIC_RPC_URL?: string | undefined;
}

export interface WebPublicConfiguration {
  readonly applicationUrl: string | undefined;
  readonly deploymentEnvironment: DeploymentEnvironmentName;
  readonly privyAppId: string | undefined;
  readonly publicApiBaseUrl: string | undefined;
  readonly rpcUrl: string | undefined;
}

export interface ProductionWebPublicConfiguration extends WebPublicConfiguration {
  readonly applicationUrl: string;
  readonly publicApiBaseUrl: string;
}

const optionalBinding = (value: string | undefined): string | undefined => {
  const configured = value?.trim();
  return configured === undefined || configured.length === 0
    ? undefined
    : configured;
};

const parseDeploymentEnvironment = (
  value: string | undefined,
): DeploymentEnvironmentName => {
  const configured = optionalBinding(value) ?? "staging";
  if (
    configured !== "development" &&
    configured !== "staging" &&
    configured !== "production"
  ) {
    throw new TypeError(
      "NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT must be development, staging, or production",
    );
  }
  return configured;
};

const localApplicationHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const usesApplicationProtocol = (url: URL): boolean =>
  url.protocol === "https:" ||
  (url.protocol === "http:" && localApplicationHosts.has(url.hostname));

const containsOnlyOriginComponents = (url: URL): boolean =>
  url.username.length === 0 &&
  url.password.length === 0 &&
  url.pathname === "/" &&
  url.search.length === 0 &&
  url.hash.length === 0;

const normalizeApplicationUrl = (
  value: string | undefined,
): string | undefined => {
  const configured = optionalBinding(value);
  if (configured === undefined) return undefined;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new TypeError(
      "NEXT_PUBLIC_APP_URL must be an HTTPS origin or local HTTP origin",
    );
  }
  if (!usesApplicationProtocol(url) || !containsOnlyOriginComponents(url)) {
    throw new TypeError(
      "NEXT_PUBLIC_APP_URL must be an HTTPS origin or local HTTP origin",
    );
  }
  return url.origin;
};

const normalizeRpcUrl = (
  name: "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL" | "NEXT_PUBLIC_RPC_URL",
  value: string | undefined,
): string | undefined => {
  const configured = optionalBinding(value);
  if (configured === undefined) return undefined;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new TypeError(
      `${name} must be an absolute HTTP(S) URL without credentials or a fragment`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError(
      `${name} must be an absolute HTTP(S) URL without credentials or a fragment`,
    );
  }
  return configured;
};

export const parseWebPublicConfiguration = (
  environment: WebPublicEnvironmentBindings,
): WebPublicConfiguration => {
  const deploymentEnvironment = parseDeploymentEnvironment(
    environment.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT,
  );
  const configuredPublicApiUrl = optionalBinding(
    environment.NEXT_PUBLIC_API_URL,
  );
  const explicitRpcUrl = normalizeRpcUrl(
    "NEXT_PUBLIC_RPC_URL",
    environment.NEXT_PUBLIC_RPC_URL,
  );
  const baseSepoliaRpcUrl = normalizeRpcUrl(
    "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
    environment.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  );

  return {
    applicationUrl: normalizeApplicationUrl(environment.NEXT_PUBLIC_APP_URL),
    deploymentEnvironment,
    privyAppId: optionalBinding(environment.NEXT_PUBLIC_PRIVY_APP_ID),
    publicApiBaseUrl:
      configuredPublicApiUrl === undefined
        ? undefined
        : normalizePublicApiBaseUrl(configuredPublicApiUrl),
    rpcUrl:
      explicitRpcUrl ??
      (deploymentEnvironment === "staging" ? baseSepoliaRpcUrl : undefined),
  };
};

export const requireProductionWebPublicConfiguration = (
  configuration: WebPublicConfiguration,
): ProductionWebPublicConfiguration => {
  if (configuration.publicApiBaseUrl === undefined) {
    throw new TypeError(
      "NEXT_PUBLIC_API_URL is required for a production web build",
    );
  }
  if (configuration.applicationUrl === undefined) {
    throw new TypeError(
      "NEXT_PUBLIC_APP_URL is required for a production web build",
    );
  }
  return configuration as ProductionWebPublicConfiguration;
};
