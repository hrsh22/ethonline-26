import type { ProtocolHealthCheck } from "@orbit/protocol/health";
import type { PublicStatusModel } from "@orbit/protocol/public-status-codec";
export type { PublicStatusModel } from "@orbit/protocol/public-status-codec";
import type {
  createProtocolReader,
  RewardHistoryEvent,
} from "@orbit/protocol/reader";

type ProtocolReader = ReturnType<typeof createProtocolReader>;
export type ProtocolHealthSnapshot = Awaited<
  ReturnType<ProtocolReader["readHealth"]>
>;

type ProtocolOperations = ProtocolHealthSnapshot["operations"];
type ProtocolRewardTrack = ProtocolHealthSnapshot["rewards"]["tracks"][number];

export type PublicStatusSnapshotInput = {
  readonly health: {
    readonly checks: readonly ProtocolHealthCheck[];
  };
  readonly deployment: Pick<
    ProtocolHealthSnapshot["deployment"],
    "network" | "observedAt" | "observedBlock"
  >;
  readonly collection: Pick<
    ProtocolHealthSnapshot["collection"],
    | "availableIdentityCount"
    | "pendingDiscoveryCount"
    | "permanentCount"
    | "transientCount"
  >;
  readonly market: Pick<
    ProtocolHealthSnapshot["market"],
    "creatorPotWeth" | "liquidityPotWeth" | "rewardPotWeth"
  > & {
    readonly price?:
      { readonly wethPerLiquidTokenWei?: bigint | undefined } | undefined;
  };
  readonly operations: Pick<
    ProtocolOperations,
    "rewardEpochCount" | "rewardHistory" | "rewardHistoryStatus"
  > & {
    readonly protocolOwnedLiquidity: Pick<
      ProtocolOperations["protocolOwnedLiquidity"],
      "permanentlyLockedWeth" | "queuedWeth"
    >;
    readonly trackQueues: ReadonlyArray<
      Pick<ProtocolOperations["trackQueues"][number], "trackId" | "weth"> & {
        readonly track?: string;
      }
    >;
  };
  readonly rewards: {
    readonly tracks: ReadonlyArray<
      Pick<ProtocolRewardTrack, "rawLiability" | "track">
    >;
  };
};

export type ProtocolFunds = {
  readonly creatorWeth: bigint | undefined;
  readonly liquidityLockedWeth: bigint | undefined;
  readonly liquidityQueuedWeth: bigint | undefined;
  readonly liquidityWaitingWeth: bigint | undefined;
  readonly rewardPotWeth: bigint | undefined;
  readonly rewardWethWaiting: bigint | undefined;
};

const sumObserved = (
  values: readonly (bigint | undefined)[],
): bigint | undefined => {
  if (values.some((value) => value === undefined)) return undefined;
  return values.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);
};

export const deriveProtocolFunds = (
  health: Pick<PublicStatusSnapshotInput, "market" | "operations">,
): ProtocolFunds => {
  const rewardWethWaiting = sumObserved([
    health.market.rewardPotWeth,
    ...health.operations.trackQueues.map((queue) => queue.weth),
  ]);
  const liquidityWaitingWeth = sumObserved([
    health.market.liquidityPotWeth,
    health.operations.protocolOwnedLiquidity.queuedWeth,
  ]);
  const liquidityLockedWeth =
    health.operations.protocolOwnedLiquidity.permanentlyLockedWeth;
  return {
    creatorWeth: health.market.creatorPotWeth,
    liquidityLockedWeth,
    liquidityQueuedWeth: health.operations.protocolOwnedLiquidity.queuedWeth,
    liquidityWaitingWeth,
    rewardPotWeth: health.market.rewardPotWeth,
    rewardWethWaiting,
  };
};

const compareHistoryEvents = (
  left: RewardHistoryEvent,
  right: RewardHistoryEvent,
): number => {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return (
    left.transactionIndex - right.transactionIndex ||
    left.logIndex - right.logIndex
  );
};

export const deriveRewardActivityHistory = (
  events: readonly RewardHistoryEvent[],
): RewardHistoryEvent[] =>
  [...events].sort((left, right) => compareHistoryEvents(right, left));

const statusFromChecks = (checks: readonly ProtocolHealthCheck[]) => {
  if (
    checks.some(
      (check) => check.status === "fail" && check.severity === "critical",
    )
  ) {
    return "critical" as const;
  }
  return checks.length > 0 && checks.every((check) => check.status === "pass")
    ? ("healthy" as const)
    : ("degraded" as const);
};

type RewardOpeningEvent = Extract<
  RewardHistoryEvent,
  { readonly type: "reward-epoch" }
>;
type RewardConversionEvent = Extract<
  RewardHistoryEvent,
  { readonly type: "track-conversion" }
>;

export const derivePublicStatusModel = (health: PublicStatusSnapshotInput) => {
  const history = deriveRewardActivityHistory(health.operations.rewardHistory);
  const latestOpening = history.find(
    (event): event is RewardOpeningEvent => event.type === "reward-epoch",
  );
  const recentConversions = history
    .filter(
      (event): event is RewardConversionEvent =>
        event.type === "track-conversion",
    )
    .slice(0, 4);
  const freshness =
    health.health.checks.find((check) => check.id === "read-freshness")
      ?.freshness ?? "unknown";
  const publicChecks = health.health.checks.filter(
    (check) =>
      check.id !== "freeze:connected-wallet" && !check.id.startsWith("track:"),
  );
  const onchainHealth = statusFromChecks(publicChecks);
  return {
    health: onchainHealth,
    freshness,
    network: health.deployment.network,
    observedAt: health.deployment.observedAt,
    observedBlock: health.deployment.observedBlock,
    priceWethPerLiquidTokenWei: health.market.price?.wethPerLiquidTokenWei,
    collection: {
      permanent: health.collection.permanentCount,
      transient: health.collection.transientCount,
      pending: health.collection.pendingDiscoveryCount,
      available: health.collection.availableIdentityCount,
    },
    funds: deriveProtocolFunds(health),
    rewardActivity: {
      epochCount: health.operations.rewardEpochCount,
      historyStatus: health.operations.rewardHistoryStatus,
      history,
      latestOpening,
      recentConversions,
      collectorLiability: health.rewards.tracks.map((track) => ({
        track: track.track,
        amount: track.rawLiability,
      })),
    },
  } as const satisfies PublicStatusModel;
};

const unavailableKeeperAttemptEvidence =
  (): ProtocolOperations["keeperAttemptEvidence"] => ({
    source: "keeper-attempt-journal",
    generation: undefined,
    state: "unavailable",
    freshness: {},
    coverage: { 1: "partial", 2: "partial", 3: "partial", 4: "partial" },
    tracks: {
      1: { state: "unknown" },
      2: { state: "unknown" },
      3: { state: "unknown" },
      4: { state: "unknown" },
    },
  });

type CheckGroup = "accounting" | "market" | "operations" | "deployment";

export type AdminRoleId =
  | "liquid-token-owner"
  | "reward-ledger-owner"
  | "converter-owner"
  | "liquidity-owner"
  | "keeper"
  | "liquidity-executor"
  | "guardian"
  | "recovery-authority-contract"
  | "creator";

type ProtocolRoles = ProtocolHealthSnapshot["roles"];

export type AdminDiagnosticsSnapshotInput = {
  readonly health: { readonly checks: readonly ProtocolHealthCheck[] };
  readonly deployment: Pick<
    ProtocolHealthSnapshot["deployment"],
    | "expectedChainId"
    | "expectedManifestCommitment"
    | "manifestCommitment"
    | "network"
    | "observedChainId"
  >;
  readonly collection: Pick<
    ProtocolHealthSnapshot["collection"],
    | "availableIdentityCount"
    | "liquidSupplyFormatted"
    | "pendingDiscoveryCount"
    | "permanentCount"
    | "transientCount"
  >;
  readonly operations: Pick<
    ProtocolOperations,
    | "historyStatus"
    | "recentEvents"
    | "rewardHistoryStatus"
    | "summary"
    | "trackOutcomes"
  > & {
    readonly keeperAttemptEvidence?: ProtocolOperations["keeperAttemptEvidence"];
    readonly protocolOwnedLiquidity: Pick<
      ProtocolOperations["protocolOwnedLiquidity"],
      "cycleCount" | "permanentlyLockedWethFormatted" | "queuedWethFormatted"
    >;
    readonly trackQueues: ReadonlyArray<
      Pick<
        ProtocolOperations["trackQueues"][number],
        "deferred" | "status" | "track" | "trackId" | "wethFormatted"
      >
    >;
  };
  readonly rewards: {
    readonly tracks: ReadonlyArray<
      Pick<
        ProtocolRewardTrack,
        | "activeWeight"
        | "basketRelicPot"
        | "indicatorRelicPot"
        | "rawLiability"
        | "rawTokenBalance"
        | "solvent"
        | "track"
        | "unclaimedTrackPot"
      >
    >;
  };
  readonly roles: {
    readonly owners: Pick<
      ProtocolRoles["owners"],
      "converter" | "liquidToken" | "liquidity" | "rewards"
    >;
    readonly keeper: ProtocolRoles["keeper"];
    readonly liquidityExecutor: ProtocolRoles["liquidityExecutor"];
    readonly guardian: ProtocolRoles["guardian"];
    readonly recoveryAuthority: ProtocolRoles["recoveryAuthority"];
    readonly creator: ProtocolRoles["creator"];
  };
};

const checkGroups: ReadonlyArray<{
  readonly group: Exclude<CheckGroup, "deployment">;
  readonly exact: ReadonlySet<string>;
  readonly prefixes: readonly string[];
}> = [
  {
    group: "accounting",
    exact: new Set(["supply-invariant", "collection-partition"]),
    prefixes: ["reward-solvency:", "reward-accounting:", "accounting:"],
  },
  {
    group: "market",
    exact: new Set(["value:feeBps"]),
    prefixes: [
      "market:",
      "binding:market.",
      "binding:hook.",
      "binding:router.",
      "value:canonical",
    ],
  },
  {
    group: "operations",
    exact: new Set(["read-freshness"]),
    prefixes: ["track:", "pause:", "freeze:", "liquidity:", "rpc:"],
  },
];

const groupForCheck = (check: ProtocolHealthCheck): CheckGroup =>
  checkGroups.find(
    ({ exact, prefixes }) =>
      exact.has(check.id) ||
      prefixes.some((prefix) => check.id.startsWith(prefix)),
  )?.group ?? "deployment";

const groupChecks = (checks: readonly ProtocolHealthCheck[]) => {
  const grouped: Record<CheckGroup, ProtocolHealthCheck[]> = {
    deployment: [],
    accounting: [],
    market: [],
    operations: [],
  };
  for (const check of checks) grouped[groupForCheck(check)].push(check);
  return grouped;
};

const directOnchainStatus = (checks: readonly ProtocolHealthCheck[]) => {
  const direct = checks.filter(
    (check) => !check.id.startsWith("rpc:") && !check.id.startsWith("track:"),
  );
  return statusFromChecks(direct);
};

export type FundingDiagnosticInput =
  | { readonly state: "not-checked" | "loading" | "failed" }
  | {
      readonly state: "loaded";
      readonly serviceState: "disabled" | "inventory-empty" | "ready";
    };

const fundingSourceState = (funding: FundingDiagnosticInput) => {
  if (funding.state === "loaded") return funding.serviceState;
  if (funding.state === "failed") return "unavailable" as const;
  return funding.state;
};

const roleRows = (
  health: AdminDiagnosticsSnapshotInput,
): ReadonlyArray<{
  readonly role: AdminRoleId;
  readonly address: string | undefined;
}> => [
  { role: "liquid-token-owner", address: health.roles.owners.liquidToken },
  { role: "reward-ledger-owner", address: health.roles.owners.rewards },
  { role: "converter-owner", address: health.roles.owners.converter },
  { role: "liquidity-owner", address: health.roles.owners.liquidity },
  { role: "keeper", address: health.roles.keeper },
  { role: "liquidity-executor", address: health.roles.liquidityExecutor },
  { role: "guardian", address: health.roles.guardian },
  {
    role: "recovery-authority-contract",
    address: health.roles.recoveryAuthority,
  },
  { role: "creator", address: health.roles.creator },
];

export const deriveAdminDiagnosticsModel = (
  health: AdminDiagnosticsSnapshotInput,
  funding: FundingDiagnosticInput,
) => {
  const keeperAttemptEvidence =
    health.operations.keeperAttemptEvidence ??
    unavailableKeeperAttemptEvidence();
  return {
    sources: [
      { source: "onchain", state: directOnchainStatus(health.health.checks) },
      {
        source: "operational-index",
        state: health.operations.historyStatus,
      },
      {
        source: "reward-index",
        state: health.operations.rewardHistoryStatus,
      },
      { source: "funding", state: fundingSourceState(funding) },
      {
        source: "keeper-attempts",
        state: keeperAttemptEvidence.state,
      },
      { source: "automation", state: "not-inferable" },
    ] as const,
    deployment: health.deployment,
    collection: health.collection,
    liquidity: health.operations.protocolOwnedLiquidity,
    rewardTracks: health.rewards.tracks,
    trackQueues: health.operations.trackQueues,
    trackOutcomes: health.operations.trackOutcomes,
    keeperAttemptEvidence,
    checks: groupChecks(health.health.checks),
    roles: roleRows(health),
    recentEvents: health.operations.recentEvents,
    operationSummary: health.operations.summary,
  };
};

export type AdminDiagnosticsModel = ReturnType<
  typeof deriveAdminDiagnosticsModel
>;
