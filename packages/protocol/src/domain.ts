import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";
import { formatUnits, isAddress, type Address } from "viem";

import {
  derivePendingDiscoveryPhase,
  type DiscoveryBatchObservation,
  type PendingDiscoveryPhase,
} from "./discovery.js";

export type RewardTrackLabel = string;

export interface IdentityAttributes {
  track: number;
  tier: number;
  weightHundredths: number;
  specialKind: number;
}

export interface WalletSnapshotInput {
  liquidBalanceWei: bigint;
  settlementBalanceWei: bigint;
  transientIdentityIds: number[];
  permanentIdentityIds: number[];
  permanentHoldingsStatus: "complete" | "unavailable";
  pendingDiscoveryCount: number;
  pendingDiscoveryBatch?: DiscoveryBatchObservation;
  attributesByIdentity: Record<number, IdentityAttributes>;
  pendingRewardsByIdentity: Record<
    number,
    readonly [bigint, bigint, bigint, bigint]
  >;
  /**
   * Identities whose pending-reward read did not succeed. Their amounts are
   * substituted with zero, so consumers must be able to tell a genuine zero
   * from missing evidence.
   */
  unavailablePendingRewardIdentityIds?: ReadonlySet<number>;
  claimableIdentityIds: Set<number>;
}

export interface StockRewardAmount {
  track: RewardTrackLabel;
  rawTokenUnits: bigint;
}

export type WalletPendingDiscoveryPhase = PendingDiscoveryPhase | "unknown";

export interface CollectibleSnapshot {
  identityId: number;
  stateLabel: string;
  rewardTrack: string;
  rarityTier: string;
  rewardWeight: number;
  specialKindCode: "ordinary" | "basket" | "indicator";
  specialKind: string;
  pendingRewards: readonly StockRewardAmount[];
  /** `unavailable` means the amounts are substituted, not observed as zero. */
  pendingRewardsStatus: "observed" | "unavailable";
  claimEligible: boolean;
}

const Q192 = 1n << 192n;

export const CANONICAL_MARKET_TOKEN_DECIMALS = {
  liquidToken: 18,
  settlementToken: 18,
} as const;

const LIQUID_TOKEN_UNIT =
  10n ** BigInt(CANONICAL_MARKET_TOKEN_DECIMALS.liquidToken);

export const MAX_DISCOVERY_MUTATIONS_PER_TRANSFER = 64;

export interface LiquidTokenTransferAccountState {
  readonly balance: bigint;
  readonly discoveryExempt: boolean;
}

export interface MarketDiscoveryAccountEvidence extends LiquidTokenTransferAccountState {
  readonly account: Address;
  readonly mutations: number;
}

export interface MarketDiscoveryEvidence {
  readonly account: Address;
  readonly accountHoldings: {
    readonly pendingDiscoveryCount: number;
    readonly transientCollectibleCount: number;
  };
  readonly sender: MarketDiscoveryAccountEvidence;
  readonly recipient: MarketDiscoveryAccountEvidence;
  readonly mutations: number;
  readonly maximumMutations: number;
  readonly executable: boolean;
  readonly maximumLiquidTokenAmount: bigint;
}

export interface LiquidTokenTransferMutationCapacityInput {
  readonly sender: LiquidTokenTransferAccountState;
  readonly recipient: LiquidTokenTransferAccountState;
  readonly liquidTokenAmount: bigint;
}

const nonnegativeBalance = (name: string, value: bigint): bigint => {
  if (value < 0n) throw new RangeError(`${name} must be nonnegative`);
  return value;
};

const transferMutationCounts = (
  sender: LiquidTokenTransferAccountState,
  recipient: LiquidTokenTransferAccountState,
  liquidTokenAmount: bigint,
) => {
  const senderWholeUnitsBefore = sender.balance / LIQUID_TOKEN_UNIT;
  const recipientWholeUnitsBefore = recipient.balance / LIQUID_TOKEN_UNIT;
  const senderMutations = sender.discoveryExempt
    ? 0n
    : senderWholeUnitsBefore -
      (sender.balance - liquidTokenAmount) / LIQUID_TOKEN_UNIT;
  const recipientMutations = recipient.discoveryExempt
    ? 0n
    : (recipient.balance + liquidTokenAmount) / LIQUID_TOKEN_UNIT -
      recipientWholeUnitsBefore;
  return { senderMutations, recipientMutations } as const;
};

export const deriveLiquidTokenTransferMutationCapacity = ({
  sender,
  recipient,
  liquidTokenAmount,
}: LiquidTokenTransferMutationCapacityInput) => {
  const checkedSender = {
    ...sender,
    balance: nonnegativeBalance("sender.balance", sender.balance),
  };
  const checkedRecipient = {
    ...recipient,
    balance: nonnegativeBalance("recipient.balance", recipient.balance),
  };
  const amount = nonnegativeBalance("liquidTokenAmount", liquidTokenAmount);
  if (amount > checkedSender.balance) {
    throw new RangeError("liquidTokenAmount exceeds the sender balance");
  }
  const maximumMutations = BigInt(MAX_DISCOVERY_MUTATIONS_PER_TRANSFER);
  const countsAt = (candidate: bigint) => {
    const counts = transferMutationCounts(
      checkedSender,
      checkedRecipient,
      candidate,
    );
    return {
      ...counts,
      total: counts.senderMutations + counts.recipientMutations,
    } as const;
  };
  const counts = countsAt(amount);
  if (counts.total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Discovery mutation count is too large");
  }
  let safeLower = 0n;
  let unsafeUpper = checkedSender.balance;
  while (safeLower < unsafeUpper) {
    const candidate = (safeLower + unsafeUpper + 1n) / 2n;
    if (countsAt(candidate).total <= maximumMutations) {
      safeLower = candidate;
    } else {
      unsafeUpper = candidate - 1n;
    }
  }
  return {
    senderMutations: Number(counts.senderMutations),
    recipientMutations: Number(counts.recipientMutations),
    mutations: Number(counts.total),
    maximumMutations: MAX_DISCOVERY_MUTATIONS_PER_TRANSFER,
    executable: counts.total <= maximumMutations,
    maximumLiquidTokenAmount: safeLower,
  } as const;
};

export interface LiquidTokenBoundaryInput {
  readonly currentBalanceWei: bigint;
  readonly projectedBalanceWei: bigint;
  readonly pendingDiscoveryCount: number;
  readonly transientCollectibleCount: number;
}

const nonnegativeCount = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  return value;
};

const nextDiscoveryDrawForBalance = (
  balanceWei: bigint,
  wholeUnits: number,
) => {
  const thresholdWei = BigInt(wholeUnits + 1) * LIQUID_TOKEN_UNIT;
  const remainingWei = thresholdWei - balanceWei;
  return {
    thresholdWei,
    thresholdFormatted: formatUnits(
      thresholdWei,
      CANONICAL_MARKET_TOKEN_DECIMALS.liquidToken,
    ),
    remainingWei,
    remainingFormatted: formatUnits(
      remainingWei,
      CANONICAL_MARKET_TOKEN_DECIMALS.liquidToken,
    ),
  } as const;
};

export const deriveLiquidTokenBoundaryImpact = ({
  currentBalanceWei,
  projectedBalanceWei,
  pendingDiscoveryCount,
  transientCollectibleCount,
}: LiquidTokenBoundaryInput) => {
  const current = nonnegativeBalance("currentBalanceWei", currentBalanceWei);
  const projected = nonnegativeBalance(
    "projectedBalanceWei",
    projectedBalanceWei,
  );
  const pending = nonnegativeCount(
    "pendingDiscoveryCount",
    pendingDiscoveryCount,
  );
  const transient = nonnegativeCount(
    "transientCollectibleCount",
    transientCollectibleCount,
  );
  const currentWholeUnits = Number(current / LIQUID_TOKEN_UNIT);
  const projectedWholeUnits = Number(projected / LIQUID_TOKEN_UNIT);
  if (!Number.isSafeInteger(currentWholeUnits + projectedWholeUnits)) {
    throw new RangeError("Liquid Token whole-unit balance is too large");
  }
  if (currentWholeUnits !== pending + transient) {
    throw new RangeError(
      "Liquid Token whole units must equal confirmed pending and transient holdings",
    );
  }
  const gainedDiscoveryDrawCount = Math.max(
    projectedWholeUnits - currentWholeUnits,
    0,
  );
  const lostWholeUnitCount = Math.max(
    currentWholeUnits - projectedWholeUnits,
    0,
  );
  const pendingDiscoveryCancellationCount = Math.min(
    lostWholeUnitCount,
    pending,
  );
  const transientDissolutionCount =
    lostWholeUnitCount - pendingDiscoveryCancellationCount;
  return {
    currentWholeUnits,
    projectedWholeUnits,
    nextDiscoveryDraw: nextDiscoveryDrawForBalance(current, currentWholeUnits),
    projectedNextDiscoveryDraw: nextDiscoveryDrawForBalance(
      projected,
      projectedWholeUnits,
    ),
    gainedDiscoveryDrawCount,
    lostWholeUnitCount,
    pendingDiscoveryCancellationCount,
    transientDissolutionCount,
  } as const;
};

export interface MarketDiscoveryEvidenceValidationInput {
  readonly account: unknown;
  readonly evidence: unknown;
  readonly liquidTokenAmount: unknown;
  readonly liquidTokenForWeth: unknown;
}

type MarketDiscoveryEvidenceValidationBase = {
  readonly capacity: ReturnType<
    typeof deriveLiquidTokenTransferMutationCapacity
  >;
  readonly evidence: MarketDiscoveryEvidence;
  readonly walletLeg: MarketDiscoveryAccountEvidence;
};

export type ValidatedMarketDiscoveryEvidence =
  | (MarketDiscoveryEvidenceValidationBase & {
      readonly walletDiscoveryExempt: true;
      readonly walletImpact: undefined;
    })
  | (MarketDiscoveryEvidenceValidationBase & {
      readonly walletDiscoveryExempt: false;
      readonly walletImpact: ReturnType<typeof deriveLiquidTokenBoundaryImpact>;
    });

const discoveryRecord = (
  name: string,
  value: unknown,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

const discoveryAddress = (name: string, value: unknown): Address => {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    throw new RangeError(`${name} must be an address`);
  }
  return value;
};

const discoveryBigint = (name: string, value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new RangeError(`${name} must be a nonnegative bigint`);
  }
  return value;
};

const discoveryBoolean = (name: string, value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throw new RangeError(`${name} must be a boolean`);
  }
  return value;
};

const discoveryCount = (name: string, value: unknown): number => {
  if (typeof value !== "number") {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  return nonnegativeCount(name, value);
};

const discoveryAccountEvidence = (
  name: string,
  value: unknown,
): MarketDiscoveryAccountEvidence => {
  const record = discoveryRecord(name, value);
  return {
    account: discoveryAddress(`${name}.account`, record.account),
    balance: discoveryBigint(`${name}.balance`, record.balance),
    discoveryExempt: discoveryBoolean(
      `${name}.discoveryExempt`,
      record.discoveryExempt,
    ),
    mutations: discoveryCount(`${name}.mutations`, record.mutations),
  };
};

const checkedMarketDiscoveryEvidence = (
  value: unknown,
): MarketDiscoveryEvidence => {
  const record = discoveryRecord("evidence", value);
  const holdings = discoveryRecord(
    "evidence.accountHoldings",
    record.accountHoldings,
  );
  return {
    account: discoveryAddress("evidence.account", record.account),
    accountHoldings: {
      pendingDiscoveryCount: discoveryCount(
        "evidence.accountHoldings.pendingDiscoveryCount",
        holdings.pendingDiscoveryCount,
      ),
      transientCollectibleCount: discoveryCount(
        "evidence.accountHoldings.transientCollectibleCount",
        holdings.transientCollectibleCount,
      ),
    },
    sender: discoveryAccountEvidence("evidence.sender", record.sender),
    recipient: discoveryAccountEvidence("evidence.recipient", record.recipient),
    mutations: discoveryCount("evidence.mutations", record.mutations),
    maximumMutations: discoveryCount(
      "evidence.maximumMutations",
      record.maximumMutations,
    ),
    executable: discoveryBoolean("evidence.executable", record.executable),
    maximumLiquidTokenAmount: discoveryBigint(
      "evidence.maximumLiquidTokenAmount",
      record.maximumLiquidTokenAmount,
    ),
  };
};

const discoveryCapacityMatchesEvidence = (
  evidence: MarketDiscoveryEvidence,
  capacity: ReturnType<typeof deriveLiquidTokenTransferMutationCapacity>,
): boolean =>
  evidence.sender.mutations === capacity.senderMutations &&
  evidence.recipient.mutations === capacity.recipientMutations &&
  evidence.mutations === capacity.mutations &&
  evidence.maximumMutations === capacity.maximumMutations &&
  evidence.executable === capacity.executable &&
  evidence.maximumLiquidTokenAmount === capacity.maximumLiquidTokenAmount;

const assertDiscoveryWalletIdentity = (
  account: Address,
  evidence: MarketDiscoveryEvidence,
  walletLeg: MarketDiscoveryAccountEvidence,
): void => {
  const normalizedAccount = account.toLowerCase();
  if (
    evidence.account.toLowerCase() !== normalizedAccount ||
    walletLeg.account.toLowerCase() !== normalizedAccount
  ) {
    throw new RangeError("Discovery evidence does not match the wallet");
  }
};

const assertExemptWalletEvidence = (
  evidence: MarketDiscoveryEvidence,
  walletLeg: MarketDiscoveryAccountEvidence,
): void => {
  if (
    evidence.accountHoldings.pendingDiscoveryCount !== 0 ||
    evidence.accountHoldings.transientCollectibleCount !== 0 ||
    walletLeg.mutations !== 0
  ) {
    throw new RangeError("Exempt wallet discovery evidence is inconsistent");
  }
};

export const validateMarketDiscoveryEvidence = ({
  account,
  evidence: evidenceInput,
  liquidTokenAmount,
  liquidTokenForWeth,
}: MarketDiscoveryEvidenceValidationInput): ValidatedMarketDiscoveryEvidence => {
  const checkedAccount = discoveryAddress("account", account);
  const direction = discoveryBoolean("liquidTokenForWeth", liquidTokenForWeth);
  const amount = discoveryBigint("liquidTokenAmount", liquidTokenAmount);
  const evidence = checkedMarketDiscoveryEvidence(evidenceInput);
  const walletLeg = direction ? evidence.sender : evidence.recipient;
  assertDiscoveryWalletIdentity(checkedAccount, evidence, walletLeg);
  const capacity = deriveLiquidTokenTransferMutationCapacity({
    sender: evidence.sender,
    recipient: evidence.recipient,
    liquidTokenAmount: amount,
  });
  if (!discoveryCapacityMatchesEvidence(evidence, capacity)) {
    throw new RangeError("Discovery evidence capacity is inconsistent");
  }
  if (walletLeg.discoveryExempt) {
    assertExemptWalletEvidence(evidence, walletLeg);
    return {
      capacity,
      evidence,
      walletDiscoveryExempt: true,
      walletImpact: undefined,
      walletLeg,
    };
  }
  const walletImpact = deriveLiquidTokenBoundaryImpact({
    currentBalanceWei: walletLeg.balance,
    projectedBalanceWei: direction
      ? walletLeg.balance - amount
      : walletLeg.balance + amount,
    pendingDiscoveryCount: evidence.accountHoldings.pendingDiscoveryCount,
    transientCollectibleCount:
      evidence.accountHoldings.transientCollectibleCount,
  });
  const walletMutations = direction
    ? walletImpact.lostWholeUnitCount
    : walletImpact.gainedDiscoveryDrawCount;
  if (walletMutations !== walletLeg.mutations) {
    throw new RangeError("Wallet discovery evidence is inconsistent");
  }
  return {
    capacity,
    evidence,
    walletDiscoveryExempt: false,
    walletImpact,
    walletLeg,
  };
};

const checkedTokenDecimals = (name: string, decimals: number): number => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`${name} must be an integer from 0 through 255`);
  }
  return decimals;
};

export const deriveCanonicalMarketPrice = ({
  sqrtPriceX96,
  currency0,
  currency1,
  liquidToken,
  identity,
  liquidTokenDecimals,
  settlementTokenDecimals,
}: {
  sqrtPriceX96: bigint;
  currency0: Address;
  currency1: Address;
  liquidToken: Address;
  identity: IdentityConfiguration;
  liquidTokenDecimals: number;
  settlementTokenDecimals: number;
}) => {
  const copy = createIdentityProtocolCopy(identity).domain;
  if (sqrtPriceX96 <= 0n) {
    throw new RangeError(copy.marketPricePositive);
  }
  const liquidDecimals = checkedTokenDecimals(
    "liquidTokenDecimals",
    liquidTokenDecimals,
  );
  const settlementDecimals = checkedTokenDecimals(
    "settlementTokenDecimals",
    settlementTokenDecimals,
  );
  const liquidTokenIsCurrency0 =
    currency0.toLowerCase() === liquidToken.toLowerCase();
  if (
    !liquidTokenIsCurrency0 &&
    currency1.toLowerCase() !== liquidToken.toLowerCase()
  ) {
    throw new RangeError(copy.marketMissingLiquidToken);
  }
  const squaredPriceX192 = sqrtPriceX96 * sqrtPriceX96;
  const liquidScale = 10n ** BigInt(liquidDecimals);
  const settlementScale = 10n ** BigInt(settlementDecimals);
  const wethPerLiquidTokenWei = liquidTokenIsCurrency0
    ? (squaredPriceX192 * liquidScale * 10n ** 18n) / (Q192 * settlementScale)
    : (Q192 * liquidScale * 10n ** 18n) / (squaredPriceX192 * settlementScale);
  return {
    wethPerLiquidTokenWei,
    wethPerLiquidTokenFormatted: formatUnits(wethPerLiquidTokenWei, 18),
  } as const;
};

const attributesFor = (
  input: WalletSnapshotInput,
  identity: IdentityConfiguration,
  identityId: number,
) => {
  const copy = createIdentityProtocolCopy(identity).domain;
  const rewardTrackLabels = identity.rewardTrackLabels;
  const rarityTierLabels = identity.rarityTierLabels;
  const attributes = input.attributesByIdentity[identityId];
  if (attributes === undefined) {
    throw new RangeError(copy.missingAttributes(identityId));
  }
  const rewardTrack = rewardTrackLabels[attributes.track];
  const rarityTier = rarityTierLabels[attributes.tier];
  if (rewardTrack === undefined || rarityTier === undefined) {
    throw new RangeError(copy.invalidAttributes(identityId));
  }
  return { attributes, rarityTier, rewardTrack };
};

export const deriveCollectibleSnapshot = (
  input: WalletSnapshotInput,
  identity: IdentityConfiguration,
  identityId: number,
  permanent: boolean,
): CollectibleSnapshot => {
  const { attributes, rarityTier, rewardTrack } = attributesFor(
    input,
    identity,
    identityId,
  );
  const pending = input.pendingRewardsByIdentity[identityId] ?? [
    0n,
    0n,
    0n,
    0n,
  ];
  const rewardTrackLabels = identity.rewardTrackLabels;
  const specialKindCode =
    attributes.specialKind === 1
      ? "basket"
      : attributes.specialKind === 2
        ? "indicator"
        : "ordinary";
  const specialKind =
    specialKindCode === "basket"
      ? identity.terms.basketRelic
      : specialKindCode === "indicator"
        ? identity.terms.indicatorRelic
        : identity.terms.ordinaryCollectible;

  return {
    identityId,
    stateLabel: permanent
      ? identity.terms.permanentCollectible
      : identity.terms.transientCollectible,
    rewardTrack,
    rarityTier,
    rewardWeight: attributes.weightHundredths / 100,
    specialKindCode,
    specialKind,
    pendingRewards: pending.map((rawTokenUnits, index) => ({
      track: rewardTrackLabels[index + 1] as RewardTrackLabel,
      rawTokenUnits,
    })),
    pendingRewardsStatus:
      input.unavailablePendingRewardIdentityIds?.has(identityId) === true
        ? "unavailable"
        : "observed",
    claimEligible: permanent && input.claimableIdentityIds.has(identityId),
  };
};

export const deriveWalletSnapshot = (
  input: WalletSnapshotInput,
  identity: IdentityConfiguration,
) => {
  const boundary = deriveLiquidTokenBoundaryImpact({
    currentBalanceWei: input.liquidBalanceWei,
    projectedBalanceWei: input.liquidBalanceWei,
    pendingDiscoveryCount: input.pendingDiscoveryCount,
    transientCollectibleCount: input.transientIdentityIds.length,
  });
  return {
    liquidToken: {
      label: identity.liquidToken.displayName,
      rawWei: input.liquidBalanceWei,
      formatted: formatUnits(
        input.liquidBalanceWei,
        CANONICAL_MARKET_TOKEN_DECIMALS.liquidToken,
      ),
      wholeUnits: boundary.currentWholeUnits,
      nextDiscoveryDraw: boundary.nextDiscoveryDraw,
    },
    settlementToken: {
      label: identity.terms.settlementAsset,
      rawWei: input.settlementBalanceWei,
      formatted: formatUnits(
        input.settlementBalanceWei,
        CANONICAL_MARKET_TOKEN_DECIMALS.settlementToken,
      ),
    },
    collectibles: {
      transientLabel: identity.terms.transientCollectible,
      permanentLabel: identity.terms.permanentCollectible,
      transient: input.transientIdentityIds.map((identityId) =>
        deriveCollectibleSnapshot(input, identity, identityId, false),
      ),
      permanent: input.permanentIdentityIds.map((identityId) =>
        deriveCollectibleSnapshot(input, identity, identityId, true),
      ),
      permanentHoldingsStatus: input.permanentHoldingsStatus,
      pendingDiscovery: {
        count: input.pendingDiscoveryCount,
        label: identity.terms.pendingDiscovery,
        phase: (input.pendingDiscoveryCount === 0
          ? "complete"
          : input.pendingDiscoveryBatch === undefined
            ? "unknown"
            : derivePendingDiscoveryPhase(
                input.pendingDiscoveryBatch,
              )) as WalletPendingDiscoveryPhase,
        batch: input.pendingDiscoveryBatch,
      },
    },
    stockRewardUnitDisclosure: identity.disclosures.stockRewardUnits,
  };
};
