import type { CanonicalMarketHistorySnapshot } from "@orbit/protocol/market-history";
import { IndexedHistoryError } from "@orbit/protocol/history";

export type IndexedMarketHistoryRead =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: Error }
  | {
      readonly status: "stale";
      readonly snapshot: CanonicalMarketHistorySnapshot;
      readonly error: Error;
    }
  | {
      readonly status: "loaded";
      readonly snapshot: CanonicalMarketHistorySnapshot;
    };

const marketHistoryError = (error: unknown): Error | null =>
  error instanceof Error
    ? error
    : error === null || error === undefined
      ? null
      : new Error(String(error));

export const deriveIndexedMarketHistoryRead = (
  snapshot: CanonicalMarketHistorySnapshot | undefined,
  error: unknown,
): IndexedMarketHistoryRead => {
  const readError = marketHistoryError(error);
  if (readError !== null) {
    const canRetainVerifiedFacts =
      snapshot !== undefined &&
      readError instanceof IndexedHistoryError &&
      readError.code === "history-rpc-unavailable";
    return canRetainVerifiedFacts
      ? { status: "stale", snapshot, error: readError }
      : { status: "failed", error: readError };
  }
  return snapshot === undefined
    ? { status: "loading" }
    : { status: "loaded", snapshot };
};
