import { join } from "node:path";

import {
  readRuntimeEnvironmentSource,
  type EnvironmentVariables,
} from "./runtime-environment.ts";

export type RuntimeEnvironmentProfile = "development" | "staging" | "none";

export interface RuntimeEnvironmentProfileArguments {
  readonly profile: RuntimeEnvironmentProfile;
  readonly remainingArguments: readonly string[];
}

export interface RuntimeEnvironmentProfileOptions {
  readonly developmentFileRequired: boolean;
  readonly environment: EnvironmentVariables;
  readonly profile: RuntimeEnvironmentProfile;
  readonly repositoryRoot: string;
}

const profileArgument = "--profile=";

/**
 * Removes environment-source flags without interpreting a launcher's own
 * positional arguments. This lets `history --once --profile=staging` retain
 * the historical forwarded flag while every launcher shares one profile
 * contract.
 */
export const parseRuntimeEnvironmentProfileArguments = (
  arguments_: readonly string[],
): RuntimeEnvironmentProfileArguments => {
  let profile: RuntimeEnvironmentProfile = "development";
  let configured = false;
  const remainingArguments: string[] = [];

  for (const argument of arguments_) {
    if (argument === "--no-env-file") {
      if (configured) {
        throw new Error(
          "Choose exactly one environment source: --profile or --no-env-file",
        );
      }
      configured = true;
      profile = "none";
      continue;
    }
    if (argument.startsWith(profileArgument)) {
      if (configured) {
        throw new Error(
          "Choose exactly one environment source: --profile or --no-env-file",
        );
      }
      const candidate = argument.slice(profileArgument.length);
      if (candidate !== "development" && candidate !== "staging") {
        throw new Error("Environment profile must be development or staging");
      }
      configured = true;
      profile = candidate;
      continue;
    }
    remainingArguments.push(argument);
  }

  return { profile, remainingArguments };
};

/**
 * Repository files are lower precedence than explicit process bindings. The
 * injected profile deliberately performs no filesystem access.
 */
export const readRuntimeEnvironmentProfile = ({
  developmentFileRequired,
  environment,
  profile,
  repositoryRoot,
}: RuntimeEnvironmentProfileOptions): EnvironmentVariables => {
  if (profile === "none") return environment;
  return readRuntimeEnvironmentSource({
    environment,
    path: join(repositoryRoot, profile === "staging" ? ".env.staging" : ".env"),
    required: profile === "staging" || developmentFileRequired,
  });
};
