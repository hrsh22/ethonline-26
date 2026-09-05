import { protocolAbis } from "@orbit/protocol/contracts";
import type {
  OperationalEvent,
  OperationalEventWindow,
  RewardTrack,
} from "@orbit/protocol/reader";
import { parseEventLogs, type Address, type TransactionReceipt } from "viem";

export interface ForkSmokeTrackAttempt {
  readonly track: RewardTrack;
  readonly receipt: Pick<
    TransactionReceipt,
    | "to"
    | "blockNumber"
    | "transactionIndex"
    | "transactionHash"
    | "status"
    | "logs"
  >;
}

/** Only this controlled fork run's receipts, never a durable history source. */
export const readForkSmokeTrackHistory = (
  attempts: readonly ForkSmokeTrackAttempt[],
  converter: Address,
  fromBlock: bigint,
  toBlock: bigint,
): OperationalEventWindow => {
  const trackAttemptState: Record<
    RewardTrack,
    "fresh" | "retryable" | "unknown"
  > = {
    1: "unknown",
    2: "unknown",
    3: "unknown",
    4: "unknown",
  };
  const events = attempts
    .filter(
      ({ receipt }) =>
        receipt.blockNumber >= fromBlock && receipt.blockNumber <= toBlock,
    )
    .sort(
      (left, right) =>
        Number(left.receipt.blockNumber - right.receipt.blockNumber) ||
        left.receipt.transactionIndex - right.receipt.transactionIndex,
    )
    .map(({ receipt, track }): OperationalEvent => {
      if (
        receipt.to?.toLowerCase() !== converter.toLowerCase() ||
        ![1, 2, 3, 4].includes(track)
      ) {
        throw new TypeError(
          "Fork smoke track receipt does not match its request",
        );
      }
      const successful = receipt.status === "success";
      if (
        successful &&
        !parseEventLogs({
          abi: protocolAbis.epochConverter,
          eventName: "TrackExecuted",
          logs: receipt.logs.filter(
            (log) => log.address.toLowerCase() === converter.toLowerCase(),
          ),
        }).some((log) => log.args.track === track)
      ) {
        throw new TypeError(
          "Successful fork smoke track receipt has no matching execution event",
        );
      }
      trackAttemptState[track] = successful ? "fresh" : "retryable";
      return {
        type: "track-execution",
        track,
        successful,
        blockNumber: receipt.blockNumber,
        transactionIndex: receipt.transactionIndex,
        transactionHash: receipt.transactionHash,
        explanation: successful
          ? "Fork smoke track execution succeeded"
          : "Fork smoke track execution reverted",
      };
    });
  return {
    events,
    trackAttemptState,
    trackAttemptCoverage: {
      1: "partial",
      2: "partial",
      3: "partial",
      4: "partial",
    },
    failureScanTruncated: true,
    claimScanTruncated: true,
    eventWindowTruncated: true,
  };
};
