import type { ProtocolAction } from "@orbit/protocol/transactions";
import type { Address } from "viem";

export interface TransactionScope {
  readonly address: Address | undefined;
  readonly chainId: number | undefined;
  readonly pathname: string;
}

export interface ScopedTransactionAttempt {
  readonly action: ProtocolAction;
  readonly label: string;
  readonly scope: TransactionScope;
}

const sameAddress = (
  left: Address | undefined,
  right: Address | undefined,
): boolean => left?.toLowerCase() === right?.toLowerCase();

export const isSameTransactionScope = (
  left: TransactionScope,
  right: TransactionScope,
): boolean =>
  sameAddress(left.address, right.address) &&
  left.chainId === right.chainId &&
  left.pathname === right.pathname;

export const transactionAttemptForScope = (
  attempt: ScopedTransactionAttempt | undefined,
  scope: TransactionScope,
): ScopedTransactionAttempt | undefined =>
  attempt !== undefined && isSameTransactionScope(attempt.scope, scope)
    ? attempt
    : undefined;

export const bindProtocolActionToWallet = (
  action: ProtocolAction,
  address: Address,
): ProtocolAction =>
  action.type === "swap-exact-input"
    ? { ...action, recipient: address }
    : action;
