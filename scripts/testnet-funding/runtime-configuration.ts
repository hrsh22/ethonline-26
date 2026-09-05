import { isAbsolute, resolve } from "node:path";

import { getAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { TestnetFundingAbusePolicy } from "./abuse-controls.ts";
import type { TestnetFundingPolicy } from "./policy.ts";

type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export interface TestnetFundingEnvironment {
  readonly enabled: boolean;
  readonly rpcUrl: string | undefined;
  readonly apiToken: string;
  readonly privateKey: Hex | undefined;
  readonly signer: Address;
  readonly databasePath: string;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly policy: TestnetFundingPolicy;
  readonly abusePolicy: TestnetFundingAbusePolicy;
  readonly proofDomain: string;
}

const required = (environment: EnvironmentVariables, name: string): string => {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const optional = (
  environment: EnvironmentVariables,
  name: string,
): string | undefined => {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const boolean = (value: string | undefined, name: string): boolean => {
  if (value === undefined || value.trim().length === 0) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
};

const privateKey = (value: string): Hex => {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (
    !/^0x[0-9a-fA-F]{64}$/u.test(normalized) ||
    /^0x0{64}$/u.test(normalized)
  ) {
    throw new Error("TESTNET_FUNDING_SIGNER_PRIVATE_KEY is invalid");
  }
  return normalized as Hex;
};

const rpcUrl = (value: string): string => {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Funding RPC URL must use HTTP or HTTPS");
  }
  return value;
};

const port = (value: string | undefined): number => {
  const parsed = value === undefined ? 8_790 : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("TESTNET_FUNDING_PORT must be a valid TCP port");
  }
  return parsed;
};

const databasePath = (
  value: string | undefined,
  repositoryRoot: string,
): string => {
  const selected = value ?? ".data/testnet-funding.sqlite";
  if (selected === ":memory:") {
    throw new Error("The funding worker requires a persistent SQLite database");
  }
  return isAbsolute(selected) ? selected : resolve(repositoryRoot, selected);
};

const resolveApiToken = (environment: EnvironmentVariables): string => {
  const value = required(environment, "TESTNET_FUNDING_API_TOKEN");
  if (value.length < 32) {
    throw new Error("Funding API token must contain at least 32 characters");
  }
  return value;
};

const resolvePrivateKey = (
  environment: EnvironmentVariables,
  enabled: boolean,
  signer: Address,
): Hex | undefined => {
  const value = optional(environment, "TESTNET_FUNDING_SIGNER_PRIVATE_KEY");
  const resolved = value === undefined ? undefined : privateKey(value);
  if (enabled && resolved === undefined) {
    throw new Error(
      "TESTNET_FUNDING_SIGNER_PRIVATE_KEY is required when enabled",
    );
  }
  if (
    resolved !== undefined &&
    privateKeyToAccount(resolved).address !== signer
  ) {
    throw new Error("Funding signer address does not match its private key");
  }
  return resolved;
};

const resolveRpcUrl = (
  environment: EnvironmentVariables,
  enabled: boolean,
): string | undefined => {
  const selected =
    optional(environment, "RPC_URL") ??
    optional(environment, "BASE_SEPOLIA_RPC_URL");
  if (enabled && selected === undefined) {
    throw new Error("RPC_URL or BASE_SEPOLIA_RPC_URL is required when enabled");
  }
  return selected === undefined ? undefined : rpcUrl(selected);
};

const resolveHost = (environment: EnvironmentVariables): "127.0.0.1" => {
  const value = optional(environment, "TESTNET_FUNDING_HOST") ?? "127.0.0.1";
  if (value !== "127.0.0.1") {
    throw new Error(
      "The funding worker must bind to the IPv4 loopback address",
    );
  }
  return value;
};

/**
 * The domain a wallet-control proof must be bound to. It must match the site
 * the collector signs from, so a proof issued elsewhere cannot be replayed.
 */
const resolveProofDomain = (
  environment: EnvironmentVariables,
  enabled: boolean,
): string => {
  const configured = optional(environment, "TESTNET_FUNDING_PROOF_DOMAIN");
  if (configured !== undefined && configured.trim() !== "") {
    return configured.trim();
  }
  const appUrl = optional(environment, "NEXT_PUBLIC_APP_URL");
  if (appUrl === undefined || appUrl.trim() === "") {
    // A disabled service issues no challenges, so it needs no binding. An
    // enabled service must know the domain a proof is valid for.
    if (!enabled) return "funding-disabled.invalid";
    throw new TypeError(
      "TESTNET_FUNDING_PROOF_DOMAIN or NEXT_PUBLIC_APP_URL is required to bind funding proofs",
    );
  }
  try {
    return new URL(appUrl.trim()).host;
  } catch {
    throw new TypeError(
      "NEXT_PUBLIC_APP_URL must be an absolute URL to derive the funding proof domain",
    );
  }
};

export const resolveTestnetFundingEnvironment = (
  environment: EnvironmentVariables,
  repositoryRoot: string,
): TestnetFundingEnvironment => {
  const enabled = boolean(
    optional(environment, "TESTNET_FUNDING_ENABLED"),
    "TESTNET_FUNDING_ENABLED",
  );
  const apiToken = resolveApiToken(environment);
  const signer = getAddress(
    required(environment, "TESTNET_FUNDING_SIGNER_ADDRESS"),
  );
  const resolvedPrivateKey = resolvePrivateKey(environment, enabled, signer);
  const selectedRpcUrl = resolveRpcUrl(environment, enabled);
  const host = resolveHost(environment);
  return {
    enabled,
    rpcUrl: selectedRpcUrl,
    apiToken,
    privateKey: resolvedPrivateKey,
    signer,
    databasePath: databasePath(
      optional(environment, "TESTNET_FUNDING_DATABASE_PATH"),
      repositoryRoot,
    ),
    host,
    port: port(optional(environment, "TESTNET_FUNDING_PORT")),
    policy: {
      target: {
        wethWei: parseEther("0.1"),
        ethWei: parseEther("0.01"),
      },
      reserve: {
        wethWei: parseEther("0.1"),
        ethWei: parseEther("0.01"),
      },
      lifetimeLimit: {
        wethWei: parseEther("0.2"),
        ethWei: parseEther("0.02"),
      },
      cooldownMilliseconds: 86_400_000,
      reconciliationTimeoutMilliseconds: 120_000,
      requestLeaseMilliseconds: 600_000,
    },
    // Service-wide bounds. Per-recipient limits cannot stop one actor cycling
    // fresh addresses, so total daily spend and per-client rate are bounded
    // too. Both are persisted, so a restart does not reset them.
    abusePolicy: {
      dailyBudget: {
        wethWei: parseEther("2"),
        ethWei: parseEther("0.2"),
      },
      dailyGrantLimit: 20,
      clientWindowMilliseconds: 3_600_000,
      clientWindowLimit: 5,
      elevatedUsageRatio: 0.6,
      criticalUsageRatio: 0.9,
    },
    proofDomain: resolveProofDomain(environment, enabled),
  };
};
