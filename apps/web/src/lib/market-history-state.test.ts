import type { CanonicalMarketHistorySnapshot } from "@orbit/protocol/market-history";
import { IndexedHistoryError } from "@orbit/protocol/history";
import { describe, expect, it } from "vitest";

import { deriveIndexedMarketHistoryRead } from "./market-history-state";

const snapshot = {} as CanonicalMarketHistorySnapshot;

describe("indexed market history query state", () => {
  it("labels retained data stale when a background refresh fails", () => {
    const error = new IndexedHistoryError(
      "history-rpc-unavailable",
      "history refresh failed",
      503,
    );

    expect(deriveIndexedMarketHistoryRead(snapshot, error)).toEqual({
      status: "stale",
      snapshot,
      error,
    });
  });

  it("fails closed for known canonicality failures and unknown errors", () => {
    const canonicality = new IndexedHistoryError(
      "history-canonicality-check-failed",
      "canonicality failed",
      503,
    );

    expect(deriveIndexedMarketHistoryRead(snapshot, canonicality)).toEqual({
      status: "failed",
      error: canonicality,
    });
    expect(
      deriveIndexedMarketHistoryRead(snapshot, new Error("unknown failure")),
    ).toMatchObject({ status: "failed" });
  });

  it("distinguishes initial loading and initial failure", () => {
    expect(deriveIndexedMarketHistoryRead(undefined, null)).toEqual({
      status: "loading",
    });
    expect(
      deriveIndexedMarketHistoryRead(undefined, new Error("unavailable")),
    ).toMatchObject({ status: "failed" });
  });
});
