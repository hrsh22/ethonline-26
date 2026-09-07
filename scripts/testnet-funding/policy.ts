import type { Address } from "viem";

import type { TestnetFundingAssetAmounts } from "./types.ts";

export interface TestnetFundingPolicy {
  readonly target: TestnetFundingAssetAmounts;
  readonly reserve: TestnetFundingAssetAmounts;
  readonly lifetimeLimit?: TestnetFundingAssetAmounts;
  readonly cooldownMilliseconds: number;
  readonly reconciliationTimeoutMilliseconds: number;
  readonly requestLeaseMilliseconds: number;
}

export interface TestnetFundingPolicyHistory {
  readonly confirmedWethWei: bigint;
  readonly confirmedEthWei: bigint;
  readonly lastConfirmedAt: number | undefined;
}

export interface TestnetFundingPolicyInput {
  readonly activeRecipient: Address | undefined;
  readonly nowMilliseconds: number;
  readonly recipient: Address;
  readonly recipientBalance: TestnetFundingAssetAmounts;
  readonly recipientHistory: TestnetFundingPolicyHistory;
  readonly signerBalance: TestnetFundingAssetAmounts;
}

const topUp = (balance: bigint, target: bigint): bigint =>
  balance >= target ? 0n : target - balance;

const availableInventory = (balance: bigint, reserve: bigint): bigint =>
  balance > reserve ? balance - reserve : 0n;

const canSupply = (
  available: TestnetFundingAssetAmounts,
  required: TestnetFundingAssetAmounts,
): boolean =>
  available.wethWei >= required.wethWei && available.ethWei >= required.ethWei;

const sameAddress = (left: Address, right: Address): boolean =>
  left.toLowerCase() === right.toLowerCase();

const recipientStateFor = (input: {
  readonly requestPending: boolean;
  readonly funded: boolean;
  readonly coolingDown: boolean;
  readonly lifetimeLimitReached: boolean;
  readonly inventoryAvailable: boolean;
}) => {
  if (input.requestPending) return "pending" as const;
  if (input.funded) return "already-funded" as const;
  if (input.coolingDown) return "rate-limited" as const;
  if (input.lifetimeLimitReached) return "limit-reached" as const;
  return input.inventoryAvailable
    ? ("eligible" as const)
    : ("unavailable" as const);
};

export const evaluateTestnetFundingPolicy = (
  policy: TestnetFundingPolicy,
  input: TestnetFundingPolicyInput,
) => {
  const deficit = {
    wethWei: topUp(input.recipientBalance.wethWei, policy.target.wethWei),
    ethWei: topUp(input.recipientBalance.ethWei, policy.target.ethWei),
  } as const;
  const available = {
    wethWei: availableInventory(
      input.signerBalance.wethWei,
      policy.reserve.wethWei,
    ),
    ethWei: availableInventory(
      input.signerBalance.ethWei,
      policy.reserve.ethWei,
    ),
  } as const;
  const funded = deficit.wethWei === 0n && deficit.ethWei === 0n;
  const nextEligibleAt =
    input.recipientHistory.lastConfirmedAt === undefined
      ? null
      : input.recipientHistory.lastConfirmedAt + policy.cooldownMilliseconds;
  const coolingDown =
    nextEligibleAt !== null && nextEligibleAt > input.nowMilliseconds;
  const lifetimeLimitReached =
    policy.lifetimeLimit !== undefined &&
    (input.recipientHistory.confirmedWethWei + deficit.wethWei >
      policy.lifetimeLimit.wethWei ||
      input.recipientHistory.confirmedEthWei + deficit.ethWei >
        policy.lifetimeLimit.ethWei);
  const requestPending =
    input.activeRecipient !== undefined &&
    sameAddress(input.activeRecipient, input.recipient);
  const recipientInventoryAvailable = canSupply(available, deficit);
  const recipientState = recipientStateFor({
    requestPending,
    funded,
    coolingDown,
    lifetimeLimitReached,
    inventoryAvailable: recipientInventoryAvailable,
  });
  const serviceInventoryAvailable = canSupply(available, policy.target);
  return {
    available,
    deficit,
    nextEligibleAt: coolingDown ? nextEligibleAt : null,
    recipientInventoryAvailable,
    recipientState,
    serviceInventoryAvailable,
  } as const;
};
