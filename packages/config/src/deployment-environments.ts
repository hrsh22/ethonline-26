import { Schema } from "effect";

import {
  decodeProtocolDeploymentManifest,
  type ProtocolDeploymentManifest,
} from "./deployment-manifest.js";

export const DeploymentEnvironmentNameSchema = Schema.Literal(
  "development",
  "development-sepolia",
  "staging",
  "production",
);

export type DeploymentEnvironmentName =
  typeof DeploymentEnvironmentNameSchema.Type;

const DevelopmentDeploymentEnvironmentSchema = Schema.Struct({
  status: Schema.Literal("configured"),
  name: Schema.Literal("development"),
  chainId: Schema.Literal(31_337),
  network: Schema.Literal("anvil"),
  chainLabel: Schema.Literal("Anvil"),
  applicationLabel: Schema.Literal("Anvil Development"),
  manifestPath: Schema.Literal("deployments/31337.json"),
  assetPolicy: Schema.Literal("mock"),
});

const DevelopmentSepoliaDeploymentEnvironmentSchema = Schema.Struct({
  status: Schema.Literal("configured"),
  name: Schema.Literal("development-sepolia"),
  chainId: Schema.Literal(84_532),
  network: Schema.Literal("base-sepolia"),
  chainLabel: Schema.Literal("Base Sepolia"),
  applicationLabel: Schema.Literal("Base Sepolia Development"),
  manifestPath: Schema.Literal("deployments/84532.json"),
  assetPolicy: Schema.Literal("mock"),
});

const StagingDeploymentEnvironmentSchema = Schema.Struct({
  status: Schema.Literal("configured"),
  name: Schema.Literal("staging"),
  chainId: Schema.Literal(84_532),
  network: Schema.Literal("base-sepolia"),
  chainLabel: Schema.Literal("Base Sepolia"),
  applicationLabel: Schema.Literal("Base Sepolia Staging"),
  manifestPath: Schema.Literal("deployments/84532.staging.json"),
  assetPolicy: Schema.Literal("mock"),
});

export const ConfiguredDeploymentEnvironmentSchema = Schema.Union(
  DevelopmentDeploymentEnvironmentSchema,
  DevelopmentSepoliaDeploymentEnvironmentSchema,
  StagingDeploymentEnvironmentSchema,
);

export const DeployableDeploymentEnvironmentSchema =
  ConfiguredDeploymentEnvironmentSchema;

export type DeployableDeploymentEnvironment =
  typeof DeployableDeploymentEnvironmentSchema.Type;

const UnconfiguredProductionEnvironmentSchema = Schema.Struct({
  status: Schema.Literal("unconfigured"),
  name: Schema.Literal("production"),
  chainId: Schema.Literal(8_453),
  network: Schema.Literal("base"),
  chainLabel: Schema.Literal("Base"),
  applicationLabel: Schema.Literal("Base Production"),
  assetPolicy: Schema.Literal("production"),
});

export const DeploymentEnvironmentConfigurationSchema = Schema.Union(
  DeployableDeploymentEnvironmentSchema,
  UnconfiguredProductionEnvironmentSchema,
);

export type DeploymentEnvironmentConfiguration =
  typeof DeploymentEnvironmentConfigurationSchema.Type;
export type ConfiguredDeploymentEnvironment =
  typeof ConfiguredDeploymentEnvironmentSchema.Type;

export interface ConfiguredDeploymentSelection {
  readonly environment: ConfiguredDeploymentEnvironment;
  readonly manifest: ProtocolDeploymentManifest;
}

const decodeConfiguredDeploymentSelectionInput = Schema.decodeUnknownSync(
  Schema.Struct({
    environment: ConfiguredDeploymentEnvironmentSchema,
    manifest: Schema.Unknown,
  }),
  { errors: "all", onExcessProperty: "error" },
);

export const decodeConfiguredDeploymentSelection = (
  input: unknown,
): ConfiguredDeploymentSelection => {
  const { environment, manifest: manifestInput } =
    decodeConfiguredDeploymentSelectionInput(input);
  const manifest = decodeProtocolDeploymentManifest(manifestInput);
  if (
    environment.chainId !== manifest.chainId ||
    environment.network !== manifest.network
  ) {
    throw new Error(
      "Deployment selection fields do not match: environment.chainId, environment.network, manifest.chainId, manifest.network",
    );
  }
  return { environment, manifest } as ConfiguredDeploymentSelection;
};

const decodeConfiguredConfiguration = Schema.decodeUnknownSync(
  ConfiguredDeploymentEnvironmentSchema,
);
const decodeProductionConfiguration = Schema.decodeUnknownSync(
  UnconfiguredProductionEnvironmentSchema,
);

export const deploymentEnvironmentConfigurations = {
  development: decodeConfiguredConfiguration({
    status: "configured",
    name: "development",
    chainId: 31_337,
    network: "anvil",
    chainLabel: "Anvil",
    applicationLabel: "Anvil Development",
    manifestPath: "deployments/31337.json",
    assetPolicy: "mock",
  }),
  "development-sepolia": decodeConfiguredConfiguration({
    status: "configured",
    name: "development-sepolia",
    chainId: 84_532,
    network: "base-sepolia",
    chainLabel: "Base Sepolia",
    applicationLabel: "Base Sepolia Development",
    manifestPath: "deployments/84532.json",
    assetPolicy: "mock",
  }),
  staging: decodeConfiguredConfiguration({
    status: "configured",
    name: "staging",
    chainId: 84_532,
    network: "base-sepolia",
    chainLabel: "Base Sepolia",
    applicationLabel: "Base Sepolia Staging",
    manifestPath: "deployments/84532.staging.json",
    assetPolicy: "mock",
  }),
  production: decodeProductionConfiguration({
    status: "unconfigured",
    name: "production",
    chainId: 8_453,
    network: "base",
    chainLabel: "Base",
    applicationLabel: "Base Production",
    assetPolicy: "production",
  }),
} as const satisfies Record<
  DeploymentEnvironmentName,
  DeploymentEnvironmentConfiguration
>;

export const configuredDeploymentEnvironments = Object.values(
  deploymentEnvironmentConfigurations,
).filter(
  (configuration): configuration is ConfiguredDeploymentEnvironment =>
    configuration.status === "configured",
);

export const defaultDeploymentEnvironmentName = "development-sepolia" as const;

export const deploymentEnvironmentForName = (
  input: unknown,
): DeploymentEnvironmentConfiguration => {
  const name = Schema.decodeUnknownSync(DeploymentEnvironmentNameSchema)(input);
  return deploymentEnvironmentConfigurations[name];
};

export const selectDeploymentEnvironment = (
  input: unknown,
): DeploymentEnvironmentConfiguration =>
  deploymentEnvironmentForName(input ?? defaultDeploymentEnvironmentName);

export const deploymentEnvironmentForChainId = (
  chainId: number,
): DeploymentEnvironmentConfiguration => {
  const configurations = Object.values(
    deploymentEnvironmentConfigurations,
  ).filter((candidate) => candidate.chainId === chainId);
  if (configurations.length > 1) {
    throw new RangeError(
      `Ambiguous deployment chain ${chainId}; select an environment explicitly: ${configurations.map((configuration) => configuration.name).join(", ")}`,
    );
  }
  const configuration = configurations[0];
  if (configuration === undefined) {
    throw new RangeError(`Unsupported deployment chain ${chainId}`);
  }
  return configuration;
};

export const requireDeployableDeploymentEnvironment = (
  configuration: DeploymentEnvironmentConfiguration,
): DeployableDeploymentEnvironment => {
  if (!("manifestPath" in configuration)) {
    throw new Error(
      `Deployment environment ${configuration.name} has no deployment target`,
    );
  }
  return configuration;
};

export const requireConfiguredDeploymentEnvironment = (
  configuration: DeploymentEnvironmentConfiguration,
): ConfiguredDeploymentEnvironment => {
  if (configuration.status !== "configured") {
    throw new Error(
      `Deployment environment ${configuration.name} has no published manifest`,
    );
  }
  return configuration;
};
