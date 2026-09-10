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
import { webPublicConfiguration } from "@/lib/browser-public-configuration";

type SelectedDeployment = {
  readonly environment: DeploymentEnvironmentConfiguration;
  readonly manifest: ProtocolDeploymentManifest | undefined;
};

const protocolDeploymentForEnvironment = (
  environment: DeploymentEnvironmentConfiguration,
): SelectedDeployment => {
  if (environment.status !== "configured") {
    return { environment, manifest: undefined };
  }
  return decodeConfiguredDeploymentSelection({
    environment,
    manifest: protocolDeploymentManifests[environment.name],
  });
};

export const selectProtocolDeployment = (input: unknown): SelectedDeployment =>
  protocolDeploymentForEnvironment(selectDeploymentEnvironment(input));

const selectedDeployment = protocolDeploymentForEnvironment(
  selectDeploymentEnvironment(webPublicConfiguration.deploymentEnvironment),
);

/**
 * The public origin this deployment is served from. It resolves generated icon
 * and social-card routes to absolute URLs, which social and wallet consumers
 * require, and binds the wallet-control proof domain.
 */
export const applicationUrl = webPublicConfiguration.applicationUrl;

export const deploymentEnvironment = selectedDeployment.environment;
export const protocolDeploymentManifest = selectedDeployment.manifest;
export const protocolDeploymentFingerprint =
  protocolDeploymentManifest === undefined
    ? undefined
    : deploymentManifestFingerprint(protocolDeploymentManifest);
