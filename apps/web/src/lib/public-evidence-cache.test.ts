import { describe, expect, it } from "vitest";
import {
  encodePublicStatusCache,
  type PublicStatusModel,
} from "@orbit/protocol/public-status-codec";

import {
  readPublicEvidenceCache,
  writePublicEvidenceCache,
} from "./public-evidence-cache";

const model: PublicStatusModel = {
  health: "degraded",
  freshness: "stale",
  network: "base-sepolia",
  observedAt: 1_700_000_000,
  observedBlock: 46_352_953n,
  collection: {
    permanent: 12,
    transient: 20,
    pending: undefined,
    available: 4_412,
  },
  funds: {
    creatorWeth: 1n,
    liquidityLockedWeth: 2n,
    liquidityWaitingWeth: undefined,
    rewardWethWaiting: 3n,
  },
  rewardActivity: {
    epochCount: undefined,
    historyStatus: "unknown",
    history: [],
    latestOpening: undefined,
    recentConversions: [],
    collectorLiability: [],
  },
};

describe("public evidence cache", () => {
  it("round-trips public snapshots with bigint evidence and provenance", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writePublicEvidenceCache(storage, "launch-hash", model, 1_700_000_000_000);

    expect([...values.keys()]).toEqual([
      "orbit:public-evidence:v1:launch-hash",
    ]);
    expect(readPublicEvidenceCache(storage, "launch-hash")).toEqual({
      model,
      savedAt: 1_700_000_000_000,
    });
  });

  it("ignores corrupt or differently scoped evidence", () => {
    const storage = {
      getItem: () => "not-json",
      setItem: () => undefined,
    };
    expect(readPublicEvidenceCache(storage, "another-launch")).toBeUndefined();
  });

  it.each(["1e999", "-1"])(
    "ignores an invalid persisted timestamp (%s)",
    (savedAt) => {
      const storage = {
        getItem: () =>
          encodePublicStatusCache({
            model,
            savedAt: 1_700_000_000_000,
          }).replace('"savedAt":1700000000000', `"savedAt":${savedAt}`),
      };

      expect(readPublicEvidenceCache(storage, "launch-hash")).toBeUndefined();
    },
  );
});
