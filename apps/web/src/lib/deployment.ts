import {
  decodeConfiguredDeploymentSelection,
  selectDeploymentEnvironment,
  type DeploymentEnvironmentConfiguration,
} from "@orbit/config/deployment-environments";
import {
  deploymentManifestFingerprint,
  type ProtocolDeploymentManifest,
} from "@orbit/config/deployment-manifest";

import { protocolDeploymentManifests } from "@/generated/deployment-manifests";

type SelectedDeployment = {
  readonly environment: DeploymentEnvironmentConfiguration;
  readonly manifest: ProtocolDeploymentManifest | undefined;
};

export const selectProtocolDeployment = (
  input: unknown,
): SelectedDeployment => {
  const environment = selectDeploymentEnvironment(input);
  if (environment.status !== "configured") {
    return { environment, manifest: undefined };
  }
  return decodeConfiguredDeploymentSelection({
    environment,
    manifest: protocolDeploymentManifests[environment.name],
  });
};

const selectedDeployment = selectProtocolDeployment(
  process.env.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT,
);

/**
 * The public origin this deployment is served from. It resolves generated icon
 * and social-card routes to absolute URLs, which social and wallet consumers
 * require, and binds the wallet-control proof domain.
 */
export const applicationUrl: string | undefined = (() => {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured === undefined || configured === "") return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    return undefined;
  }
})();

export const deploymentEnvironment = selectedDeployment.environment;
export const protocolDeploymentManifest = selectedDeployment.manifest;
export const protocolDeploymentFingerprint =
  protocolDeploymentManifest === undefined
    ? undefined
    : deploymentManifestFingerprint(protocolDeploymentManifest);
