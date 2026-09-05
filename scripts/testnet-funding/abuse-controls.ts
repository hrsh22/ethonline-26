import type { TestnetFundingAssetAmounts } from "./types.ts";

/**
 * Service-wide controls that per-recipient limits cannot provide. A 24-hour
 * per-recipient cooldown does not stop one actor cycling fresh addresses, so
 * the service also bounds total daily spend, throttles per client, and can be
 * halted without a restart.
 */
export interface TestnetFundingAbusePolicy {
  readonly dailyBudget: TestnetFundingAssetAmounts;
  readonly dailyGrantLimit: number;
  readonly clientWindowMilliseconds: number;
  readonly clientWindowLimit: number;
  /** Fraction of the daily budget spent before the operator alert elevates. */
  readonly elevatedUsageRatio: number;
  readonly criticalUsageRatio: number;
}

export const FUNDING_BUDGET_WINDOW_MILLISECONDS = 86_400_000;

export const fundingBudgetWindowStart = (nowMilliseconds: number): number =>
  Math.floor(nowMilliseconds / FUNDING_BUDGET_WINDOW_MILLISECONDS) *
  FUNDING_BUDGET_WINDOW_MILLISECONDS;

export const fundingClientWindowStart = (
  nowMilliseconds: number,
  windowMilliseconds: number,
): number =>
  Math.floor(nowMilliseconds / windowMilliseconds) * windowMilliseconds;

export interface FundingBudgetSpend {
  readonly wethWei: bigint;
  readonly ethWei: bigint;
  readonly grants: number;
}

export type FundingBudgetVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "budget-exhausted" | "grant-limit" };

const remaining = (limit: bigint, spent: bigint): bigint =>
  spent >= limit ? 0n : limit - spent;

/**
 * Decides whether one more grant fits inside the window's remaining budget.
 * Evaluated before any transfer is prepared so a denial costs no inventory.
 */
export const evaluateFundingBudget = (
  policy: TestnetFundingAbusePolicy,
  spent: FundingBudgetSpend,
  requested: TestnetFundingAssetAmounts,
): FundingBudgetVerdict => {
  if (spent.grants >= policy.dailyGrantLimit) {
    return { ok: false, reason: "grant-limit" };
  }
  const wethRemaining = remaining(policy.dailyBudget.wethWei, spent.wethWei);
  const ethRemaining = remaining(policy.dailyBudget.ethWei, spent.ethWei);
  if (requested.wethWei > wethRemaining || requested.ethWei > ethRemaining) {
    return { ok: false, reason: "budget-exhausted" };
  }
  return { ok: true };
};

export type FundingDepletionState = "normal" | "elevated" | "critical";

const usageRatio = (spent: bigint, limit: bigint): number =>
  limit === 0n ? 1 : Number((spent * 10_000n) / limit) / 10_000;

/**
 * Depletion velocity for the operator alert. Reported as a state and a ratio
 * only, never as signer balances or addresses.
 */
export const fundingDepletionState = (
  policy: TestnetFundingAbusePolicy,
  spent: FundingBudgetSpend,
): { readonly state: FundingDepletionState; readonly usedRatio: number } => {
  const ratio = Math.max(
    usageRatio(spent.wethWei, policy.dailyBudget.wethWei),
    usageRatio(spent.ethWei, policy.dailyBudget.ethWei),
    policy.dailyGrantLimit === 0 ? 1 : spent.grants / policy.dailyGrantLimit,
  );
  const bounded = Math.min(1, Math.max(0, ratio));
  if (bounded >= policy.criticalUsageRatio) {
    return { state: "critical", usedRatio: bounded };
  }
  if (bounded >= policy.elevatedUsageRatio) {
    return { state: "elevated", usedRatio: bounded };
  }
  return { state: "normal", usedRatio: bounded };
};

export type FundingThrottleVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterMilliseconds: number };

/**
 * Funding-specific per-client throttling. This sits on top of the generic
 * per-IP request limiter, which is far too permissive to bound funding and
 * resets on restart.
 */
export const evaluateFundingThrottle = (
  policy: TestnetFundingAbusePolicy,
  attempts: number,
  nowMilliseconds: number,
  windowStart: number,
): FundingThrottleVerdict =>
  attempts <= policy.clientWindowLimit
    ? { ok: true }
    : {
        ok: false,
        retryAfterMilliseconds: Math.max(
          0,
          windowStart + policy.clientWindowMilliseconds - nowMilliseconds,
        ),
      };
