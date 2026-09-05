import { describe, expect, it } from "vitest";

import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  classifyTrackAttempts,
  retainOperationalSummaryEvents,
  summarizeOperationalEvents,
  summarizeTrackOutcomes,
} from "../src/events.js";
import type { OperationalEvent } from "../src/reader.js";

const hash = (suffix: string) =>
  `0x${suffix.padStart(64, "0")}` as `0x${string}`;
const identity = selectIdentityConfiguration("orbit-4444");

describe("bounded operational event summary", () => {
  it("keeps the latest successful and failed operation independently", () => {
    const summary = summarizeOperationalEvents([
      {
        type: "conversion",
        blockNumber: 10n,
        transactionHash: hash("1"),
        successful: true,
        explanation: "converted",
      },
      {
        type: "retry",
        blockNumber: 12n,
        transactionHash: hash("2"),
        successful: false,
        explanation: "retry failed",
      },
      {
        type: "conversion",
        blockNumber: 11n,
        transactionHash: hash("3"),
        successful: true,
        explanation: "converted again",
      },
    ]);

    expect(summary.conversion.lastSuccessful?.blockNumber).toBe(11n);
    expect(summary.retry.lastFailed?.blockNumber).toBe(12n);
  });

  it("reports the latest conversion or retry outcome independently for each track", () => {
    const outcomes = summarizeTrackOutcomes([
      {
        type: "conversion",
        track: 1,
        blockNumber: 10n,
        transactionHash: hash("1"),
        successful: true,
        explanation: "track one converted",
      },
      {
        type: "conversion",
        track: 2,
        blockNumber: 11n,
        transactionHash: hash("2"),
        successful: false,
        explanation: "track two failed",
      },
      {
        type: "retry",
        track: 2,
        blockNumber: 12n,
        transactionHash: hash("3"),
        successful: true,
        explanation: "track two recovered",
      },
    ]);

    expect(outcomes[1]?.latest?.explanation).toBe("track one converted");
    expect(outcomes[2]?.latest?.explanation).toBe("track two recovered");
    expect(outcomes[3]?.latest).toBeUndefined();
    expect(outcomes[4]?.latest).toBeUndefined();
  });

  it("classifies a failed conversion and its later attempts as retries per track", () => {
    const attempts = classifyTrackAttempts(
      [
        {
          type: "track-execution",
          track: 2,
          blockNumber: 10n,
          transactionHash: hash("1"),
          successful: false,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 1,
          blockNumber: 11n,
          transactionHash: hash("2"),
          successful: true,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 2,
          blockNumber: 12n,
          transactionHash: hash("3"),
          successful: false,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 2,
          blockNumber: 13n,
          transactionHash: hash("4"),
          successful: true,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 2,
          blockNumber: 14n,
          transactionHash: hash("5"),
          successful: true,
          explanation: "raw",
        },
      ],
      identity,
    );

    expect(attempts.map((attempt) => attempt.type)).toEqual([
      "conversion",
      "conversion",
      "retry",
      "retry",
      "conversion",
    ]);
  });

  it("retains the latest status for rarer operations and deduplicates one transaction's logs", () => {
    const events: OperationalEvent[] = [
      ...Array.from({ length: 5 }, (_, index): OperationalEvent => ({
        type: "claim" as const,
        blockNumber: BigInt(20 - index),
        transactionHash: hash(String(index + 1)),
        successful: true,
        explanation: "claimed",
      })),
      {
        type: "claim",
        blockNumber: 20n,
        transactionHash: hash("1"),
        successful: true,
        explanation: "same claim transaction",
      },
      {
        type: "pol-execution" as const,
        blockNumber: 10n,
        transactionHash: hash("99"),
        successful: false,
        explanation: "POL failed",
      },
    ];

    const retained = retainOperationalSummaryEvents(events, 3);

    expect(
      retained.filter((event) => event.transactionHash === hash("1")),
    ).toHaveLength(1);
    expect(retained.some((event) => event.type === "pol-execution")).toBe(true);
  });

  it("takes event explanations from the selected identity adapter", () => {
    const [event] = classifyTrackAttempts(
      [
        {
          type: "track-execution",
          track: 1,
          blockNumber: 10n,
          transactionHash: hash("1"),
          successful: false,
          explanation: "raw",
        },
      ],
      selectIdentityConfiguration("neutral-test"),
    );

    expect(event?.explanation).toContain("Queued Track Budget");
    expect(event?.explanation).not.toContain("Deferred Track Budget");
  });

  it("keeps the boundary attempt unclassified when preceding failure coverage is partial", () => {
    const attempts = classifyTrackAttempts(
      [
        {
          type: "track-execution",
          track: 2,
          blockNumber: 600n,
          transactionHash: hash("1"),
          successful: false,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 2,
          blockNumber: 601n,
          transactionHash: hash("2"),
          successful: true,
          explanation: "raw",
        },
      ],
      identity,
      { fromBlock: 500n, completeFromStart: false, truncated: false },
    );

    expect(attempts.map((attempt) => attempt.type)).toEqual([
      "track-execution-unknown",
      "retry",
    ]);
  });

  it("recovers classification after reliable attempts beyond a truncation boundary", () => {
    const attempts = classifyTrackAttempts(
      [
        {
          type: "track-execution",
          track: 2,
          blockNumber: 600n,
          transactionHash: hash("1"),
          successful: false,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 2,
          blockNumber: 601n,
          transactionHash: hash("2"),
          successful: false,
          explanation: "raw",
        },
        {
          type: "track-execution",
          track: 2,
          blockNumber: 602n,
          transactionHash: hash("3"),
          successful: true,
          explanation: "raw",
        },
      ],
      identity,
      {
        fromBlock: 500n,
        completeFromStart: false,
        truncated: true,
        truncatedAt: 600n,
      },
    );

    expect(attempts.map((attempt) => attempt.type)).toEqual([
      "track-execution-unknown",
      "track-execution-unknown",
      "retry",
    ]);
  });
});
