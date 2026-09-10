/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAuctionTransaction,
  readAuctionTransaction,
  writeAuctionTransaction,
} from "./auction-transaction-record";

const account = "0x00000000000000000000000000000000000000aa" as const;
const auction = "0x00000000000000000000000000000000000000bb" as const;

describe("auction transaction recovery record", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the exact bounded action and transaction hash", () => {
    writeAuctionTransaction(localStorage, {
      version: 1,
      account,
      auctionAddress: auction,
      createdAt: 1_700_000_000_000,
      hash: `0x${"ab".repeat(32)}`,
      action: { type: "exit", bidId: 17n },
    });

    expect(
      readAuctionTransaction(localStorage, account, auction),
    ).toMatchObject({
      action: { type: "exit", bidId: 17n },
    });
  });

  it("discards a record from another wallet", () => {
    writeAuctionTransaction(localStorage, {
      version: 1,
      account,
      auctionAddress: auction,
      createdAt: 1,
      hash: `0x${"cd".repeat(32)}`,
      action: { type: "approve-token", amount: 5n },
    });
    expect(
      readAuctionTransaction(
        localStorage,
        "0x00000000000000000000000000000000000000cc",
        auction,
      ),
    ).toBeUndefined();
    expect(localStorage).toHaveLength(0);
  });

  it("clears confirmed attempts", () => {
    localStorage.setItem("orbit.collector.auction-transaction.v1", "value");
    clearAuctionTransaction(localStorage);
    expect(localStorage).toHaveLength(0);
  });
});
