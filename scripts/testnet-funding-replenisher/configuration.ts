import { isAbsolute, resolve } from "node:path";

import { getAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export interface ReplenishAmounts {
  readonly wethWei: bigint;
  readonly ethWei: bigint;
}

export interface ReplenishPolicy {
  /** Signer balance at or below which one top-up is due. */
  readonly minimum: ReplenishAmounts;
  /** The fixed amount one top-up moves. Never derived from a request. */
  readonly topUp: ReplenishAmounts;
  /** Ceiling per fixed 24-hour window, persisted so a restart cannot reset it. */
  readonly dailyLimit: ReplenishAmounts;
}

export interface ReplenisherEnvironment {
  readonly enabled: true;
  readonly rpcUrl: string;
  readonly privateKey: Hex;
  readonly treasury: Address;
  readonly signer: Address;
  readonly databasePath: string;
  readonly intervalMilliseconds: number;
  readonly policy: ReplenishPolicy;
}

/**
 * Disabled is a first-class state, not a startup failure. The supervisor stops
 * the whole backend group when any child exits, so a deployment that has not
 * provisioned a treasury has to leave this process running and idle rather
 * than take the funding worker and the API down with it.
 */
export type ReplenisherConfiguration =
  { readonly enabled: false } | ReplenisherEnvironment;

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
  if (value === undefined) return false;
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
    throw new Error("TESTNET_FUNDING_TREASURY_PRIVATE_KEY is invalid");
  }
  return normalized as Hex;
};

const rpcUrl = (environment: EnvironmentVariables): string => {
  const value =
    optional(environment, "RPC_URL") ??
    optional(environment, "BASE_SEPOLIA_RPC_URL");
  if (value === undefined) {
    throw new Error("RPC_URL or BASE_SEPOLIA_RPC_URL is required");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Replenisher RPC URL must use HTTP or HTTPS");
  }
  return value;
};

const positiveEther = (
  environment: EnvironmentVariables,
  name: string,
  fallback: string,
): bigint => {
  const parsed = parseEther(optional(environment, name) ?? fallback);
  if (parsed <= 0n) throw new Error(`${name} must be greater than zero`);
  return parsed;
};

const amounts = (
  environment: EnvironmentVariables,
  suffix: string,
  fallback: { readonly weth: string; readonly eth: string },
): ReplenishAmounts => ({
  ethWei: positiveEther(
    environment,
    `TESTNET_FUNDING_REPLENISH_${suffix}_ETH`,
    fallback.eth,
  ),
  wethWei: positiveEther(
    environment,
    `TESTNET_FUNDING_REPLENISH_${suffix}_WETH`,
    fallback.weth,
  ),
});

const intervalMilliseconds = (environment: EnvironmentVariables): number => {
  const value = Number(
    optional(environment, "TESTNET_FUNDING_REPLENISH_INTERVAL_SECONDS") ??
      "300",
  );
  if (!Number.isSafeInteger(value) || value < 30 || value > 86_400) {
    throw new Error(
      "TESTNET_FUNDING_REPLENISH_INTERVAL_SECONDS must be 30 to 86400",
    );
  }
  return value * 1_000;
};

const databasePath = (
  environment: EnvironmentVariables,
  repositoryRoot: string,
): string => {
  const configured =
    optional(environment, "TESTNET_FUNDING_REPLENISH_DATABASE_PATH") ??
    ".data/testnet-funding-replenisher.sqlite";
  const resolved = isAbsolute(configured)
    ? configured
    : resolve(repositoryRoot, configured);
  if (!resolved.endsWith(".sqlite")) {
    throw new Error(
      "TESTNET_FUNDING_REPLENISH_DATABASE_PATH must be a .sqlite file path",
    );
  }
  return resolved;
};

/**
 * A top-up larger than its own window ceiling could never be sent, and one that
 * does not clear the minimum would run every cycle forever. Both are
 * configuration mistakes that only surface as behaviour, so they fail closed.
 */
const validatePolicy = (policy: ReplenishPolicy): void => {
  const assets = [
    [
      "ETH",
      policy.minimum.ethWei,
      policy.topUp.ethWei,
      policy.dailyLimit.ethWei,
    ],
    [
      "WETH",
      policy.minimum.wethWei,
      policy.topUp.wethWei,
      policy.dailyLimit.wethWei,
    ],
  ] as const;
  for (const [label, minimum, topUp, dailyLimit] of assets) {
    if (topUp > dailyLimit) {
      throw new Error(
        `TESTNET_FUNDING_REPLENISH_TOPUP_${label} exceeds its daily limit`,
      );
    }
    if (topUp <= minimum) {
      throw new Error(
        `TESTNET_FUNDING_REPLENISH_TOPUP_${label} must exceed its minimum`,
      );
    }
  }
};

export const resolveReplenisherEnvironment = (
  environment: EnvironmentVariables,
  repositoryRoot: string,
): ReplenisherConfiguration => {
  // Everything below is required, because an armed replenisher that cannot
  // read its own bounds would move funds on a guess.
  if (
    !boolean(
      optional(environment, "TESTNET_FUNDING_REPLENISH_ENABLED"),
      "TESTNET_FUNDING_REPLENISH_ENABLED",
    )
  ) {
    return { enabled: false };
  }
  const key = privateKey(
    required(environment, "TESTNET_FUNDING_TREASURY_PRIVATE_KEY"),
  );
  // The address is configured beside its secret so a swapped key fails before
  // it can move anything, exactly as the funding signer binds its own pair.
  const treasury = getAddress(
    required(environment, "TESTNET_FUNDING_TREASURY_ADDRESS"),
  );
  if (privateKeyToAccount(key).address !== treasury) {
    throw new Error(
      "TESTNET_FUNDING_TREASURY_ADDRESS does not match its private key",
    );
  }
  const signer = getAddress(
    required(environment, "TESTNET_FUNDING_SIGNER_ADDRESS"),
  );
  if (signer === treasury) {
    throw new Error("The treasury cannot replenish itself");
  }
  const policy: ReplenishPolicy = {
    dailyLimit: amounts(environment, "DAILY", { eth: "0.4", weth: "4" }),
    minimum: amounts(environment, "MINIMUM", { eth: "0.02", weth: "0.2" }),
    topUp: amounts(environment, "TOPUP", { eth: "0.2", weth: "2" }),
  };
  validatePolicy(policy);
  return {
    databasePath: databasePath(environment, repositoryRoot),
    enabled: true,
    intervalMilliseconds: intervalMilliseconds(environment),
    policy,
    privateKey: key,
    rpcUrl: rpcUrl(environment),
    signer,
    treasury,
  };
};
