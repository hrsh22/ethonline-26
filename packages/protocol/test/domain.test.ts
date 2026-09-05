import { describe, expect, it } from "vitest";

import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  deriveCanonicalMarketPrice,
  deriveLiquidTokenBoundaryImpact,
  deriveLiquidTokenTransferMutationCapacity,
  deriveWalletSnapshot,
  validateMarketDiscoveryEvidence,
  type WalletSnapshotInput,
} from "../src/domain.js";

const orbit = selectIdentityConfiguration("orbit-4444");
const neutral = selectIdentityConfiguration("neutral-test");
const discoveryAccount = "0x0000000000000000000000000000000000000001" as const;
const discoveryManager = "0x0000000000000000000000000000000000000017" as const;

const validDiscoveryValidationInput = () => ({
  account: discoveryAccount,
  evidence: {
    account: discoveryAccount,
    accountHoldings: {
      pendingDiscoveryCount: 4,
      transientCollectibleCount: 6,
    },
    sender: {
      account: discoveryManager,
      balance: 4_000n * 10n ** 18n,
      discoveryExempt: true,
      mutations: 0,
    },
    recipient: {
      account: discoveryAccount,
      balance: 10_250_000_000_000_000_000n,
      discoveryExempt: false,
      mutations: 64,
    },
    mutations: 64,
    maximumMutations: 64,
    executable: true,
    maximumLiquidTokenAmount: 64_749_999_999_999_999_999n,
  },
  liquidTokenAmount: 63_750_000_000_000_000_000n,
  liquidTokenForWeth: false,
});

const baseInput = (): WalletSnapshotInput => ({
  liquidBalanceWei: 0n,
  settlementBalanceWei: 0n,
  transientIdentityIds: [],
  permanentIdentityIds: [],
  permanentHoldingsStatus: "complete",
  pendingDiscoveryCount: 0,
  attributesByIdentity: {},
  pendingRewardsByIdentity: {},
  claimableIdentityIds: new Set(),
});

describe("wallet domain snapshot", () => {
  it("represents an empty wallet without leaking contract units or neutral copy", () => {
    const snapshot = deriveWalletSnapshot(baseInput(), orbit);

    expect(snapshot.liquidToken).toEqual({
      label: "$FUEL",
      rawWei: 0n,
      formatted: "0",
      wholeUnits: 0,
      nextDiscoveryDraw: {
        thresholdWei: 1_000_000_000_000_000_000n,
        thresholdFormatted: "1",
        remainingWei: 1_000_000_000_000_000_000n,
        remainingFormatted: "1",
      },
    });
    expect(snapshot.settlementToken).toEqual({
      label: "Settlement Asset",
      rawWei: 0n,
      formatted: "0",
    });
    expect(snapshot.collectibles).toEqual({
      transientLabel: "Grounded Craft",
      permanentLabel: "Orbiter",
      transient: [],
      permanent: [],
      permanentHoldingsStatus: "complete",
      pendingDiscovery: {
        count: 0,
        label: "Pending Discovery",
        phase: "complete",
        batch: undefined,
      },
    });
  });

  it("derives multiple whole units, collectible identity data, pending rewards, and eligibility", () => {
    const input = baseInput();
    input.liquidBalanceWei = 2_750_000_000_000_000_000n;
    input.settlementBalanceWei = 5_250_000_000_000_000_000n;
    input.transientIdentityIds = [12];
    input.permanentIdentityIds = [4441];
    input.pendingDiscoveryCount = 1;
    input.attributesByIdentity = {
      12: { track: 2, tier: 3, weightHundredths: 250, specialKind: 0 },
      4441: { track: 0, tier: 0, weightHundredths: 0, specialKind: 1 },
    };
    input.pendingRewardsByIdentity = {
      4441: [10n, 20n, 30n, 40n],
    };
    input.claimableIdentityIds = new Set([4441]);

    const snapshot = deriveWalletSnapshot(input, orbit);

    expect(snapshot.liquidToken.formatted).toBe("2.75");
    expect(snapshot.settlementToken.formatted).toBe("5.25");
    expect(snapshot.liquidToken.wholeUnits).toBe(2);
    expect(snapshot.collectibles.transient[0]).toMatchObject({
      identityId: 12,
      stateLabel: "Grounded Craft",
      rewardTrack: "GOOGLc",
      rarityTier: "III",
      rewardWeight: 2.5,
      specialKindCode: "ordinary",
      specialKind: "Ordinary",
    });
    expect(snapshot.collectibles.permanent[0]).toMatchObject({
      identityId: 4441,
      stateLabel: "Orbiter",
      specialKindCode: "basket",
      specialKind: "Station",
      claimEligible: true,
      pendingRewards: [
        { track: "AAPLc", rawTokenUnits: 10n },
        { track: "GOOGLc", rawTokenUnits: 20n },
        { track: "METAc", rawTokenUnits: 30n },
        { track: "NVDAc", rawTokenUnits: 40n },
      ],
    });
    expect(snapshot.collectibles.pendingDiscovery.count).toBe(1);
    expect(snapshot.stockRewardUnitDisclosure).toContain(
      "not guaranteed underlying-share counts",
    );
  });

  it("takes every user-facing wallet label and disclosure from the identity adapter", () => {
    const input = baseInput();
    input.liquidBalanceWei = 2_000_000_000_000_000_000n;
    input.transientIdentityIds = [12];
    input.permanentIdentityIds = [42];
    input.pendingDiscoveryCount = 1;
    input.attributesByIdentity = {
      12: { track: 2, tier: 3, weightHundredths: 250, specialKind: 0 },
      42: { track: 0, tier: 0, weightHundredths: 0, specialKind: 1 },
    };

    const snapshot = deriveWalletSnapshot(input, neutral);

    expect(snapshot.liquidToken.label).toBe("Test Liquid Token");
    expect(snapshot.collectibles.transientLabel).toBe("Transient Collectible");
    expect(snapshot.collectibles.transient[0]?.specialKind).toBe(
      "Standard Collectible",
    );
    expect(snapshot.collectibles.transient[0]?.rewardTrack).toBe("Track Two");
    expect(snapshot.collectibles.transient[0]?.rarityTier).toBe("Tier III");
    expect(snapshot.collectibles.permanent[0]?.rewardTrack).toBe(
      "All Distribution Tracks",
    );
    expect(snapshot.collectibles.permanent[0]?.rarityTier).toBe("Unique");
    expect(snapshot.collectibles.pendingDiscovery.label).toBe(
      "Pending Assignment",
    );
    expect(snapshot.stockRewardUnitDisclosure).toBe(
      "Test reward quantities are raw token units, not guaranteed underlying-share counts.",
    );
  });
});

describe("Liquid Token collectible boundaries", () => {
  it("accepts an exempt wallet with whole Liquid Tokens and no collectible backing", () => {
    expect(
      validateMarketDiscoveryEvidence({
        account: "0x0000000000000000000000000000000000000001",
        evidence: {
          account: "0x0000000000000000000000000000000000000001",
          accountHoldings: {
            pendingDiscoveryCount: 0,
            transientCollectibleCount: 0,
          },
          sender: {
            account: "0x0000000000000000000000000000000000000017",
            balance: 4_000n * 10n ** 18n,
            discoveryExempt: true,
            mutations: 0,
          },
          recipient: {
            account: "0x0000000000000000000000000000000000000001",
            balance: 10n * 10n ** 18n,
            discoveryExempt: true,
            mutations: 0,
          },
          mutations: 0,
          maximumMutations: 64,
          executable: true,
          maximumLiquidTokenAmount: 4_000n * 10n ** 18n,
        },
        liquidTokenAmount: 65n * 10n ** 18n,
        liquidTokenForWeth: false,
      }),
    ).toMatchObject({
      walletDiscoveryExempt: true,
      walletImpact: undefined,
      capacity: {
        senderMutations: 0,
        recipientMutations: 0,
        mutations: 0,
        executable: true,
      },
    });
  });

  it.each([
    [
      "an invalid wallet address",
      () => ({ ...validDiscoveryValidationInput(), account: "0x01" }),
    ],
    [
      "a string balance",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: {
            ...input.evidence,
            sender: { ...input.evidence.sender, balance: "4000" },
          },
        };
      },
    ],
    [
      "a negative balance",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: {
            ...input.evidence,
            recipient: { ...input.evidence.recipient, balance: -1n },
          },
        };
      },
    ],
    [
      "a truthy string exemption",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: {
            ...input.evidence,
            recipient: {
              ...input.evidence.recipient,
              discoveryExempt: "false",
            },
          },
        };
      },
    ],
    [
      "a string executable flag",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: { ...input.evidence, executable: "true" },
        };
      },
    ],
    [
      "a fractional mutation count",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: { ...input.evidence, mutations: 64.5 },
        };
      },
    ],
    [
      "an unsafe holding count",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: {
            ...input.evidence,
            accountHoldings: {
              ...input.evidence.accountHoldings,
              pendingDiscoveryCount: Number.MAX_SAFE_INTEGER + 1,
            },
          },
        };
      },
    ],
    [
      "a negative transfer amount",
      () => ({
        ...validDiscoveryValidationInput(),
        liquidTokenAmount: -1n,
      }),
    ],
    [
      "a string transfer direction",
      () => ({
        ...validDiscoveryValidationInput(),
        liquidTokenForWeth: "false",
      }),
    ],
    [
      "a negative maximum capacity",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: {
            ...input.evidence,
            maximumLiquidTokenAmount: -1n,
          },
        };
      },
    ],
    [
      "a false capacity summary",
      () => {
        const input = validDiscoveryValidationInput();
        return {
          ...input,
          evidence: {
            ...input.evidence,
            recipient: { ...input.evidence.recipient, mutations: 63 },
            mutations: 63,
          },
        };
      },
    ],
  ])("rejects %s at the discovery-evidence boundary", (_label, input) => {
    expect(() => validateMarketDiscoveryEvidence(input())).toThrow(RangeError);
  });

  it.each([
    ["receive", 62_750_000_000_000_000_000n, 63, true],
    ["receive", 63_750_000_000_000_000_000n, 64, true],
    ["receive", 64_750_000_000_000_000_000n, 65, false],
    ["send", 63_250_000_000_000_000_000n, 63, true],
    ["send", 64_250_000_000_000_000_000n, 64, true],
    ["send", 65_250_000_000_000_000_000n, 65, false],
  ] as const)(
    "counts %s mutations at the 63/64/65 transfer boundary",
    (movement, amount, mutations, executable) => {
      const receiving = movement === "receive";
      expect(
        deriveLiquidTokenTransferMutationCapacity({
          sender: {
            balance: receiving
              ? 4_444n * 10n ** 18n
              : 65_250_000_000_000_000_000n,
            discoveryExempt: receiving,
          },
          recipient: {
            balance: receiving ? 10_250_000_000_000_000_000n : 0n,
            discoveryExempt: !receiving,
          },
          liquidTokenAmount: amount,
        }),
      ).toMatchObject({
        senderMutations: receiving ? 0 : mutations,
        recipientMutations: receiving ? mutations : 0,
        mutations,
        maximumMutations: 64,
        executable,
        maximumLiquidTokenAmount: receiving
          ? 64_749_999_999_999_999_999n
          : 64_250_000_000_000_000_000n,
      });
    },
  );

  it("reports the exact next threshold from fractional and whole balances", () => {
    expect(
      deriveLiquidTokenBoundaryImpact({
        currentBalanceWei: 2_750_000_000_000_000_000n,
        projectedBalanceWei: 2_750_000_000_000_000_000n,
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 2,
      }),
    ).toMatchObject({
      nextDiscoveryDraw: {
        thresholdWei: 3_000_000_000_000_000_000n,
        thresholdFormatted: "3",
        remainingWei: 250_000_000_000_000_000n,
        remainingFormatted: "0.25",
      },
      gainedDiscoveryDrawCount: 0,
      lostWholeUnitCount: 0,
    });
    expect(
      deriveLiquidTokenBoundaryImpact({
        currentBalanceWei: 2_000_000_000_000_000_000n,
        projectedBalanceWei: 2_000_000_000_000_000_000n,
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 2,
      }).nextDiscoveryDraw,
    ).toEqual({
      thresholdWei: 3_000_000_000_000_000_000n,
      thresholdFormatted: "3",
      remainingWei: 1_000_000_000_000_000_000n,
      remainingFormatted: "1",
    });
  });

  it("counts Discovery Draws and cancels Pending Discovery before dissolving Transient Collectibles", () => {
    expect(
      deriveLiquidTokenBoundaryImpact({
        currentBalanceWei: 2_750_000_000_000_000_000n,
        projectedBalanceWei: 3_100_000_000_000_000_000n,
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 2,
      }),
    ).toMatchObject({
      gainedDiscoveryDrawCount: 1,
      lostWholeUnitCount: 0,
      pendingDiscoveryCancellationCount: 0,
      transientDissolutionCount: 0,
      projectedNextDiscoveryDraw: {
        thresholdFormatted: "4",
        remainingFormatted: "0.9",
      },
    });
    expect(
      deriveLiquidTokenBoundaryImpact({
        currentBalanceWei: 3_200_000_000_000_000_000n,
        projectedBalanceWei: 1_900_000_000_000_000_000n,
        pendingDiscoveryCount: 1,
        transientCollectibleCount: 2,
      }),
    ).toMatchObject({
      gainedDiscoveryDrawCount: 0,
      lostWholeUnitCount: 2,
      pendingDiscoveryCancellationCount: 1,
      transientDissolutionCount: 1,
    });
  });

  it("rejects balances and holdings that cannot represent a real wallet", () => {
    expect(() =>
      deriveLiquidTokenBoundaryImpact({
        currentBalanceWei: -1n,
        projectedBalanceWei: 0n,
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 0,
      }),
    ).toThrow("currentBalanceWei");
    expect(() =>
      deriveLiquidTokenBoundaryImpact({
        currentBalanceWei: 1_000_000_000_000_000_000n,
        projectedBalanceWei: 0n,
        pendingDiscoveryCount: 0,
        transientCollectibleCount: 0,
      }),
    ).toThrow("confirmed pending and transient holdings");
  });
});

describe("Canonical Market price", () => {
  const fuel = "0x0000000000000000000000000000000000000001" as const;
  const weth = "0x0000000000000000000000000000000000000002" as const;
  const q96 = 1n << 96n;

  it("derives exact WETH-per-Liquid-Token units in either currency order", () => {
    expect(
      deriveCanonicalMarketPrice({
        sqrtPriceX96: q96 * 2n,
        currency0: fuel,
        currency1: weth,
        liquidToken: fuel,
        identity: orbit,
        liquidTokenDecimals: 18,
        settlementTokenDecimals: 18,
      }),
    ).toEqual({
      wethPerLiquidTokenWei: 4n * 10n ** 18n,
      wethPerLiquidTokenFormatted: "4",
    });
    expect(
      deriveCanonicalMarketPrice({
        sqrtPriceX96: q96 * 2n,
        currency0: weth,
        currency1: fuel,
        liquidToken: fuel,
        identity: orbit,
        liquidTokenDecimals: 18,
        settlementTokenDecimals: 18,
      }),
    ).toEqual({
      wethPerLiquidTokenWei: 250_000_000_000_000_000n,
      wethPerLiquidTokenFormatted: "0.25",
    });
  });

  it("normalizes canonical price for checked token decimals", () => {
    expect(
      deriveCanonicalMarketPrice({
        sqrtPriceX96: q96,
        currency0: fuel,
        currency1: weth,
        liquidToken: fuel,
        identity: orbit,
        liquidTokenDecimals: 6,
        settlementTokenDecimals: 18,
      }),
    ).toEqual({
      wethPerLiquidTokenWei: 1_000_000n,
      wethPerLiquidTokenFormatted: "0.000000000001",
    });
  });

  it("rejects unchecked protocol token decimals", () => {
    expect(() =>
      deriveCanonicalMarketPrice({
        sqrtPriceX96: q96,
        currency0: fuel,
        currency1: weth,
        liquidToken: fuel,
        identity: orbit,
        liquidTokenDecimals: 18,
        settlementTokenDecimals: 256,
      }),
    ).toThrow("settlementTokenDecimals must be an integer from 0 through 255");
    expect(() =>
      deriveCanonicalMarketPrice({
        sqrtPriceX96: q96,
        currency0: fuel,
        currency1: weth,
        liquidToken: fuel,
        identity: orbit,
        liquidTokenDecimals: -1,
        settlementTokenDecimals: 18,
      }),
    ).toThrow("liquidTokenDecimals must be an integer from 0 through 255");
  });
});
