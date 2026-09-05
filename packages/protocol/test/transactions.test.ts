import { describe, expect, it } from "vitest";

import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  deriveCapabilities,
  MAX_CLAIM_IDENTITIES,
  prepareProtocolTransaction,
  selectClaimIdentityBatch,
  TransactionPreparationError,
  type TransactionContext,
} from "../src/transactions.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as const;

const context = (): TransactionContext => ({
  identity: selectIdentityConfiguration("orbit-4444"),
  expectedChainId: 84_532,
  connectedChainId: 84_532,
  currentBlock: 100n,
  currentTimestamp: 1_000n,
  maximumQuoteAgeBlocks: 5n,
  connectedWallet: address("1"),
  roles: {
    owners: {
      liquidToken: address("1"),
      rewards: address("1"),
      converter: address("1"),
      liquidity: address("1"),
    },
    guardian: address("2"),
    recoveryAuthority: address("3"),
    keeper: address("4"),
    liquidityExecutor: address("5"),
    creator: address("6"),
  },
  contracts: {
    canonicalFeeHook: address("19"),
    claimGate: address("1a"),
    fuelCore: address("10"),
    weth: address("16"),
    fuelMirror: address("11"),
    rewardLedger: address("12"),
    epochConverter: address("13"),
    canonicalRouter: address("14"),
    protocolLiquidityVault: address("15"),
    uniswapV4PoolManager: address("17"),
  },
  launched: true,
  sealed: true,
  liquidityConfigurationSealed: true,
  canonicalTickSpacing: 60,
  pauses: {
    liquidToken: false,
    rewards: false,
    converter: false,
    liquidity: false,
  },
  rewardPotWeth: 1n * 10n ** 18n,
  creatorPotWeth: 2n * 10n ** 18n,
  nextRewardEpochAt: 900n,
  trackQueues: { 1: 1n, 2: 1n, 3: 0n, 4: 0n },
  trackAttemptHistoryAvailable: { 1: true, 2: true, 3: true, 4: true },
  retryableTracks: new Set<1 | 2 | 3 | 4>([1]),
  ownedTransientIdentityIds: new Set([7]),
  ownedPermanentIdentityIds: new Set([42]),
  claimableIdentityIds: new Set([42]),
  readAvailability: {
    launched: true,
    conversionConfigurationSealed: true,
    liquidityConfigurationSealed: true,
    pauses: {
      liquidToken: true,
      rewards: true,
      converter: true,
      liquidity: true,
    },
    rewardPot: true,
    creatorPot: true,
    nextRewardEpoch: true,
    trackQueues: { 1: true, 2: true, 3: true, 4: true },
  },
});

describe("role capabilities and transaction preparation", () => {
  it("selects and prepares only the bounded claim batch", () => {
    const identityIds = Array.from({ length: 65 }, (_, index) => index + 1);
    const claimContext = {
      ...context(),
      claimableIdentityIds: new Set(identityIds),
    };

    expect(selectClaimIdentityBatch(identityIds)).toEqual(
      identityIds.slice(0, MAX_CLAIM_IDENTITIES),
    );
    expect(() =>
      prepareProtocolTransaction({ type: "claim", identityIds }, claimContext),
    ).toThrow(TransactionPreparationError);
    expect(
      prepareProtocolTransaction(
        {
          type: "claim",
          identityIds: selectClaimIdentityBatch(identityIds),
        },
        claimContext,
      ),
    ).toMatchObject({
      functionName: "claim",
      args: [identityIds.slice(0, MAX_CLAIM_IDENTITIES)],
    });
  });

  it("derives capabilities only from the connected wallet and observed onchain roles", () => {
    expect(deriveCapabilities(context())).toMatchObject({
      connected: true,
      owner: true,
      ownerModules: {
        liquidToken: true,
        rewards: true,
        converter: true,
        liquidity: true,
      },
      guardian: false,
      keeper: false,
      liquidityExecutor: false,
    });
    expect(
      deriveCapabilities({ ...context(), connectedWallet: undefined }),
    ).toMatchObject({
      connected: false,
      owner: false,
      guardian: false,
      keeper: false,
      liquidityExecutor: false,
    });
  });

  it("authorizes owner actions against each observed target owner", () => {
    const splitOwners = {
      ...context(),
      connectedWallet: address("7"),
      roles: {
        ...context().roles,
        owners: {
          ...context().roles.owners,
          rewards: address("7"),
        },
      },
    };

    expect(
      prepareProtocolTransaction(
        { type: "set-pause", module: "rewards", paused: true },
        splitOwners,
      ),
    ).toMatchObject({ to: address("12") });
    expect(() =>
      prepareProtocolTransaction(
        { type: "set-pause", module: "liquidToken", paused: true },
        splitOwners,
      ),
    ).toThrow(TransactionPreparationError);
  });

  it("prepares domain actions against manifest-bound targets", () => {
    expect(
      prepareProtocolTransaction(
        {
          type: "commit-collectible",
          identityId: 7,
        },
        context(),
      ),
    ).toMatchObject({
      to: address("10"),
      functionName: "commit",
      args: [7],
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "claim",
          identityIds: [42],
        },
        context(),
      ),
    ).toMatchObject({
      to: address("12"),
      functionName: "claim",
      args: [[42]],
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "direct-collectible-transfer",
          identityId: 42,
          recipient: address("99"),
        },
        context(),
      ),
    ).toMatchObject({
      to: address("11"),
      functionName: "safeTransferFrom",
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "direct-collectible-transfer",
          identityId: 7,
          recipient: address("99"),
        },
        context(),
      ),
    ).toMatchObject({
      to: address("11"),
      functionName: "safeTransferFrom",
      args: [address("1"), address("99"), 7n],
    });
    expect(
      prepareProtocolTransaction(
        { type: "set-pause", module: "liquidToken", paused: true },
        context(),
      ),
    ).toMatchObject({
      to: address("10"),
      functionName: "setPaused",
      args: [true],
    });
  });

  it("prepares every market and operator action with validated inputs", () => {
    expect(
      prepareProtocolTransaction(
        {
          type: "approve-exchange-input",
          asset: "weth",
          amount: 100n,
        },
        context(),
      ),
    ).toMatchObject({
      to: address("16"),
      functionName: "approve",
      args: [address("14"), 100n],
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "approve-exchange-input",
          asset: "liquid-token",
          amount: 100n,
        },
        context(),
      ),
    ).toMatchObject({
      to: address("10"),
      functionName: "approve",
      args: [address("14"), 100n],
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "swap-exact-input",
          quote: {
            observedBlock: 100n,
            expiresAtBlock: 105n,
            liquidTokenForWeth: false,
            amountIn: 100n,
            amountOut: 97n,
            discovery: {
              account: address("1"),
              accountHoldings: {
                pendingDiscoveryCount: 0,
                transientCollectibleCount: 0,
              },
              sender: {
                account: address("17"),
                balance: 1_000n * 10n ** 18n,
                discoveryExempt: true,
                mutations: 0,
              },
              recipient: {
                account: address("1"),
                balance: 0n,
                discoveryExempt: false,
                mutations: 0,
              },
              mutations: 0,
              maximumMutations: 64,
              executable: true,
              maximumLiquidTokenAmount: 65n * 10n ** 18n - 1n,
            },
          },
          liquidTokenForWeth: false,
          exactAmountIn: 100n,
          minimumAmountOut: 95n,
          recipient: address("1"),
          deadline: 2_000n,
          useNative: true,
        },
        context(),
      ),
    ).toMatchObject({
      to: address("14"),
      functionName: "swapExactInput",
      value: 100n,
    });

    const keeperContext = {
      ...context(),
      connectedWallet: address("4"),
    };
    expect(
      prepareProtocolTransaction({ type: "open-reward-epoch" }, keeperContext),
    ).toMatchObject({
      to: address("13"),
      functionName: "openRewardEpoch",
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "execute-track",
          track: 2,
          minimumStockOutput: 10n,
          deadline: 2_000n,
        },
        keeperContext,
      ),
    ).toMatchObject({
      to: address("13"),
      functionName: "executeTrack",
      args: [2, 10n, 2_000n],
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "execute-track",
          track: 2,
          minimumStockOutput: 10n,
          deadline: 2_000n,
        },
        {
          ...keeperContext,
          trackAttemptHistoryAvailable: {
            1: true,
            2: false,
            3: true,
            4: true,
          },
        },
      ),
    ).toMatchObject({
      to: address("13"),
      functionName: "executeTrack",
      args: [2, 10n, 2_000n],
    });
    expect(
      prepareProtocolTransaction(
        {
          type: "retry-track",
          track: 1,
          minimumStockOutput: 10n,
          deadline: 2_000n,
        },
        keeperContext,
      ),
    ).toMatchObject({
      to: address("13"),
      functionName: "executeTrack",
      args: [1, 10n, 2_000n],
    });

    expect(
      prepareProtocolTransaction(
        {
          type: "execute-pol",
          tickLower: -120,
          tickUpper: 120,
          liquidity: 10n,
          maximumWeth: 20n,
          deadline: 2_000n,
        },
        { ...context(), connectedWallet: address("5") },
      ),
    ).toMatchObject({
      to: address("15"),
      functionName: "addLiquidityCycle",
      args: [-120, 120, 10n, 20n, 2_000n],
    });

    expect(
      prepareProtocolTransaction(
        {
          type: "configure-conversion-track",
          track: 2,
          stockToken: address("20"),
          adapter: address("21"),
        },
        { ...context(), sealed: false },
      ),
    ).toMatchObject({
      to: address("13"),
      functionName: "configureTrack",
      args: [2, address("20"), address("21")],
    });
  });

  it("rejects a swap quote that exceeds the discovery mutation limit", () => {
    expect(() =>
      prepareProtocolTransaction(
        {
          type: "swap-exact-input",
          quote: {
            observedBlock: 100n,
            expiresAtBlock: 105n,
            liquidTokenForWeth: false,
            amountIn: 1n * 10n ** 18n,
            amountOut: 65n * 10n ** 18n,
            discovery: {
              account: address("1"),
              accountHoldings: {
                pendingDiscoveryCount: 0,
                transientCollectibleCount: 0,
              },
              sender: {
                account: address("17"),
                balance: 1_000n * 10n ** 18n,
                discoveryExempt: true,
                mutations: 0,
              },
              recipient: {
                account: address("1"),
                balance: 0n,
                discoveryExempt: false,
                mutations: 65,
              },
              mutations: 65,
              maximumMutations: 64,
              executable: false,
              maximumLiquidTokenAmount: 65n * 10n ** 18n - 1n,
            },
          },
          liquidTokenForWeth: false,
          exactAmountIn: 1n * 10n ** 18n,
          minimumAmountOut: 64n * 10n ** 18n,
          recipient: address("1"),
          deadline: 2_000n,
        },
        context(),
      ),
    ).toThrow(TransactionPreparationError);
  });

  it("fails closed with a typed error when swap discovery evidence is missing", () => {
    const actionWithoutDiscovery = {
      type: "swap-exact-input",
      quote: {
        observedBlock: 100n,
        expiresAtBlock: 105n,
        liquidTokenForWeth: false,
        amountIn: 1n,
        amountOut: 1n,
      },
      liquidTokenForWeth: false,
      exactAmountIn: 1n,
      minimumAmountOut: 1n,
      recipient: address("1"),
      deadline: 2_000n,
    } as Parameters<typeof prepareProtocolTransaction>[0];

    expect(() =>
      prepareProtocolTransaction(actionWithoutDiscovery, context()),
    ).toThrowError(
      expect.objectContaining({
        code: "discovery-evidence-invalid",
      }),
    );
  });

  it.each([
    {
      label: "buy",
      liquidTokenForWeth: false,
      amountIn: 1n * 10n ** 18n,
      amountOut: 63_750_000_000_000_000_000n,
      minimumAmountOut: 63n * 10n ** 18n,
      sender: {
        account: address("17"),
        balance: 1_000n * 10n ** 18n,
        discoveryExempt: true,
        mutations: 0,
      },
      recipient: {
        account: address("1"),
        balance: 10_250_000_000_000_000_000n,
        discoveryExempt: false,
        mutations: 64,
      },
      maximumLiquidTokenAmount: 64_749_999_999_999_999_999n,
    },
    {
      label: "sell",
      liquidTokenForWeth: true,
      amountIn: 64_250_000_000_000_000_000n,
      amountOut: 1n * 10n ** 18n,
      minimumAmountOut: 990_000_000_000_000_000n,
      sender: {
        account: address("1"),
        balance: 65_250_000_000_000_000_000n,
        discoveryExempt: false,
        mutations: 64,
      },
      recipient: {
        account: address("17"),
        balance: 1_000n * 10n ** 18n,
        discoveryExempt: true,
        mutations: 0,
      },
      maximumLiquidTokenAmount: 64_250_000_000_000_000_000n,
    },
  ] as const)(
    "accepts verified $label evidence at exactly 64 discovery mutations",
    ({
      liquidTokenForWeth,
      amountIn,
      amountOut,
      minimumAmountOut,
      sender,
      recipient,
      maximumLiquidTokenAmount,
    }) => {
      expect(
        prepareProtocolTransaction(
          {
            type: "swap-exact-input",
            quote: {
              observedBlock: 100n,
              expiresAtBlock: 105n,
              liquidTokenForWeth,
              amountIn,
              amountOut,
              discovery: {
                account: address("1"),
                accountHoldings: liquidTokenForWeth
                  ? {
                      pendingDiscoveryCount: 40,
                      transientCollectibleCount: 25,
                    }
                  : {
                      pendingDiscoveryCount: 4,
                      transientCollectibleCount: 6,
                    },
                sender,
                recipient,
                mutations: 64,
                maximumMutations: 64,
                executable: true,
                maximumLiquidTokenAmount,
              },
            },
            liquidTokenForWeth,
            exactAmountIn: amountIn,
            minimumAmountOut,
            recipient: address("1"),
            deadline: 2_000n,
          },
          context(),
        ),
      ).toMatchObject({ functionName: "swapExactInput" });
    },
  );

  it("rejects truthy-string discovery exemption evidence", () => {
    const action = {
      type: "swap-exact-input",
      quote: {
        observedBlock: 100n,
        expiresAtBlock: 105n,
        liquidTokenForWeth: false,
        amountIn: 1n * 10n ** 18n,
        amountOut: 63_750_000_000_000_000_000n,
        discovery: {
          account: address("1"),
          accountHoldings: {
            pendingDiscoveryCount: 0,
            transientCollectibleCount: 0,
          },
          sender: {
            account: address("17"),
            balance: 1_000n * 10n ** 18n,
            discoveryExempt: true,
            mutations: 0,
          },
          recipient: {
            account: address("1"),
            balance: 10_250_000_000_000_000_000n,
            discoveryExempt: "false",
            mutations: 0,
          },
          mutations: 0,
          maximumMutations: 64,
          executable: true,
          maximumLiquidTokenAmount: 1_000n * 10n ** 18n,
        },
      },
      liquidTokenForWeth: false,
      exactAmountIn: 1n * 10n ** 18n,
      minimumAmountOut: 63n * 10n ** 18n,
      recipient: address("1"),
      deadline: 2_000n,
    } as unknown as Parameters<typeof prepareProtocolTransaction>[0];

    expect(() => prepareProtocolTransaction(action, context())).toThrowError(
      expect.objectContaining({ code: "discovery-evidence-invalid" }),
    );
  });

  it.each([
    ["wallet", { account: address("2") }],
    [
      "sender exemption",
      {
        sender: {
          account: address("17"),
          balance: 1_000n * 10n ** 18n,
          discoveryExempt: false,
          mutations: 0,
        },
      },
    ],
    ["mutation count", { mutations: 63 }],
  ] as const)("rejects tampered %s discovery evidence", (_label, override) => {
    const evidence = {
      account: address("1"),
      accountHoldings: {
        pendingDiscoveryCount: 4,
        transientCollectibleCount: 6,
      },
      sender: {
        account: address("17"),
        balance: 1_000n * 10n ** 18n,
        discoveryExempt: true,
        mutations: 0,
      },
      recipient: {
        account: address("1"),
        balance: 10_250_000_000_000_000_000n,
        discoveryExempt: false,
        mutations: 64,
      },
      mutations: 64,
      maximumMutations: 64,
      executable: true,
      maximumLiquidTokenAmount: 64_749_999_999_999_999_999n,
      ...override,
    };
    expect(() =>
      prepareProtocolTransaction(
        {
          type: "swap-exact-input",
          quote: {
            observedBlock: 100n,
            expiresAtBlock: 105n,
            liquidTokenForWeth: false,
            amountIn: 1n * 10n ** 18n,
            amountOut: 63_750_000_000_000_000_000n,
            discovery: evidence,
          },
          liquidTokenForWeth: false,
          exactAmountIn: 1n * 10n ** 18n,
          minimumAmountOut: 63n * 10n ** 18n,
          recipient: address("1"),
          deadline: 2_000n,
        },
        context(),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "discovery-evidence-invalid" }),
    );
  });

  it("uses identity-adapter terminology in transaction preflight errors", () => {
    expect(() =>
      prepareProtocolTransaction(
        { type: "commit-collectible", identityId: 99 },
        {
          ...context(),
          identity: selectIdentityConfiguration("neutral-test"),
        },
      ),
    ).toThrow("Transient Collectible");
    expect(() =>
      prepareProtocolTransaction(
        { type: "set-pause", module: "converter", paused: true },
        {
          ...context(),
          identity: selectIdentityConfiguration("neutral-test"),
          connectedWallet: address("9"),
        },
      ),
    ).toThrow("Distribution Round Administrator");
    expect(() =>
      prepareProtocolTransaction(
        {
          type: "configure-conversion-track",
          track: 1,
          stockToken: address("20"),
          adapter: address("21"),
        },
        {
          ...context(),
          identity: selectIdentityConfiguration("neutral-test"),
          connectedWallet: address("9"),
          sealed: false,
        },
      ),
    ).toThrow("Distribution Round Administrator");
  });

  it("fails closed when a required transaction precondition read is unavailable", () => {
    const unavailableSeal = {
      ...context(),
      sealed: false,
      readAvailability: {
        ...context().readAvailability,
        conversionConfigurationSealed: false,
      },
    };

    expect(() =>
      prepareProtocolTransaction(
        {
          type: "configure-conversion-track",
          track: 1,
          stockToken: address("20"),
          adapter: address("21"),
        },
        unavailableSeal,
      ),
    ).toThrow(TransactionPreparationError);
  });

  it.each([
    [
      "wrong chain",
      { connectedChainId: 1 },
      { type: "claim", identityIds: [42] },
    ],
    [
      "stale quote",
      {},
      {
        type: "swap-exact-input",
        quote: {
          observedBlock: 90n,
          expiresAtBlock: 99n,
          liquidTokenForWeth: true,
          amountIn: 1n,
          amountOut: 1n,
        },
        liquidTokenForWeth: true,
        exactAmountIn: 1n,
        minimumAmountOut: 1n,
        recipient: address("1"),
        deadline: 2_000n,
      },
    ],
    [
      "quote for a different swap payload",
      {},
      {
        type: "swap-exact-input",
        quote: {
          observedBlock: 100n,
          expiresAtBlock: 105n,
          liquidTokenForWeth: false,
          amountIn: 2n,
          amountOut: 2n,
        },
        liquidTokenForWeth: true,
        exactAmountIn: 1n,
        minimumAmountOut: 1n,
        recipient: address("1"),
        deadline: 2_000n,
      },
    ],
    [
      "caller-extended old quote",
      {},
      {
        type: "swap-exact-input",
        quote: {
          observedBlock: 90n,
          expiresAtBlock: 105n,
          liquidTokenForWeth: true,
          amountIn: 1n,
          amountOut: 1n,
        },
        liquidTokenForWeth: true,
        exactAmountIn: 1n,
        minimumAmountOut: 1n,
        recipient: address("1"),
        deadline: 2_000n,
      },
    ],
    [
      "zero exact swap input",
      {},
      {
        type: "swap-exact-input",
        quote: {
          observedBlock: 100n,
          expiresAtBlock: 105n,
          liquidTokenForWeth: true,
          amountIn: 0n,
          amountOut: 1n,
        },
        liquidTokenForWeth: true,
        exactAmountIn: 0n,
        minimumAmountOut: 1n,
        recipient: address("1"),
        deadline: 2_000n,
      },
    ],
    [
      "negative minimum swap output",
      {},
      {
        type: "swap-exact-input",
        quote: {
          observedBlock: 100n,
          expiresAtBlock: 105n,
          liquidTokenForWeth: true,
          amountIn: 1n,
          amountOut: 1n,
        },
        liquidTokenForWeth: true,
        exactAmountIn: 1n,
        minimumAmountOut: -1n,
        recipient: address("1"),
        deadline: 2_000n,
      },
    ],
    [
      "invalid ownership",
      {},
      {
        type: "direct-collectible-transfer",
        identityId: 99,
        recipient: address("99"),
      },
    ],
    [
      "zero transfer recipient",
      {},
      {
        type: "direct-collectible-transfer",
        identityId: 42,
        recipient: address("0"),
      },
    ],
    [
      "zero swap recipient",
      {},
      {
        type: "swap-exact-input",
        quote: {
          observedBlock: 100n,
          expiresAtBlock: 105n,
          liquidTokenForWeth: true,
          amountIn: 1n,
          amountOut: 1n,
        },
        liquidTokenForWeth: true,
        exactAmountIn: 1n,
        minimumAmountOut: 1n,
        recipient: address("0"),
        deadline: 2_000n,
      },
    ],
    [
      "unsupported role",
      { connectedWallet: address("9") },
      { type: "open-reward-epoch" },
    ],
    [
      "sealed mutation",
      {},
      {
        type: "configure-conversion-track",
        track: 1,
        stockToken: address("20"),
        adapter: address("21"),
      },
    ],
    [
      "invalid operator precondition",
      {
        connectedWallet: address("4"),
        trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
      },
      {
        type: "retry-track",
        track: 1,
        minimumStockOutput: 1n,
        deadline: 2_000n,
      },
    ],
    [
      "unknown operational history",
      {
        connectedWallet: address("4"),
        trackAttemptHistoryAvailable: {
          1: true,
          2: false,
          3: true,
          4: true,
        },
        retryableTracks: new Set([2]),
      },
      {
        type: "retry-track",
        track: 2,
        minimumStockOutput: 1n,
        deadline: 2_000n,
      },
    ],
    [
      "negative minimum stock output",
      { connectedWallet: address("4") },
      {
        type: "execute-track",
        track: 2,
        minimumStockOutput: -1n,
        deadline: 2_000n,
      },
    ],
    [
      "zero minimum stock output",
      { connectedWallet: address("4") },
      {
        type: "execute-track",
        track: 2,
        minimumStockOutput: 0n,
        deadline: 2_000n,
      },
    ],
    [
      "minimum stock output above uint256",
      { connectedWallet: address("4") },
      {
        type: "execute-track",
        track: 2,
        minimumStockOutput: 2n ** 256n,
        deadline: 2_000n,
      },
    ],
    [
      "unsealed conversion execution",
      { connectedWallet: address("4"), sealed: false },
      {
        type: "execute-track",
        track: 2,
        minimumStockOutput: 1n,
        deadline: 2_000n,
      },
    ],
    [
      "unsealed POL configuration",
      {
        connectedWallet: address("5"),
        liquidityConfigurationSealed: false,
      },
      {
        type: "execute-pol",
        tickLower: -120,
        tickUpper: 120,
        liquidity: 10n,
        maximumWeth: 20n,
        deadline: 2_000n,
      },
    ],
    [
      "misaligned POL ticks",
      { connectedWallet: address("5") },
      {
        type: "execute-pol",
        tickLower: -119,
        tickUpper: 120,
        liquidity: 10n,
        maximumWeth: 20n,
        deadline: 2_000n,
      },
    ],
    [
      "out-of-bounds POL ticks",
      { connectedWallet: address("5") },
      {
        type: "execute-pol",
        tickLower: 887_220,
        tickUpper: 887_280,
        liquidity: 10n,
        maximumWeth: 20n,
        deadline: 2_000n,
      },
    ],
    [
      "oversized POL liquidity",
      { connectedWallet: address("5") },
      {
        type: "execute-pol",
        tickLower: -120,
        tickUpper: 120,
        liquidity: 1n << 127n,
        maximumWeth: 20n,
        deadline: 2_000n,
      },
    ],
  ])("refuses %s before prompting the wallet", (_label, override, action) => {
    expect(() =>
      prepareProtocolTransaction(
        action as Parameters<typeof prepareProtocolTransaction>[0],
        { ...context(), ...override } as TransactionContext,
      ),
    ).toThrow(TransactionPreparationError);
  });
});

describe("claim policy administration", () => {
  // The whole reason a configurable gate exists is that an administrator can
  // deny and approve individual wallets. None of these paths had a test, which
  // is how the console shipped with the administrator never plumbed into the
  // transaction context at all.
  const administered = (): TransactionContext => ({
    ...context(),
    claimPolicyAdministrator: address("1"),
  });

  it("prepares an approval from the administrator wallet", () => {
    expect(
      prepareProtocolTransaction(
        { type: "set-claim-policy", account: address("77"), allowed: true },
        administered(),
      ),
    ).toMatchObject({
      to: address("1a"),
      functionName: "setClaimAllowed",
      args: [address("77"), true],
    });
  });

  it("rejects a wallet that is not the administrator", () => {
    expect(() =>
      prepareProtocolTransaction(
        { type: "set-claim-policy", account: address("77"), allowed: false },
        { ...administered(), connectedWallet: address("9") },
      ),
    ).toThrow(/administrator/iu);
  });

  it("fails closed when the deployment binds no configurable policy", () => {
    expect(() =>
      prepareProtocolTransaction(
        { type: "set-claim-policy", account: address("77"), allowed: true },
        context(),
      ),
    ).toThrow(TransactionPreparationError);
  });

  it("rejects the zero address as a policy target", () => {
    expect(() =>
      prepareProtocolTransaction(
        {
          type: "set-claim-policy",
          account: "0x0000000000000000000000000000000000000000",
          allowed: true,
        },
        administered(),
      ),
    ).toThrow(TransactionPreparationError);
  });
});

describe("creator fee withdrawal", () => {
  const creatorContext = (
    overrides: Partial<TransactionContext> = {},
  ): TransactionContext => ({
    ...context(),
    connectedWallet: address("6"),
    ...overrides,
  });

  it("pulls to the fee hook's configured destination", () => {
    expect(
      prepareProtocolTransaction(
        { type: "withdraw-creator-fees", amount: 10n ** 18n },
        creatorContext(),
      ),
    ).toMatchObject({
      to: address("19"),
      functionName: "pullCreatorPot",
      args: [10n ** 18n],
      value: 0n,
    });
  });

  it("rejects a wallet that is not the creator destination", () => {
    expect(() =>
      prepareProtocolTransaction(
        { type: "withdraw-creator-fees", amount: 10n ** 18n },
        creatorContext({ connectedWallet: address("1") }),
      ),
    ).toThrow(TransactionPreparationError);
  });

  it("rejects a zero or negative amount", () => {
    for (const amount of [0n, -1n]) {
      expect(() =>
        prepareProtocolTransaction(
          { type: "withdraw-creator-fees", amount },
          creatorContext(),
        ),
      ).toThrow(TransactionPreparationError);
    }
  });

  it("rejects an overdraw beyond the accrued balance", () => {
    expect(() =>
      prepareProtocolTransaction(
        { type: "withdraw-creator-fees", amount: 3n * 10n ** 18n },
        creatorContext(),
      ),
    ).toThrow(TransactionPreparationError);
  });

  it("allows withdrawing the exact accrued balance", () => {
    expect(
      prepareProtocolTransaction(
        { type: "withdraw-creator-fees", amount: 2n * 10n ** 18n },
        creatorContext(),
      ),
    ).toMatchObject({ args: [2n * 10n ** 18n] });
  });

  it("refuses to act on an unread creator balance", () => {
    const base = context();
    expect(() =>
      prepareProtocolTransaction(
        { type: "withdraw-creator-fees", amount: 10n ** 18n },
        creatorContext({
          readAvailability: { ...base.readAvailability, creatorPot: false },
        }),
      ),
    ).toThrow(TransactionPreparationError);
  });
});
