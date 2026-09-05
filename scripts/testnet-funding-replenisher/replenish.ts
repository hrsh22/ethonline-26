import { Effect } from "effect";
import { parseEther, type Address } from "viem";

import type { ReplenishAmounts, ReplenishPolicy } from "./configuration.ts";
import type {
  PreparedReplenishment,
  ReplenishChain,
  ReplenishChainInspection,
} from "./chain.ts";
import {
  replenishWindowStart,
  type ReplenishLedger,
  type ReplenishmentAsset,
  type StoredReplenishment,
} from "./ledger.ts";

/**
 * Left in the treasury so it can always pay for the transfers it signs. Base
 * Sepolia gas is a rounding error against these amounts; the point is that a
 * treasury drained to exactly zero cannot send the next top-up.
 */
const TREASURY_GAS_RESERVE_WEI = parseEther("0.001");

export type ReplenishOutcome =
  "due" | "sufficient" | "daily-limit" | "treasury-exhausted";

export interface ReplenishDecision {
  readonly amountWei: bigint;
  readonly asset: ReplenishmentAsset;
  readonly outcome: ReplenishOutcome;
}

export interface ReplenishPlanInput {
  readonly signerBalance: ReplenishAmounts;
  readonly treasuryBalance: ReplenishAmounts;
  readonly windowUsage: ReplenishAmounts;
}

interface AssetPlanInput {
  readonly available: bigint;
  readonly minimum: bigint;
  readonly remainingWindow: bigint;
  readonly signerBalance: bigint;
  readonly topUp: bigint;
}

const decide = (
  asset: ReplenishmentAsset,
  input: AssetPlanInput,
): ReplenishDecision => {
  if (input.signerBalance >= input.minimum) {
    return { amountWei: 0n, asset, outcome: "sufficient" };
  }
  if (input.topUp > input.remainingWindow) {
    return { amountWei: 0n, asset, outcome: "daily-limit" };
  }
  if (input.topUp > input.available) {
    return { amountWei: 0n, asset, outcome: "treasury-exhausted" };
  }
  return { amountWei: input.topUp, asset, outcome: "due" };
};

const remaining = (limit: bigint, used: bigint): bigint =>
  used >= limit ? 0n : limit - used;

const spendable = (balance: bigint, reserve: bigint): bigint =>
  balance > reserve ? balance - reserve : 0n;

/**
 * A fixed top-up per asset, never an amount derived from a request. Both the
 * window ceiling and the treasury balance can only shrink it to nothing.
 */
export const planReplenishment = (
  policy: ReplenishPolicy,
  input: ReplenishPlanInput,
): readonly ReplenishDecision[] => [
  decide("weth", {
    available: input.treasuryBalance.wethWei,
    minimum: policy.minimum.wethWei,
    remainingWindow: remaining(
      policy.dailyLimit.wethWei,
      input.windowUsage.wethWei,
    ),
    signerBalance: input.signerBalance.wethWei,
    topUp: policy.topUp.wethWei,
  }),
  decide("eth", {
    available: spendable(
      input.treasuryBalance.ethWei,
      TREASURY_GAS_RESERVE_WEI,
    ),
    minimum: policy.minimum.ethWei,
    remainingWindow: remaining(
      policy.dailyLimit.ethWei,
      input.windowUsage.ethWei,
    ),
    signerBalance: input.signerBalance.ethWei,
    topUp: policy.topUp.ethWei,
  }),
];

export interface ReplenishGuard {
  readonly chainId: number;
  readonly privilegedAddresses: ReadonlySet<Address>;
  readonly signer: Address;
  readonly treasury: Address;
}

const sameAddress = (left: Address, right: Address): boolean =>
  left.toLowerCase() === right.toLowerCase();

/**
 * The treasury exists to hold a small, disposable inventory float. Letting it
 * be a protocol authority would turn a compromise of this process into a
 * compromise of the deployment, which is the boundary the funding signer's own
 * startup check protects.
 */
export const validateReplenishInspection = (
  guard: ReplenishGuard,
  inspection: ReplenishChainInspection,
): void => {
  if (inspection.chainId !== guard.chainId) {
    throw new Error("Replenisher is connected to the wrong chain");
  }
  if (!sameAddress(inspection.treasury, guard.treasury)) {
    throw new Error("Treasury does not match its checked configuration");
  }
  if (inspection.treasuryCode !== "0x") {
    throw new Error("Treasury must be an externally owned account");
  }
  const privileged = [
    ...guard.privilegedAddresses,
    inspection.deploymentSender,
    inspection.usdcOperator,
    inspection.wethOperator,
  ];
  if (privileged.some((address) => sameAddress(address, inspection.treasury))) {
    throw new Error("Treasury has a privileged protocol role");
  }
  if (sameAddress(inspection.treasury, guard.signer)) {
    throw new Error("The treasury cannot replenish itself");
  }
};

export interface ReplenishCycleOptions {
  readonly chain: ReplenishChain;
  readonly guard: ReplenishGuard;
  readonly ledger: ReplenishLedger;
  readonly nowMilliseconds: () => number;
  readonly policy: ReplenishPolicy;
  readonly replenishmentId: () => string;
}

export interface ReplenishCycleReport {
  readonly decisions: readonly ReplenishDecision[];
  readonly settled: number;
  readonly submitted: readonly StoredReplenishment[];
  readonly unsettled: number;
}

const settleOne = (
  options: ReplenishCycleOptions,
  replenishment: StoredReplenishment,
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* () {
    if (replenishment.state === "prepared") {
      // Persisted but never broadcast: the crash-safe half of the write. Its
      // nonce is already burned, so resending it is the only way forward.
      yield* options.chain.broadcast(replenishment.rawTransaction);
      options.ledger.updateState(
        replenishment.id,
        "broadcast",
        options.nowMilliseconds(),
      );
    }
    const receipt = yield* options.chain.receipt(replenishment.hash);
    if (receipt === "pending" || receipt === "unavailable") return false;
    options.ledger.updateState(
      replenishment.id,
      receipt === "confirmed" ? "confirmed" : "failed",
      options.nowMilliseconds(),
    );
    return true;
  });

const submit = (
  options: ReplenishCycleOptions,
  windowStart: number,
  decision: ReplenishDecision,
): Effect.Effect<StoredReplenishment, unknown> =>
  Effect.gen(function* () {
    const prepared: PreparedReplenishment = yield* options.chain.prepare({
      amountWei: decision.amountWei,
      asset: decision.asset,
    });
    const replenishment: StoredReplenishment = {
      amountWei: prepared.amountWei,
      asset: prepared.asset,
      hash: prepared.hash,
      id: options.replenishmentId(),
      rawTransaction: prepared.rawTransaction,
      state: "prepared",
      windowStart,
    };
    // Persist before broadcast, so a crash cannot lose a spend the chain will
    // still accept and the window ceiling cannot be walked past by restarting.
    options.ledger.recordPrepared(replenishment, options.nowMilliseconds());
    yield* options.chain.broadcast(prepared.rawTransaction);
    options.ledger.updateState(
      replenishment.id,
      "broadcast",
      options.nowMilliseconds(),
    );
    return { ...replenishment, state: "broadcast" as const };
  });

export const runReplenishCycle = (
  options: ReplenishCycleOptions,
): Effect.Effect<ReplenishCycleReport, unknown> =>
  Effect.gen(function* () {
    const outstanding = options.ledger.readUnsettled();
    let settled = 0;
    for (const replenishment of outstanding) {
      if (yield* settleOne(options, replenishment)) settled += 1;
    }
    const unsettled = outstanding.length - settled;
    // One in-flight transfer at a time. Signing a second against the same
    // pending nonce would replace it rather than add to it.
    if (unsettled > 0) {
      return { decisions: [], settled, submitted: [], unsettled };
    }
    const inspection = yield* options.chain.inspect();
    validateReplenishInspection(options.guard, inspection);
    const windowStart = replenishWindowStart(options.nowMilliseconds());
    const decisions = planReplenishment(options.policy, {
      signerBalance: inspection.signerBalance,
      treasuryBalance: inspection.treasuryBalance,
      windowUsage: options.ledger.readWindowUsage(windowStart),
    });
    const submitted: StoredReplenishment[] = [];
    for (const decision of decisions) {
      if (decision.outcome !== "due") continue;
      submitted.push(yield* submit(options, windowStart, decision));
      break;
    }
    return { decisions, settled, submitted, unsettled: 0 };
  });
