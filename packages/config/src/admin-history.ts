import { ADMIN_DIAGNOSTIC_PATHS } from "./admin-auth.js";
import type { Address, Hex } from "viem";

export const ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES = 1_048_576;

const MAXIMUM_HISTORY_ITEMS = 256;
const MAXIMUM_DECIMAL_DIGITS = 78;

type JsonRecord = Readonly<Record<string, unknown>>;

export interface AdminHistoryManifestDto {
  readonly canonicalPool: {
    readonly currency0: Address;
    readonly currency1: Address;
    readonly poolId: Hex;
  };
  readonly chainId: number;
  readonly commitment: Hex;
  readonly fingerprint: Hex;
  readonly launchBlock: string;
  readonly network: string;
  readonly sources: {
    readonly canonicalFeeHook: Address;
    readonly epochConverter: Address;
    readonly fuelCore: Address;
    readonly poolManager: Address;
    readonly protocolLiquidityVault: Address;
    readonly rewardLedger: Address;
  };
}

export type AdminHistoryPayloadScalar = string | number | boolean | null;

export interface AdminOperationsHistoryResponseDto {
  readonly items: readonly {
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly blockTimestamp: string;
    readonly eventName:
      | "reward-epoch-opened"
      | "track-executed"
      | "reward-claimed"
      | "protocol-liquidity-added";
    readonly logIndex: number;
    readonly parentHash: Hex;
    readonly payload: Readonly<Record<string, AdminHistoryPayloadScalar>>;
    readonly removed: false;
    readonly sourceAddress: Address;
    readonly transactionHash: Hex;
    readonly transactionIndex: number;
  }[];
  readonly manifest: AdminHistoryManifestDto;
  readonly page: {
    readonly hasMore: boolean;
    readonly nextCursor?: string;
  };
  readonly snapshot: {
    readonly blockHash?: Hex;
    readonly blockNumber?: string;
    readonly canonicalRevision: number;
    readonly generation: string;
  };
  readonly status: {
    readonly coverage: {
      readonly fromBlock: string;
      readonly indexedThroughBlock?: string;
      readonly indexedThroughTime?: string;
    };
    readonly head: {
      readonly lagBlocks?: string;
      readonly observedBlock?: string;
    };
    readonly requested: {
      readonly fromBlock: string;
      readonly toBlock: string;
    };
    readonly state: "complete" | "partial";
  };
}

export type AdminKeeperTrack = 1 | 2 | 3 | 4;
export type AdminKeeperAttemptOutcome =
  | "preparing"
  | "not-required"
  | "simulated"
  | "failed-before-submission"
  | "pending"
  | "succeeded"
  | "reverted"
  | "reorged";
export type AdminKeeperAttemptFailureClass =
  | "quote-unavailable"
  | "preflight-rejected"
  | "submission-rejected"
  | "receipt-unavailable"
  | "execution-reverted"
  | "canonicality-uncertain";

export interface AdminKeeperAttemptDto {
  readonly actionKind: "reward-track";
  readonly failureClass?: AdminKeeperAttemptFailureClass;
  readonly observedAt: string;
  readonly observedBlock: string;
  readonly outcome: AdminKeeperAttemptOutcome;
  readonly receipt?: {
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly blockTimestamp: string;
  };
  readonly track: AdminKeeperTrack;
  readonly transactionHash?: Hex;
}

export interface AdminKeeperAttemptsHistoryResponseDto {
  readonly evidence: {
    readonly coverage: Readonly<
      Record<AdminKeeperTrack, "complete" | "partial">
    >;
    readonly freshness: {
      readonly ageSeconds?: string;
      readonly maximumAgeSeconds: string;
      readonly observedAt?: string;
      readonly recordedAt?: string;
    };
    readonly generation: string;
    readonly source: "keeper-attempt-journal";
    readonly state: "fresh" | "stale" | "incomplete" | "unavailable";
    readonly tracks: Readonly<
      Record<
        AdminKeeperTrack,
        {
          readonly latest?: AdminKeeperAttemptDto;
          readonly state: "fresh" | "retryable" | "unknown";
        }
      >
    >;
  };
  readonly manifest: AdminHistoryManifestDto;
}

export type AdminHistoryResponseDto =
  AdminOperationsHistoryResponseDto | AdminKeeperAttemptsHistoryResponseDto;

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
};

const string = (value: unknown, label: string, maximum: number): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new TypeError(`${label} must be a bounded non-empty string`);
  }
  return value;
};

const safeUnsignedInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value as number;
};

const safeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
  return value as number;
};

const decimal = (value: unknown, label: string): string => {
  const encoded = string(value, label, MAXIMUM_DECIMAL_DIGITS);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(encoded)) {
    throw new TypeError(`${label} must be an unsigned decimal string`);
  }
  return encoded;
};

const optionalDecimal = (value: unknown, label: string): string | undefined =>
  value === undefined || value === null ? undefined : decimal(value, label);

const hex = (value: unknown, label: string, digits: number): `0x${string}` => {
  const encoded = string(value, label, digits + 2);
  if (!new RegExp(`^0x[0-9a-fA-F]{${digits}}$`, "u").test(encoded)) {
    throw new TypeError(`${label} must be a bounded hex string`);
  }
  return encoded as `0x${string}`;
};

const address = (value: unknown, label: string): `0x${string}` =>
  hex(value, label, 40);

const enumValue = <const Values extends readonly string[]>(
  value: unknown,
  label: string,
  values: Values,
): Values[number] => {
  const encoded = string(value, label, 64);
  if (!values.includes(encoded)) {
    throw new TypeError(`${label} is unsupported`);
  }
  return encoded;
};

const manifestFrom = (
  value: unknown,
  expectedFingerprint: Hex,
): AdminHistoryManifestDto => {
  const input = record(value, "history manifest");
  const canonicalPool = record(input.canonicalPool, "history canonical pool");
  const sources = record(input.sources, "history sources");
  const fingerprint = hex(input.fingerprint, "history fingerprint", 64);
  if (fingerprint !== expectedFingerprint) {
    throw new TypeError(
      "History manifest fingerprint does not match the session",
    );
  }
  return {
    canonicalPool: {
      currency0: address(canonicalPool.currency0, "history currency0"),
      currency1: address(canonicalPool.currency1, "history currency1"),
      poolId: hex(canonicalPool.poolId, "history pool id", 64),
    },
    chainId: safeUnsignedInteger(input.chainId, "history chain id"),
    commitment: hex(input.commitment, "history commitment", 64),
    fingerprint,
    launchBlock: decimal(input.launchBlock, "history launch block"),
    network: string(input.network, "history network", 128),
    sources: {
      canonicalFeeHook: address(
        sources.canonicalFeeHook,
        "history canonical fee hook",
      ),
      epochConverter: address(
        sources.epochConverter,
        "history epoch converter",
      ),
      fuelCore: address(sources.fuelCore, "history fuel core"),
      poolManager: address(sources.poolManager, "history pool manager"),
      protocolLiquidityVault: address(
        sources.protocolLiquidityVault,
        "history liquidity vault",
      ),
      rewardLedger: address(sources.rewardLedger, "history reward ledger"),
    },
  };
};

const snapshotFrom = (
  value: unknown,
): AdminOperationsHistoryResponseDto["snapshot"] => {
  const input = record(value, "history snapshot");
  const blockNumber = optionalDecimal(
    input.blockNumber,
    "snapshot block number",
  );
  const blockHash =
    input.blockHash === undefined || input.blockHash === null
      ? undefined
      : hex(input.blockHash, "snapshot block hash", 64);
  if ((blockNumber === undefined) !== (blockHash === undefined)) {
    throw new TypeError("Snapshot block number and hash must appear together");
  }
  return {
    ...(blockHash === undefined ? {} : { blockHash }),
    ...(blockNumber === undefined ? {} : { blockNumber }),
    canonicalRevision: safeUnsignedInteger(
      input.canonicalRevision,
      "history canonical revision",
    ),
    generation: string(input.generation, "history generation", 256),
  };
};

const operationEventNames = [
  "reward-epoch-opened",
  "track-executed",
  "reward-claimed",
  "protocol-liquidity-added",
] as const;
type OperationEventName = (typeof operationEventNames)[number];

const rewardEpochPayloadFrom = (
  input: JsonRecord,
): Readonly<Record<string, AdminHistoryPayloadScalar>> => ({
  epochNumber: decimal(input.epochNumber, "reward epoch number"),
  equalTrackShare: decimal(input.equalTrackShare, "reward equal track share"),
  finalTrackRemainder: decimal(
    input.finalTrackRemainder,
    "reward final track remainder",
  ),
  openedAmount: decimal(input.openedAmount, "reward opened amount"),
});

const trackExecutedPayloadFrom = (
  input: JsonRecord,
): Readonly<Record<string, AdminHistoryPayloadScalar>> => {
  const track = safeUnsignedInteger(input.track, "executed reward track");
  if (track < 1 || track > 4) {
    throw new TypeError("Executed reward track is invalid");
  }
  return {
    deferredTrackBudget: decimal(
      input.deferredTrackBudget,
      "deferred track budget",
    ),
    measuredStockOutput: decimal(
      input.measuredStockOutput,
      "measured stock output",
    ),
    track,
    wethInput: decimal(input.wethInput, "track WETH input"),
  };
};

const rewardClaimedPayloadFrom = (
  input: JsonRecord,
): Readonly<Record<string, AdminHistoryPayloadScalar>> => {
  const track = safeUnsignedInteger(input.track, "claimed reward track");
  if (track < 1 || track > 4) {
    throw new TypeError("Claimed reward track is invalid");
  }
  return {
    amount: decimal(input.amount, "claimed reward amount"),
    currentOwner: address(input.currentOwner, "claimed reward owner"),
    identityId: safeUnsignedInteger(
      input.identityId,
      "claimed reward identity",
    ),
    track,
  };
};

const protocolLiquidityPayloadFrom = (
  input: JsonRecord,
): Readonly<Record<string, AdminHistoryPayloadScalar>> => ({
  consumedWeth: decimal(input.consumedWeth, "consumed liquidity WETH"),
  cycleNumber: decimal(input.cycleNumber, "liquidity cycle number"),
  liquidity: decimal(input.liquidity, "position liquidity"),
  permanentlyLockedWeth: decimal(
    input.permanentlyLockedWeth,
    "permanently locked WETH",
  ),
  positionSalt: hex(input.positionSalt, "liquidity position salt", 64),
  pulledWeth: decimal(input.pulledWeth, "pulled liquidity WETH"),
  queuedWeth: decimal(input.queuedWeth, "queued liquidity WETH"),
  tickLower: safeInteger(input.tickLower, "position lower tick"),
  tickUpper: safeInteger(input.tickUpper, "position upper tick"),
});

const operationPayloadFrom = (
  value: unknown,
  eventName: OperationEventName,
): Readonly<Record<string, AdminHistoryPayloadScalar>> => {
  const input = record(value, `${eventName} payload`);
  if (eventName === "reward-epoch-opened") {
    return rewardEpochPayloadFrom(input);
  }
  if (eventName === "track-executed") {
    return trackExecutedPayloadFrom(input);
  }
  if (eventName === "reward-claimed") {
    return rewardClaimedPayloadFrom(input);
  }
  return protocolLiquidityPayloadFrom(input);
};

const operationItemFrom = (
  value: unknown,
): AdminOperationsHistoryResponseDto["items"][number] => {
  const input = record(value, "history operation item");
  if (input.removed !== false) {
    throw new TypeError("History operation must be canonical");
  }
  const eventName = enumValue(
    input.eventName,
    "operation event name",
    operationEventNames,
  );
  return {
    blockHash: hex(input.blockHash, "operation block hash", 64),
    blockNumber: decimal(input.blockNumber, "operation block number"),
    blockTimestamp: decimal(input.blockTimestamp, "operation block timestamp"),
    eventName,
    logIndex: safeUnsignedInteger(input.logIndex, "operation log index"),
    parentHash: hex(input.parentHash, "operation parent hash", 64),
    payload: operationPayloadFrom(input.payload, eventName),
    removed: false,
    sourceAddress: address(input.sourceAddress, "operation source address"),
    transactionHash: hex(
      input.transactionHash,
      "operation transaction hash",
      64,
    ),
    transactionIndex: safeUnsignedInteger(
      input.transactionIndex,
      "operation transaction index",
    ),
  };
};

const statusPositionFrom = (
  value: unknown,
): Omit<AdminOperationsHistoryResponseDto["status"], "requested"> => {
  const input = record(value, "history status");
  const coverage = record(input.coverage, "history coverage");
  const head = record(input.head, "history head");
  const indexedThroughBlock = optionalDecimal(
    coverage.indexedThroughBlock,
    "history indexed through block",
  );
  const indexedThroughTime = optionalDecimal(
    coverage.indexedThroughTime,
    "history indexed through time",
  );
  const observedBlock = optionalDecimal(
    head.observedBlock,
    "history observed block",
  );
  const lagBlocks = optionalDecimal(head.lagBlocks, "history lag blocks");
  return {
    coverage: {
      fromBlock: decimal(coverage.fromBlock, "history coverage from block"),
      ...(indexedThroughBlock === undefined ? {} : { indexedThroughBlock }),
      ...(indexedThroughTime === undefined ? {} : { indexedThroughTime }),
    },
    head: {
      ...(lagBlocks === undefined ? {} : { lagBlocks }),
      ...(observedBlock === undefined ? {} : { observedBlock }),
    },
    state: enumValue(input.state, "history state", ["complete", "partial"]),
  };
};

export const decodeAdminOperationsHistoryResponse = (
  value: unknown,
  expectedFingerprint: Hex,
): AdminOperationsHistoryResponseDto => {
  const input = record(value, "operations history response");
  if (
    !Array.isArray(input.items) ||
    input.items.length > MAXIMUM_HISTORY_ITEMS
  ) {
    throw new TypeError("Operations history items are invalid");
  }
  const page = record(input.page, "operations history page");
  if (typeof page.hasMore !== "boolean") {
    throw new TypeError("Operations history pagination is invalid");
  }
  const nextCursor =
    page.nextCursor === undefined
      ? undefined
      : string(page.nextCursor, "operations next cursor", 4_096);
  if (page.hasMore && nextCursor === undefined) {
    throw new TypeError("A continuing operations page requires a cursor");
  }
  const status = record(input.status, "operations history status");
  const requested = record(status.requested, "operations requested range");
  return {
    items: input.items.map(operationItemFrom),
    manifest: manifestFrom(input.manifest, expectedFingerprint),
    page: {
      hasMore: page.hasMore,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
    snapshot: snapshotFrom(input.snapshot),
    status: {
      ...statusPositionFrom(status),
      requested: {
        fromBlock: decimal(requested.fromBlock, "requested from block"),
        toBlock: decimal(requested.toBlock, "requested to block"),
      },
    },
  };
};

const keeperAttemptOutcomes = [
  "preparing",
  "not-required",
  "simulated",
  "failed-before-submission",
  "pending",
  "succeeded",
  "reverted",
  "reorged",
] as const;
const keeperFailureClasses = [
  "quote-unavailable",
  "preflight-rejected",
  "submission-rejected",
  "receipt-unavailable",
  "execution-reverted",
  "canonicality-uncertain",
] as const;

type KeeperTrackState =
  AdminKeeperAttemptsHistoryResponseDto["evidence"]["tracks"][1]["state"];

const keeperAttemptRules: Readonly<
  Record<
    AdminKeeperAttemptOutcome,
    {
      readonly failureClasses: readonly AdminKeeperAttemptFailureClass[];
      readonly failureRequired?: boolean;
      readonly receipt: boolean;
      readonly state: KeeperTrackState;
      readonly transaction: boolean;
    }
  >
> = {
  preparing: {
    failureClasses: [],
    receipt: false,
    state: "unknown",
    transaction: false,
  },
  "not-required": {
    failureClasses: [],
    receipt: false,
    state: "fresh",
    transaction: false,
  },
  simulated: {
    failureClasses: [],
    receipt: false,
    state: "unknown",
    transaction: false,
  },
  "failed-before-submission": {
    failureClasses: [
      "quote-unavailable",
      "preflight-rejected",
      "submission-rejected",
    ],
    failureRequired: true,
    receipt: false,
    state: "retryable",
    transaction: false,
  },
  pending: {
    failureClasses: ["receipt-unavailable"],
    receipt: false,
    state: "unknown",
    transaction: true,
  },
  succeeded: {
    failureClasses: [],
    receipt: true,
    state: "fresh",
    transaction: true,
  },
  reverted: {
    failureClasses: ["execution-reverted"],
    failureRequired: true,
    receipt: true,
    state: "retryable",
    transaction: true,
  },
  reorged: {
    failureClasses: ["canonicality-uncertain"],
    failureRequired: true,
    receipt: false,
    state: "unknown",
    transaction: true,
  },
};

const keeperReceiptFrom = (
  value: unknown,
): AdminKeeperAttemptDto["receipt"] => {
  if (value === undefined) return undefined;
  const receipt = record(value, "keeper attempt receipt");
  return {
    blockHash: hex(receipt.blockHash, "keeper receipt block hash", 64),
    blockNumber: decimal(receipt.blockNumber, "keeper receipt block number"),
    blockTimestamp: decimal(
      receipt.blockTimestamp,
      "keeper receipt block timestamp",
    ),
  };
};

const optionalKeeperFailureClass = (
  value: unknown,
): AdminKeeperAttemptFailureClass | undefined =>
  value === undefined
    ? undefined
    : enumValue(value, "keeper attempt failure class", keeperFailureClasses);

const optionalKeeperTransactionHash = (value: unknown): Hex | undefined =>
  value === undefined || value === null
    ? undefined
    : hex(value, "keeper attempt transaction hash", 64);

const assertKeeperAttempt = (input: {
  readonly failureClass: AdminKeeperAttemptFailureClass | undefined;
  readonly outcome: AdminKeeperAttemptOutcome;
  readonly receiptPresent: boolean;
  readonly state: KeeperTrackState;
  readonly transactionPresent: boolean;
}): void => {
  const rule = keeperAttemptRules[input.outcome];
  if (
    input.state !== rule.state ||
    input.transactionPresent !== rule.transaction ||
    input.receiptPresent !== rule.receipt ||
    (rule.failureRequired === true && input.failureClass === undefined) ||
    (input.failureClass !== undefined &&
      !rule.failureClasses.includes(input.failureClass))
  ) {
    throw new TypeError("Keeper attempt evidence is internally inconsistent");
  }
};

const keeperAttemptFrom = (
  value: unknown,
  track: AdminKeeperTrack,
  state: KeeperTrackState,
): AdminKeeperAttemptDto => {
  const input = record(value, `keeper track ${track} latest attempt`);
  if (safeUnsignedInteger(input.track, "keeper attempt track") !== track) {
    throw new TypeError("Keeper attempt is attached to the wrong track");
  }
  if (input.actionKind !== "reward-track") {
    throw new TypeError("Keeper track evidence has the wrong action kind");
  }
  const outcome = enumValue(
    input.outcome,
    "keeper attempt outcome",
    keeperAttemptOutcomes,
  );
  const failureClass = optionalKeeperFailureClass(input.failureClass);
  const transactionHash = optionalKeeperTransactionHash(input.transactionHash);
  const receipt = keeperReceiptFrom(input.receipt);
  assertKeeperAttempt({
    failureClass,
    outcome,
    receiptPresent: receipt !== undefined,
    state,
    transactionPresent: transactionHash !== undefined,
  });
  return {
    actionKind: "reward-track",
    ...(failureClass === undefined ? {} : { failureClass }),
    observedAt: decimal(input.observedAt, "keeper attempt observed time"),
    observedBlock: decimal(
      input.observedBlock,
      "keeper attempt observed block",
    ),
    outcome,
    ...(receipt === undefined ? {} : { receipt }),
    track,
    ...(transactionHash === undefined ? {} : { transactionHash }),
  };
};

const keeperTrackFrom = (
  value: unknown,
  track: AdminKeeperTrack,
): AdminKeeperAttemptsHistoryResponseDto["evidence"]["tracks"][typeof track] => {
  const input = record(value, `keeper track ${track}`);
  const state = enumValue(input.state, `keeper track ${track} state`, [
    "fresh",
    "retryable",
    "unknown",
  ] as const);
  if (input.latest === undefined) {
    if (state !== "unknown") {
      throw new TypeError("Known keeper track state requires an attempt");
    }
    return { state };
  }
  return { latest: keeperAttemptFrom(input.latest, track, state), state };
};

export const decodeAdminKeeperAttemptsHistoryResponse = (
  value: unknown,
  expectedFingerprint: Hex,
): AdminKeeperAttemptsHistoryResponseDto => {
  const input = record(value, "keeper attempts history response");
  const evidence = record(input.evidence, "keeper attempt evidence");
  const freshness = record(evidence.freshness, "keeper attempt freshness");
  const coverage = record(evidence.coverage, "keeper attempt coverage");
  const tracks = record(evidence.tracks, "keeper attempt tracks");
  const maximumAgeSeconds = decimal(
    freshness.maximumAgeSeconds,
    "keeper maximum age",
  );
  if (maximumAgeSeconds === "0") {
    throw new TypeError("Keeper maximum age must be positive");
  }
  const coverageFor = (track: AdminKeeperTrack) =>
    enumValue(coverage[track], `keeper track ${track} coverage`, [
      "complete",
      "partial",
    ] as const);
  const decodedCoverage = {
    1: coverageFor(1),
    2: coverageFor(2),
    3: coverageFor(3),
    4: coverageFor(4),
  } as const;
  const decodedTracks = {
    1: keeperTrackFrom(tracks[1], 1),
    2: keeperTrackFrom(tracks[2], 2),
    3: keeperTrackFrom(tracks[3], 3),
    4: keeperTrackFrom(tracks[4], 4),
  } as const;
  const trackNumbers = [1, 2, 3, 4] as const;
  if (
    trackNumbers.some(
      (track) =>
        (decodedCoverage[track] === "partial") !==
        (decodedTracks[track].state === "unknown"),
    )
  ) {
    throw new TypeError("Keeper coverage and track state disagree");
  }
  const state = enumValue(evidence.state, "keeper attempt state", [
    "fresh",
    "stale",
    "incomplete",
    "unavailable",
  ] as const);
  if (
    state !== "fresh" &&
    trackNumbers.some(
      (track) =>
        decodedCoverage[track] !== "partial" ||
        decodedTracks[track].state !== "unknown" ||
        decodedTracks[track].latest !== undefined,
    )
  ) {
    throw new TypeError("Non-fresh keeper evidence must remain unknown");
  }
  const observedAt = optionalDecimal(
    freshness.observedAt,
    "keeper freshness observed time",
  );
  const recordedAt = optionalDecimal(
    freshness.recordedAt,
    "keeper freshness recorded time",
  );
  const ageSeconds = optionalDecimal(
    freshness.ageSeconds,
    "keeper freshness age",
  );
  return {
    evidence: {
      coverage: decodedCoverage,
      freshness: {
        ...(ageSeconds === undefined ? {} : { ageSeconds }),
        maximumAgeSeconds,
        ...(observedAt === undefined ? {} : { observedAt }),
        ...(recordedAt === undefined ? {} : { recordedAt }),
      },
      generation: string(evidence.generation, "keeper generation", 256),
      source: enumValue(evidence.source, "keeper attempt source", [
        "keeper-attempt-journal",
      ] as const),
      state,
      tracks: decodedTracks,
    },
    manifest: manifestFrom(input.manifest, expectedFingerprint),
  };
};

export const decodeAdminHistoryResponse = (
  path: string,
  value: unknown,
  expectedFingerprint: Hex,
): AdminHistoryResponseDto => {
  if (path === ADMIN_DIAGNOSTIC_PATHS.operations) {
    return decodeAdminOperationsHistoryResponse(value, expectedFingerprint);
  }
  if (path === ADMIN_DIAGNOSTIC_PATHS.keeperAttempts) {
    return decodeAdminKeeperAttemptsHistoryResponse(value, expectedFingerprint);
  }
  throw new TypeError("Unsupported admin history response");
};
