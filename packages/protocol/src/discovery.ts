export const MAX_DISCOVERY_FINALIZATION_MUTATIONS = 8;

export type DiscoveryRequestState =
  "awaiting-randomness" | "ready" | "finalized";

export type PendingDiscoveryPhase =
  | "waiting-for-randomness"
  | "delayed"
  | "ready-for-finalization"
  | "finalizing"
  | "complete";

export interface DiscoveryBatchObservation {
  readonly vrfRequestId: bigint;
  readonly sequence: bigint;
  readonly state: DiscoveryRequestState;
  readonly requestedAt: bigint;
  readonly fulfilledAt: bigint | undefined;
  readonly count: number;
  readonly finalizedCount: number;
  readonly delayReported: boolean;
  readonly delayed: boolean;
  readonly fullyCancelled: boolean;
}

export type DiscoveryMaintenance =
  | {
      readonly kind: "finalize";
      readonly vrfRequestId: bigint;
      readonly maxCount: number;
      readonly reason: string;
    }
  | {
      readonly kind: "report-delay" | "skip-cancelled";
      readonly vrfRequestId: bigint;
      readonly reason: string;
    }
  | { readonly kind: "wait"; readonly reason: string };

export const derivePendingDiscoveryPhase = (
  batch: DiscoveryBatchObservation,
): PendingDiscoveryPhase => {
  if (batch.state === "finalized") return "complete";
  if (batch.state === "awaiting-randomness") {
    return batch.delayed ? "delayed" : "waiting-for-randomness";
  }
  return batch.finalizedCount === 0 ? "ready-for-finalization" : "finalizing";
};

export const deriveDiscoveryMaintenance = (
  batch: DiscoveryBatchObservation,
): DiscoveryMaintenance => {
  if (batch.fullyCancelled && batch.state !== "finalized") {
    return {
      kind: "skip-cancelled",
      vrfRequestId: batch.vrfRequestId,
      reason:
        "Every Pending Discovery in the head batch was cancelled; advance without randomness.",
    };
  }
  if (batch.state === "ready") {
    return {
      kind: "finalize",
      vrfRequestId: batch.vrfRequestId,
      maxCount: MAX_DISCOVERY_FINALIZATION_MUTATIONS,
      reason: "Verified randomness is ready; finalize the next bounded chunk.",
    };
  }
  if (batch.state === "awaiting-randomness" && batch.delayed) {
    return batch.delayReported
      ? {
          kind: "wait",
          reason:
            "Chainlink VRF is delayed and the incident is already recorded; do not reroll.",
        }
      : {
          kind: "report-delay",
          vrfRequestId: batch.vrfRequestId,
          reason:
            "Chainlink VRF passed the delay threshold; record the incident without rerolling.",
        };
  }
  return {
    kind: "wait",
    reason:
      batch.state === "finalized"
        ? "The observed Discovery Batch is complete."
        : "Waiting for the verified Chainlink VRF response.",
  };
};
