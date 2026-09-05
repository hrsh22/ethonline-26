import { join } from "node:path";

import { Effect, Schema } from "effect";
import {
  parseHistoryCredential,
  parseHistoryLoopbackUrl,
} from "@orbit/config/history-runtime";

import { resolveRepositoryPath } from "./base-sepolia-manifest.ts";
import {
  decodeEnvironment,
  loadEnvironmentFile,
  validate,
} from "./effect-runtime.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

const HealthEnvironmentSchema = Schema.Struct({
  RPC_URL: Schema.optional(NonEmptyString),
  BASE_SEPOLIA_RPC_URL: Schema.optional(NonEmptyString),
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(NonEmptyString),
  HEALTH_EVIDENCE_PATH: Schema.optional(NonEmptyString),
  DEPLOYER_ADDRESS: Schema.optional(NonEmptyString),
  HISTORY_INDEX_URL: Schema.optional(NonEmptyString),
  HISTORY_READ_API_TOKEN: Schema.optional(NonEmptyString),
  TESTNET_FUNDING_API_TOKEN: Schema.optional(NonEmptyString),
  TESTNET_FUNDING_SERVICE_URL: Schema.optional(NonEmptyString),
});

export const loadHealthEnvironment = (repositoryRoot: string) =>
  Effect.gen(function* () {
    yield* loadEnvironmentFile(
      join(repositoryRoot, ".env"),
      "Unable to load the root .env",
    );
    const environment = yield* decodeEnvironment(
      HealthEnvironmentSchema,
      "Health environment is invalid",
    );
    const rpcUrl = yield* validate(
      "RPC_URL or BASE_SEPOLIA_RPC_URL is required",
      () => {
        const selected =
          environment.RPC_URL ?? environment.BASE_SEPOLIA_RPC_URL;
        if (selected === undefined) {
          throw new Error("RPC_URL or BASE_SEPOLIA_RPC_URL is required");
        }
        return selected;
      },
    );
    const historyIndexUrl = yield* validate(
      "HISTORY_INDEX_URL is invalid",
      () =>
        parseHistoryLoopbackUrl(
          environment.HISTORY_INDEX_URL ?? "http://127.0.0.1:8787",
        ),
    );

    // The faucet is part of the operated deployment, so its inventory belongs
    // in the same gate. An empty faucet was previously only discoverable by
    // clicking it.
    const fundingServiceUrl = yield* validate(
      "TESTNET_FUNDING_SERVICE_URL is invalid",
      () =>
        parseHistoryLoopbackUrl(
          environment.TESTNET_FUNDING_SERVICE_URL ?? "http://127.0.0.1:8790",
        ),
    );

    return {
      fundingApiToken: environment.TESTNET_FUNDING_API_TOKEN,
      fundingServiceUrl,
      rpcUrl,
      historyIndexUrl,
      historyReadApiToken: parseHistoryCredential(
        environment.HISTORY_READ_API_TOKEN,
        "HISTORY_READ_API_TOKEN",
      ),
      manifestPath: resolveRepositoryPath(
        repositoryRoot,
        environment.DEPLOYMENT_MANIFEST_PATH,
        "deployments/84532.json",
      ),
      evidencePath: resolveRepositoryPath(
        repositoryRoot,
        environment.HEALTH_EVIDENCE_PATH,
        "deployments/84532-health.json",
      ),
      deployerAddress: environment.DEPLOYER_ADDRESS,
    } as const;
  });
