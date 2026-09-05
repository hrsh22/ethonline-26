import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export type RuntimeService =
  | "api"
  | "funding"
  | "funding-launcher"
  | "funding-replenisher"
  | "funding-replenisher-launcher"
  | "history"
  | "operator"
  | "web";

export interface RuntimeEnvironmentSourceOptions {
  readonly environment: EnvironmentVariables;
  readonly path: string;
  readonly required: boolean;
}

const runtimeVariableNames = [
  "CI",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
] as const;

const publicApiVariableNames = [
  "ADMIN_AUTH_APP_ORIGIN",
  "ADMIN_AUTH_CHALLENGE_TTL_SECONDS",
  "ADMIN_AUTH_DATABASE_PATH",
  "ADMIN_AUTH_MANIFEST_PATH",
  "ADMIN_AUTH_RPC_URL",
  "ADMIN_AUTH_SESSION_TTL_SECONDS",
  "HISTORY_INDEX_URL",
  "HISTORY_READ_API_TOKEN",
  // The API is the only process that may reach the operator control surface;
  // the browser never holds this token. Without both names projected here, the
  // proxy silently resolves to "not configured" and the console cannot work.
  "OPERATOR_CONTROL_API_TOKEN",
  "OPERATOR_CONTROL_URL",
  "PUBLIC_API_ALLOWED_ORIGINS",
  "PUBLIC_API_HOST",
  "PUBLIC_API_MAXIMUM_REQUEST_BODY_BYTES",
  "PUBLIC_API_PORT",
  "PUBLIC_API_RATE_LIMIT_MAXIMUM_CLIENTS",
  "PUBLIC_API_RATE_LIMIT_MAXIMUM_REQUESTS",
  "PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS",
  "PUBLIC_API_TRUST_PROXY",
  "PUBLIC_API_UPSTREAM_TIMEOUT_MILLISECONDS",
  "TESTNET_FUNDING_API_TOKEN",
  "TESTNET_FUNDING_SERVICE_URL",
] as const;

const historyVariableNames = [
  "BASE_SEPOLIA_RPC_URL",
  "HISTORY_BATCH_BLOCKS",
  "HISTORY_CONFIRMATION_BLOCKS",
  "HISTORY_CURSOR_SNAPSHOT_RETENTION",
  "HISTORY_DATABASE_PATH",
  "HISTORY_HOST",
  "HISTORY_INGEST_API_TOKEN",
  "HISTORY_MANIFEST_PATH",
  "HISTORY_MAXIMUM_PAGE_SIZE",
  "HISTORY_POLL_SECONDS",
  "HISTORY_PORT",
  "HISTORY_REORG_OVERLAP_BLOCKS",
  "HISTORY_RETRY_BASE_DELAY_MILLISECONDS",
  "HISTORY_RETRY_MAXIMUM_ATTEMPTS",
  "HISTORY_READ_API_TOKEN",
  "HISTORY_RPC_CONCURRENCY",
  "HISTORY_RPC_URL",
  "KEEPER_ATTEMPT_DATABASE_PATH",
  "KEEPER_ATTEMPT_MAXIMUM_AGE_SECONDS",
  "RPC_URL",
  "UNISWAP_V4_SUBGRAPH_BEARER_TOKEN",
  "UNISWAP_V4_SUBGRAPH_CACHE_SECONDS",
  "UNISWAP_V4_SUBGRAPH_TIMEOUT_MILLISECONDS",
  "UNISWAP_V4_SUBGRAPH_URL",
] as const;

const fundingVariableNames = [
  "BASE_SEPOLIA_RPC_URL",
  // A wallet-control proof is bound to the domain the collector signs from, so
  // an enabled signer needs that domain. It reads the explicit override first
  // and derives the host from the app origin otherwise; projecting neither left
  // the worker unable to start at all.
  "NEXT_PUBLIC_APP_URL",
  "RPC_URL",
  "TESTNET_FUNDING_API_TOKEN",
  "TESTNET_FUNDING_DATABASE_PATH",
  "TESTNET_FUNDING_ENABLED",
  "TESTNET_FUNDING_HOST",
  "TESTNET_FUNDING_PORT",
  "TESTNET_FUNDING_PROOF_DOMAIN",
  "TESTNET_FUNDING_SIGNER_ADDRESS",
  "TESTNET_FUNDING_SIGNER_PRIVATE_KEY",
] as const;

const fundingLauncherVariableNames = [
  ...fundingVariableNames,
  "TESTNET_FUNDING_ENV_PATH",
] as const;

// The treasury key lives only here. Nothing in this list overlaps the funding
// signer's allowlist, so a compromise of the internet-facing worker cannot
// reach the wallet that refills it.
const replenisherVariableNames = [
  "BASE_SEPOLIA_RPC_URL",
  "RPC_URL",
  "TESTNET_FUNDING_REPLENISH_DAILY_ETH",
  "TESTNET_FUNDING_REPLENISH_DAILY_WETH",
  "TESTNET_FUNDING_REPLENISH_DATABASE_PATH",
  "TESTNET_FUNDING_REPLENISH_ENABLED",
  "TESTNET_FUNDING_REPLENISH_INTERVAL_SECONDS",
  "TESTNET_FUNDING_REPLENISH_MINIMUM_ETH",
  "TESTNET_FUNDING_REPLENISH_MINIMUM_WETH",
  "TESTNET_FUNDING_REPLENISH_TOPUP_ETH",
  "TESTNET_FUNDING_REPLENISH_TOPUP_WETH",
  "TESTNET_FUNDING_SIGNER_ADDRESS",
  "TESTNET_FUNDING_TREASURY_ADDRESS",
  "TESTNET_FUNDING_TREASURY_PRIVATE_KEY",
] as const;

const replenisherLauncherVariableNames = [
  ...replenisherVariableNames,
  "TESTNET_FUNDING_REPLENISH_ENV_PATH",
] as const;

const operatorVariableNames = [
  "BASE_SEPOLIA_RPC_URL",
  "DEPLOYMENT_MANIFEST_PATH",
  // Signed control-plane commands are domain-bound to the web origin, so the
  // control surface must expect the same host the browser signs with.
  "NEXT_PUBLIC_APP_URL",
  "HISTORY_INGEST_API_TOKEN",
  "HISTORY_INDEX_URL",
  "KEEPER_ATTEMPT_OUTBOX_PATH",
  "OPERATOR_CONTROL_API_TOKEN",
  "OPERATOR_CONTROL_DATABASE_PATH",
  "OPERATOR_CONTROL_RUN_ID",
  "OPERATOR_CONTROL_HOST",
  "OPERATOR_CONTROL_PORT",
  "OPERATOR_EVIDENCE_PATH",
  "OPERATOR_EXECUTE",
  "OPERATOR_INTERVAL_SECONDS",
  "OPERATOR_KEEPER_PRIVATE_KEY",
  "OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY",
  "OPERATOR_MINIMUM_OUTPUT_BPS",
  "OPERATOR_POL_MAXIMUM_WETH_PER_CYCLE",
  "OPERATOR_POL_MINIMUM_QUEUE_WETH",
  "OPERATOR_POL_STALE_QUEUE_SECONDS",
  "OPERATOR_POL_TARGET_WETH_PER_CYCLE",
  "OPERATOR_PRIVATE_KEY",
  "RPC_URL",
] as const;

const webVariableNames = [
  "HOSTNAME",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
  "NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT",
  "NEXT_PUBLIC_REOWN_PROJECT_ID",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_TELEMETRY_DISABLED",
  "NODE_ENV",
  "PORT",
  "__NEXT_PROCESSED_ENV",
] as const;

const serviceVariableNames = {
  api: publicApiVariableNames,
  funding: fundingVariableNames,
  "funding-launcher": fundingLauncherVariableNames,
  "funding-replenisher": replenisherVariableNames,
  "funding-replenisher-launcher": replenisherLauncherVariableNames,
  history: historyVariableNames,
  operator: operatorVariableNames,
  web: webVariableNames,
} as const satisfies Readonly<Record<RuntimeService, readonly string[]>>;

const selectEnvironmentVariables = (
  environment: EnvironmentVariables,
  names: readonly string[],
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );

export const readRuntimeEnvironmentSource = ({
  environment,
  path,
  required,
}: RuntimeEnvironmentSourceOptions): EnvironmentVariables => ({
  ...(required || existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}),
  ...environment,
});

export const createRuntimeServiceEnvironment = (
  service: RuntimeService,
  environment: EnvironmentVariables,
  serviceOverrides: EnvironmentVariables = {},
): NodeJS.ProcessEnv => ({
  ...createRuntimeProcessEnvironment(environment),
  ...selectEnvironmentVariables(
    {
      ...environment,
      ...serviceOverrides,
      ...(service === "web" ? { __NEXT_PROCESSED_ENV: "true" } : {}),
    },
    serviceVariableNames[service],
  ),
});

export const createRuntimeProcessEnvironment = (
  environment: EnvironmentVariables,
): NodeJS.ProcessEnv =>
  selectEnvironmentVariables(environment, runtimeVariableNames);

export const replaceProcessEnvironment = (
  isolated: NodeJS.ProcessEnv,
): void => {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, isolated);
};

export interface RuntimeServiceProcessOptions {
  readonly arguments: readonly string[];
  readonly command: string;
  readonly cwd?: string;
  readonly environment: EnvironmentVariables;
  readonly service: RuntimeService;
  readonly stdio?: SpawnOptions["stdio"];
}

export const spawnRuntimeServiceProcess = ({
  arguments: arguments_,
  command,
  cwd,
  environment,
  service,
  stdio = "inherit",
}: RuntimeServiceProcessOptions): ChildProcess =>
  spawn(command, [...arguments_], {
    ...(cwd === undefined ? {} : { cwd }),
    env: createRuntimeServiceEnvironment(service, environment),
    stdio,
  });
