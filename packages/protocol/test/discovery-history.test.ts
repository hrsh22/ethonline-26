import { describe, expect, it } from "vitest";
import {
  discoveryHistoryFrom,
  type IndexedHistoryPage,
} from "../src/history.js";
const account = "0x0000000000000000000000000000000000000001";
const fuelCore = "0x0000000000000000000000000000000000000002";
const requestId = `0x${"1".repeat(64)}`;
const acquisitionHash = `0x${"2".repeat(64)}`;
const item = (eventName: string, blockNumber: bigint, payload = {}) => ({
  eventName,
  blockNumber,
  blockTimestamp: blockNumber,
  transactionHash: acquisitionHash,
  logIndex: 0,
  sourceAddress: fuelCore,
  removed: false,
  payload: { account, requestId, ...payload },
});
const page = (items: unknown[]) =>
  ({
    items,
    page: { hasMore: false },
    status: {
      state: "complete",
      coverage: { indexedThroughBlock: 3n, indexedThroughTime: 3n },
    },
  }) as unknown as IndexedHistoryPage;
describe("Discovery history evidence", () => {
  it("links a revealed identity to the acquisition by the protocol request id", () => {
    const result = discoveryHistoryFrom(
      page([
        item("discovery-fulfilled", 3n, { identityId: 1639 }),
        item("discovery-requested", 1n),
      ]),
      account,
      fuelCore,
    );
    expect(result.requests[0]).toMatchObject({
      requestId,
      acquisitionHash,
      outcome: "delivered",
      identityId: 1639,
    });
  });
  it("separates cancelled requests and rejects foreign-wallet or noncanonical evidence", () => {
    expect(
      discoveryHistoryFrom(
        page([
          item("discovery-requested", 1n),
          item("discovery-cancelled", 2n),
        ]),
        account,
        fuelCore,
      ).requests[0]?.outcome,
    ).toBe("cancelled");
    expect(() =>
      discoveryHistoryFrom(
        page([item("discovery-requested", 1n, { account: fuelCore })]),
        account,
        fuelCore,
      ),
    ).toThrow();
    expect(() =>
      discoveryHistoryFrom(
        page([{ ...item("discovery-requested", 1n), removed: true }]),
        account,
        fuelCore,
      ),
    ).toThrow();
  });
});
