import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  observeEligiblePolQueue,
  previousPolQueueFirstObservedAt,
  writeOperatorEvidenceAtomically,
} from "./base-sepolia-operator-observability.ts";

describe("Protocol-Owned Liquidity operator observability", () => {
  it("tracks the age of one continuous eligible queue and marks it stale", () => {
    expect(
      observeEligiblePolQueue({
        availableWeth: 25n,
        minimumQueueWeth: 5n,
        observedAt: 1_000n,
        previousFirstObservedAt: 100n,
        staleAfterSeconds: 600n,
      }),
    ).toEqual({
      firstEligibleQueueObservedAt: 100n,
      eligibleQueueAgeSeconds: 900n,
      staleAfterSeconds: 600n,
      eligibleQueueStale: true,
    });
  });

  it("starts a new observation and clears it below the execution threshold", () => {
    expect(
      observeEligiblePolQueue({
        availableWeth: 25n,
        minimumQueueWeth: 5n,
        observedAt: 1_000n,
        staleAfterSeconds: 600n,
      }),
    ).toMatchObject({
      firstEligibleQueueObservedAt: 1_000n,
      eligibleQueueAgeSeconds: 0n,
      eligibleQueueStale: false,
    });
    expect(
      observeEligiblePolQueue({
        availableWeth: 4n,
        minimumQueueWeth: 5n,
        observedAt: 1_000n,
        previousFirstObservedAt: 100n,
        staleAfterSeconds: 600n,
      }),
    ).toEqual({
      firstEligibleQueueObservedAt: null,
      eligibleQueueAgeSeconds: 0n,
      staleAfterSeconds: 600n,
      eligibleQueueStale: false,
    });
  });

  it("reads the prior timestamp from evidence and rejects corrupt values", () => {
    expect(
      previousPolQueueFirstObservedAt(
        JSON.stringify({
          observedState: {
            protocolOwnedLiquidity: {
              firstEligibleQueueObservedAt: "123",
            },
          },
        }),
      ),
    ).toBe(123n);
    expect(
      previousPolQueueFirstObservedAt(JSON.stringify({ observedState: {} })),
    ).toBeUndefined();
    expect(
      previousPolQueueFirstObservedAt(JSON.stringify({ mode: "execute" })),
    ).toBeUndefined();
    expect(() =>
      previousPolQueueFirstObservedAt(
        JSON.stringify({
          observedState: {
            protocolOwnedLiquidity: {
              firstEligibleQueueObservedAt: "not-a-timestamp",
            },
          },
        }),
      ),
    ).toThrow("timestamp");
  });

  it("replaces evidence atomically without leaving partial files", () => {
    const directory = mkdtempSync(join(tmpdir(), "base-quotron-evidence-"));
    const evidencePath = join(directory, "operator.json");
    try {
      writeOperatorEvidenceAtomically(evidencePath, '{"run":1}\n');
      writeOperatorEvidenceAtomically(evidencePath, '{"run":2}\n');
      expect(readFileSync(evidencePath, "utf8")).toBe('{"run":2}\n');
      expect(readdirSync(directory)).toEqual(["operator.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
