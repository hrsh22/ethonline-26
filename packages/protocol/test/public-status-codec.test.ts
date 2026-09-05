import { describe, expect, it } from "vitest";

import {
  decodePublicStatusCache,
  encodePublicStatusCache,
  isPublicStatusModel,
  type PublicStatusModel,
} from "../src/public-status-codec.js";

const model: PublicStatusModel = {
  health: "degraded",
  freshness: "stale",
  network: "base-sepolia",
  observedAt: 1_700_000_000,
  observedBlock: 46_352_953n,
  collection: {
    permanent: 12,
    transient: 20n,
    pending: undefined,
    available: 4_412,
  },
  funds: {
    creatorWeth: 1n,
    liquidityLockedWeth: 2n,
    liquidityWaitingWeth: undefined,
    rewardWethWaiting: 10n ** 30n,
  },
  rewardActivity: {
    epochCount: 1n,
    historyStatus: "partial",
    history: [
      {
        type: "reward-epoch",
        blockNumber: 46_352_953n,
        logIndex: 0,
        transactionIndex: 0,
        transactionHash: `0x${"12".repeat(32)}`,
        epoch: {
          epochNumber: 1n,
          openedWeth: 40n,
          equalTrackShare: 10n,
          finalTrackRemainder: 0n,
        },
      },
    ],
    latestOpening: undefined,
    recentConversions: [],
    collectorLiability: [{ track: "AAPLc", amount: undefined }],
  },
};

describe("public status cache codec", () => {
  it("round-trips v1 bigint markers and missing partial evidence without precision loss", () => {
    const cached = { model, savedAt: 1_700_000_000_000 };
    const encoded = encodePublicStatusCache(cached);
    expect(encoded).toContain(
      '"__orbitPublicBigInt":"1000000000000000000000000000000"',
    );
    expect(decodePublicStatusCache(encoded)).toEqual(cached);
    expect(isPublicStatusModel(model)).toBe(true);
    const current = {
      ...cached,
      model: {
        ...model,
        priceWethPerLiquidTokenWei: 10n ** 18n,
        funds: {
          ...model.funds,
          rewardPotWeth: 4n,
          liquidityQueuedWeth: 5n,
        },
      },
    };
    expect(decodePublicStatusCache(encodePublicStatusCache(current))).toEqual(
      current,
    );
  });

  it("rejects corrupt bigint encodings and invalid specialized reward events", () => {
    const encoded = encodePublicStatusCache({
      model,
      savedAt: 1_700_000_000_000,
    });
    expect(() =>
      decodePublicStatusCache(encoded.replace('"46352953"', '"0x2c"')),
    ).toThrow();
    expect(() =>
      decodePublicStatusCache(encoded.replace('"46352953"', '"046352953"')),
    ).toThrow();
    expect(
      isPublicStatusModel({
        ...model,
        rewardActivity: {
          ...model.rewardActivity,
          recentConversions: model.rewardActivity.history,
        },
      }),
    ).toBe(false);
    expect(
      isPublicStatusModel({
        ...model,
        observedAt: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBe(false);
  });
});
