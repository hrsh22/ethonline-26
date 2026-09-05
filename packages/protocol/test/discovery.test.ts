import { describe, expect, it } from "vitest";

import {
  deriveDiscoveryMaintenance,
  derivePendingDiscoveryPhase,
  type DiscoveryBatchObservation,
} from "../src/discovery.js";

const readyBatch = (
  overrides: Partial<DiscoveryBatchObservation> = {},
): DiscoveryBatchObservation => ({
  vrfRequestId: 44n,
  sequence: 3n,
  state: "ready",
  requestedAt: 1_000n,
  fulfilledAt: 1_030n,
  count: 15,
  finalizedCount: 0,
  delayReported: false,
  delayed: false,
  fullyCancelled: false,
  ...overrides,
});

describe("discovery lifecycle", () => {
  it("distinguishes external randomness delay from retryable finalization", () => {
    expect(
      derivePendingDiscoveryPhase(
        readyBatch({
          state: "awaiting-randomness",
          fulfilledAt: undefined,
          delayed: true,
        }),
      ),
    ).toBe("delayed");
    expect(derivePendingDiscoveryPhase(readyBatch())).toBe(
      "ready-for-finalization",
    );
    expect(derivePendingDiscoveryPhase(readyBatch({ finalizedCount: 8 }))).toBe(
      "finalizing",
    );
  });

  it("finalizes ready work in the contract's bounded retry size", () => {
    expect(deriveDiscoveryMaintenance(readyBatch())).toEqual({
      kind: "finalize",
      vrfRequestId: 44n,
      maxCount: 8,
      reason: "Verified randomness is ready; finalize the next bounded chunk.",
    });
  });

  it("reports an active delayed coordinator request without replacing it", () => {
    expect(
      deriveDiscoveryMaintenance(
        readyBatch({
          state: "awaiting-randomness",
          fulfilledAt: undefined,
          delayed: true,
        }),
      ),
    ).toEqual({
      kind: "report-delay",
      vrfRequestId: 44n,
      reason:
        "Chainlink VRF passed the delay threshold; record the incident without rerolling.",
    });
  });

  it("skips a fully cancelled head without waiting for or replacing randomness", () => {
    expect(
      deriveDiscoveryMaintenance(
        readyBatch({
          state: "awaiting-randomness",
          fulfilledAt: undefined,
          delayed: true,
          fullyCancelled: true,
        }),
      ),
    ).toEqual({
      kind: "skip-cancelled",
      vrfRequestId: 44n,
      reason:
        "Every Pending Discovery in the head batch was cancelled; advance without randomness.",
    });
  });
});
