import { formatUnits, type Address } from "viem";

import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";

import { createProtocolContracts, protocolAbis } from "./contracts.js";
import {
  validateMarketDiscoveryEvidence,
  type MarketDiscoveryEvidence,
} from "./domain.js";

export const MAX_CLAIM_IDENTITIES = 64;
export const MAX_UINT256 = 2n ** 256n - 1n;
const MIN_UNISWAP_TICK = -887_272;
const MAX_UNISWAP_TICK = 887_272;

export const selectClaimIdentityBatch = (
  identityIds: readonly number[],
): number[] => identityIds.slice(0, MAX_CLAIM_IDENTITIES);

export interface ProtocolRoles {
  owners: {
    liquidToken: Address | undefined;
    rewards: Address | undefined;
    converter: Address | undefined;
    liquidity: Address | undefined;
  };
  guardian: Address | undefined;
  recoveryAuthority: Address | undefined;
  keeper: Address | undefined;
  liquidityExecutor: Address | undefined;
  creator: Address | undefined;
}

export interface TransactionContracts {
  canonicalFeeHook: Address;
  claimGate: Address;
  fuelCore: Address;
  weth: Address;
  fuelMirror: Address;
  rewardLedger: Address;
  epochConverter: Address;
  canonicalRouter: Address;
  protocolLiquidityVault: Address;
  uniswapV4PoolManager: Address;
}

export interface TransactionContext {
  identity: IdentityConfiguration;
  expectedChainId: number;
  connectedChainId: number;
  currentBlock: bigint;
  currentTimestamp: bigint;
  maximumQuoteAgeBlocks: bigint;
  connectedWallet: Address | undefined;
  roles: ProtocolRoles;
  contracts: TransactionContracts;
  launched: boolean;
  sealed: boolean;
  liquidityConfigurationSealed: boolean;
  canonicalTickSpacing: number;
  pauses: {
    liquidToken: boolean;
    rewards: boolean;
    converter: boolean;
    liquidity: boolean;
  };
  rewardPotWeth: bigint;
  creatorPotWeth: bigint;
  nextRewardEpochAt: bigint;
  trackQueues: Readonly<Record<1 | 2 | 3 | 4, bigint>>;
  trackAttemptHistoryAvailable: Readonly<Record<1 | 2 | 3 | 4, boolean>>;
  retryableTracks: ReadonlySet<1 | 2 | 3 | 4>;
  ownedTransientIdentityIds: Set<number>;
  ownedPermanentIdentityIds: Set<number>;
  claimableIdentityIds: Set<number>;
  /** The configurable policy's administrator, absent for always-allow. */
  claimPolicyAdministrator?: Address | undefined;
  readAvailability: {
    launched: boolean;
    conversionConfigurationSealed: boolean;
    liquidityConfigurationSealed: boolean;
    pauses: {
      liquidToken: boolean;
      rewards: boolean;
      converter: boolean;
      liquidity: boolean;
    };
    rewardPot: boolean;
    creatorPot: boolean;
    nextRewardEpoch: boolean;
    trackQueues: Readonly<Record<1 | 2 | 3 | 4, boolean>>;
  };
}

export type TransactionRuntimeContext = Omit<
  TransactionContext,
  | "contracts"
  | "expectedChainId"
  | "identity"
  | "canonicalTickSpacing"
  | "maximumQuoteAgeBlocks"
>;

export type ProtocolAction =
  | { type: "claim"; identityIds: number[] }
  | {
      type: "approve-exchange-input";
      asset: "liquid-token" | "weth";
      amount: bigint;
    }
  | { type: "commit-collectible"; identityId: number }
  | {
      type: "direct-collectible-transfer";
      identityId: number;
      recipient: Address;
    }
  | {
      type: "swap-exact-input";
      quote: {
        observedBlock: bigint;
        expiresAtBlock: bigint;
        liquidTokenForWeth: boolean;
        amountIn: bigint;
        amountOut: bigint;
        discovery: MarketDiscoveryEvidence;
      };
      liquidTokenForWeth: boolean;
      exactAmountIn: bigint;
      minimumAmountOut: bigint;
      recipient: Address;
      deadline: bigint;
      useNative?: boolean;
    }
  | { type: "open-reward-epoch" }
  | {
      type: "execute-track" | "retry-track";
      track: 1 | 2 | 3 | 4;
      minimumStockOutput: bigint;
      deadline: bigint;
    }
  | {
      type: "execute-pol";
      tickLower: number;
      tickUpper: number;
      liquidity: bigint;
      maximumWeth: bigint;
      deadline: bigint;
    }
  | {
      type: "set-pause";
      module: "liquidToken" | "rewards" | "converter" | "liquidity";
      paused: boolean;
    }
  | {
      /**
       * Approves or revokes one wallet on the configurable claim policy. Only
       * the policy administrator may call it, and revoking preserves accrued
       * rewards and liabilities - it only prevents claiming.
       */
      type: "set-claim-policy";
      account: Address;
      allowed: boolean;
    }
  | {
      /**
       * Destination-only withdrawal of accrued creator fees. The hook sends to
       * its configured creator destination, so no recipient is accepted here.
       */
      type: "withdraw-creator-fees";
      amount: bigint;
    }
  | {
      type: "configure-conversion-track";
      track: 1 | 2 | 3 | 4;
      stockToken: Address;
      adapter: Address;
    };

export class TransactionPreparationError extends Error {
  override readonly name = "TransactionPreparationError";

  constructor(
    readonly code:
      | "wallet-required"
      | "wrong-chain"
      | "protocol-not-launched"
      | "stale-quote"
      | "quote-review-changed"
      | "discovery-evidence-invalid"
      | "discovery-mutation-limit"
      | "invalid-approval"
      | "invalid-ownership"
      | "invalid-recipient"
      | "claim-ineligible"
      | "claim-batch-too-large"
      | "unsupported-role"
      | "invalid-operator-precondition"
      | "sealed-mutation"
      | "invalid-withdrawal-amount"
      | "claim-policy-unavailable"
      | "claim-policy-account",
    message: string,
  ) {
    super(message);
  }
}

const sameAddress = (left: Address | undefined, right: Address | undefined) =>
  left !== undefined &&
  right !== undefined &&
  left.toLowerCase() === right.toLowerCase();

export const deriveCapabilities = (context: TransactionContext) => ({
  connected: context.connectedWallet !== undefined,
  owner:
    sameAddress(context.connectedWallet, context.roles.owners.liquidToken) ||
    sameAddress(context.connectedWallet, context.roles.owners.rewards) ||
    sameAddress(context.connectedWallet, context.roles.owners.converter) ||
    sameAddress(context.connectedWallet, context.roles.owners.liquidity),
  ownerModules: {
    liquidToken: sameAddress(
      context.connectedWallet,
      context.roles.owners.liquidToken,
    ),
    rewards: sameAddress(context.connectedWallet, context.roles.owners.rewards),
    converter: sameAddress(
      context.connectedWallet,
      context.roles.owners.converter,
    ),
    liquidity: sameAddress(
      context.connectedWallet,
      context.roles.owners.liquidity,
    ),
  },
  guardian: sameAddress(context.connectedWallet, context.roles.guardian),
  recovery: sameAddress(
    context.connectedWallet,
    context.roles.recoveryAuthority,
  ),
  keeper: sameAddress(context.connectedWallet, context.roles.keeper),
  liquidityExecutor: sameAddress(
    context.connectedWallet,
    context.roles.liquidityExecutor,
  ),
  creator: sameAddress(context.connectedWallet, context.roles.creator),
});

const requireWalletAndChain: (
  context: TransactionContext,
  copy: ReturnType<typeof createIdentityProtocolCopy>["transactions"],
) => asserts context is TransactionContext & { connectedWallet: Address } = (
  context,
  copy,
) => {
  if (context.connectedWallet === undefined) {
    throw new TransactionPreparationError(
      "wallet-required",
      copy.walletRequired,
    );
  }
  if (context.connectedChainId !== context.expectedChainId) {
    throw new TransactionPreparationError(
      "wrong-chain",
      copy.wrongChain(context.expectedChainId),
    );
  }
};

const requireRole = (
  available: boolean,
  role: string,
  copy: ReturnType<typeof createIdentityProtocolCopy>["transactions"],
) => {
  if (!available) {
    throw new TransactionPreparationError(
      "unsupported-role",
      copy.unsupportedRole(role),
    );
  }
};

type IdentityCopy = ReturnType<typeof createIdentityProtocolCopy>;
type TransactionCopy = IdentityCopy["transactions"];
type Capabilities = ReturnType<typeof deriveCapabilities>;
type ReadyTransactionContext = TransactionContext & {
  readonly connectedWallet: Address;
};

const prepareApproval = (
  action: Extract<ProtocolAction, { type: "approve-exchange-input" }>,
  context: TransactionContext,
  copy: TransactionCopy,
) => {
  if (action.amount <= 0n) {
    throw new TransactionPreparationError(
      "invalid-approval",
      copy.invalidApproval,
    );
  }
  return {
    to:
      action.asset === "liquid-token"
        ? context.contracts.fuelCore
        : context.contracts.weth,
    abi:
      action.asset === "liquid-token"
        ? protocolAbis.fuelCore
        : protocolAbis.weth,
    functionName: "approve",
    args: [context.contracts.canonicalRouter, action.amount],
    value: 0n,
  } as const;
};

const prepareClaim = (
  action: Extract<ProtocolAction, { type: "claim" }>,
  context: TransactionContext,
  copy: TransactionCopy,
) => {
  if (action.identityIds.length > MAX_CLAIM_IDENTITIES) {
    throw new TransactionPreparationError(
      "claim-batch-too-large",
      copy.claimBatchTooLarge(MAX_CLAIM_IDENTITIES),
    );
  }
  if (
    action.identityIds.length === 0 ||
    action.identityIds.some((id) => !context.claimableIdentityIds.has(id))
  ) {
    throw new TransactionPreparationError(
      "claim-ineligible",
      copy.claimIneligible,
    );
  }
  return {
    to: context.contracts.rewardLedger,
    abi: protocolAbis.rewardLedger,
    functionName: "claim",
    args: [action.identityIds],
    value: 0n,
  } as const;
};

const liquidTokenIsAvailable = (context: TransactionContext): boolean =>
  context.readAvailability.pauses.liquidToken && !context.pauses.liquidToken;

const prepareCommitment = (
  action: Extract<ProtocolAction, { type: "commit-collectible" }>,
  context: TransactionContext,
  copy: TransactionCopy,
) => {
  if (!context.readAvailability.launched || !context.launched) {
    throw new TransactionPreparationError(
      "protocol-not-launched",
      copy.protocolNotLaunched,
    );
  }
  if (!context.ownedTransientIdentityIds.has(action.identityId)) {
    throw new TransactionPreparationError(
      "invalid-ownership",
      copy.transientNotOwned,
    );
  }
  if (!liquidTokenIsAvailable(context)) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.commitmentPaused,
    );
  }
  return {
    to: context.contracts.fuelCore,
    abi: protocolAbis.fuelCore,
    functionName: "commit",
    args: [action.identityId],
    value: 0n,
  } as const;
};

const prepareCollectibleTransfer = (
  action: Extract<ProtocolAction, { type: "direct-collectible-transfer" }>,
  context: ReadyTransactionContext,
  copy: TransactionCopy,
) => {
  const ownsTransient = context.ownedTransientIdentityIds.has(
    action.identityId,
  );
  const ownsPermanent = context.ownedPermanentIdentityIds.has(
    action.identityId,
  );
  if (!ownsTransient && !ownsPermanent) {
    throw new TransactionPreparationError(
      "invalid-ownership",
      copy.collectibleNotOwned,
    );
  }
  if (/^0x0{40}$/i.test(action.recipient)) {
    throw new TransactionPreparationError(
      "invalid-recipient",
      copy.invalidRecipient,
    );
  }
  if (!liquidTokenIsAvailable(context)) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.transferPaused(
        ownsTransient
          ? context.identity.terms.transientCollectible
          : context.identity.terms.permanentCollectible,
      ),
    );
  }
  return {
    to: context.contracts.fuelMirror,
    abi: protocolAbis.fuelMirror,
    functionName: "safeTransferFrom",
    args: [
      context.connectedWallet,
      action.recipient,
      BigInt(action.identityId),
    ],
    value: 0n,
  } as const;
};

type SwapAction = Extract<ProtocolAction, { type: "swap-exact-input" }>;

const quoteWindowIsInvalid = (
  action: SwapAction,
  context: TransactionContext,
): boolean =>
  action.quote.observedBlock > context.currentBlock ||
  context.maximumQuoteAgeBlocks <= 0n ||
  action.quote.observedBlock + context.maximumQuoteAgeBlocks <
    context.currentBlock ||
  action.quote.expiresAtBlock !==
    action.quote.observedBlock + context.maximumQuoteAgeBlocks ||
  action.quote.expiresAtBlock < context.currentBlock;

const quoteDoesNotMatchAction = (action: SwapAction): boolean =>
  action.quote.liquidTokenForWeth !== action.liquidTokenForWeth ||
  action.quote.amountIn !== action.exactAmountIn;

const checkedDiscoveryCapacity = (
  action: SwapAction,
  context: TransactionContext,
) => {
  try {
    const validation = validateMarketDiscoveryEvidence({
      account: context.connectedWallet,
      evidence: action.quote.discovery,
      liquidTokenAmount: action.liquidTokenForWeth
        ? action.exactAmountIn
        : action.quote.amountOut,
      liquidTokenForWeth: action.liquidTokenForWeth,
    });
    const counterparty = action.liquidTokenForWeth
      ? validation.evidence.recipient.account
      : validation.evidence.sender.account;
    return {
      capacity: validation.capacity,
      matchesAction:
        sameAddress(action.recipient, context.connectedWallet) &&
        sameAddress(counterparty, context.contracts.uniswapV4PoolManager),
    } as const;
  } catch {
    return undefined;
  }
};

const swapAmountsAreInvalid = (action: SwapAction): boolean =>
  action.exactAmountIn <= 0n ||
  action.quote.amountOut <= 0n ||
  action.minimumAmountOut <= 0n ||
  action.minimumAmountOut > action.quote.amountOut;

const quoteIsStale = (
  action: SwapAction,
  context: TransactionContext,
): boolean =>
  quoteWindowIsInvalid(action, context) ||
  quoteDoesNotMatchAction(action) ||
  swapAmountsAreInvalid(action) ||
  action.deadline <= context.currentTimestamp;

const marketIsAvailable = (context: TransactionContext): boolean =>
  context.readAvailability.launched &&
  context.readAvailability.pauses.liquidToken &&
  context.launched &&
  !context.pauses.liquidToken;

const requireExecutableDiscoveryCapacity = (
  action: SwapAction,
  context: TransactionContext,
  copy: TransactionCopy,
): void => {
  if (action.quote.discovery === undefined) {
    throw new TransactionPreparationError(
      "discovery-evidence-invalid",
      copy.discoveryEvidenceUnavailable,
    );
  }
  const discovery = checkedDiscoveryCapacity(action, context);
  if (discovery === undefined || !discovery.matchesAction) {
    throw new TransactionPreparationError(
      "discovery-evidence-invalid",
      copy.discoveryEvidenceInvalid,
    );
  }
  if (!discovery.capacity.executable) {
    throw new TransactionPreparationError(
      "discovery-mutation-limit",
      copy.discoveryMutationLimit(
        discovery.capacity.mutations,
        discovery.capacity.maximumMutations,
        formatUnits(discovery.capacity.maximumLiquidTokenAmount, 18),
      ),
    );
  }
};

const prepareSwap = (
  action: SwapAction,
  context: TransactionContext,
  copy: TransactionCopy,
) => {
  if (/^0x0{40}$/i.test(action.recipient)) {
    throw new TransactionPreparationError(
      "invalid-recipient",
      copy.invalidRecipient,
    );
  }
  if (quoteIsStale(action, context)) {
    throw new TransactionPreparationError("stale-quote", copy.staleQuote);
  }
  requireExecutableDiscoveryCapacity(action, context, copy);
  if (!marketIsAvailable(context)) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.marketUnavailable,
    );
  }
  return {
    to: context.contracts.canonicalRouter,
    abi: protocolAbis.canonicalRouter,
    functionName: "swapExactInput",
    args: [
      {
        fuelForWeth: action.liquidTokenForWeth,
        amountIn: action.exactAmountIn,
        amountOutMinimum: action.minimumAmountOut,
        recipient: action.recipient,
        deadline: action.deadline,
        useNative: action.useNative ?? false,
      },
    ],
    value:
      action.useNative && !action.liquidTokenForWeth
        ? action.exactAmountIn
        : 0n,
  } as const;
};

const epochCanOpen = (context: TransactionContext): boolean =>
  context.readAvailability.conversionConfigurationSealed &&
  context.sealed &&
  context.readAvailability.pauses.converter &&
  context.readAvailability.nextRewardEpoch &&
  context.readAvailability.rewardPot &&
  !context.pauses.converter &&
  context.currentTimestamp >= context.nextRewardEpochAt &&
  context.rewardPotWeth >= 40_000_000_000_000_000n;

const prepareRewardEpoch = (
  context: TransactionContext,
  copy: TransactionCopy,
  identityCopy: IdentityCopy,
  capabilities: Capabilities,
) => {
  requireRole(capabilities.keeper, identityCopy.labels.keeper, copy);
  if (!epochCanOpen(context)) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.epochPrecondition,
    );
  }
  return {
    to: context.contracts.epochConverter,
    abi: protocolAbis.epochConverter,
    functionName: "openRewardEpoch",
    args: [],
    value: 0n,
  } as const;
};

type TrackAction = Extract<
  ProtocolAction,
  { type: "execute-track" | "retry-track" }
>;

const trackConfigurationIsAvailable = (
  action: TrackAction,
  context: TransactionContext,
): boolean =>
  context.readAvailability.conversionConfigurationSealed &&
  context.sealed &&
  context.readAvailability.pauses.converter &&
  context.readAvailability.trackQueues[action.track] &&
  !context.pauses.converter;

const trackAttemptStateIsValid = (
  action: TrackAction,
  context: TransactionContext,
): boolean =>
  (action.type !== "retry-track" ||
    context.trackAttemptHistoryAvailable[action.track]) &&
  (action.type !== "retry-track" ||
    context.retryableTracks.has(action.track)) &&
  (action.type !== "execute-track" ||
    !context.retryableTracks.has(action.track));

const trackExecutionBoundsAreValid = (
  action: TrackAction,
  context: TransactionContext,
): boolean =>
  context.trackQueues[action.track] !== 0n &&
  action.minimumStockOutput > 0n &&
  action.minimumStockOutput <= MAX_UINT256 &&
  action.deadline > context.currentTimestamp;

const trackCanExecute = (
  action: TrackAction,
  context: TransactionContext,
): boolean =>
  trackConfigurationIsAvailable(action, context) &&
  trackAttemptStateIsValid(action, context) &&
  trackExecutionBoundsAreValid(action, context);

const prepareTrackExecution = (
  action: TrackAction,
  context: TransactionContext,
  copy: TransactionCopy,
  identityCopy: IdentityCopy,
  capabilities: Capabilities,
) => {
  requireRole(capabilities.keeper, identityCopy.labels.keeper, copy);
  if (!trackCanExecute(action, context)) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      action.type === "retry-track"
        ? copy.retryPrecondition
        : copy.executionPrecondition,
    );
  }
  return {
    to: context.contracts.epochConverter,
    abi: protocolAbis.epochConverter,
    functionName: "executeTrack",
    args: [action.track, action.minimumStockOutput, action.deadline],
    value: 0n,
  } as const;
};

type PolAction = Extract<ProtocolAction, { type: "execute-pol" }>;

const liquidityConfigurationIsAvailable = (
  context: TransactionContext,
): boolean =>
  context.readAvailability.pauses.liquidity &&
  context.readAvailability.liquidityConfigurationSealed &&
  !context.pauses.liquidity &&
  context.liquidityConfigurationSealed;

const polTicksAreValid = (
  action: PolAction,
  context: TransactionContext,
): boolean =>
  action.tickLower < action.tickUpper &&
  action.tickLower >= MIN_UNISWAP_TICK &&
  action.tickUpper <= MAX_UNISWAP_TICK &&
  action.tickLower % context.canonicalTickSpacing === 0 &&
  action.tickUpper % context.canonicalTickSpacing === 0;

const polAmountsAreValid = (
  action: PolAction,
  context: TransactionContext,
): boolean =>
  action.liquidity > 0n &&
  action.liquidity <= (1n << 127n) - 1n &&
  action.maximumWeth > 0n &&
  action.deadline > context.currentTimestamp;

const polCanExecute = (
  action: PolAction,
  context: TransactionContext,
): boolean =>
  liquidityConfigurationIsAvailable(context) &&
  polTicksAreValid(action, context) &&
  polAmountsAreValid(action, context);

const preparePolExecution = (
  action: PolAction,
  context: TransactionContext,
  copy: TransactionCopy,
  identityCopy: IdentityCopy,
  capabilities: Capabilities,
) => {
  requireRole(
    capabilities.liquidityExecutor,
    identityCopy.labels.liquidityExecutor,
    copy,
  );
  if (!polCanExecute(action, context)) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.liquidityPrecondition,
    );
  }
  return {
    to: context.contracts.protocolLiquidityVault,
    abi: protocolAbis.protocolLiquidityVault,
    functionName: "addLiquidityCycle",
    args: [
      action.tickLower,
      action.tickUpper,
      action.liquidity,
      action.maximumWeth,
      action.deadline,
    ],
    value: 0n,
  } as const;
};

type PauseAction = Extract<ProtocolAction, { type: "set-pause" }>;

const preparePause = (
  action: PauseAction,
  context: TransactionContext,
  copy: TransactionCopy,
  capabilities: Capabilities,
) => {
  requireRole(
    capabilities.ownerModules[action.module],
    copy.moduleOwner(action.module),
    copy,
  );
  const modules = {
    liquidToken: {
      to: context.contracts.fuelCore,
      abi: protocolAbis.fuelCore,
      functionName: "setPaused",
    },
    rewards: {
      to: context.contracts.rewardLedger,
      abi: protocolAbis.rewardLedger,
      functionName: "setRewardNotificationsPaused",
    },
    converter: {
      to: context.contracts.epochConverter,
      abi: protocolAbis.epochConverter,
      functionName: "setPaused",
    },
    liquidity: {
      to: context.contracts.protocolLiquidityVault,
      abi: protocolAbis.protocolLiquidityVault,
      functionName: "setPaused",
    },
  } as const;
  return {
    ...modules[action.module],
    args: [action.paused],
    value: 0n,
  } as const;
};

type ClaimPolicyAction = Extract<ProtocolAction, { type: "set-claim-policy" }>;

const prepareClaimPolicy = (
  action: ClaimPolicyAction,
  context: TransactionContext,
  copy: TransactionCopy,
) => {
  const administrator = context.claimPolicyAdministrator;
  if (administrator === undefined) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.claimPolicyNotConfigurable,
    );
  }
  if (!sameAddress(context.connectedWallet, administrator)) {
    throw new TransactionPreparationError(
      "claim-policy-unavailable",
      copy.claimPolicyAdministratorOnly,
    );
  }
  if (/^0x0{40}$/iu.test(action.account)) {
    throw new TransactionPreparationError(
      "claim-policy-account",
      copy.claimPolicyInvalidAccount,
    );
  }
  return {
    to: context.contracts.claimGate,
    abi: protocolAbis.claimGate,
    functionName: "setClaimAllowed",
    args: [action.account, action.allowed],
    value: 0n,
  } as const;
};

type CreatorWithdrawalAction = Extract<
  ProtocolAction,
  { type: "withdraw-creator-fees" }
>;

const prepareCreatorWithdrawal = (
  action: CreatorWithdrawalAction,
  context: TransactionContext,
  copy: TransactionCopy,
  identityCopy: IdentityCopy,
  capabilities: Capabilities,
) => {
  requireRole(capabilities.creator, identityCopy.labels.creator, copy);
  if (!context.readAvailability.creatorPot) {
    throw new TransactionPreparationError(
      "invalid-operator-precondition",
      copy.creatorPotUnavailable,
    );
  }
  if (action.amount <= 0n) {
    throw new TransactionPreparationError(
      "invalid-withdrawal-amount",
      copy.creatorWithdrawalPositive,
    );
  }
  if (action.amount > context.creatorPotWeth) {
    throw new TransactionPreparationError(
      "invalid-withdrawal-amount",
      copy.creatorWithdrawalOverdraw,
    );
  }
  return {
    to: context.contracts.canonicalFeeHook,
    abi: protocolAbis.canonicalFeeHook,
    functionName: "pullCreatorPot",
    args: [action.amount],
    value: 0n,
  } as const;
};

const prepareTrackConfiguration = (
  action: Extract<ProtocolAction, { type: "configure-conversion-track" }>,
  context: TransactionContext,
  copy: TransactionCopy,
  capabilities: Capabilities,
) => {
  requireRole(
    capabilities.ownerModules.converter,
    copy.moduleOwner("converter"),
    copy,
  );
  if (
    !context.readAvailability.conversionConfigurationSealed ||
    context.sealed
  ) {
    throw new TransactionPreparationError(
      "sealed-mutation",
      copy.sealedMutation,
    );
  }
  return {
    to: context.contracts.epochConverter,
    abi: protocolAbis.epochConverter,
    functionName: "configureTrack",
    args: [action.track, action.stockToken, action.adapter],
    value: 0n,
  } as const;
};

interface PreparationResources {
  readonly context: ReadyTransactionContext;
  readonly copy: TransactionCopy;
  readonly identityCopy: IdentityCopy;
  readonly capabilities: Capabilities;
}

type ActionFor<Type extends ProtocolAction["type"]> = Extract<
  ProtocolAction,
  { type: Type }
>;

type TransactionPreparerMap = {
  readonly [Type in ProtocolAction["type"]]: (
    action: ActionFor<Type>,
    resources: PreparationResources,
  ) => unknown;
};

const transactionPreparers = {
  "approve-exchange-input": (
    action: ActionFor<"approve-exchange-input">,
    resources: PreparationResources,
  ) => prepareApproval(action, resources.context, resources.copy),
  claim: (action: ActionFor<"claim">, resources: PreparationResources) =>
    prepareClaim(action, resources.context, resources.copy),
  "commit-collectible": (
    action: ActionFor<"commit-collectible">,
    resources: PreparationResources,
  ) => prepareCommitment(action, resources.context, resources.copy),
  "direct-collectible-transfer": (
    action: ActionFor<"direct-collectible-transfer">,
    resources: PreparationResources,
  ) => prepareCollectibleTransfer(action, resources.context, resources.copy),
  "swap-exact-input": (
    action: ActionFor<"swap-exact-input">,
    resources: PreparationResources,
  ) => prepareSwap(action, resources.context, resources.copy),
  "open-reward-epoch": (
    _action: ActionFor<"open-reward-epoch">,
    resources: PreparationResources,
  ) =>
    prepareRewardEpoch(
      resources.context,
      resources.copy,
      resources.identityCopy,
      resources.capabilities,
    ),
  "execute-track": (
    action: ActionFor<"execute-track">,
    resources: PreparationResources,
  ) =>
    prepareTrackExecution(
      action,
      resources.context,
      resources.copy,
      resources.identityCopy,
      resources.capabilities,
    ),
  "retry-track": (
    action: ActionFor<"retry-track">,
    resources: PreparationResources,
  ) =>
    prepareTrackExecution(
      action,
      resources.context,
      resources.copy,
      resources.identityCopy,
      resources.capabilities,
    ),
  "execute-pol": (
    action: ActionFor<"execute-pol">,
    resources: PreparationResources,
  ) =>
    preparePolExecution(
      action,
      resources.context,
      resources.copy,
      resources.identityCopy,
      resources.capabilities,
    ),
  "set-pause": (
    action: ActionFor<"set-pause">,
    resources: PreparationResources,
  ) =>
    preparePause(
      action,
      resources.context,
      resources.copy,
      resources.capabilities,
    ),
  "set-claim-policy": (
    action: ActionFor<"set-claim-policy">,
    resources: PreparationResources,
  ) => prepareClaimPolicy(action, resources.context, resources.copy),
  "withdraw-creator-fees": (
    action: ActionFor<"withdraw-creator-fees">,
    resources: PreparationResources,
  ) =>
    prepareCreatorWithdrawal(
      action,
      resources.context,
      resources.copy,
      resources.identityCopy,
      resources.capabilities,
    ),
  "configure-conversion-track": (
    action: ActionFor<"configure-conversion-track">,
    resources: PreparationResources,
  ) =>
    prepareTrackConfiguration(
      action,
      resources.context,
      resources.copy,
      resources.capabilities,
    ),
} as const satisfies TransactionPreparerMap;

type PreparedTransaction = ReturnType<
  (typeof transactionPreparers)[keyof typeof transactionPreparers]
>;

const dispatchTransactionPreparation = (
  action: ProtocolAction,
  resources: PreparationResources,
): PreparedTransaction => {
  const prepare = transactionPreparers[action.type] as (
    action: ProtocolAction,
    resources: PreparationResources,
  ) => PreparedTransaction;
  return prepare(action, resources);
};

export const prepareProtocolTransaction = (
  action: ProtocolAction,
  context: TransactionContext,
) => {
  const identityCopy = createIdentityProtocolCopy(context.identity);
  const copy = identityCopy.transactions;
  requireWalletAndChain(context, copy);
  const capabilities = deriveCapabilities(context);
  return dispatchTransactionPreparation(action, {
    context,
    copy,
    identityCopy,
    capabilities,
  });
};

export const createProtocolTransactionPreparer = ({
  manifest,
  identity,
  maximumQuoteAgeBlocks = 5n,
}: {
  manifest: ProtocolDeploymentManifest;
  identity: IdentityConfiguration;
  maximumQuoteAgeBlocks?: bigint;
}) => {
  if (identity.key !== manifest.identity.key) {
    throw new RangeError(
      createIdentityProtocolCopy(identity).transactions.identityMismatch(
        identity.key,
        manifest.identity.key,
      ),
    );
  }
  const contracts = createProtocolContracts(manifest);
  const transactionContracts: TransactionContracts = {
    canonicalFeeHook: contracts.canonicalFeeHook.address,
    claimGate: contracts.claimGate.address,
    fuelCore: contracts.fuelCore.address,
    weth: contracts.weth.address,
    fuelMirror: contracts.fuelMirror.address,
    rewardLedger: contracts.rewardLedger.address,
    epochConverter: contracts.epochConverter.address,
    canonicalRouter: contracts.canonicalRouter.address,
    protocolLiquidityVault: contracts.protocolLiquidityVault.address,
    uniswapV4PoolManager: contracts.uniswapV4PoolManager.address,
  };
  return (action: ProtocolAction, context: TransactionRuntimeContext) =>
    prepareProtocolTransaction(action, {
      ...context,
      identity,
      expectedChainId: manifest.chainId,
      canonicalTickSpacing: manifest.canonicalPool.tickSpacing,
      maximumQuoteAgeBlocks,
      contracts: transactionContracts,
    });
};
