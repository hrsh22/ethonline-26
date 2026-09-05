import { describe, expect, it } from "vitest";

import {
  transactionAttemptForScope,
  type ScopedTransactionAttempt,
  type TransactionScope,
} from "./transaction-retry";

describe("retriable transaction refresh", () => {
  it("invalidates an attempt when its wallet, chain, or pathname changes", () => {
    const scope: TransactionScope = {
      address: "0x0000000000000000000000000000000000000001",
      chainId: 84_532,
      pathname: "/trade",
    };
    const attempt: ScopedTransactionAttempt = {
      action: {
        type: "open-reward-epoch",
      },
      label: "Open Reward Epoch",
      scope,
    };

    expect(transactionAttemptForScope(attempt, scope)).toBe(attempt);
    expect(
      transactionAttemptForScope(attempt, {
        ...scope,
        address: "0x0000000000000000000000000000000000000002",
      }),
    ).toBeUndefined();
    expect(
      transactionAttemptForScope(attempt, { ...scope, chainId: 1 }),
    ).toBeUndefined();
    expect(
      transactionAttemptForScope(attempt, { ...scope, pathname: "/fleet" }),
    ).toBeUndefined();
  });
});
