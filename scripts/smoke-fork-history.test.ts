import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { protocolAbis } from "@orbit/protocol/contracts";

import {
  readForkSmokeTrackHistory,
  type ForkSmokeTrackAttempt,
} from "./smoke-fork-history.ts";

const converter = `0x${"12".repeat(20)}` as const;
const transactionHash = `0x${"34".repeat(32)}` as const;
const blockHash = `0x${"56".repeat(32)}` as const;

describe("fork smoke receipt history", () => {
  it("observes a reverted track and its later successful retry without claiming complete history", () => {
    const failed: ForkSmokeTrackAttempt = {
      track: 3,
      receipt: {
        to: converter,
        blockNumber: 10n,
        transactionIndex: 0,
        transactionHash,
        status: "reverted",
        logs: [],
      },
    };
    expect(
      readForkSmokeTrackHistory([failed], converter, 1n, 10n),
    ).toMatchObject({
      trackAttemptState: {
        1: "unknown",
        2: "unknown",
        3: "retryable",
        4: "unknown",
      },
      trackAttemptCoverage: {
        1: "partial",
        2: "partial",
        3: "partial",
        4: "partial",
      },
      eventWindowTruncated: true,
      events: [{ track: 3, successful: false, transactionHash }],
    });

    const retried: ForkSmokeTrackAttempt = {
      track: 3,
      receipt: {
        ...failed.receipt,
        blockNumber: 11n,
        transactionHash: `0x${"78".repeat(32)}`,
        status: "success",
        logs: [
          {
            address: converter,
            blockNumber: 11n,
            blockHash,
            transactionHash: `0x${"78".repeat(32)}`,
            transactionIndex: 0,
            logIndex: 0,
            removed: false,
            data: encodeAbiParameters(
              [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
              [10n, 100n, 0n],
            ),
            topics: encodeEventTopics({
              abi: protocolAbis.epochConverter,
              eventName: "TrackExecuted",
              args: { track: 3 },
            }) as [`0x${string}`, ...`0x${string}`[]],
          },
        ],
      },
    };
    expect(
      readForkSmokeTrackHistory([retried, failed], converter, 1n, 11n),
    ).toMatchObject({
      trackAttemptState: { 3: "fresh" },
      trackAttemptCoverage: { 3: "partial" },
    });
    expect(
      readForkSmokeTrackHistory([retried, failed], converter, 1n, 10n)
        .trackAttemptState[3],
    ).toBe("retryable");
    expect(() =>
      readForkSmokeTrackHistory(
        [{ ...retried, receipt: { ...retried.receipt, logs: [] } }],
        converter,
        1n,
        11n,
      ),
    ).toThrow();
  });
});
