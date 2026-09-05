import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";
import {
  DEFAULT_POL_BUDGET_POLICY,
  planWethOnlyPolCycle,
  validatePolBudgetPolicy,
  validatePolSimulation,
  type PolBudgetPolicy,
  type PolCyclePlan,
  type ReadyPolCyclePlan,
} from "@orbit/protocol/pol-planner";
import { Effect, Schema } from "effect";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseEther,
  parseAbi,
  toHex,
} from "viem";
import type {
  Abi,
  Address,
  Hex,
  SimulateContractParameters,
  WriteContractParameters,
} from "viem";
import {
  parseHistoryLoopbackUrl,
  parseHistoryCredential,
} from "@orbit/config/history-runtime";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import {
  DEFAULT_POL_STALE_QUEUE_SECONDS,
  observeEligiblePolQueue,
  previousPolQueueFirstObservedAt,
  writeOperatorEvidenceAtomically,
} from "./base-sepolia-operator-observability.ts";
import { operatorDiagnostic } from "./base-sepolia-operator-diagnostic.ts";
import { maintainBaseSepoliaDiscovery } from "./discovery-maintenance.ts";
import {
  bindOperatorActors,
  type OperatorAccounts,
  type OperatorActors,
  type OperatorAuthorization,
} from "./base-sepolia-operator-identity.ts";
import {
  minimumOutputFromQuote,
  nextRewardEpochAt,
  rewardEpochIsEligible,
  trackExecutionInput,
} from "@orbit/protocol/operator-policy";
import {
  readLaunchedBaseSepoliaManifest,
  resolveRepositoryPath,
} from "./base-sepolia-manifest.ts";
import {
  createKeeperAttemptRecorder,
  type KeeperAttemptMilestone,
  type KeeperAttemptRecorder,
  type KeeperRunStartedMilestone,
} from "./keeper-attempt-client.ts";
import {
  acquireKeeperAttemptOutbox,
  deliverSubmittedKeeperAttempt,
  replayKeeperAttemptOutbox,
  type KeeperAttemptOutbox,
} from "./keeper-attempt-outbox.ts";
import { deriveHistoryIndexConfiguration } from "./history-indexer/configuration.ts";
import { openOperatorControlStore } from "./operator-control/store.ts";
import type { KeeperAttemptFailureClass } from "./history-indexer/keeper-attempt-store.ts";
import {
  decodeEnvironment,
  ensure,
  fileSystem,
  nonBlankString,
  rpc,
  runMain,
  validate,
} from "./effect-runtime.ts";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const TRACK_IDS = [1, 2, 3, 4] as const;
const OperatorEnvironmentSchema = Schema.Struct({
  RPC_URL: Schema.optional(Schema.String),
  BASE_SEPOLIA_RPC_URL: Schema.optional(Schema.String),
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(Schema.String),
  OPERATOR_EVIDENCE_PATH: Schema.optional(Schema.String),
  OPERATOR_EXECUTE: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false,
  }),
  OPERATOR_CONTROL_DATABASE_PATH: Schema.optional(
    Schema.String.pipe(Schema.minLength(1)),
  ),
  OPERATOR_CONTROL_RUN_ID: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^[0-9a-f-]{36}$/u)),
  ),
  OPERATOR_MINIMUM_OUTPUT_BPS: Schema.optional(Schema.String),
  OPERATOR_POL_MINIMUM_QUEUE_WETH: Schema.optional(Schema.String),
  OPERATOR_POL_TARGET_WETH_PER_CYCLE: Schema.optional(Schema.String),
  OPERATOR_POL_MAXIMUM_WETH_PER_CYCLE: Schema.optional(Schema.String),
  OPERATOR_POL_STALE_QUEUE_SECONDS: Schema.optional(Schema.String),
  OPERATOR_PRIVATE_KEY: Schema.optional(Schema.String),
  OPERATOR_KEEPER_PRIVATE_KEY: Schema.optional(Schema.String),
  OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: Schema.optional(Schema.String),
  HISTORY_INDEX_URL: Schema.optional(Schema.String),
  HISTORY_INGEST_API_TOKEN: Schema.optional(Schema.String),
  KEEPER_ATTEMPT_OUTBOX_PATH: Schema.optional(Schema.String),
});

type OperatorEnvironmentBindings = typeof OperatorEnvironmentSchema.Type;
type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const conversionVenueAbi = parseAbi([
  "function quoteExactInput(address tokenIn,address tokenOut,uint256 amountIn) returns (uint256)",
]);

export type TrackId = (typeof TRACK_IDS)[number];
export type OperatorActionKind =
  "reward-epoch" | "reward-track-or-retry" | "protocol-liquidity";
export type OperatorActionStatus =
  "not-eligible" | "simulated" | "confirmed" | "failed" | "submitted-unknown";

export interface OperatorActionEvidence {
  readonly kind: OperatorActionKind;
  readonly status: OperatorActionStatus;
  readonly reason: string;
  readonly track?: TrackId;
  readonly quotedOutput?: bigint;
  readonly minimumOutput?: bigint;
  readonly liquidityPlan?: PolCyclePlan;
  readonly simulatedConsumptionWeth?: bigint;
  readonly transactionHash?: Hex;
  readonly blockNumber?: bigint;
  readonly failureClass?: KeeperAttemptFailureClass;
  readonly planningBlock?: OperatorBlockIdentity;
  readonly quoteBlock?: OperatorBlockIdentity;
  readonly preflightBlock?: OperatorBlockIdentity;
  readonly replanRequired?: boolean;
}

export interface OperatorBlockIdentity {
  readonly number: bigint;
  readonly hash: Hex;
  readonly timestamp: bigint;
}

export interface OperatorState {
  readonly block: OperatorBlockIdentity;
  readonly keeper: Address;
  readonly liquidityExecutor: Address;
  readonly converterConfigurationSealed: boolean;
  readonly converterPaused: boolean;
  readonly rewardEpochCount: bigint;
  readonly lastRewardEpochAt: bigint;
  readonly rewardPotWeth: bigint;
  readonly trackQueues: Readonly<Record<TrackId, bigint>>;
  readonly trackConfigurations: Readonly<
    Record<TrackId, { readonly stockToken: Address; readonly adapter: Address }>
  >;
  readonly liquidityConfigurationSealed: boolean;
  readonly liquidityPaused: boolean;
  readonly liquidityPotWeth: bigint;
  readonly queuedLiquidityWeth: bigint;
  readonly currentTick: number;
}

export type OperatorActionIntent =
  | { readonly kind: "reward-epoch" }
  | {
      readonly kind: "reward-track-or-retry";
      readonly track: TrackId;
      readonly wethInput: bigint;
      readonly minimumOutputBps: number;
      readonly deadline: bigint;
    }
  | {
      readonly kind: "protocol-liquidity";
      readonly plan: ReadyPolCyclePlan;
    };

export interface OperatorEnvironment {
  readonly controlGrant?:
    { readonly databasePath: string; readonly runId: string } | undefined;
  readonly rpcUrl: string;
  readonly manifestPath: string;
  readonly evidencePath: string;
  readonly execute: boolean;
  readonly minimumOutputBps: number;
  readonly polPolicy: PolBudgetPolicy;
  readonly polStaleQueueSeconds: bigint;
  readonly keeperPrivateKey: Hex | undefined;
  readonly liquidityExecutorPrivateKey: Hex | undefined;
  readonly historyIndexUrl: string;
  readonly historyIngestApiToken: string | undefined;
  readonly keeperAttemptOutboxPath: string;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const normalizePrivateKey = (
  value: string | undefined,
  variableName:
    | "OPERATOR_PRIVATE_KEY"
    | "OPERATOR_KEEPER_PRIVATE_KEY"
    | "OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY",
): Hex | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized) || /^0x0{64}$/.test(normalized)) {
    throw new Error(`${variableName} is invalid`);
  }
  return normalized as Hex;
};

const parseMinimumOutputBps = (value: string | undefined): number => {
  const parsed = Number(value ?? "9900");
  minimumOutputFromQuote(1_000_000n, parsed);
  return parsed;
};

const parseWethPolicyValue = (
  value: string | undefined,
  fallback: bigint,
  label: string,
): bigint => {
  const normalized = nonBlankString(value);
  if (normalized === undefined) return fallback;
  try {
    return parseEther(normalized);
  } catch {
    throw new Error(`${label} must be a decimal WETH amount`);
  }
};

const parsePolPolicy = (
  decoded: OperatorEnvironmentBindings,
): PolBudgetPolicy =>
  validatePolBudgetPolicy({
    minimumQueueWeth: parseWethPolicyValue(
      decoded.OPERATOR_POL_MINIMUM_QUEUE_WETH,
      DEFAULT_POL_BUDGET_POLICY.minimumQueueWeth,
      "POL minimum queue WETH",
    ),
    targetWethPerCycle: parseWethPolicyValue(
      decoded.OPERATOR_POL_TARGET_WETH_PER_CYCLE,
      DEFAULT_POL_BUDGET_POLICY.targetWethPerCycle,
      "POL target WETH",
    ),
    maximumWethPerCycle: parseWethPolicyValue(
      decoded.OPERATOR_POL_MAXIMUM_WETH_PER_CYCLE,
      DEFAULT_POL_BUDGET_POLICY.maximumWethPerCycle,
      "POL maximum WETH",
    ),
  });

const parsePolStaleQueueSeconds = (value: string | undefined): bigint => {
  const normalized = nonBlankString(value);
  if (normalized === undefined) return DEFAULT_POL_STALE_QUEUE_SECONDS;
  if (!/^\d+$/.test(normalized) || BigInt(normalized) === 0n) {
    throw new Error("POL stale queue seconds must be a positive integer");
  }
  return BigInt(normalized);
};

const operatorControlGrant = (
  decoded: OperatorEnvironmentBindings,
  root: string,
): OperatorEnvironment["controlGrant"] => {
  const databasePath = decoded.OPERATOR_CONTROL_DATABASE_PATH;
  const runId = decoded.OPERATOR_CONTROL_RUN_ID;
  if (databasePath === undefined) {
    if (runId !== undefined)
      throw new Error("An operator control grant requires its database path");
    return undefined;
  }
  if (runId === undefined) {
    if (decoded.OPERATOR_EXECUTE)
      throw new Error(
        "Controlled execution requires a supervisor-issued run grant",
      );
    return undefined;
  }
  return {
    databasePath: resolveRepositoryPath(root, databasePath, databasePath),
    runId,
  };
};

const operatorEnvironment = (
  decoded: OperatorEnvironmentBindings,
  root: string,
): OperatorEnvironment => {
  const rpcUrl =
    nonBlankString(decoded.RPC_URL) ??
    nonBlankString(decoded.BASE_SEPOLIA_RPC_URL);
  if (rpcUrl === undefined) {
    throw new Error("RPC_URL or BASE_SEPOLIA_RPC_URL is required");
  }
  const sharedPrivateKey = normalizePrivateKey(
    nonBlankString(decoded.OPERATOR_PRIVATE_KEY),
    "OPERATOR_PRIVATE_KEY",
  );
  const keeperPrivateKey = normalizePrivateKey(
    nonBlankString(decoded.OPERATOR_KEEPER_PRIVATE_KEY) ?? sharedPrivateKey,
    "OPERATOR_KEEPER_PRIVATE_KEY",
  );
  const liquidityExecutorPrivateKey = normalizePrivateKey(
    nonBlankString(decoded.OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY) ??
      sharedPrivateKey,
    "OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY",
  );
  if (
    decoded.OPERATOR_EXECUTE &&
    (keeperPrivateKey === undefined ||
      liquidityExecutorPrivateKey === undefined)
  ) {
    throw new Error(
      "OPERATOR_EXECUTE=true requires OPERATOR_PRIVATE_KEY or both OPERATOR_KEEPER_PRIVATE_KEY and OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY",
    );
  }
  return {
    controlGrant: operatorControlGrant(decoded, root),
    rpcUrl,
    manifestPath: resolveRepositoryPath(
      root,
      nonBlankString(decoded.DEPLOYMENT_MANIFEST_PATH),
      "deployments/84532.json",
    ),
    evidencePath: resolveRepositoryPath(
      root,
      nonBlankString(decoded.OPERATOR_EVIDENCE_PATH),
      ".scratch/base-sepolia-operator.json",
    ),
    execute: decoded.OPERATOR_EXECUTE,
    minimumOutputBps: parseMinimumOutputBps(
      nonBlankString(decoded.OPERATOR_MINIMUM_OUTPUT_BPS),
    ),
    polPolicy: parsePolPolicy(decoded),
    polStaleQueueSeconds: parsePolStaleQueueSeconds(
      decoded.OPERATOR_POL_STALE_QUEUE_SECONDS,
    ),
    keeperPrivateKey,
    liquidityExecutorPrivateKey,
    historyIndexUrl: parseHistoryLoopbackUrl(
      decoded.HISTORY_INDEX_URL === undefined ||
        decoded.HISTORY_INDEX_URL.length === 0
        ? "http://127.0.0.1:8787"
        : decoded.HISTORY_INDEX_URL,
    ),
    historyIngestApiToken: parseHistoryCredential(
      decoded.HISTORY_INGEST_API_TOKEN,
      "HISTORY_INGEST_API_TOKEN",
    ),
    keeperAttemptOutboxPath: resolveRepositoryPath(
      root,
      nonBlankString(decoded.KEEPER_ATTEMPT_OUTBOX_PATH),
      ".data/operator/base-sepolia-keeper-attempt-outbox.sqlite",
    ),
  };
};

const decodeOperatorEnvironment = Schema.decodeUnknownSync(
  OperatorEnvironmentSchema,
);

export const resolveOperatorEnvironment = (
  environment: EnvironmentVariables,
  root: string,
): OperatorEnvironment =>
  operatorEnvironment(decodeOperatorEnvironment(environment), root);

const loadOperatorEnvironment = Effect.gen(function* () {
  const decoded = yield* decodeEnvironment(
    OperatorEnvironmentSchema,
    "Base Sepolia operator environment is invalid",
  );
  return yield* validate("Base Sepolia operator configuration is invalid", () =>
    operatorEnvironment(decoded, repositoryRoot),
  );
});

const makeClients = (
  environment: OperatorEnvironment,
  assertMaySign?: () => void,
) => {
  const transport = http(environment.rpcUrl, {
    retryCount: 6,
    retryDelay: 250,
    timeout: 30_000,
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const roleClient = (privateKey: Hex | undefined) => {
    const account =
      privateKey === undefined ? undefined : privateKeyToAccount(privateKey);
    const walletClient =
      account === undefined
        ? undefined
        : createWalletClient({ account, chain: baseSepolia, transport });
    return { account, walletClient };
  };
  return {
    assertMaySign,
    publicClient,
    roles: {
      keeper: roleClient(environment.keeperPrivateKey),
      "liquidity-executor": roleClient(environment.liquidityExecutorPrivateKey),
    },
  };
};

type OperatorClients = ReturnType<typeof makeClients>;
type ProtocolContracts = ReturnType<typeof createProtocolContracts>;

export interface OperatorChain {
  readonly accounts: OperatorAccounts;
  readonly getChainId: () => Promise<number>;
  readonly observe: (request?: {
    readonly minimumBlock?: bigint;
  }) => Promise<OperatorState>;
  readonly attempt: (
    request: {
      readonly actors: OperatorActors;
      readonly execute: boolean;
      readonly planningState: OperatorState;
      readonly intent: OperatorActionIntent;
    },
    observer: OperatorCallObserver,
  ) => Promise<OperatorActionEvidence>;
  readonly reconcileSubmission?: (
    transactionHash: Hex,
  ) => Promise<OperatorSubmissionResolution>;
  readonly rebroadcastSubmission?: (rawTransaction: Hex) => Promise<Hex>;
}

export type OperatorSubmissionResolution =
  | {
      readonly status: "confirmed" | "reverted";
      readonly blockNumber: bigint;
    }
  | {
      readonly status: "submitted-unknown";
      readonly reason: string;
      readonly failureClass: "receipt-unavailable" | "canonicality-uncertain";
    };

export interface OperatorWorkflowDependencies {
  readonly chain: OperatorChain;
  readonly recorder: KeeperAttemptRecorder;
  readonly outbox: KeeperAttemptOutbox;
  readonly runId: string;
}

const readCurrentTick = async (
  clients: OperatorClients,
  contracts: ProtocolContracts,
  manifest: ProtocolDeploymentManifest,
  blockNumber: bigint,
): Promise<number> => {
  const poolStateSlot = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [manifest.canonicalPool.poolId as Hex, 6n],
      ),
    ),
  );
  const packedSlot0 = BigInt(
    await clients.publicClient.readContract({
      address: contracts.uniswapV4PoolManager.address,
      abi: contracts.uniswapV4PoolManager.abi,
      functionName: "extsload",
      args: [toHex(poolStateSlot, { size: 32 })],
      blockNumber,
    }),
  );
  const rawTick = Number((packedSlot0 >> 160n) & 0xff_ffffn);
  return rawTick >= 0x80_0000 ? rawTick - 0x100_0000 : rawTick;
};

const readOperatorState = async (
  clients: OperatorClients,
  contracts: ProtocolContracts,
  manifest: ProtocolDeploymentManifest,
): Promise<OperatorState> => {
  const block = decodeOperatorBlockIdentity(
    await clients.publicClient.getBlock(),
    "Operator observation header",
  );
  const converter = contracts.epochConverter;
  const liquidity = contracts.protocolLiquidityVault;
  const hook = contracts.canonicalFeeHook;
  const readConverter = <
    Name extends
      | "keeper"
      | "configurationSealed"
      | "paused"
      | "rewardEpochCount"
      | "lastRewardEpochAt",
  >(
    functionName: Name,
  ) =>
    clients.publicClient.readContract({
      address: converter.address,
      abi: converter.abi,
      functionName,
      blockNumber: block.number,
    });
  const trackQueues = Promise.all(
    TRACK_IDS.map((track) =>
      clients.publicClient.readContract({
        address: converter.address,
        abi: converter.abi,
        functionName: "trackQueue",
        args: [track],
        blockNumber: block.number,
      }),
    ),
  );
  const trackConfigurations = Promise.all(
    TRACK_IDS.map((track) =>
      clients.publicClient.readContract({
        address: converter.address,
        abi: converter.abi,
        functionName: "trackConfiguration",
        args: [track],
        blockNumber: block.number,
      }),
    ),
  );
  const [
    keeper,
    converterConfigurationSealed,
    converterPaused,
    rewardEpochCount,
    lastRewardEpochAt,
    rewardPotWeth,
    queues,
    configurations,
    liquidityExecutor,
    liquidityConfigurationSealed,
    liquidityPaused,
    liquidityPotWeth,
    queuedLiquidityWeth,
    currentTick,
  ] = await Promise.all([
    readConverter("keeper"),
    readConverter("configurationSealed"),
    readConverter("paused"),
    readConverter("rewardEpochCount"),
    readConverter("lastRewardEpochAt"),
    clients.publicClient.readContract({
      address: hook.address,
      abi: hook.abi,
      functionName: "rewardPot",
      blockNumber: block.number,
    }),
    trackQueues,
    trackConfigurations,
    clients.publicClient.readContract({
      address: liquidity.address,
      abi: liquidity.abi,
      functionName: "executor",
      blockNumber: block.number,
    }),
    clients.publicClient.readContract({
      address: liquidity.address,
      abi: liquidity.abi,
      functionName: "configurationSealed",
      blockNumber: block.number,
    }),
    clients.publicClient.readContract({
      address: liquidity.address,
      abi: liquidity.abi,
      functionName: "paused",
      blockNumber: block.number,
    }),
    clients.publicClient.readContract({
      address: hook.address,
      abi: hook.abi,
      functionName: "liquidityPot",
      blockNumber: block.number,
    }),
    clients.publicClient.readContract({
      address: liquidity.address,
      abi: liquidity.abi,
      functionName: "queuedWeth",
      blockNumber: block.number,
    }),
    readCurrentTick(clients, contracts, manifest, block.number),
  ]);
  await requireCanonicalBlockIdentity(clients, block, "snapshot assembly");
  return {
    block,
    keeper,
    liquidityExecutor,
    converterConfigurationSealed,
    converterPaused,
    rewardEpochCount,
    lastRewardEpochAt,
    rewardPotWeth,
    trackQueues: Object.fromEntries(
      TRACK_IDS.map((track, index) => [track, queues[index] ?? 0n]),
    ) as Record<TrackId, bigint>,
    trackConfigurations: Object.fromEntries(
      TRACK_IDS.map((track, index) => {
        const configuration = configurations[index];
        if (
          !Array.isArray(configuration) ||
          typeof configuration[0] !== "string" ||
          typeof configuration[1] !== "string"
        ) {
          throw new TypeError(
            `Reward Track ${track} configuration is malformed`,
          );
        }
        return [
          track,
          {
            stockToken: getAddress(configuration[0]),
            adapter: getAddress(configuration[1]),
          },
        ];
      }),
    ) as Record<
      TrackId,
      { readonly stockToken: Address; readonly adapter: Address }
    >,
    liquidityConfigurationSealed,
    liquidityPaused,
    liquidityPotWeth,
    queuedLiquidityWeth,
    currentTick,
  };
};

const decodeOperatorBlockIdentity = (
  value: unknown,
  label: string,
): OperatorBlockIdentity => {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} is unavailable`);
  }
  const block = value as {
    readonly number?: unknown;
    readonly hash?: unknown;
    readonly timestamp?: unknown;
  };
  if (typeof block.number !== "bigint" || block.number < 0n) {
    throw new TypeError(`${label} has an invalid number`);
  }
  if (
    typeof block.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(block.hash)
  ) {
    throw new TypeError(`${label} has an invalid hash`);
  }
  if (typeof block.timestamp !== "bigint" || block.timestamp < 0n) {
    throw new TypeError(`${label} has an invalid timestamp`);
  }
  return {
    number: block.number,
    hash: block.hash.toLowerCase() as Hex,
    timestamp: block.timestamp,
  };
};

const requireCanonicalBlockIdentity = async (
  clients: OperatorClients,
  expected: OperatorBlockIdentity,
  context: string,
): Promise<void> => {
  const canonical = decodeOperatorBlockIdentity(
    await clients.publicClient.getBlock({ blockNumber: expected.number }),
    `Operator canonical header ${expected.number}`,
  );
  if (
    canonical.number !== expected.number ||
    canonical.hash !== expected.hash ||
    canonical.timestamp !== expected.timestamp
  ) {
    throw new Error(
      `Operator block ${expected.number} changed canonical identity during ${context}`,
    );
  }
};

const errorDescription = (cause: unknown): string =>
  operatorDiagnostic(cause, "Operator request failed safely");

export const liquidityIsWaitingForFunding = (reason: string): boolean =>
  /QueuedWethExceeded|available queue/i.test(reason);

interface OperatorCallDetails {
  readonly address: Address;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args: readonly unknown[];
  readonly track?: TrackId;
  readonly quotedOutput?: bigint;
  readonly minimumOutput?: bigint;
  readonly validateSimulation?: (result: unknown) => void;
  readonly planningBlock: OperatorBlockIdentity;
  readonly quoteBlock?: OperatorBlockIdentity;
  readonly preflightBlock: OperatorBlockIdentity;
}

type OperatorCall = OperatorCallDetails &
  (
    | {
        readonly authorization: "keeper";
        readonly kind: "reward-epoch" | "reward-track-or-retry";
      }
    | {
        readonly authorization: "liquidity-executor";
        readonly kind: "protocol-liquidity";
      }
  );

export interface OperatorCallObserver {
  readonly beforeAttempt: () => Promise<void>;
  /** Persist the signed identity before any RPC can receive the transaction. */
  readonly submitted: (
    transactionHash: Hex,
    rawTransaction?: Hex,
  ) => Promise<void>;
}

const noopCallObserver: OperatorCallObserver = {
  beforeAttempt: async () => undefined,
  submitted: async () => undefined,
};

interface KeeperJournalContext {
  readonly recorder: KeeperAttemptRecorder;
  readonly outbox: KeeperAttemptOutbox;
  readonly runStarted: KeeperRunStartedMilestone;
  readonly runId: string;
  readonly attemptId: string;
  readonly actionKind: KeeperAttemptMilestone["actionKind"];
  readonly track?: TrackId;
  readonly observedBlock: bigint;
  readonly observedAt: bigint;
}

const keeperMilestone = (
  context: KeeperJournalContext,
  input: Pick<
    KeeperAttemptMilestone,
    "outcome" | "failureClass" | "transactionHash"
  >,
): KeeperAttemptMilestone => ({
  type: "attempt-observed",
  attemptId: context.attemptId,
  runId: context.runId,
  actionKind: context.actionKind,
  ...(context.track === undefined ? {} : { track: context.track }),
  observedBlock: context.observedBlock,
  observedAt: context.observedAt,
  outcome: input.outcome,
  ...(input.failureClass === undefined
    ? {}
    : { failureClass: input.failureClass }),
  ...(input.transactionHash === undefined
    ? {}
    : { transactionHash: input.transactionHash }),
});

const journalObserver = (
  context: KeeperJournalContext,
): OperatorCallObserver => ({
  beforeAttempt: () =>
    context.recorder.observeAttempt(
      keeperMilestone(context, { outcome: "preparing" }),
    ),
  submitted: (transactionHash, rawTransaction) => {
    const milestone = keeperMilestone(context, {
      outcome: "pending",
      transactionHash,
    }) as KeeperAttemptMilestone & {
      readonly outcome: "pending";
      readonly transactionHash: Hex;
    };
    return deliverSubmittedKeeperAttempt(
      context.outbox,
      context.recorder,
      {
        runStarted: context.runStarted,
        attempt: milestone,
        ...(rawTransaction === undefined ? {} : { rawTransaction }),
      },
      BigInt(Math.floor(Date.now() / 1_000)),
    );
  },
});

class SubmittedAttemptJournalError extends Error {
  override readonly name = "SubmittedAttemptJournalError";
}

const recordCompletedAction = async (
  context: KeeperJournalContext,
  evidence: OperatorActionEvidence,
): Promise<void> => {
  if (evidence.transactionHash !== undefined) return;
  if (evidence.status === "not-eligible") {
    await context.recorder.observeAttempt(
      keeperMilestone(context, { outcome: "not-required" }),
    );
    return;
  }
  if (evidence.status === "simulated") {
    await context.recorder.observeAttempt(
      keeperMilestone(context, { outcome: "simulated" }),
    );
    return;
  }
  if (evidence.status === "failed") {
    await context.recorder.observeAttempt(
      keeperMilestone(context, {
        outcome: "failed-before-submission",
        failureClass: evidence.failureClass ?? "preflight-rejected",
      }),
    );
  }
};

const isSubmittedUnknown = (evidence: OperatorActionEvidence): boolean =>
  evidence.status === "submitted-unknown" &&
  evidence.transactionHash !== undefined;

const callEvidence = (
  call: OperatorCall,
): Pick<
  OperatorActionEvidence,
  | "kind"
  | "track"
  | "quotedOutput"
  | "minimumOutput"
  | "planningBlock"
  | "quoteBlock"
  | "preflightBlock"
> => {
  const evidence: {
    kind: OperatorActionKind;
    track?: TrackId;
    quotedOutput?: bigint;
    minimumOutput?: bigint;
    planningBlock?: OperatorBlockIdentity;
    quoteBlock?: OperatorBlockIdentity;
    preflightBlock?: OperatorBlockIdentity;
  } = { kind: call.kind };
  if (call.track !== undefined) evidence.track = call.track;
  if (call.quotedOutput !== undefined) {
    evidence.quotedOutput = call.quotedOutput;
  }
  if (call.minimumOutput !== undefined) {
    evidence.minimumOutput = call.minimumOutput;
  }
  if (call.planningBlock !== undefined) {
    evidence.planningBlock = call.planningBlock;
  }
  if (call.quoteBlock !== undefined) evidence.quoteBlock = call.quoteBlock;
  if (call.preflightBlock !== undefined) {
    evidence.preflightBlock = call.preflightBlock;
  }
  return evidence;
};

const simulateOperatorCall = (
  clients: OperatorClients,
  actor: Address,
  call: OperatorCall,
) =>
  clients.publicClient.simulateContract({
    account: actor,
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    blockNumber: call.preflightBlock.number,
  } as unknown as SimulateContractParameters);

const sameOperatorBlockIdentity = (
  left: OperatorBlockIdentity,
  right: OperatorBlockIdentity,
): boolean =>
  left.number === right.number &&
  left.hash === right.hash &&
  left.timestamp === right.timestamp;

const revalidateSigningBlockIdentities = async (
  clients: OperatorClients,
  call: OperatorCall,
): Promise<void> => {
  await requireCanonicalBlockIdentity(
    clients,
    call.planningBlock,
    "signing-boundary planning validation",
  );
  if (
    call.quoteBlock !== undefined &&
    !sameOperatorBlockIdentity(call.quoteBlock, call.planningBlock)
  ) {
    await requireCanonicalBlockIdentity(
      clients,
      call.quoteBlock,
      "signing-boundary quote validation",
    );
  }
  if (!sameOperatorBlockIdentity(call.preflightBlock, call.planningBlock)) {
    await requireCanonicalBlockIdentity(
      clients,
      call.preflightBlock,
      "signing-boundary preflight validation",
    );
  }
};

const prepareOperatorCall = async (
  clients: OperatorClients,
  authorization: OperatorAuthorization,
  request: unknown,
) => {
  const roleClient = clients.roles[authorization];
  if (
    roleClient.walletClient === undefined ||
    roleClient.account === undefined
  ) {
    throw new Error(
      `Execute mode has no configured ${authorization} signing account`,
    );
  }
  const { address, abi, functionName, args, ...transaction } =
    request as WriteContractParameters;
  const prepared = await roleClient.walletClient.prepareTransactionRequest({
    ...transaction,
    account: roleClient.account,
    to: address,
    data: encodeFunctionData({ abi, functionName, args }),
  });
  return { walletClient: roleClient.walletClient, request: prepared };
};

const signAndSubmitOperatorCall = async (
  clients: OperatorClients,
  authorization: OperatorAuthorization,
  request: unknown,
  persist: (hash: Hex, rawTransaction: Hex) => Promise<void>,
  beforeSigning?: () => Promise<void>,
): Promise<Hex> => {
  const prepared = await prepareOperatorCall(clients, authorization, request);
  await beforeSigning?.();
  clients.assertMaySign?.();
  const rawTransaction = await prepared.walletClient.signTransaction(
    prepared.request,
  );
  const hash = keccak256(rawTransaction);
  await persist(hash, rawTransaction);
  clients.assertMaySign?.();
  const broadcastHash = await prepared.walletClient.sendRawTransaction({
    serializedTransaction: rawTransaction,
  });
  if (broadcastHash !== hash)
    throw new Error("RPC returned a different operator transaction hash");
  return hash;
};

const failureClassForStage = (
  stage: "preflight" | "submission" | "receipt",
): KeeperAttemptFailureClass => {
  if (stage === "preflight") return "preflight-rejected";
  return stage === "submission" ? "submission-rejected" : "receipt-unavailable";
};

interface OperatorReceiptSnapshot {
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint;
}

const receiptField = (
  receipt: object,
  field: "status" | "blockNumber" | "blockHash",
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    return { ok: true, value: Reflect.get(receipt, field) };
  } catch {
    return { ok: false };
  }
};

const inspectableReceipt = (receipt: unknown): object => {
  if (
    (typeof receipt === "object" && receipt !== null) ||
    typeof receipt === "function"
  ) {
    return receipt;
  }
  throw new TypeError("Operator RPC returned a malformed receipt");
};

const receiptStatus = (
  field: ReturnType<typeof receiptField>,
): "success" | "reverted" => {
  if (field.ok && (field.value === "success" || field.value === "reverted")) {
    return field.value;
  }
  throw new TypeError("Operator RPC returned a malformed receipt");
};

const receiptBlockNumber = (field: ReturnType<typeof receiptField>): bigint => {
  if (field.ok && typeof field.value === "bigint" && field.value >= 0n) {
    return field.value;
  }
  throw new TypeError("Operator RPC returned a malformed receipt");
};

const receiptBlockHash = (field: ReturnType<typeof receiptField>): Hex => {
  if (
    field.ok &&
    typeof field.value === "string" &&
    /^0x[0-9a-fA-F]{64}$/u.test(field.value)
  ) {
    return field.value.toLowerCase() as Hex;
  }
  throw new TypeError("Operator RPC returned a malformed receipt");
};

export const snapshotOperatorReceipt = (
  receipt: unknown,
): OperatorReceiptSnapshot => {
  const value = inspectableReceipt(receipt);
  const status = receiptField(value, "status");
  const blockNumber = receiptField(value, "blockNumber");
  return {
    status: receiptStatus(status),
    blockNumber: receiptBlockNumber(blockNumber),
  };
};

interface OperatorCanonicalReceiptSnapshot extends OperatorReceiptSnapshot {
  readonly blockHash: Hex;
}

const snapshotCanonicalOperatorReceipt = (
  receipt: unknown,
): OperatorCanonicalReceiptSnapshot => {
  const value = inspectableReceipt(receipt);
  const status = receiptField(value, "status");
  const blockNumber = receiptField(value, "blockNumber");
  const blockHash = receiptField(value, "blockHash");
  return {
    status: receiptStatus(status),
    blockNumber: receiptBlockNumber(blockNumber),
    blockHash: receiptBlockHash(blockHash),
  };
};

export const reconcileOperatorSubmission = async (
  clients: OperatorClients,
  transactionHash: Hex,
): Promise<OperatorSubmissionResolution> => {
  try {
    const receipt = snapshotCanonicalOperatorReceipt(
      await clients.publicClient.getTransactionReceipt({
        hash: transactionHash,
      }),
    );
    const canonical = decodeOperatorBlockIdentity(
      await clients.publicClient.getBlock({
        blockNumber: receipt.blockNumber,
      }),
      `Operator receipt header ${receipt.blockNumber}`,
    );
    if (
      canonical.number !== receipt.blockNumber ||
      canonical.hash !== receipt.blockHash
    ) {
      return {
        status: "submitted-unknown",
        reason: "The submitted transaction receipt is not canonical.",
        failureClass: "canonicality-uncertain",
      };
    }
    const head = await clients.publicClient.getBlockNumber();
    if (typeof head !== "bigint" || head < receipt.blockNumber + 2n) {
      return {
        status: "submitted-unknown",
        reason: "The submitted transaction has not reached two confirmations.",
        failureClass: "canonicality-uncertain",
      };
    }
    return {
      status: receipt.status === "success" ? "confirmed" : "reverted",
      blockNumber: receipt.blockNumber,
    };
  } catch (cause) {
    return {
      status: "submitted-unknown",
      reason: errorDescription(cause),
      failureClass: "receipt-unavailable",
    };
  }
};

const receiptEvidence = (
  call: OperatorCall,
  transactionHash: Hex,
  rawReceipt: unknown,
): OperatorActionEvidence => {
  const receipt = snapshotOperatorReceipt(rawReceipt);
  return receipt.status === "success"
    ? {
        ...callEvidence(call),
        status: "confirmed",
        reason: "Simulation passed and the transaction confirmed.",
        transactionHash,
        blockNumber: receipt.blockNumber,
      }
    : {
        ...callEvidence(call),
        status: "failed",
        reason: "The submitted transaction reverted.",
        failureClass: "execution-reverted",
        transactionHash,
        blockNumber: receipt.blockNumber,
      };
};

const operatorCallFailureEvidence = (
  call: OperatorCall,
  stage: "preflight" | "submission" | "receipt",
  submittedHash: Hex | undefined,
  cause: unknown,
): OperatorActionEvidence => {
  if (stage === "receipt" && submittedHash !== undefined) {
    return {
      ...callEvidence(call),
      status: "submitted-unknown",
      reason: errorDescription(cause),
      failureClass: "receipt-unavailable",
      transactionHash: submittedHash,
    };
  }
  return {
    ...callEvidence(call),
    status: "failed",
    reason: errorDescription(cause),
    failureClass: failureClassForStage(stage),
    ...(stage === "preflight" ? { replanRequired: true } : {}),
    ...(submittedHash === undefined ? {} : { transactionHash: submittedHash }),
  };
};

export const attemptOperatorCall = async (
  clients: OperatorClients,
  actors: OperatorActors,
  execute: boolean,
  call: OperatorCall,
  observer?: OperatorCallObserver,
): Promise<OperatorActionEvidence> => {
  let stage: "preflight" | "submission" | "receipt" = "preflight";
  let submittedHash: Hex | undefined;
  let journalFailure = false;
  const journal = observer ?? noopCallObserver;
  const actor = actors[call.authorization];
  try {
    await journal.beforeAttempt();
    const simulation = await simulateOperatorCall(clients, actor, call);
    call.validateSimulation?.(simulation.result);
    await revalidateSigningBlockIdentities(clients, call);
    if (!execute) {
      return {
        ...callEvidence(call),
        status: "simulated",
        reason: "Onchain preflight passed; dry-run mode submitted nothing.",
      };
    }
    stage = "submission";
    const transactionHash = await signAndSubmitOperatorCall(
      clients,
      call.authorization,
      simulation.request,
      async (hash, rawTransaction) => {
        submittedHash = hash;
        try {
          await journal.submitted(hash, rawTransaction);
        } catch (cause) {
          journalFailure = true;
          throw new SubmittedAttemptJournalError(
            "A signed transaction could not be durably journaled; broadcast was not attempted",
            { cause },
          );
        }
        stage = "receipt";
      },
      () => revalidateSigningBlockIdentities(clients, call),
    );
    const receipt = await clients.publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 2,
    });
    return receiptEvidence(call, transactionHash, receipt);
  } catch (cause) {
    if (journalFailure) throw cause;
    return operatorCallFailureEvidence(call, stage, submittedHash, cause);
  }
};

const quoteTrack = async (
  clients: OperatorClients,
  contracts: ProtocolContracts,
  track: TrackId,
  wethInput: bigint,
  minimumOutputBps: number,
  block: OperatorBlockIdentity,
) => {
  const stockToken = expectedTrackConfiguration(contracts, track).stockToken;
  const quote = async (
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
  ) => {
    const simulation = await clients.publicClient.simulateContract({
      address: contracts.testConversionVenue.address,
      abi: conversionVenueAbi,
      functionName: "quoteExactInput",
      args: [tokenIn, tokenOut, amountIn],
      blockNumber: block.number,
    });
    return simulation.result;
  };
  const usdcOutput = await quote(
    contracts.weth.address,
    contracts.usdc.address,
    wethInput,
  );
  const quotedOutput = await quote(
    contracts.usdc.address,
    stockToken,
    usdcOutput,
  );
  await requireCanonicalBlockIdentity(clients, block, "Reward Track quoting");
  return {
    quotedOutput,
    minimumOutput: minimumOutputFromQuote(quotedOutput, minimumOutputBps),
  };
};

class OperatorReplanRequiredError extends Error {
  override readonly name = "OperatorReplanRequiredError";
}

const expectedTrackConfiguration = (
  contracts: ProtocolContracts,
  track: TrackId,
): { readonly stockToken: Address; readonly adapter: Address } => {
  const configurations = {
    1: {
      stockToken: contracts.mockAaplc.address,
      adapter: contracts.aaplcConversionAdapter.address,
    },
    2: {
      stockToken: contracts.mockGooglc.address,
      adapter: contracts.googlcConversionAdapter.address,
    },
    3: {
      stockToken: contracts.mockMetac.address,
      adapter: contracts.metacConversionAdapter.address,
    },
    4: {
      stockToken: contracts.mockNvdac.address,
      adapter: contracts.nvdacConversionAdapter.address,
    },
  } as const;
  return configurations[track];
};

const sameTrackConfiguration = (
  left: { readonly stockToken: Address; readonly adapter: Address },
  right: { readonly stockToken: Address; readonly adapter: Address },
): boolean =>
  getAddress(left.stockToken) === getAddress(right.stockToken) &&
  getAddress(left.adapter) === getAddress(right.adapter);

const trackKeeperIsStable = (
  actors: OperatorActors,
  planning: OperatorState,
  preflight: OperatorState,
): boolean =>
  getAddress(planning.keeper) === getAddress(actors.keeper) &&
  getAddress(preflight.keeper) === getAddress(actors.keeper);

const trackEligibilityIsStable = (
  planning: OperatorState,
  preflight: OperatorState,
): boolean =>
  planning.converterConfigurationSealed &&
  !planning.converterPaused &&
  preflight.converterConfigurationSealed &&
  !preflight.converterPaused;

const trackRequestIsStable = (
  intent: Extract<
    OperatorActionIntent,
    { readonly kind: "reward-track-or-retry" }
  >,
  planning: OperatorState,
  preflight: OperatorState,
): boolean =>
  trackExecutionInput(planning.trackQueues[intent.track]) ===
    intent.wethInput &&
  trackExecutionInput(preflight.trackQueues[intent.track]) ===
    intent.wethInput &&
  preflight.block.timestamp <= intent.deadline;

const trackRouteIsStable = (
  track: TrackId,
  expectedRoute: { readonly stockToken: Address; readonly adapter: Address },
  planning: OperatorState,
  preflight: OperatorState,
): boolean =>
  sameTrackConfiguration(planning.trackConfigurations[track], expectedRoute) &&
  sameTrackConfiguration(preflight.trackConfigurations[track], expectedRoute);

const requireTrackPreflight = (input: {
  readonly actors: OperatorActors;
  readonly contracts: ProtocolContracts;
  readonly intent: Extract<
    OperatorActionIntent,
    { readonly kind: "reward-track-or-retry" }
  >;
  readonly planning: OperatorState;
  readonly preflight: OperatorState;
}): void => {
  const { actors, contracts, intent, planning, preflight } = input;
  const expectedRoute = expectedTrackConfiguration(contracts, intent.track);
  if (!trackKeeperIsStable(actors, planning, preflight)) {
    throw new OperatorReplanRequiredError(
      `Reward Track ${intent.track} Keeper role changed; replan required`,
    );
  }
  if (!trackEligibilityIsStable(planning, preflight)) {
    throw new OperatorReplanRequiredError(
      `Reward Track ${intent.track} eligibility changed; replan required`,
    );
  }
  if (!trackRequestIsStable(intent, planning, preflight)) {
    throw new OperatorReplanRequiredError(
      `Reward Track ${intent.track} call request changed; replan required`,
    );
  }
  if (!trackRouteIsStable(intent.track, expectedRoute, planning, preflight)) {
    throw new OperatorReplanRequiredError(
      `Reward Track ${intent.track} sealed route changed; replan required`,
    );
  }
};

const rewardEpochEligibility = (state: OperatorState) =>
  rewardEpochIsEligible({
    configurationSealed: state.converterConfigurationSealed,
    paused: state.converterPaused,
    rewardEpochCount: state.rewardEpochCount,
    lastRewardEpochAt: state.lastRewardEpochAt,
    rewardPotWeth: state.rewardPotWeth,
    currentTimestamp: state.block.timestamp,
  });

const requireEpochPreflight = (input: {
  readonly actors: OperatorActors;
  readonly planning: OperatorState;
  readonly preflight: OperatorState;
}): void => {
  const { actors, planning, preflight } = input;
  if (
    getAddress(planning.keeper) !== getAddress(actors.keeper) ||
    getAddress(preflight.keeper) !== getAddress(actors.keeper)
  ) {
    throw new OperatorReplanRequiredError(
      "Reward Epoch Keeper role changed; replan required",
    );
  }
  if (
    !rewardEpochEligibility(planning) ||
    !rewardEpochEligibility(preflight) ||
    planning.rewardEpochCount !== preflight.rewardEpochCount ||
    planning.lastRewardEpochAt !== preflight.lastRewardEpochAt
  ) {
    throw new OperatorReplanRequiredError(
      "Reward Epoch eligibility changed; replan required",
    );
  }
};

const samePolCallRequest = (
  candidate: PolCyclePlan,
  expected: ReadyPolCyclePlan,
): candidate is ReadyPolCyclePlan =>
  candidate.status === "ready" &&
  candidate.tickLower === expected.tickLower &&
  candidate.tickUpper === expected.tickUpper &&
  candidate.liquidity === expected.liquidity &&
  candidate.maximumWeth === expected.maximumWeth &&
  candidate.expectedConsumptionWeth === expected.expectedConsumptionWeth;

const polExecutorIsStable = (
  actors: OperatorActors,
  planning: OperatorState,
  preflight: OperatorState,
): boolean =>
  getAddress(planning.liquidityExecutor) ===
    getAddress(actors["liquidity-executor"]) &&
  getAddress(preflight.liquidityExecutor) ===
    getAddress(actors["liquidity-executor"]);

const polEligibilityIsStable = (
  deadline: bigint,
  planning: OperatorState,
  preflight: OperatorState,
): boolean =>
  planning.liquidityConfigurationSealed &&
  !planning.liquidityPaused &&
  preflight.liquidityConfigurationSealed &&
  !preflight.liquidityPaused &&
  preflight.block.timestamp <= deadline;

const replanLiquidityRequest = (
  manifest: ProtocolDeploymentManifest,
  state: OperatorState,
  policy: PolBudgetPolicy,
  label: "planning" | "preflight",
): PolCyclePlan => {
  try {
    return createLiquidityPlan(manifest, state, policy);
  } catch (cause) {
    throw new OperatorReplanRequiredError(
      `Protocol-Owned Liquidity ${label} state is invalid: ${errorDescription(cause)}`,
      { cause },
    );
  }
};

const requirePolPreflight = (input: {
  readonly actors: OperatorActors;
  readonly intent: Extract<
    OperatorActionIntent,
    { readonly kind: "protocol-liquidity" }
  >;
  readonly manifest: ProtocolDeploymentManifest;
  readonly planning: OperatorState;
  readonly preflight: OperatorState;
}): void => {
  const { actors, intent, manifest, planning, preflight } = input;
  if (!polExecutorIsStable(actors, planning, preflight)) {
    throw new OperatorReplanRequiredError(
      "Protocol-Owned Liquidity executor role changed; replan required",
    );
  }
  if (!polEligibilityIsStable(intent.plan.deadline, planning, preflight)) {
    throw new OperatorReplanRequiredError(
      "Protocol-Owned Liquidity eligibility changed; replan required",
    );
  }
  const policy = {
    minimumQueueWeth: intent.plan.minimumQueueWeth,
    targetWethPerCycle: intent.plan.targetWethPerCycle,
    maximumWethPerCycle: intent.plan.maximumWethPerCycle,
  };
  const plannedAgain = replanLiquidityRequest(
    manifest,
    planning,
    policy,
    "planning",
  );
  const preflightPlan = replanLiquidityRequest(
    manifest,
    preflight,
    policy,
    "preflight",
  );
  if (
    !samePolCallRequest(plannedAgain, intent.plan) ||
    !samePolCallRequest(preflightPlan, intent.plan)
  ) {
    throw new OperatorReplanRequiredError(
      "Protocol-Owned Liquidity call request changed; replan required",
    );
  }
};

type RewardTrackIntent = Extract<
  OperatorActionIntent,
  { readonly kind: "reward-track-or-retry" }
>;
type PolIntent = Extract<
  OperatorActionIntent,
  { readonly kind: "protocol-liquidity" }
>;

interface OperatorAttemptContext {
  readonly clients: OperatorClients;
  readonly contracts: ProtocolContracts;
  readonly manifest: ProtocolDeploymentManifest;
  readonly actors: OperatorActors;
  readonly execute: boolean;
  readonly planningState: OperatorState;
  readonly observer: OperatorCallObserver;
  readonly observe: (request?: {
    readonly minimumBlock?: bigint;
  }) => Promise<OperatorState>;
}

const attemptRewardEpochIntent = async (
  context: OperatorAttemptContext,
): Promise<OperatorActionEvidence> => {
  const {
    clients,
    contracts,
    actors,
    execute,
    planningState,
    observer,
    observe,
  } = context;
  const planningBlock = planningState.block;
  let preflightBlock: OperatorBlockIdentity | undefined;
  try {
    await requireCanonicalBlockIdentity(
      clients,
      planningBlock,
      "planning validation",
    );
    const preflight = await observe({ minimumBlock: planningBlock.number });
    preflightBlock = preflight.block;
    requireEpochPreflight({ actors, planning: planningState, preflight });
    await requireCanonicalBlockIdentity(
      clients,
      planningBlock,
      "preflight planning validation",
    );
    return attemptOperatorCall(
      clients,
      actors,
      execute,
      {
        authorization: "keeper",
        kind: "reward-epoch",
        address: contracts.epochConverter.address,
        abi: contracts.epochConverter.abi,
        functionName: "openRewardEpoch",
        args: [],
        planningBlock,
        preflightBlock,
      },
      observer,
    );
  } catch (cause) {
    return {
      kind: "reward-epoch",
      status: "failed",
      reason: errorDescription(cause),
      failureClass: "preflight-rejected",
      planningBlock,
      ...(preflightBlock === undefined ? {} : { preflightBlock }),
      replanRequired: true,
    };
  }
};

type TrackAttemptStage = "planning" | "quote" | "preflight";

const trackAttemptFailureClass = (
  stage: TrackAttemptStage,
): KeeperAttemptFailureClass =>
  stage === "quote" ? "quote-unavailable" : "preflight-rejected";

const attemptRewardTrackIntent = async (
  context: OperatorAttemptContext,
  intent: RewardTrackIntent,
): Promise<OperatorActionEvidence> => {
  const {
    clients,
    contracts,
    actors,
    execute,
    planningState,
    observer,
    observe,
  } = context;
  const planningBlock = planningState.block;
  let preflightBlock: OperatorBlockIdentity | undefined;
  let quoteStarted = false;
  let stage: TrackAttemptStage = "planning";
  try {
    await requireCanonicalBlockIdentity(
      clients,
      planningBlock,
      "planning validation",
    );
    stage = "quote";
    quoteStarted = true;
    const quote = await quoteTrack(
      clients,
      contracts,
      intent.track,
      intent.wethInput,
      intent.minimumOutputBps,
      planningBlock,
    );
    stage = "preflight";
    const preflight = await observe({ minimumBlock: planningBlock.number });
    preflightBlock = preflight.block;
    requireTrackPreflight({
      actors,
      contracts,
      intent,
      planning: planningState,
      preflight,
    });
    await requireCanonicalBlockIdentity(
      clients,
      planningBlock,
      "preflight planning validation",
    );
    return attemptOperatorCall(
      clients,
      actors,
      execute,
      {
        authorization: "keeper",
        kind: "reward-track-or-retry",
        track: intent.track,
        address: contracts.epochConverter.address,
        abi: contracts.epochConverter.abi,
        functionName: "executeTrack",
        args: [intent.track, quote.minimumOutput, intent.deadline],
        ...quote,
        planningBlock,
        quoteBlock: planningBlock,
        preflightBlock: preflight.block,
      },
      observer,
    );
  } catch (cause) {
    return {
      kind: "reward-track-or-retry",
      track: intent.track,
      status: "failed",
      reason: errorDescription(cause),
      failureClass: trackAttemptFailureClass(stage),
      planningBlock,
      ...(quoteStarted ? { quoteBlock: planningBlock } : {}),
      ...(preflightBlock === undefined ? {} : { preflightBlock }),
      replanRequired: true,
    };
  }
};

const polFundingEvidence = (
  evidence: OperatorActionEvidence,
): OperatorActionEvidence =>
  evidence.status === "failed" && liquidityIsWaitingForFunding(evidence.reason)
    ? {
        ...evidence,
        status: "not-eligible",
        reason: `WETH-only cycle simulation did not pass yet: ${evidence.reason}`,
      }
    : evidence;

const attemptPolIntent = async (
  context: OperatorAttemptContext,
  intent: PolIntent,
): Promise<OperatorActionEvidence> => {
  const {
    clients,
    contracts,
    manifest,
    actors,
    execute,
    planningState,
    observer,
    observe,
  } = context;
  const planningBlock = planningState.block;
  let preflight: OperatorState | undefined;
  try {
    await requireCanonicalBlockIdentity(
      clients,
      planningBlock,
      "planning validation",
    );
    preflight = await observe({ minimumBlock: planningBlock.number });
    requirePolPreflight({
      actors,
      intent,
      manifest,
      planning: planningState,
      preflight,
    });
    await requireCanonicalBlockIdentity(
      clients,
      planningBlock,
      "preflight planning validation",
    );
  } catch (cause) {
    return {
      kind: "protocol-liquidity",
      status: "failed",
      reason: errorDescription(cause),
      failureClass: "preflight-rejected",
      liquidityPlan: intent.plan,
      planningBlock,
      ...(preflight === undefined ? {} : { preflightBlock: preflight.block }),
      replanRequired: true,
    };
  }
  if (preflight === undefined) {
    throw new Error("Protocol-Owned Liquidity preflight was not recorded");
  }
  let simulatedConsumptionWeth: bigint | undefined;
  const evidence = await attemptOperatorCall(
    clients,
    actors,
    execute,
    {
      authorization: "liquidity-executor",
      kind: "protocol-liquidity",
      address: contracts.protocolLiquidityVault.address,
      abi: contracts.protocolLiquidityVault.abi,
      functionName: "addLiquidityCycle",
      args: [
        intent.plan.tickLower,
        intent.plan.tickUpper,
        intent.plan.liquidity,
        intent.plan.maximumWeth,
        intent.plan.deadline,
      ],
      validateSimulation: (result) => {
        if (typeof result !== "bigint") {
          throw new TypeError(
            "Protocol-Owned Liquidity simulation returned no WETH consumption",
          );
        }
        simulatedConsumptionWeth = validatePolSimulation(intent.plan, result);
      },
      planningBlock,
      preflightBlock: preflight.block,
    },
    observer,
  );
  return polFundingEvidence({
    ...evidence,
    liquidityPlan: intent.plan,
    ...(simulatedConsumptionWeth === undefined
      ? {}
      : { simulatedConsumptionWeth }),
  });
};

const attemptOperatorIntent = (
  clients: OperatorClients,
  contracts: ProtocolContracts,
  manifest: ProtocolDeploymentManifest,
  actors: OperatorActors,
  execute: boolean,
  planningState: OperatorState,
  intent: OperatorActionIntent,
  observer: OperatorCallObserver,
  observe: OperatorAttemptContext["observe"],
): Promise<OperatorActionEvidence> => {
  const context: OperatorAttemptContext = {
    clients,
    contracts,
    manifest,
    actors,
    execute,
    planningState,
    observer,
    observe,
  };
  if (intent.kind === "reward-epoch") {
    return attemptRewardEpochIntent(context);
  }
  if (intent.kind === "reward-track-or-retry") {
    return attemptRewardTrackIntent(context, intent);
  }
  return attemptPolIntent(context, intent);
};

const MAXIMUM_OBSERVATION_ATTEMPTS = 3;

interface ViemOperatorChainInput {
  readonly clients: OperatorClients;
  readonly contracts: ProtocolContracts;
  readonly manifest: ProtocolDeploymentManifest;
}

const operatorStateMeetsBlockFloor = (
  state: OperatorState,
  minimumBlock: bigint | undefined,
): boolean => minimumBlock === undefined || state.block.number >= minimumBlock;

const observeCanonicalOperatorState = async (
  input: ViemOperatorChainInput,
  request: { readonly minimumBlock?: bigint } = {},
): Promise<OperatorState> => {
  const minimumBlock = request.minimumBlock;
  if (minimumBlock !== undefined && minimumBlock < 0n) {
    throw new RangeError("Operator observation block floor cannot be negative");
  }
  let lastSnapshotFailure: unknown;
  let snapshotFailed = false;
  for (let attempt = 1; attempt <= MAXIMUM_OBSERVATION_ATTEMPTS; attempt += 1) {
    try {
      const state = await readOperatorState(
        input.clients,
        input.contracts,
        input.manifest,
      );
      if (operatorStateMeetsBlockFloor(state, minimumBlock)) {
        return state;
      }
    } catch (cause) {
      snapshotFailed = true;
      lastSnapshotFailure = cause;
    }
  }
  if (snapshotFailed) {
    throw new Error(
      `Operator canonical snapshot failed after ${MAXIMUM_OBSERVATION_ATTEMPTS} attempts: ${errorDescription(lastSnapshotFailure)}`,
      { cause: lastSnapshotFailure },
    );
  }
  throw new Error(
    `Operator RPC remained behind confirmed block ${minimumBlock?.toString()}`,
  );
};

export const createViemOperatorChain = (
  input: ViemOperatorChainInput,
): OperatorChain => ({
  accounts: {
    keeper: input.clients.roles.keeper.account,
    "liquidity-executor": input.clients.roles["liquidity-executor"].account,
  },
  getChainId: () => input.clients.publicClient.getChainId(),
  observe: (request) => observeCanonicalOperatorState(input, request),
  reconcileSubmission: (transactionHash) =>
    reconcileOperatorSubmission(input.clients, transactionHash),
  rebroadcastSubmission: async (rawTransaction) => {
    input.clients.assertMaySign?.();
    const hash = await input.clients.publicClient.sendRawTransaction({
      serializedTransaction: rawTransaction,
    });
    if (hash !== keccak256(rawTransaction))
      throw new Error("RPC returned a different operator transaction hash");
    return hash;
  },
  attempt: (request, observer) =>
    attemptOperatorIntent(
      input.clients,
      input.contracts,
      input.manifest,
      request.actors,
      request.execute,
      request.planningState,
      request.intent,
      observer,
      (observationRequest) =>
        observeCanonicalOperatorState(input, observationRequest),
    ),
});

const epochEvidence = async (
  chain: OperatorChain,
  actors: OperatorActors,
  execute: boolean,
  state: OperatorState,
  journal: KeeperJournalContext,
): Promise<OperatorActionEvidence> => {
  if (
    !rewardEpochIsEligible({
      configurationSealed: state.converterConfigurationSealed,
      paused: state.converterPaused,
      rewardEpochCount: state.rewardEpochCount,
      lastRewardEpochAt: state.lastRewardEpochAt,
      rewardPotWeth: state.rewardPotWeth,
      currentTimestamp: state.block.timestamp,
    })
  ) {
    return {
      kind: "reward-epoch",
      status: "not-eligible",
      planningBlock: state.block,
      reason: `Reward pot ${state.rewardPotWeth}; next eligible timestamp ${nextRewardEpochAt(
        {
          configurationSealed: state.converterConfigurationSealed,
          paused: state.converterPaused,
          rewardEpochCount: state.rewardEpochCount,
          lastRewardEpochAt: state.lastRewardEpochAt,
          rewardPotWeth: state.rewardPotWeth,
          currentTimestamp: state.block.timestamp,
        },
      )}.`,
    };
  }
  const evidence = await chain.attempt(
    {
      actors,
      execute,
      planningState: state,
      intent: { kind: "reward-epoch" },
    },
    journalObserver(journal),
  );
  return evidence.planningBlock === undefined
    ? { ...evidence, planningBlock: state.block }
    : evidence;
};

const trackEvidence = async (
  chain: OperatorChain,
  actors: OperatorActors,
  execute: boolean,
  state: OperatorState,
  track: TrackId,
  minimumOutputBps: number,
  journal: KeeperJournalContext,
): Promise<OperatorActionEvidence> => {
  const queuedWeth = state.trackQueues[track];
  if (queuedWeth === 0n) {
    return {
      kind: "reward-track-or-retry",
      track,
      status: "not-eligible",
      planningBlock: state.block,
      reason: "The Reward Track queue is clear.",
    };
  }
  const evidence = await chain.attempt(
    {
      actors,
      execute,
      planningState: state,
      intent: {
        kind: "reward-track-or-retry",
        track,
        wethInput: trackExecutionInput(queuedWeth),
        minimumOutputBps,
        deadline: state.block.timestamp + 300n,
      },
    },
    journalObserver(journal),
  );
  return evidence.planningBlock === undefined
    ? { ...evidence, planningBlock: state.block }
    : evidence;
};

const createLiquidityPlan = (
  manifest: ProtocolDeploymentManifest,
  state: OperatorState,
  policy: PolBudgetPolicy,
): PolCyclePlan => {
  const weth = manifest.contracts.weth;
  if (weth === undefined) {
    throw new TypeError("Operator manifest has no WETH contract");
  }
  return planWethOnlyPolCycle({
    currentTick: state.currentTick,
    tickSpacing: manifest.canonicalPool.tickSpacing,
    wethIsCurrency0:
      getAddress(manifest.canonicalPool.currency0) === getAddress(weth),
    availableWeth: state.queuedLiquidityWeth + state.liquidityPotWeth,
    currentTimestamp: state.block.timestamp,
    policy,
  });
};

const liquidityEvidence = async (
  chain: OperatorChain,
  manifest: ProtocolDeploymentManifest,
  actors: OperatorActors,
  execute: boolean,
  state: OperatorState,
  policy: PolBudgetPolicy,
  journal: KeeperJournalContext,
): Promise<OperatorActionEvidence> => {
  const plan = createLiquidityPlan(manifest, state, policy);
  if (!state.liquidityConfigurationSealed) {
    return {
      kind: "protocol-liquidity",
      status: "not-eligible",
      reason: "Protocol-Owned Liquidity configuration is not sealed.",
      liquidityPlan: plan,
      planningBlock: state.block,
    };
  }
  if (state.liquidityPaused) {
    return {
      kind: "protocol-liquidity",
      status: "not-eligible",
      reason: "Protocol-Owned Liquidity execution is paused.",
      liquidityPlan: plan,
      planningBlock: state.block,
    };
  }
  if (plan.status !== "ready") {
    return {
      kind: "protocol-liquidity",
      status: "not-eligible",
      reason: plan.message,
      liquidityPlan: plan,
      planningBlock: state.block,
    };
  }
  const evidence = await chain.attempt(
    {
      actors,
      execute,
      planningState: state,
      intent: {
        kind: "protocol-liquidity",
        plan,
      },
    },
    journalObserver(journal),
  );
  return evidence.planningBlock === undefined
    ? { ...evidence, planningBlock: state.block }
    : evidence;
};

const rebroadcastPendingSubmission = async (
  chain: OperatorChain,
  rawTransaction: Hex | undefined,
  execute: boolean,
) => {
  if (
    !execute ||
    rawTransaction === undefined ||
    chain.rebroadcastSubmission === undefined
  )
    return;
  // The exact signed bytes retain their nonce. An ambiguous retry never removes the signing gate.
  try {
    await chain.rebroadcastSubmission(rawTransaction);
  } catch {
    /* Leave the durable row unresolved. */
  }
};

const reconcileUnresolvedSubmissions = async (
  chain: OperatorChain,
  outbox: KeeperAttemptOutbox,
  recorder: KeeperAttemptRecorder,
  execute: boolean,
): Promise<void> => {
  await replayKeeperAttemptOutbox(outbox, recorder);
  const stillUnresolved: Array<{
    readonly transactionHash: Hex;
    readonly reason: string;
  }> = [];
  const pending = [
    ...outbox.unresolved().map((delivery) => ({
      transactionHash: delivery.attempt.transactionHash,
      rawTransaction: delivery.rawTransaction,
      resolve: () =>
        outbox.resolve(
          delivery.attempt.attemptId,
          delivery.attempt.transactionHash,
        ),
    })),
    ...outbox.localSubmissions().map((transaction) => ({
      ...transaction,
      resolve: () => outbox.resolveLocalSubmission(transaction.transactionHash),
    })),
  ];
  for (const delivery of pending) {
    const resolution =
      chain.reconcileSubmission === undefined
        ? {
            status: "submitted-unknown" as const,
            reason: "No canonical receipt reconciliation source is configured.",
          }
        : await chain.reconcileSubmission(delivery.transactionHash);
    if (resolution.status === "submitted-unknown") {
      if (
        "failureClass" in resolution &&
        resolution.failureClass === "receipt-unavailable"
      ) {
        await rebroadcastPendingSubmission(
          chain,
          delivery.rawTransaction,
          execute,
        );
      }
      stillUnresolved.push({
        transactionHash: delivery.transactionHash,
        reason: resolution.reason,
      });
    } else {
      delivery.resolve();
    }
  }
  const first = stillUnresolved[0];
  if (first === undefined) return;
  throw new Error(
    `Operator signing is gated by ${stillUnresolved.length} unresolved submitted transaction(s); ${first.transactionHash}: ${first.reason}`,
  );
};

interface OperatorActionSequence {
  readonly chain: OperatorChain;
  readonly manifest: ProtocolDeploymentManifest;
  readonly actors: OperatorActors;
  readonly execute: boolean;
  readonly minimumOutputBps: number;
  readonly polPolicy: PolBudgetPolicy;
  readonly state: () => OperatorState;
  readonly journalFor: (
    attemptName: string,
    actionKind: KeeperAttemptMilestone["actionKind"],
    track?: TrackId,
  ) => KeeperJournalContext;
  readonly accept: (
    journal: KeeperJournalContext,
    action: OperatorActionEvidence,
  ) => Promise<void>;
}

const executeOperatorActionSequence = async (
  sequence: OperatorActionSequence,
): Promise<boolean> => {
  const epochJournal = sequence.journalFor("reward-epoch", "reward-epoch");
  const epoch = await epochEvidence(
    sequence.chain,
    sequence.actors,
    sequence.execute,
    sequence.state(),
    epochJournal,
  );
  await sequence.accept(epochJournal, epoch);
  if (isSubmittedUnknown(epoch)) return true;

  for (const track of TRACK_IDS) {
    const trackJournal = sequence.journalFor(
      `reward-track-${track}`,
      "reward-track",
      track,
    );
    const action = await trackEvidence(
      sequence.chain,
      sequence.actors,
      sequence.execute,
      sequence.state(),
      track,
      sequence.minimumOutputBps,
      trackJournal,
    );
    await sequence.accept(trackJournal, action);
    if (isSubmittedUnknown(action)) return true;
  }

  const liquidityJournal = sequence.journalFor(
    "protocol-liquidity",
    "protocol-liquidity",
  );
  const liquidity = await liquidityEvidence(
    sequence.chain,
    sequence.manifest,
    sequence.actors,
    sequence.execute,
    sequence.state(),
    sequence.polPolicy,
    liquidityJournal,
  );
  await sequence.accept(liquidityJournal, liquidity);
  return isSubmittedUnknown(liquidity);
};

export const runOperatorWorkflow = async (
  environment: OperatorEnvironment,
  manifest: ProtocolDeploymentManifest,
  previousPolQueueObservedAt: bigint | undefined,
  dependencies: OperatorWorkflowDependencies,
) => {
  const { chain, outbox, recorder, runId } = dependencies;
  const chainId = await chain.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Operator RPC returned chain ${chainId}, expected 84532`);
  }
  await reconcileUnresolvedSubmissions(
    chain,
    outbox,
    recorder,
    environment.execute,
  );
  let state = await chain.observe();
  const actors = bindOperatorActors({
    accounts: chain.accounts,
    execute: environment.execute,
    liveRoles: {
      keeper: state.keeper,
      liquidityExecutor: state.liquidityExecutor,
    },
  });
  const runStarted: KeeperRunStartedMilestone = {
    type: "run-started",
    runId,
    observedBlock: state.block.number,
    observedAt: state.block.timestamp,
  };
  const journalFor = (
    attemptName: string,
    actionKind: KeeperAttemptMilestone["actionKind"],
    track?: TrackId,
  ): KeeperJournalContext => ({
    recorder,
    outbox,
    runStarted,
    runId,
    attemptId: `${runId}:${attemptName}`,
    actionKind,
    ...(track === undefined ? {} : { track }),
    observedBlock: state.block.number,
    observedAt: state.block.timestamp,
  });
  await recorder.startRun(runStarted);
  const actions: OperatorActionEvidence[] = [];
  let maximumConfirmedBlock: bigint | undefined;
  const refreshAfterTerminalSubmission = async (
    action: OperatorActionEvidence,
  ): Promise<void> => {
    if (
      action.status !== "confirmed" &&
      !(
        action.status === "failed" &&
        action.failureClass === "execution-reverted" &&
        action.transactionHash !== undefined
      )
    ) {
      return;
    }
    if (typeof action.blockNumber !== "bigint" || action.blockNumber < 0n) {
      throw new TypeError(
        "A confirmed operator action returned an invalid receipt block",
      );
    }
    maximumConfirmedBlock =
      maximumConfirmedBlock === undefined ||
      action.blockNumber > maximumConfirmedBlock
        ? action.blockNumber
        : maximumConfirmedBlock;
    state = await chain.observe({ minimumBlock: maximumConfirmedBlock });
  };
  const refreshAfterInvalidatedPlan = async (
    action: OperatorActionEvidence,
  ): Promise<void> => {
    if (action.replanRequired !== true) return;
    state = await chain.observe(
      maximumConfirmedBlock === undefined
        ? undefined
        : { minimumBlock: maximumConfirmedBlock },
    );
  };
  const submittedUnknown = await executeOperatorActionSequence({
    chain,
    manifest,
    actors,
    execute: environment.execute,
    minimumOutputBps: environment.minimumOutputBps,
    polPolicy: environment.polPolicy,
    state: () => state,
    journalFor,
    accept: async (journal, action) => {
      actions.push(action);
      await recordCompletedAction(journal, action);
      await refreshAfterTerminalSubmission(action);
      await refreshAfterInvalidatedPlan(action);
    },
  });
  state = await chain.observe(
    maximumConfirmedBlock === undefined
      ? undefined
      : { minimumBlock: maximumConfirmedBlock },
  );
  const availableLiquidityWeth =
    state.queuedLiquidityWeth + state.liquidityPotWeth;
  const observedLiquidityPlan = createLiquidityPlan(
    manifest,
    state,
    environment.polPolicy,
  );
  const queueObservation = observeEligiblePolQueue({
    availableWeth: availableLiquidityWeth,
    minimumQueueWeth: environment.polPolicy.minimumQueueWeth,
    observedAt: state.block.timestamp,
    staleAfterSeconds: environment.polStaleQueueSeconds,
    ...(previousPolQueueObservedAt === undefined
      ? {}
      : { previousFirstObservedAt: previousPolQueueObservedAt }),
  });
  if (!submittedUnknown) {
    await recorder.completeRun({
      type: "run-completed",
      runId,
      observedBlock: state.block.number,
      observedAt: state.block.timestamp,
    });
  }
  return {
    schemaVersion: 5,
    mode: environment.execute ? "execute" : "dry-run",
    reconciliationStatus: submittedUnknown ? "submitted-unknown" : "reconciled",
    chainId,
    actors,
    observation: state.block,
    observedBlock: state.block.number,
    observedBlockHash: state.block.hash,
    observedAt: state.block.timestamp,
    minimumOutputBps: environment.minimumOutputBps,
    observedState: {
      rewardPotWeth: state.rewardPotWeth,
      nextRewardEpochAt: nextRewardEpochAt({
        configurationSealed: state.converterConfigurationSealed,
        paused: state.converterPaused,
        rewardEpochCount: state.rewardEpochCount,
        lastRewardEpochAt: state.lastRewardEpochAt,
        rewardPotWeth: state.rewardPotWeth,
        currentTimestamp: state.block.timestamp,
      }),
      trackQueues: state.trackQueues,
      protocolOwnedLiquidity: {
        queuedWeth: state.queuedLiquidityWeth,
        feePotWeth: state.liquidityPotWeth,
        availableWeth: availableLiquidityWeth,
        currentTick: state.currentTick,
        policy: environment.polPolicy,
        estimatedCyclesRemaining:
          observedLiquidityPlan.estimatedCyclesRemaining,
        ...queueObservation,
      },
    },
    actions,
  } as const;
};

const serializeEvidence = (evidence: unknown): string =>
  `${JSON.stringify(
    evidence,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  )}\n`;

const readPreviousPolQueueObservation = (
  evidencePath: string,
): bigint | undefined =>
  existsSync(evidencePath)
    ? previousPolQueueFirstObservedAt(readFileSync(evidencePath, "utf8"))
    : undefined;

export const operatorProgram = Effect.scoped(
  Effect.gen(function* () {
    const environment = yield* loadOperatorEnvironment;
    const grant = environment.controlGrant;
    const controlStore =
      grant === undefined
        ? undefined
        : yield* Effect.acquireRelease(
            Effect.try(() => openOperatorControlStore(grant.databasePath)),
            (store) => Effect.sync(store.close),
          );
    const assertMaySign = () => {
      if (
        grant !== undefined &&
        !controlStore?.maySign(grant.runId, Date.now())
      ) {
        throw new Error("Operator signing authority is unavailable or revoked");
      }
    };
    const previousPolQueueObservedAt = yield* fileSystem(
      "Could not read prior Base Sepolia operator evidence",
      () => readPreviousPolQueueObservation(environment.evidencePath),
    );
    const manifest = yield* readLaunchedBaseSepoliaManifest(
      environment.manifestPath,
    );
    yield* fileSystem("Could not create keeper-attempt outbox directory", () =>
      mkdirSync(dirname(environment.keeperAttemptOutboxPath), {
        recursive: true,
      }),
    );
    const historyConfiguration = deriveHistoryIndexConfiguration(manifest);
    const outbox = yield* acquireKeeperAttemptOutbox(
      environment.keeperAttemptOutboxPath,
      {
        chainId: historyConfiguration.chainId,
        manifestFingerprint: historyConfiguration.manifestFingerprint,
      },
    );
    const clients = makeClients(environment, assertMaySign);
    const contracts = createProtocolContracts(manifest);
    const chain = createViemOperatorChain({ clients, contracts, manifest });
    const recorder = createKeeperAttemptRecorder({
      baseUrl: environment.historyIndexUrl,
      ingestApiToken: parseHistoryCredential(
        environment.historyIngestApiToken,
        "HISTORY_INGEST_API_TOKEN",
      ),
    });
    yield* rpc("Operator prior submissions are unresolved", async () => {
      if ((await chain.getChainId()) !== manifest.chainId)
        throw new Error("Operator RPC chain does not match the deployment");
      await reconcileUnresolvedSubmissions(
        chain,
        outbox,
        recorder,
        environment.execute,
      );
    });
    const discoveryMaintenance = yield* rpc(
      "Base Sepolia discovery maintenance failed",
      () =>
        maintainBaseSepoliaDiscovery({
          assertMaySign,
          execute: environment.execute,
          manifest,
          privateKey: environment.keeperPrivateKey,
          rpcUrl: environment.rpcUrl,
          submitTransaction: (request) =>
            signAndSubmitOperatorCall(
              clients,
              "keeper",
              request,
              async (_hash, rawTransaction) => {
                outbox.enqueueLocalSubmission(rawTransaction);
              },
            ),
        }),
    );
    const operatorEvidence = yield* rpc(
      "Base Sepolia operator workflow failed",
      () => {
        return runOperatorWorkflow(
          environment,
          manifest,
          previousPolQueueObservedAt,
          { chain, recorder, outbox, runId: randomUUID() },
        );
      },
    );
    const evidence = { ...operatorEvidence, discoveryMaintenance } as const;
    yield* fileSystem("Could not write Base Sepolia operator evidence", () => {
      writeOperatorEvidenceAtomically(
        environment.evidencePath,
        serializeEvidence(evidence),
      );
    });
    const confirmed = evidence.actions.filter(
      (action) => action.status === "confirmed",
    ).length;
    const simulated = evidence.actions.filter(
      (action) => action.status === "simulated",
    ).length;
    const failures = evidence.actions.filter(
      (action) => action.status === "failed",
    );
    const submittedUnknown = evidence.actions.filter(
      (action) => action.status === "submitted-unknown",
    );
    process.stdout.write(
      `Base Sepolia operator ${evidence.mode} at pinned block ${evidence.observedBlock}: discovery ${discoveryMaintenance.status}; ${confirmed} confirmed, ${simulated} simulated; evidence at ${environment.evidencePath}\n`,
    );
    yield* ensure(
      discoveryMaintenance.status !== "failed" &&
        failures.length === 0 &&
        submittedUnknown.length === 0,
      `Discovery maintenance is ${discoveryMaintenance.status}; ${failures.length} eligible operator action(s) failed preflight or execution; ${submittedUnknown.length} submitted action(s) have an unknown canonical outcome`,
    );
  }),
);

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runMain(operatorProgram);
}
