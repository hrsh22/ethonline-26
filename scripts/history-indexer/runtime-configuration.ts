import { readFileSync } from "node:fs";

import {
  decodeProtocolDeploymentManifest,
  type ProtocolDeploymentManifest,
} from "@orbit/config/deployment-manifest";
import { parseHistoryLoopbackUrl } from "@orbit/config/history-runtime";
import { Config, Effect, Option } from "effect";

import { resolveRepositoryPath } from "../base-sepolia-manifest.ts";
import { fileSystem, validate } from "../effect-runtime.ts";
import {
  deriveHistoryIndexConfiguration,
  type HistoryIndexConfiguration,
  validateHistoryIndexConfiguration,
} from "./configuration.ts";
import { HistoryConfigurationError } from "./errors.ts";
import {
  resolveHistoryListenerPolicy,
  type HistoryListenerPolicy,
} from "./listener-policy.ts";

const optionalString = (name: string) =>
  Config.option(Config.nonEmptyString(name));
const defaultString = (name: string, value: string) =>
  Config.nonEmptyString(name).pipe(Config.withDefault(value));
const defaultInteger = (name: string, value: number) =>
  Config.integer(name).pipe(Config.withDefault(value));

const environmentConfiguration = Config.all({
  historyRpcUrl: optionalString("HISTORY_RPC_URL"),
  rpcUrl: optionalString("RPC_URL"),
  baseSepoliaRpcUrl: optionalString("BASE_SEPOLIA_RPC_URL"),
  manifestPath: defaultString(
    "HISTORY_MANIFEST_PATH",
    "deployments/84532.json",
  ),
  databasePath: defaultString(
    "HISTORY_DATABASE_PATH",
    ".data/history/base-sepolia.sqlite",
  ),
  keeperAttemptDatabasePath: defaultString(
    "KEEPER_ATTEMPT_DATABASE_PATH",
    ".data/history/base-sepolia-keeper-attempts.sqlite",
  ),
  keeperAttemptMaximumAgeSeconds: defaultInteger(
    "KEEPER_ATTEMPT_MAXIMUM_AGE_SECONDS",
    900,
  ),
  host: defaultString("HISTORY_HOST", "127.0.0.1"),
  port: defaultInteger("HISTORY_PORT", 8_787),
  readApiToken: optionalString("HISTORY_READ_API_TOKEN"),
  ingestApiToken: optionalString("HISTORY_INGEST_API_TOKEN"),
  pollSeconds: defaultInteger("HISTORY_POLL_SECONDS", 15),
  batchBlocks: defaultInteger("HISTORY_BATCH_BLOCKS", 2_000),
  confirmationBlocks: defaultInteger("HISTORY_CONFIRMATION_BLOCKS", 2),
  overlapBlocks: defaultInteger("HISTORY_REORG_OVERLAP_BLOCKS", 64),
  rpcConcurrency: defaultInteger("HISTORY_RPC_CONCURRENCY", 4),
  retryMaximumAttempts: defaultInteger("HISTORY_RETRY_MAXIMUM_ATTEMPTS", 5),
  retryBaseDelayMilliseconds: defaultInteger(
    "HISTORY_RETRY_BASE_DELAY_MILLISECONDS",
    250,
  ),
  maximumPageSize: defaultInteger("HISTORY_MAXIMUM_PAGE_SIZE", 100),
  cursorSnapshotRetention: defaultInteger(
    "HISTORY_CURSOR_SNAPSHOT_RETENTION",
    10_000,
  ),
  uniswapV4SubgraphUrl: optionalString("UNISWAP_V4_SUBGRAPH_URL"),
  uniswapV4SubgraphBearerToken: optionalString(
    "UNISWAP_V4_SUBGRAPH_BEARER_TOKEN",
  ),
  uniswapV4SubgraphTimeoutMilliseconds: defaultInteger(
    "UNISWAP_V4_SUBGRAPH_TIMEOUT_MILLISECONDS",
    10_000,
  ),
  uniswapV4SubgraphCacheSeconds: defaultInteger(
    "UNISWAP_V4_SUBGRAPH_CACHE_SECONDS",
    60,
  ),
});

type EnvironmentConfiguration = Config.Config.Success<
  typeof environmentConfiguration
>;

export interface HistoryRuntimeConfiguration {
  readonly rpcUrl: string;
  readonly manifestPath: string;
  readonly databasePath: string;
  readonly keeperAttemptDatabasePath: string;
  readonly keeperAttemptMaximumAgeSeconds: bigint;
  readonly listener: HistoryListenerPolicy | undefined;
  readonly port: number;
  readonly pollMilliseconds: number;
  readonly index: HistoryIndexConfiguration;
  readonly uniswapV4Subgraph:
    | {
        readonly bearerToken: string | undefined;
        readonly cacheMilliseconds: number;
        readonly timeoutMilliseconds: number;
        readonly url: URL;
      }
    | undefined;
}

const firstRpcUrl = (
  environment: EnvironmentConfiguration,
): string | undefined =>
  Option.getOrUndefined(environment.historyRpcUrl) ??
  Option.getOrUndefined(environment.rpcUrl) ??
  Option.getOrUndefined(environment.baseSepoliaRpcUrl);

const boundedInteger = (
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be a safe integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
};

const readManifest = (
  path: string,
): Effect.Effect<ProtocolDeploymentManifest, Error> =>
  Effect.gen(function* () {
    const serialized = yield* fileSystem(
      `Could not read history manifest at ${path}`,
      () => readFileSync(path, "utf8"),
    );
    return yield* validate("History deployment manifest is invalid", () =>
      decodeProtocolDeploymentManifest(JSON.parse(serialized) as unknown),
    );
  });

const subgraphUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("UNISWAP_V4_SUBGRAPH_URL must be an absolute URL");
  }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(
    url.hostname,
  );
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username.length !== 0 ||
    url.password.length !== 0 ||
    url.search.length !== 0 ||
    url.hash.length !== 0
  ) {
    throw new Error(
      "UNISWAP_V4_SUBGRAPH_URL must be HTTPS or loopback HTTP without URL credentials, a query, or a fragment",
    );
  }
  return url;
};

const withEnvironmentOverrides = (
  base: HistoryIndexConfiguration,
  environment: EnvironmentConfiguration,
): HistoryIndexConfiguration => ({
  ...base,
  batchBlocks: BigInt(
    boundedInteger(environment.batchBlocks, "HISTORY_BATCH_BLOCKS", 1, 100_000),
  ),
  confirmationBlocks: BigInt(
    boundedInteger(
      environment.confirmationBlocks,
      "HISTORY_CONFIRMATION_BLOCKS",
      0,
      10_000,
    ),
  ),
  overlapBlocks: BigInt(
    boundedInteger(
      environment.overlapBlocks,
      "HISTORY_REORG_OVERLAP_BLOCKS",
      1,
      10_000,
    ),
  ),
  rpcConcurrency: boundedInteger(
    environment.rpcConcurrency,
    "HISTORY_RPC_CONCURRENCY",
    1,
    32,
  ),
  retryMaximumAttempts: boundedInteger(
    environment.retryMaximumAttempts,
    "HISTORY_RETRY_MAXIMUM_ATTEMPTS",
    1,
    10,
  ),
  retryBaseDelayMilliseconds: boundedInteger(
    environment.retryBaseDelayMilliseconds,
    "HISTORY_RETRY_BASE_DELAY_MILLISECONDS",
    1,
    60_000,
  ),
  maximumPageSize: boundedInteger(
    environment.maximumPageSize,
    "HISTORY_MAXIMUM_PAGE_SIZE",
    100,
    1_000,
  ),
  cursorSnapshotRetention: boundedInteger(
    environment.cursorSnapshotRetention,
    "HISTORY_CURSOR_SNAPSHOT_RETENTION",
    10,
    1_000_000,
  ),
});

export const loadHistoryRuntimeConfiguration = (
  repositoryRoot: string,
  mode: "service" | "once" = "service",
) =>
  Effect.gen(function* () {
    const environment = yield* environmentConfiguration;
    const rpcUrl = yield* validate(
      "HISTORY_RPC_URL, RPC_URL, or BASE_SEPOLIA_RPC_URL is required",
      () => {
        const selected = firstRpcUrl(environment);
        if (selected === undefined)
          throw new Error("History RPC URL is missing");
        return selected;
      },
    );
    const manifestPath = resolveRepositoryPath(
      repositoryRoot,
      environment.manifestPath,
      "deployments/84532.json",
    );
    const manifest = yield* readManifest(manifestPath);
    const index = yield* validate(
      "History index configuration is invalid",
      () =>
        validateHistoryIndexConfiguration(
          withEnvironmentOverrides(
            deriveHistoryIndexConfiguration(manifest),
            environment,
          ),
        ),
    );
    const port = yield* validate("HISTORY_PORT is invalid", () =>
      boundedInteger(environment.port, "HISTORY_PORT", 1, 65_535),
    );
    const pollSeconds = yield* validate("HISTORY_POLL_SECONDS is invalid", () =>
      boundedInteger(
        environment.pollSeconds,
        "HISTORY_POLL_SECONDS",
        1,
        86_400,
      ),
    );
    const keeperAttemptMaximumAgeSeconds = yield* validate(
      "KEEPER_ATTEMPT_MAXIMUM_AGE_SECONDS is invalid",
      () =>
        boundedInteger(
          environment.keeperAttemptMaximumAgeSeconds,
          "KEEPER_ATTEMPT_MAXIMUM_AGE_SECONDS",
          1,
          86_400,
        ),
    );
    const listener =
      mode === "service"
        ? yield* validate("History listener configuration is invalid", () =>
            resolveHistoryListenerPolicy({
              host: environment.host,
              readApiToken: Option.getOrUndefined(environment.readApiToken),
              ingestApiToken: Option.getOrUndefined(environment.ingestApiToken),
            }),
          )
        : undefined;
    if (listener !== undefined) {
      yield* validate("History listener configuration is invalid", () =>
        parseHistoryLoopbackUrl(`http://${listener.host}:${port}`),
      );
    }
    const configuredSubgraphUrl = Option.getOrUndefined(
      environment.uniswapV4SubgraphUrl,
    );
    const subgraphBearerToken = Option.getOrUndefined(
      environment.uniswapV4SubgraphBearerToken,
    );
    if (
      configuredSubgraphUrl === undefined &&
      subgraphBearerToken !== undefined
    ) {
      return yield* Effect.fail(
        new Error(
          "UNISWAP_V4_SUBGRAPH_URL is required when UNISWAP_V4_SUBGRAPH_BEARER_TOKEN is set",
        ),
      );
    }
    const uniswapV4Subgraph =
      configuredSubgraphUrl === undefined
        ? undefined
        : yield* validate(
            "Uniswap v4 subgraph configuration is invalid",
            () => ({
              url: subgraphUrl(configuredSubgraphUrl),
              bearerToken: subgraphBearerToken,
              timeoutMilliseconds: boundedInteger(
                environment.uniswapV4SubgraphTimeoutMilliseconds,
                "UNISWAP_V4_SUBGRAPH_TIMEOUT_MILLISECONDS",
                1_000,
                60_000,
              ),
              cacheMilliseconds:
                boundedInteger(
                  environment.uniswapV4SubgraphCacheSeconds,
                  "UNISWAP_V4_SUBGRAPH_CACHE_SECONDS",
                  1,
                  3_600,
                ) * 1_000,
            }),
          );
    return {
      rpcUrl,
      manifestPath,
      databasePath: resolveRepositoryPath(
        repositoryRoot,
        environment.databasePath,
        ".data/history/base-sepolia.sqlite",
      ),
      keeperAttemptDatabasePath: resolveRepositoryPath(
        repositoryRoot,
        environment.keeperAttemptDatabasePath,
        ".data/history/base-sepolia-keeper-attempts.sqlite",
      ),
      keeperAttemptMaximumAgeSeconds: BigInt(keeperAttemptMaximumAgeSeconds),
      listener,
      port,
      pollMilliseconds: pollSeconds * 1_000,
      index,
      uniswapV4Subgraph,
    } satisfies HistoryRuntimeConfiguration;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new HistoryConfigurationError({
          message:
            cause instanceof Error
              ? cause.message
              : "History configuration could not be loaded",
          cause,
        }),
    ),
  );
