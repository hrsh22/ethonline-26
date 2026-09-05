import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
  type Address,
} from "viem";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";
import type { ProtocolHistoryReader } from "../src/history.js";

import {
  createProtocolReader,
  ProtocolQueryError,
  type ContractReadRequest,
  type ContractReadResult,
  type ContractReadResults,
  type OperationalEvent,
  type OperationalEventWindow,
  type ProtocolReadTransport,
  type RewardHistoryEvent,
  type RewardHistoryWindow,
} from "../src/reader.js";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
const owner = "0x0000000000000000000000000000000000000001" as const;
/** An address no manifest records, used to stand in for an unreviewed nominee. */
const stranger = "0x000000000000000000000000000000000000dEaD" as const;
/**
 * The revert a mirror produces for an identity that has never been drawn,
 * shaped exactly as Viem surfaces it from a failed multicall entry: the
 * collection ABI does not carry the error, so only the raw bytes identify it.
 */
const unknownIdentityRevert = (identityId: number) => {
  const data = encodeErrorResult({
    abi: parseAbi(["error UnknownIdentity(uint256 identityId)"]),
    errorName: "UnknownIdentity",
    args: [BigInt(identityId)],
  });
  const functionOnlyAbi = parseAbi([
    "function ownerOf(uint256 identityId) view returns (address)",
  ]);
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: functionOnlyAbi,
      data,
      functionName: "ownerOf",
    }),
    {
      abi: functionOnlyAbi,
      args: [BigInt(identityId)],
      functionName: "ownerOf",
    },
  );
};

const stockContracts = [
  "mockAaplc",
  "mockGooglc",
  "mockMetac",
  "mockNvdac",
] as const;
const adapterContracts = [
  "aaplcConversionAdapter",
  "googlcConversionAdapter",
  "metacConversionAdapter",
  "nvdacConversionAdapter",
] as const;
const conversionPoolByAdapter = {
  aaplcConversionAdapter: "aaplc",
  googlcConversionAdapter: "googlc",
  metacConversionAdapter: "metac",
  nvdacConversionAdapter: "nvdac",
} as const;

class FakeTransport implements ProtocolReadTransport {
  chainId = 31_337;
  block = {
    hash: `0x${"11".repeat(32)}` as const,
    number: 100_500n,
    timestamp: 1_000n,
  };
  revalidatedBlock = this.block;
  pendingFails = false;
  permanentFails = false;
  undiscoveredIdentityIds = new Set<number>();
  ownerReadFails = false;
  permanentFailuresRemaining = 0;
  permanentReadAttempts = 0;
  permanentCandidates: readonly number[] = [];
  permanentBlock: bigint | undefined;
  readBlocks: bigint[] = [];
  permanentActive = true;
  omitSecondaryDetailResults = false;
  invalidMarketState = false;
  liquidBalance = 2n * 10n ** 18n;
  managerBalance = 4_000n * 10n ** 18n;
  accountDiscoveryExempt = false;
  managerDiscoveryExempt = true;
  discoveryHoldingReadFails = false;
  pendingDiscoveryCount = 1n;
  pendingDiscoveryState = 1;
  pendingDiscoveryDelayed = false;
  transientCollectibleCount = 1n;
  quotedAmountOut = 97n;
  quotedFee = 3n;
  recentRange: readonly [bigint, bigint, number] | undefined;
  rewardRange: readonly [bigint, bigint] | undefined;
  rewardHistoryEvents: readonly RewardHistoryEvent[] = [];
  allowanceReads: string[] = [];
  claimGateReads = 0;
  quoteCallers: Array<Address | undefined> = [];

  async getChainId() {
    return this.chainId;
  }

  async getBlock(blockNumber?: bigint) {
    return blockNumber === undefined ? this.block : this.revalidatedBlock;
  }

  async getBytecode() {
    return "0x01" as const;
  }

  private identityIsActive(request: ContractReadRequest): boolean {
    return Number(request.args?.[0]) === 4441 && this.permanentActive;
  }

  private discoveryRead(
    request: ContractReadRequest,
    key: string,
  ): ContractReadResult | undefined {
    const account = String(request.args?.[0]).toLowerCase();
    const isWallet = account === owner.toLowerCase();
    if (key === "fuelCore.balanceOf") {
      return {
        status: "success",
        value: isWallet ? this.liquidBalance : this.managerBalance,
      };
    }
    if (key === "fuelCore.isDiscoveryExempt") {
      return {
        status: "success",
        value: isWallet
          ? this.accountDiscoveryExempt
          : this.managerDiscoveryExempt,
      };
    }
    if (
      this.discoveryHoldingReadFails &&
      (key === "fuelCore.transientCount" ||
        key === "fuelCore.pendingDiscoveryCount")
    ) {
      return { status: "failure", error: new Error("holding read failed") };
    }
    return undefined;
  }

  private pendingRewardRead(key: string): ContractReadResult | undefined {
    if (key !== "rewardLedger.pendingAll") return undefined;
    return this.pendingFails
      ? { status: "failure", error: new Error("rpc") }
      : { status: "success", value: [1n, 2n, 3n, 4n] };
  }

  /** The mirror answers `ownerOf` with a revert for an undrawn identity. */
  private ownerRead(
    request: ContractReadRequest,
    key: string,
  ): ContractReadResult | undefined {
    if (key !== "fuelMirror.ownerOf") return undefined;
    if (this.ownerReadFails) {
      return { status: "failure", error: new Error("rpc") };
    }
    const identityId = Number(request.args?.[0]);
    return this.undiscoveredIdentityIds.has(identityId)
      ? { status: "failure", error: unknownIdentityRevert(identityId) }
      : { status: "success", value: owner };
  }

  private readResult(request: ContractReadRequest): ContractReadResult {
    const key = `${request.contract}.${request.functionName}`;
    this.claimGateReads += Number(key === "claimGate.isClaimAllowed");
    if (request.functionName === "allowance") {
      this.allowanceReads.push(key);
      return { status: "success", value: 77n };
    }
    const routed =
      this.discoveryRead(request, key) ??
      this.ownerRead(request, key) ??
      this.pendingRewardRead(key);
    if (routed !== undefined) return routed;
    const fixedValues = new Map<string, unknown>([
      ["weth.balanceOf", 5n * 10n ** 18n],
      ["fuelCore.transientCount", this.transientCollectibleCount],
      ["fuelCore.pendingDiscoveryCount", this.pendingDiscoveryCount],
      ["fuelCore.pendingDiscoveryAt", `0x${"ab".repeat(32)}`],
      ["discoveryAdapter.vrfRequestForProtocolRequest", 44n],
      ["discoveryAdapter.requestSequence", 3n],
      [
        "discoveryAdapter.requestStatus",
        [this.pendingDiscoveryState, 900n, 0n, 1n, 0n, false],
      ],
      ["discoveryAdapter.isDelayed", this.pendingDiscoveryDelayed],
      ["claimGate.isClaimAllowed", true],
      ["fuelCore.transientIdentityAt", 12n],
      ["fuelCore.isPermanentIdentity", true],
    ]);
    if (fixedValues.has(key)) {
      return { status: "success", value: fixedValues.get(key) };
    }
    if (key === "attributeRegistry.attributeOf") {
      const identityId = Number(request.args?.[0]);
      return {
        status: "success",
        value: identityId === 12 ? [2, 3, 250, 0] : [0, 0, 0, 1],
      };
    }
    if (key === "rewardLedger.isActive") {
      return {
        status: "success",
        value: this.identityIsActive(request),
      };
    }
    throw new Error(`Unhandled read ${key}`);
  }

  async readMany<const Requests extends readonly ContractReadRequest[]>(
    requests: Requests,
    blockNumber: bigint,
  ): Promise<ContractReadResults<Requests>> {
    this.readBlocks.push(blockNumber);
    const results = requests.map((request) => this.readResult(request));
    return (
      this.omitSecondaryDetailResults &&
      requests.some((request) => request.functionName === "attributeOf")
        ? results.map((result, index) =>
            requests[index]?.args?.[0] === 4441 &&
            requests[index]?.functionName !== "attributeOf"
              ? undefined
              : result,
          )
        : results
    ) as ContractReadResults<Requests>;
  }

  async permanentIdentityCandidates(fromBlock: bigint, toBlock: bigint) {
    return {
      identityIds: [4441],
      fromBlock,
      throughBlock: toBlock,
      coverage: "complete" as const,
      indexedThroughTime: this.block.timestamp,
    };
  }

  async permanentIdentityIds(
    _owner: Parameters<ProtocolReadTransport["permanentIdentityIds"]>[0],
    candidates: readonly number[],
    blockNumber: bigint,
  ) {
    this.permanentReadAttempts += 1;
    this.permanentCandidates = candidates;
    this.permanentBlock = blockNumber;
    if (this.permanentFails) throw new Error("ownership RPC unavailable");
    if (this.permanentFailuresRemaining > 0) {
      this.permanentFailuresRemaining -= 1;
      throw new Error("ownership RPC unavailable");
    }
    return candidates;
  }

  async quoteExactInput(
    _liquidTokenForWeth: boolean,
    _amountIn: bigint,
    _blockNumber: bigint,
    caller?: Address,
  ) {
    this.quoteCallers.push(caller);
    return [this.quotedAmountOut, this.quotedFee] as const;
  }

  async canonicalMarketState() {
    return {
      sqrtPriceX96: this.invalidMarketState ? 0n : 1n,
      tick: 0,
      protocolFee: 0,
      lpFee: 0,
      activeLiquidity: 1n,
    };
  }

  async recentOperationalEvents(
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
  ): Promise<OperationalEventWindow> {
    this.recentRange = [fromBlock, toBlock, limit];
    return {
      events: [] as readonly OperationalEvent[],
      trackAttemptCoverage: {
        1: "complete",
        2: "complete",
        3: "complete",
        4: "complete",
      } as const,
      trackAttemptState: {
        1: "fresh",
        2: "fresh",
        3: "fresh",
        4: "fresh",
      } as const,
    };
  }

  async rewardHistory(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RewardHistoryWindow> {
    this.rewardRange = [fromBlock, toBlock];
    return {
      events: this.rewardHistoryEvents,
      fromBlock,
      throughBlock: toBlock,
    };
  }
}

class HealthTransport extends FakeTransport {
  failOneLiability = false;
  mismatchMetadataBinding = false;
  unrecordedPendingOwner = false;
  reachableBlockedVenue = false;
  strangerOwnsClaimGate = false;
  retryTrackThree = false;
  operationsFail = false;
  partialTrackThree = false;
  failConverterSeal = false;
  failQueueThree = false;
  claimScanTruncated = false;
  eventWindowTruncated = false;
  epochCount = 0n;
  rewardHistoryFails = false;
  queueThree = 5n;
  converterWethOffset = 0n;
  converterPaused = false;
  failedReads = new Set<string>();

  private converterSealShouldFail(request: ContractReadRequest): boolean {
    return (
      this.failConverterSeal &&
      request.contract === "epochConverter" &&
      request.functionName === "configurationSealed"
    );
  }

  private queueThreeShouldFail(request: ContractReadRequest): boolean {
    return (
      this.failQueueThree &&
      request.functionName === "trackQueue" &&
      request.args?.[0] === 3
    );
  }

  private liabilityThreeShouldFail(request: ContractReadRequest): boolean {
    return (
      this.failOneLiability &&
      request.functionName === "totalLiability" &&
      request.args?.[0] === 3
    );
  }

  private failureResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    const fn = request.functionName;
    if (this.failedReads.has(`${request.contract}.${fn}`)) {
      return { status: "failure", error: new Error("partial") };
    }
    if (this.converterSealShouldFail(request)) {
      return { status: "failure", error: new Error("partial") };
    }
    if (this.queueThreeShouldFail(request)) {
      return { status: "failure", error: new Error("partial") };
    }
    if (this.liabilityThreeShouldFail(request)) {
      return { status: "failure", error: new Error("partial") };
    }
    return undefined;
  }

  private bindingResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    const fn = request.functionName;
    if (fn === "attributeRegistry") {
      return {
        status: "success",
        value: this.mismatchMetadataBinding
          ? owner
          : manifest.contracts.attributeRegistry,
      };
    }
    if (
      request.contract === "claimGate" &&
      request.functionName === "owner" &&
      this.strangerOwnsClaimGate
    ) {
      return { status: "success", value: stranger };
    }
    const values = new Map<string, unknown>([
      ["totalSupply", 4_444n * 10n ** 18n],
      ["permanentCount", 0],
      ["totalTransientCount", 0],
      ["totalPendingDiscoveryCount", 0n],
      ["availableIdentityCount", 4_444],
      ["manifestCommitment", manifest.identity.manifestHash],
      ["poolId", manifest.canonicalPool.poolId],
      ["owner", manifest.roles.owner],
      // No handover is outstanding in the fixture, which is what the
      // manifest omitting `modulePendingOwners` has to mean.
      [
        "pendingOwner",
        this.unrecordedPendingOwner
          ? stranger
          : "0x0000000000000000000000000000000000000000",
      ],
      ["isBlockedVenueCodehash", !this.reachableBlockedVenue],
      ["core", manifest.contracts.fuelCore],
      ["fuelCore", manifest.contracts.fuelCore],
      ["fuel", manifest.contracts.fuelCore],
      ["manager", manifest.contracts.uniswapV4PoolManager],
      ["registry", manifest.contracts.canonicalMarketRegistry],
      ["liquidToken", manifest.contracts.fuelCore],
      ["guardian", manifest.roles.guardian],
      ["recoveryAuthority", manifest.roles.recoveryAuthority],
      ["keeper", manifest.roles.keeper],
      ["executor", manifest.roles.liquidityExecutor],
      ["rewardLedger", manifest.contracts.rewardLedger],
      ["metadataRenderer", manifest.contracts.metadataRenderer],
      ["claimGate", manifest.contracts.claimGate],
      ["canonicalMarketRegistry", manifest.contracts.canonicalMarketRegistry],
      ["epochConverter", manifest.contracts.epochConverter],
      ["converter", manifest.contracts.epochConverter],
      ["weth", manifest.contracts.weth],
      ["usdc", manifest.contracts.usdc],
      ["venue", manifest.contracts.testConversionVenue],
      ["canonicalFeeHook", manifest.contracts.canonicalFeeHook],
      ["hook", manifest.contracts.canonicalFeeHook],
      ["router", manifest.contracts.canonicalRouter],
      ["rewardDestination", manifest.contracts.epochConverter],
      ["liquidityDestination", manifest.contracts.protocolLiquidityVault],
      ["creatorDestination", manifest.roles.creator],
    ]);
    return values.has(fn)
      ? { status: "success", value: values.get(fn) }
      : undefined;
  }

  private trackConfigurationResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    const fn = request.functionName;
    const requestedTrackIndex = Number(request.args?.[0]) - 1;
    if (fn === "rewardToken") {
      return {
        status: "success",
        value: manifest.contracts[stockContracts[requestedTrackIndex]!],
      };
    }
    if (fn === "trackConfiguration") {
      return {
        status: "success",
        value: [
          manifest.contracts[stockContracts[requestedTrackIndex]!],
          manifest.contracts[adapterContracts[requestedTrackIndex]!],
        ],
      };
    }
    const adapterIndex = adapterContracts.indexOf(
      request.contract as (typeof adapterContracts)[number],
    );
    if (fn === "stockToken") {
      return {
        status: "success",
        value: manifest.contracts[stockContracts[adapterIndex] ?? "mockAaplc"],
      };
    }
    if (fn === "configuredTrack") {
      return { status: "success", value: adapterIndex + 1 };
    }
    return undefined;
  }

  private conversionPoolResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    if (request.functionName === "wethUsdcPoolId") {
      return {
        status: "success",
        value: manifest.conversionPools.wethUsdc?.poolId,
      };
    }
    if (request.functionName === "usdcStockPoolId") {
      const poolName =
        conversionPoolByAdapter[
          request.contract as keyof typeof conversionPoolByAdapter
        ];
      return {
        status: "success",
        value:
          poolName === undefined
            ? undefined
            : manifest.conversionPools[poolName].poolId,
      };
    }
    return undefined;
  }

  private stateFlagResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    const fn = request.functionName;
    if (fn === "TOTAL_FEE_BPS") return { status: "success", value: 300n };
    if (fn === "registered") return { status: "success", value: true };
    if (
      ["isSealed", "configurationSealed", "seeded", "launched"].includes(fn)
    ) {
      return { status: "success", value: true };
    }
    if (["paused", "rewardNotificationsPaused"].includes(fn)) {
      return {
        status: "success",
        value: request.contract === "epochConverter" && this.converterPaused,
      };
    }
    if (fn === "isFrozen") return { status: "success", value: false };
    return undefined;
  }

  private converterWethBalance(account: unknown) {
    if (account !== manifest.contracts.epochConverter) return 0n;
    return this.retryTrackThree
      ? 5n + this.converterWethOffset
      : this.converterWethOffset;
  }

  private accountingResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    const fn = request.functionName;
    if (fn === "balanceOf" && request.contract === "weth") {
      return {
        status: "success",
        value: this.converterWethBalance(request.args?.[0]),
      };
    }
    if (fn === "balanceOf") return { status: "success", value: 100n };
    if (fn === "totalLiability") return { status: "success", value: 90n };
    if (fn === "totalActiveWeight") {
      return { status: "success", value: 160_400n };
    }
    if (fn === "unclaimedTrackPot") {
      return { status: "success", value: 11n };
    }
    return undefined;
  }

  private pendingRewardsResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    if (request.functionName !== "pendingAll") return undefined;
    const identityId = Number(request.args?.[0]);
    return {
      status: "success",
      value: identityId === 4_444 ? [4n, 3n, 2n, 1n] : [1n, 2n, 3n, 4n],
    };
  }

  private operationsResult(
    request: ContractReadRequest,
  ): ContractReadResult | undefined {
    const fn = request.functionName;
    const operationValues = [
      "rewardEpochCount",
      "lastRewardEpochAt",
      "rewardPot",
      "liquidityPot",
      "creatorPot",
      "queuedWeth",
      "permanentlyLockedWeth",
      "liquidityCycleCount",
      "trackQueue",
    ];
    if (!operationValues.includes(fn)) return undefined;
    if (fn === "rewardEpochCount") {
      return { status: "success", value: this.epochCount };
    }
    if (fn === "trackQueue" && request.args?.[0] === 3) {
      return { status: "success", value: this.queueThree };
    }
    return { status: "success", value: 0n };
  }

  private healthReadResult(request: ContractReadRequest): ContractReadResult {
    const result = [
      this.failureResult(request),
      this.bindingResult(request),
      this.trackConfigurationResult(request),
      this.conversionPoolResult(request),
      this.stateFlagResult(request),
      this.accountingResult(request),
      this.pendingRewardsResult(request),
      this.operationsResult(request),
    ].find((candidate) => candidate !== undefined);
    if (result !== undefined) return result;
    throw new Error(
      `Unhandled health read ${request.contract}.${request.functionName}`,
    );
  }

  override async recentOperationalEvents(
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
  ): Promise<OperationalEventWindow> {
    await super.recentOperationalEvents(fromBlock, toBlock, limit);
    if (this.operationsFail) throw new Error("operation scan unavailable");
    return {
      events: this.retryTrackThree
        ? [
            {
              type: "conversion",
              track: 3 as const,
              blockNumber: toBlock,
              transactionHash:
                "0x0000000000000000000000000000000000000000000000000000000000000003" as const,
              successful: false,
              explanation: "failed conversion",
            },
          ]
        : [],
      trackAttemptCoverage: {
        1: "complete",
        2: "complete",
        3: this.partialTrackThree ? "partial" : "complete",
        4: "complete",
      } as const,
      trackAttemptState: {
        1: "fresh",
        2: "fresh",
        3: this.partialTrackThree
          ? "unknown"
          : this.retryTrackThree
            ? "retryable"
            : "fresh",
        4: "fresh",
      } as const,
      claimScanTruncated: this.claimScanTruncated,
      eventWindowTruncated: this.eventWindowTruncated,
    };
  }

  override async rewardHistory(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RewardHistoryWindow> {
    if (this.rewardHistoryFails) throw new Error("reward history unavailable");
    return super.rewardHistory(fromBlock, toBlock);
  }

  override async readMany<
    const Requests extends readonly ContractReadRequest[],
  >(requests: Requests): Promise<ContractReadResults<Requests>> {
    return requests.map((request) =>
      this.healthReadResult(request),
    ) as ContractReadResults<Requests>;
  }
}

class BytecodeConcurrencyHealthTransport extends HealthTransport {
  activeBytecodeReads = 0;
  maximumBytecodeReads = 0;

  override async getBytecode() {
    this.activeBytecodeReads += 1;
    this.maximumBytecodeReads = Math.max(
      this.maximumBytecodeReads,
      this.activeBytecodeReads,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    this.activeBytecodeReads -= 1;
    return "0x01" as const;
  }
}

describe("deep protocol reader", () => {
  it("reads public counts, funds and prices without administrative diagnostics", async () => {
    const transport = new HealthTransport();
    const requests: ContractReadRequest[] = [];
    let bytecodeReads = 0;
    const readMany = transport.readMany.bind(transport);
    transport.readMany = (next) => {
      requests.push(...next);
      return readMany(next);
    };
    transport.getBytecode = async () => {
      bytecodeReads += 1;
      throw new Error("Public status must not inspect bytecode");
    };
    transport.canonicalMarketState = async () => ({
      sqrtPriceX96: 2n ** 96n,
      tick: 0,
      protocolFee: 0,
      lpFee: 0,
      activeLiquidity: 1n,
    });
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });
    const snapshot = await reader.readPublicStatus(1_010, 30);
    expect(snapshot).toMatchObject({
      deployment: {
        network: manifest.network,
        observedBlock: 100_500n,
        observedAt: 1_000,
      },
      collection: {
        permanentCount: 0,
        transientCount: 0,
        pendingDiscoveryCount: 0,
        availableIdentityCount: 4444,
      },
      market: {
        rewardPotWeth: 0n,
        liquidityPotWeth: 0n,
        creatorPotWeth: 0n,
        price: { wethPerLiquidTokenWei: 10n ** 18n },
      },
      operations: {
        rewardEpochCount: 0n,
        rewardHistoryStatus: "complete",
        trackQueues: expect.arrayContaining([
          { track: "METAc", trackId: 3, weth: 5n },
        ]),
      },
      rewards: {
        tracks: expect.arrayContaining([{ track: "METAc", rawLiability: 90n }]),
      },
    });
    expect(
      requests.some(
        (request) =>
          [
            "owner",
            "pendingOwner",
            "keeper",
            "executor",
            "venue",
            "pendingAll",
          ].includes(request.functionName) ||
          request.contract.endsWith("ConversionAdapter"),
      ),
    ).toBe(false);
    expect(transport.recentRange).toBeUndefined();
    expect(bytecodeReads).toBe(0);
  });

  it("keeps missing public observations unknown and can skip reward history", async () => {
    const transport = new HealthTransport();
    transport.failedReads.add("fuelCore.permanentCount");
    transport.failedReads.add("canonicalFeeHook.rewardPot");
    transport.failOneLiability = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });
    const snapshot = await reader.readPublicStatus(1_100, 30, {
      includeRewardHistory: false,
    });
    expect(snapshot.collection.permanentCount).toBeUndefined();
    expect(snapshot.market.rewardPotWeth).toBeUndefined();
    expect(snapshot.rewards.tracks[2]?.rawLiability).toBeUndefined();
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "supply-invariant",
          status: "unknown",
          freshness: "stale",
        }),
        expect.objectContaining({
          id: "reward-solvency:METAc",
          status: "unknown",
        }),
      ]),
    );
    expect(snapshot.operations.rewardHistoryStatus).toBe("unknown");
    expect(transport.rewardRange).toBeUndefined();
  });

  it("rejects public observations whose pinned block was reorged during the read", async () => {
    const transport = new HealthTransport();
    transport.revalidatedBlock = {
      ...transport.block,
      hash: `0x${"22".repeat(32)}`,
    };
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });
    await expect(reader.readPublicStatus(1_010, 30)).rejects.toBeInstanceOf(
      ProtocolQueryError,
    );
  });
  it("requires explicit history and reports missing history as unknown", async () => {
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport: new HealthTransport(),
    });

    await expect(reader.readRecentOperations()).rejects.toBeInstanceOf(
      ProtocolQueryError,
    );
    await expect(
      reader.readHealth(undefined, 1_010, 30),
    ).resolves.toMatchObject({
      operations: { historyStatus: "unknown", rewardHistoryStatus: "unknown" },
    });
  });

  it("assembles collection and reward queries while tolerating a secondary RPC failure", async () => {
    const transport = new FakeTransport();
    transport.pendingFails = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const wallet = await reader.readWallet(owner);

    expect(wallet.collectibles.transient[0]?.identityId).toBe(12);
    expect(wallet.settlementToken.formatted).toBe("5");
    expect(wallet.collectibles.permanent[0]?.identityId).toBe(4441);
    expect(wallet.collectibles.permanentHoldingsStatus).toBe("complete");
    expect(wallet.collectibles.pendingDiscovery.count).toBe(1);
    expect(wallet.partialFailures).toHaveLength(2);
    expect(
      wallet.collectibles.permanent[0]?.pendingRewards[0]?.rawTokenUnits,
    ).toBe(0n);
    expect(wallet.collectibles.permanent[0]?.claimEligible).toBe(true);
  });

  it("reads independent wallet evidence within three network stages while preserving both block identities", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeTransport();
      transport.pendingDiscoveryCount = 0n;
      const networkLatency = () =>
        new Promise((resolve) => setTimeout(resolve, 100));
      const readMany = transport.readMany.bind(transport);
      transport.readMany = async (requests, blockNumber) => {
        await networkLatency();
        return (await readMany(requests, blockNumber)).map((result, index) => {
          const request = requests[index];
          const current = blockNumber === 100_500n;
          if (request?.functionName === "transientCount") {
            return { status: "success", value: current ? 1n : 0n };
          }
          if (request?.functionName !== "balanceOf") return result;
          return {
            status: "success",
            value:
              request.contract === "weth"
                ? current
                  ? 93_000_000_000_000_000n
                  : 100_000_000_000_000_000n
                : current
                  ? 1_173_097_920_514_834_959n
                  : 0n,
          };
        }) as ContractReadResults<typeof requests>;
      };
      const permanentIdentityIds =
        transport.permanentIdentityIds.bind(transport);
      transport.permanentIdentityIds = async (...args) => {
        await networkLatency();
        return permanentIdentityIds(...args);
      };
      let historyRequests = 0;
      const history: Pick<
        ProtocolHistoryReader,
        "permanentIdentityCandidates"
      > = {
        permanentIdentityCandidates: async (fromBlock, toBlock) => {
          historyRequests += 1;
          await networkLatency();
          return {
            identityIds: [1493],
            fromBlock,
            throughBlock: toBlock - 2n,
            coverage: "partial",
            indexedThroughTime: 998n,
          };
        },
      };
      const reader = createProtocolReader({
        manifest,
        identity: selectIdentityConfiguration("orbit-4444"),
        history,
        transport,
      });

      let completed = false;
      const walletRead = reader.readWallet(owner).then((wallet) => {
        completed = true;
        return wallet;
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(completed).toBe(true);
      const wallet = await walletRead;

      expect(historyRequests).toBe(1);
      expect(transport.readBlocks).toHaveLength(5);
      expect(transport.permanentReadAttempts).toBe(1);
      expect(transport.permanentCandidates).toEqual([1493]);
      expect(transport.permanentBlock).toBe(100_498n);
      expect(wallet.observedBlock).toBe(100_500n);
      expect(wallet.observedAt).toBe(1_000);
      expect(wallet.liquidToken.rawWei).toBe(1_173_097_920_514_834_959n);
      expect(wallet.settlementToken.rawWei).toBe(93_000_000_000_000_000n);
      expect(new Set(transport.readBlocks)).toEqual(
        new Set([100_498n, 100_500n]),
      );
      expect(wallet.collectibles).toMatchObject({
        permanentHoldingsStatus: "complete",
        permanentObservedBlock: 100_498n,
        permanentObservedAt: 998,
      });
      expect(wallet.collectibles.permanent[0]?.identityId).toBe(1493);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it("preserves balances and enumerable holdings when permanent history is unavailable", async () => {
    const transport = new FakeTransport();
    transport.permanentFails = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const wallet = await reader.readWallet(owner);

    expect(wallet.liquidToken.formatted).toBe("2");
    expect(wallet.settlementToken.formatted).toBe("5");
    expect(wallet.collectibles.transient[0]?.identityId).toBe(12);
    expect(wallet.collectibles.permanent).toEqual([]);
    expect(wallet.collectibles.permanentHoldingsStatus).toBe("unavailable");
    expect(wallet.partialFailures).toEqual([
      expect.stringContaining("Permanent ORBIT 4444 Collectibles"),
    ]);
  });

  it("reads a known permanent identity directly when collection history is unavailable", async () => {
    const transport = new FakeTransport();
    transport.permanentFails = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const result = await reader.readCollectible(4_441);

    expect(result).toMatchObject({
      owner,
      permanent: true,
      observedBlock: 100_500n,
      collectible: {
        identityId: 4_441,
        claimEligible: true,
        pendingRewardsStatus: "observed",
      },
    });
    expect(transport.permanentReadAttempts).toBe(0);
  });

  it("reports an identity that was never discovered instead of failing", async () => {
    const transport = new FakeTransport();
    transport.undiscoveredIdentityIds.add(4_242);
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const result = await reader.readCollectible(4_242);

    // The mirror's revert is an observation about the available pool, so the
    // page can say so instead of offering a retry that can never succeed.
    expect(result).toEqual({
      status: "not-discovered",
      identityId: 4_242,
      observedAt: 1_000,
      observedBlock: 100_500n,
      partialFailures: [],
    });
  });

  it("marks a discovered identity read as discovered", async () => {
    const transport = new FakeTransport();
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const result = await reader.readCollectible(4_441);

    expect(result).toMatchObject({
      status: "discovered",
      identityId: 4_441,
      owner,
      permanent: true,
    });
  });

  it("still fails a direct identity read when the owner read is a transport failure", async () => {
    const transport = new FakeTransport();
    transport.ownerReadFails = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(reader.readCollectible(4_242)).rejects.toBeInstanceOf(
      ProtocolQueryError,
    );
  });

  it("does not call a per-wallet claim gate for an always-allow deployment", async () => {
    const transport = new FakeTransport();
    const reader = createProtocolReader({
      manifest: {
        ...manifest,
        claimPolicy: {
          mode: "always-allow",
          implementationCodehash: `0x${"12".repeat(32)}`,
          administrator: "0x0000000000000000000000000000000000000000",
        },
      },
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const wallet = await reader.readWallet(owner);

    expect(wallet.collectibles.permanent[0]?.claimEligible).toBe(true);
    expect(transport.claimGateReads).toBe(0);
  });

  it("recovers a transient permanent-membership read without requiring a UI retry", async () => {
    const transport = new FakeTransport();
    transport.permanentFailuresRemaining = 1;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const wallet = await reader.readWallet(owner);

    expect(transport.permanentReadAttempts).toBe(2);
    expect(wallet.collectibles.permanentHoldingsStatus).toBe("complete");
    expect(wallet.collectibles.permanent[0]?.identityId).toBe(4441);
  });

  it("does not infer claim eligibility from permanence and the wallet gate alone", async () => {
    const transport = new FakeTransport();
    transport.permanentActive = false;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const wallet = await reader.readWallet(owner);

    expect(wallet.collectibles.permanent[0]?.claimEligible).toBe(false);
  });

  it("provides public quotes and bounded operational scans without a wallet", async () => {
    const transport = new FakeTransport();
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
      recentEventBlockWindow: 500n,
      recentEventLimit: 25,
    });

    await expect(reader.quoteExactInput(true, 100n)).resolves.toMatchObject({
      amountOut: 97n,
      tradingFee: 3n,
      observedBlock: 100_500n,
      expiresAtBlock: 100_530n,
    });
    expect(transport.quoteCallers).toEqual([undefined]);
    await reader.readRecentOperations();
    expect(transport.recentRange).toEqual([100_001n, 100_500n, 25]);
  });

  it("marks a wallet-bound buy quote as structurally impossible before submission", async () => {
    const transport = new FakeTransport();
    transport.liquidBalance = 833_929_404_331_779_245_120n;
    const maximumLiquidTokenAmount =
      65n * 10n ** 18n - (transport.liquidBalance % 10n ** 18n) - 1n;
    transport.pendingDiscoveryCount = 833n;
    transport.transientCollectibleCount = 0n;
    transport.quotedAmountOut = 107_750_806_090_999_699_498n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.quoteExactInput(false, 1n * 10n ** 18n, owner),
    ).resolves.toMatchObject({
      amountOut: 107_750_806_090_999_699_498n,
      observedBlock: 100_500n,
      discovery: {
        account: owner,
        sender: {
          account: manifest.contracts.uniswapV4PoolManager,
          balance: 4_000n * 10n ** 18n,
          discoveryExempt: true,
          mutations: 0,
        },
        recipient: {
          account: owner,
          balance: transport.liquidBalance,
          discoveryExempt: false,
          mutations: 108,
        },
        mutations: 108,
        maximumMutations: 64,
        executable: false,
        maximumLiquidTokenAmount,
      },
    });
    expect(transport.readBlocks.at(-1)).toBe(100_500n);
    expect(transport.quoteCallers).toEqual([owner]);
  });

  it("fails a wallet-bound quote closed when its block identity changes during discovery reads", async () => {
    const transport = new FakeTransport();
    transport.revalidatedBlock = {
      ...transport.block,
      hash: `0x${"22".repeat(32)}`,
    };
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.quoteExactInput(false, 1n * 10n ** 18n, owner),
    ).rejects.toMatchObject({
      name: "ProtocolQueryError",
      operation: "Canonical Market quote block",
    });
  });

  it("pins sell-side sender and recipient discovery evidence to the quote block", async () => {
    const transport = new FakeTransport();
    transport.liquidBalance = 65_250_000_000_000_000_000n;
    transport.pendingDiscoveryCount = 40n;
    transport.transientCollectibleCount = 25n;
    transport.quotedAmountOut = 1n * 10n ** 18n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.quoteExactInput(true, 64_250_000_000_000_000_000n, owner),
    ).resolves.toMatchObject({
      discovery: {
        account: owner,
        accountHoldings: {
          pendingDiscoveryCount: 40,
          transientCollectibleCount: 25,
        },
        sender: {
          account: owner,
          balance: 65_250_000_000_000_000_000n,
          discoveryExempt: false,
          mutations: 64,
        },
        recipient: {
          account: manifest.contracts.uniswapV4PoolManager,
          balance: 4_000n * 10n ** 18n,
          discoveryExempt: true,
          mutations: 0,
        },
        mutations: 64,
        executable: true,
        maximumLiquidTokenAmount: 64_250_000_000_000_000_000n,
      },
    });
    expect(transport.readBlocks.at(-1)).toBe(100_500n);
  });

  it("fails a wallet-bound quote closed when pinned holding evidence is incomplete", async () => {
    const transport = new FakeTransport();
    transport.discoveryHoldingReadFails = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.quoteExactInput(false, 1n * 10n ** 18n, owner),
    ).rejects.toMatchObject({
      name: "ProtocolQueryError",
      operation: "Wallet summary",
    });
    expect(transport.readBlocks.at(-1)).toBe(100_500n);
  });

  it("honors both onchain exemption flags instead of assuming a wallet boundary", async () => {
    const transport = new FakeTransport();
    transport.accountDiscoveryExempt = true;
    transport.pendingDiscoveryCount = 0n;
    transport.transientCollectibleCount = 0n;
    transport.quotedAmountOut = 107n * 10n ** 18n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.quoteExactInput(false, 1n * 10n ** 18n, owner),
    ).resolves.toMatchObject({
      discovery: {
        sender: { discoveryExempt: true, mutations: 0 },
        recipient: { discoveryExempt: true, mutations: 0 },
        mutations: 0,
        executable: true,
        maximumLiquidTokenAmount: 4_000n * 10n ** 18n,
      },
    });
  });

  it("fails a wallet-bound quote closed on a truthy-string exemption response", async () => {
    const transport = new FakeTransport();
    (
      transport as unknown as {
        accountDiscoveryExempt: unknown;
      }
    ).accountDiscoveryExempt = "false";
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.quoteExactInput(false, 1n * 10n ** 18n, owner),
    ).rejects.toMatchObject({
      name: "ProtocolQueryError",
      operation: "Wallet summary",
    });
  });

  it("reads exchange allowances through the typed application reader", async () => {
    const transport = new FakeTransport();
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(reader.readExchangeAllowance(owner, true)).resolves.toEqual({
      amount: 77n,
      observedBlock: 100_500n,
    });
    await expect(reader.readExchangeAllowance(owner, false)).resolves.toEqual({
      amount: 77n,
      observedBlock: 100_500n,
    });
    expect(transport.allowanceReads).toEqual([
      "fuelCore.allowance",
      "weth.allowance",
    ]);
  });

  it("marks missing secondary multicall slots as partial wallet data", async () => {
    const transport = new FakeTransport();
    transport.omitSecondaryDetailResults = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const wallet = await reader.readWallet(owner);

    expect(wallet.partialFailures).toHaveLength(2);
    expect(wallet.collectibles.permanent[0]?.claimEligible).toBe(false);
    expect(
      wallet.collectibles.permanent[0]?.pendingRewards.every(
        (reward) => reward.rawTokenUnits === 0n,
      ),
    ).toBe(true);
  });

  it("takes visible market copy from the manifest-selected identity adapter", async () => {
    const transport = new FakeTransport();
    const neutralManifest = {
      ...manifest,
      identity: { ...manifest.identity, key: "neutral-test" as const },
    };
    const reader = createProtocolReader({
      manifest: neutralManifest,
      identity: selectIdentityConfiguration("neutral-test"),
      transport,
      history: transport,
    });

    await expect(reader.quoteExactInput(true, 100n)).resolves.toMatchObject({
      marketLabel: "Primary Market",
    });
  });

  it("uses identity-adapter role labels in visible health explanations", async () => {
    const neutralManifest = {
      ...manifest,
      identity: { ...manifest.identity, key: "neutral-test" as const },
    };
    const reader = createProtocolReader({
      manifest: neutralManifest,
      identity: selectIdentityConfiguration("neutral-test"),
      transport: new HealthTransport(),
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);
    const ledgerOwner = snapshot.health.checks.find(
      (check) => check.id === "binding:role.ledgerOwner",
    );
    const marketLiquidToken = snapshot.health.checks.find(
      (check) => check.id === "binding:market.fuel",
    );

    expect(ledgerOwner?.explanation).toContain(
      "Distribution Ledger Administrator",
    );
    expect(ledgerOwner?.explanation).not.toContain("ledgerOwner");
    expect(marketLiquidToken?.explanation).toContain("Primary Market");
    expect(marketLiquidToken?.explanation).toContain("Test Liquid Token");
    expect(marketLiquidToken?.explanation).not.toContain("market.fuel");
    const liquidTokenBytecode = snapshot.health.checks.find(
      (check) => check.id === "bytecode:fuelCore",
    );
    expect(liquidTokenBytecode?.explanation).toContain("Test Liquid Token");
    expect(liquidTokenBytecode?.explanation).not.toContain("fuelCore");
  });

  it("bounds concurrent bytecode reads for public RPC providers", async () => {
    const transport = new BytecodeConcurrencyHealthTransport();
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await reader.readHealth(undefined, 1_010, 30);

    expect(transport.maximumBytecodeReads).toBeLessThanOrEqual(4);
  });

  it("keeps an observed zero track queue healthy without historical attempt coverage", async () => {
    const transport = new HealthTransport();
    transport.partialTrackThree = true;
    transport.queueThree = 0n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);
    const trackThree = snapshot.health.checks.find(
      (check) => check.id === "track:3",
    );

    expect(trackThree?.status).toBe("pass");
    expect(trackThree?.observed).toBe("queue clear");
  });

  it("gives an observed zero queue precedence over stale retryable history", async () => {
    const transport = new HealthTransport();
    transport.retryTrackThree = true;
    transport.queueThree = 0n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);
    const trackThree = snapshot.health.checks.find(
      (check) => check.id === "track:3",
    );

    expect(trackThree?.status).toBe("pass");
    expect(trackThree?.observed).toBe("queue clear");
  });

  it("fails public and wallet reads on the wrong chain", async () => {
    const transport = new FakeTransport();
    transport.chainId = 1;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(reader.readWallet(owner)).rejects.toBeInstanceOf(
      ProtocolQueryError,
    );
  });

  it("builds public health and derives wallet capabilities only from observed roles", async () => {
    const transport = new HealthTransport();
    transport.failOneLiability = true;
    transport.retryTrackThree = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const publicHealth = await reader.readHealth(undefined, 1_010, 30);
    expect(publicHealth.capabilities).toMatchObject({
      connected: false,
      owner: false,
      keeper: false,
    });
    expect(publicHealth.collection).toMatchObject({
      liquidSupplyFormatted: "4444",
      permanentCount: 0,
      pendingDiscoveryCount: 0,
      availableIdentityCount: 4_444,
    });
    expect(publicHealth.deployment).toMatchObject({
      expectedChainId: 31_337,
      observedChainId: 31_337,
      observedBlock: 100_500n,
      launched: true,
      seals: {
        attributes: true,
        canonicalMarket: true,
        conversionRoutes: true,
        feeDestinations: true,
        genesisLiquidity: true,
      },
    });
    expect(publicHealth.transactionReadAvailability).toMatchObject({
      launched: true,
      conversionConfigurationSealed: true,
      liquidityConfigurationSealed: true,
      rewardPot: true,
      nextRewardEpoch: true,
      trackQueues: { 1: true, 2: true, 3: true, 4: true },
    });
    expect(publicHealth.health.status).toBe("degraded");
    expect(publicHealth.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "value:chainId", status: "pass" }),
        expect.objectContaining({
          id: "reward-accounting:1",
          status: "pass",
        }),
        expect.objectContaining({
          id: "liquidity:locked-position",
          status: "pass",
        }),
        expect.objectContaining({ id: "rpc:0", status: "unknown" }),
        expect.objectContaining({ id: "supply-invariant", status: "pass" }),
        expect.objectContaining({
          id: "reward-solvency:METAc",
          status: "unknown",
        }),
      ]),
    );

    const keeperHealth = await reader.readHealth(
      manifest.roles.keeper as `0x${string}`,
      1_010,
      30,
    );
    expect(keeperHealth.capabilities.keeper).toBe(true);
    expect(keeperHealth.operations.trackQueues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          track: "METAc",
          weth: 5n,
          status: "retryable",
          canConnectedWalletExecute: true,
        }),
      ]),
    );
    expect(keeperHealth.operations.deferredTrackBudgets).toEqual([
      expect.objectContaining({ track: "METAc", weth: 5n }),
    ]);
    expect(keeperHealth.rewards.tracks[2]).toMatchObject({
      track: "METAc",
      status: "unknown",
      rawTokenBalance: undefined,
      rawLiability: undefined,
      solvent: undefined,
      activeWeight: 160_400n,
      unclaimedTrackPot: 11n,
      basketRelicPot: 9n,
      indicatorRelicPot: 2n,
    });
    expect(keeperHealth.connectedWalletFrozen).toBe(false);
    expect(keeperHealth.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "track:3",
          status: "fail",
          severity: "warning",
        }),
        expect.objectContaining({ id: "track:1", status: "pass" }),
      ]),
    );
  });

  it("reads reward history from launch independently of the bounded operations window", async () => {
    const transport = new HealthTransport();
    transport.epochCount = 1n;
    transport.rewardHistoryEvents = [
      {
        type: "reward-epoch",
        blockNumber: BigInt(manifest.launch.blockNumber) + 1n,
        logIndex: 0,
        transactionHash: `0x${"0".repeat(64)}`,
        transactionIndex: 0,
        epoch: {
          epochNumber: 1n,
          openedWeth: 40n,
          equalTrackShare: 10n,
          finalTrackRemainder: 0n,
        },
      },
    ];
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.operations.recentEvents).toEqual([]);
    expect(snapshot.operations.rewardHistory).toHaveLength(1);
    expect(snapshot.operations.rewardHistoryStatus).toBe("complete");
    expect(transport.rewardRange).toEqual([
      BigInt(manifest.launch.blockNumber),
      transport.block.number,
    ]);
  });

  it("marks reward history partial instead of claiming no epochs when counts disagree", async () => {
    const transport = new HealthTransport();
    transport.epochCount = 1n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(
      reader.readHealth(undefined, 1_010, 30),
    ).resolves.toMatchObject({
      operations: {
        rewardEpochCount: 1n,
        rewardHistory: [],
        rewardHistoryStatus: "partial",
      },
    });
  });

  it("honors explicit indexed coverage even when observed epoch counts match", async () => {
    const transport = new HealthTransport();
    transport.epochCount = 1n;
    const indexedHistory: Pick<ProtocolHistoryReader, "rewardHistory"> = {
      rewardHistory: async (fromBlock, toBlock) => ({
        events: [
          {
            type: "reward-epoch",
            blockNumber: fromBlock,
            logIndex: 0,
            transactionHash: `0x${"1".repeat(64)}`,
            transactionIndex: 0,
            epoch: {
              epochNumber: 1n,
              openedWeth: 40n,
              equalTrackShare: 10n,
              finalTrackRemainder: 0n,
            },
          },
        ],
        fromBlock,
        throughBlock: toBlock - 1n,
        coverage: "partial",
      }),
    };
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: indexedHistory,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.operations.rewardHistory).toHaveLength(1);
    expect(snapshot.operations.rewardHistoryStatus).toBe("partial");
    expect(snapshot.operations.historyStatus).toBe("unknown");
  });

  it("uses indexed public operations while preserving unknown attempt coverage", async () => {
    const transport = new HealthTransport();
    const indexedHistory: Pick<
      ProtocolHistoryReader,
      "recentOperationalEvents"
    > = {
      recentOperationalEvents: async (_fromBlock, toBlock) => ({
        events: [
          {
            type: "track-execution-unknown",
            track: 2,
            blockNumber: toBlock,
            transactionHash: `0x${"2".repeat(64)}`,
            successful: true,
            explanation: "Indexed success with no failed-call evidence",
          },
        ],
        trackAttemptCoverage: {
          1: "partial",
          2: "partial",
          3: "partial",
          4: "partial",
        },
        trackAttemptState: {
          1: "unknown",
          2: "unknown",
          3: "unknown",
          4: "unknown",
        },
        failureScanTruncated: true,
      }),
    };
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: indexedHistory,
    });

    const window = await reader.readRecentOperations();

    expect(window.events[0]).toMatchObject({
      type: "track-execution-unknown",
      track: 2,
    });
    expect(window.trackAttemptState[2]).toBe("unknown");
    expect(transport.recentRange).toBeUndefined();
  });

  it("accepts a confirmation-lagged reward prefix when point reads prove it complete", async () => {
    const transport = new HealthTransport();
    transport.epochCount = 1n;
    transport.queueThree = 0n;
    const blockNumber = BigInt(manifest.launch.blockNumber);
    const transactionHash = `0x${"2".repeat(64)}` as const;
    const indexedHistory: Pick<ProtocolHistoryReader, "rewardHistory"> = {
      rewardHistory: async (fromBlock, toBlock) => ({
        events: [
          {
            type: "reward-epoch",
            blockNumber,
            logIndex: 0,
            transactionHash,
            transactionIndex: 0,
            epoch: {
              epochNumber: 1n,
              openedWeth: 400n,
              equalTrackShare: 100n,
              finalTrackRemainder: 0n,
            },
          },
          ...([1, 2, 3, 4] as const).map((track, index) => ({
            type: "track-conversion" as const,
            blockNumber,
            logIndex: index + 1,
            transactionHash,
            transactionIndex: 0,
            track,
            conversion: {
              spentWeth: 100n,
              stockReceived: 100n,
              remainingQueue: 0n,
            },
          })),
        ],
        fromBlock,
        throughBlock: toBlock - 1n,
        coverage: "partial",
      }),
    };
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: indexedHistory,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.operations.rewardHistoryStatus).toBe("complete");
  });

  it("reconciles accumulated epochs with one capped conversion and a remaining queue", async () => {
    const transport = new HealthTransport();
    transport.epochCount = 2n;
    transport.queueThree = 50n;
    transport.converterWethOffset = 50n;
    const blockNumber = BigInt(manifest.launch.blockNumber);
    const transactionHash = `0x${"3".repeat(64)}` as const;
    const indexedHistory: Pick<ProtocolHistoryReader, "rewardHistory"> = {
      rewardHistory: async (fromBlock, toBlock) => ({
        events: [
          ...([1n, 2n] as const).map((epochNumber, index) => ({
            type: "reward-epoch" as const,
            blockNumber: blockNumber + BigInt(index),
            logIndex: index,
            transactionHash,
            transactionIndex: 0,
            epoch: {
              epochNumber,
              openedWeth: 400n,
              equalTrackShare: 100n,
              finalTrackRemainder: 0n,
            },
          })),
          ...([1, 2, 3, 4] as const).map((track, index) => ({
            type: "track-conversion" as const,
            blockNumber: blockNumber + 2n,
            logIndex: index + 2,
            transactionHash,
            transactionIndex: 0,
            track,
            conversion: {
              spentWeth: track === 3 ? 150n : 200n,
              stockReceived: 100n,
              remainingQueue: track === 3 ? 50n : 0n,
            },
          })),
        ],
        fromBlock,
        throughBlock: toBlock - 1n,
        coverage: "partial",
      }),
    };
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: indexedHistory,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.operations.rewardEpochCount).toBe(2n);
    expect(snapshot.operations.trackQueues[2]?.weth).toBe(50n);
    expect(snapshot.operations.rewardHistoryStatus).toBe("complete");
  });

  it("skips expensive histories when a lightweight health consumer opts out", async () => {
    const transport = new HealthTransport();
    transport.operationsFail = true;
    transport.rewardHistoryFails = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30, {
      includeOperationalHistory: false,
      includeRewardHistory: false,
    });

    expect(transport.recentRange).toBeUndefined();
    expect(transport.rewardRange).toBeUndefined();
    expect(snapshot.operations.historyStatus).toBe("unknown");
    expect(snapshot.operations.rewardHistoryStatus).toBe("unknown");
    expect(snapshot.health.rpcFailures).toEqual([]);
  });

  it("returns the bounded event window alongside last-success and failure summaries", async () => {
    const transport = new HealthTransport();
    transport.retryTrackThree = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const operations = await reader.readOperationalStatus();

    expect(operations.events).toHaveLength(1);
    expect(operations.events[0]).toMatchObject({
      track: 3,
      successful: false,
    });
    expect(operations.trackOutcomes[3].latest).toMatchObject({
      successful: false,
    });
  });

  it("reports a deployment binding mismatch from independently observed addresses", async () => {
    const transport = new HealthTransport();
    transport.mismatchMetadataBinding = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "binding:metadata.attributeRegistry",
          status: "fail",
        }),
      ]),
    );
  });

  it("fails health when a module carries an ownership nomination the manifest never recorded", async () => {
    const transport = new HealthTransport();
    // Whoever holds a nomination takes the module by calling acceptOwnership.
    // Checking owner() alone cannot see that, so an offer to an address no
    // review ever approved would otherwise sit on chain unreported.
    transport.unrecordedPendingOwner = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.health.status).toBe("critical");
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "binding:pendingOwner.liquidToken",
          status: "fail",
        }),
        expect.objectContaining({
          id: "binding:pendingOwner.protocolLiquidityVault",
          status: "fail",
        }),
      ]),
    );
  });

  it("fails health when the claim gate is owned by someone other than the recorded administrator", async () => {
    const transport = new HealthTransport();
    transport.strangerOwnsClaimGate = true;
    const guardedManifest = {
      ...manifest,
      claimPolicy: {
        mode: "configurable" as const,
        implementationCodehash: `0x${"b".repeat(64)}`,
        administrator: manifest.roles.owner,
      },
    } as typeof manifest;
    const reader = createProtocolReader({
      manifest: guardedManifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    // The administrator can deny or approve every collector's claim, so a
    // gate owned by an unrecorded address is a critical finding, not a detail.
    expect(snapshot.health.status).toBe("critical");
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claimPolicyAdministratorBinding",
          status: "fail",
        }),
      ]),
    );
  });

  it("fails health when a claim-gate ownership nomination is outstanding", async () => {
    const transport = new HealthTransport();
    transport.unrecordedPendingOwner = true;
    const guardedManifest = {
      ...manifest,
      claimPolicy: {
        mode: "configurable" as const,
        implementationCodehash: `0x${"b".repeat(64)}`,
        administrator: manifest.roles.owner,
      },
    } as typeof manifest;
    const reader = createProtocolReader({
      manifest: guardedManifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claimPolicyPendingAdministrator",
          status: "fail",
        }),
      ]),
    );
  });

  it("fails health when a venue the manifest recorded as blocked is reachable on chain", async () => {
    const transport = new HealthTransport();
    transport.reachableBlockedVenue = true;
    const guardedManifest = {
      ...manifest,
      blockedVenues: [
        {
          label: "uniswap-v3-position-manager",
          codehash: `0x${"a".repeat(64)}`,
        },
      ],
    } as typeof manifest;
    const reader = createProtocolReader({
      manifest: guardedManifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    // The blocklist is frozen at launch, so this cannot be repaired in place:
    // the deployment is simply not the one the manifest describes.
    expect(snapshot.health.status).toBe("critical");
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "blockedVenue:uniswap-v3-position-manager",
          status: "fail",
        }),
      ]),
    );
  });

  it("passes the inventory check when every recorded venue is still blocked", async () => {
    const guardedManifest = {
      ...manifest,
      blockedVenues: [
        {
          label: "uniswap-v3-position-manager",
          codehash: `0x${"a".repeat(64)}`,
        },
      ],
    } as typeof manifest;
    const reader = createProtocolReader({
      manifest: guardedManifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport: new HealthTransport(),
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "blockedVenue:uniswap-v3-position-manager",
          status: "pass",
        }),
      ]),
    );
  });

  it("fails only the mismatched queue reconciliation and reports pauses as warnings", async () => {
    const transport = new HealthTransport();
    transport.converterWethOffset = 1n;
    transport.converterPaused = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.health.status).toBe("critical");
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "accounting:reward-queue-backing",
          status: "fail",
          expected: "balance >= 5",
          observed: "balance 1; shortfall 4",
        }),
        expect.objectContaining({
          id: "accounting:fee-pot-backing",
          status: "pass",
        }),
        expect.objectContaining({
          id: "accounting:liquidity-queue-backing",
          status: "pass",
        }),
        expect.objectContaining({
          id: "pause:converter",
          status: "fail",
          severity: "warning",
          observed: "paused",
        }),
      ]),
    );
  });

  it("reports unsolicited WETH as excess backing instead of a critical mismatch", async () => {
    const transport = new HealthTransport();
    transport.retryTrackThree = true;
    transport.converterWethOffset = 1n;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "accounting:reward-queue-backing",
          status: "pass",
          expected: "balance >= 5",
          observed: "balance 6; excess 1",
        }),
      ]),
    );
  });

  it("degrades public health when the canonical market state is invalid", async () => {
    const transport = new HealthTransport();
    transport.invalidMarketState = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(snapshot.market.price).toBeUndefined();
    expect(snapshot.health.status).toBe("critical");
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^rpc:/) }),
      ]),
    );
  });

  it("surfaces unavailable transaction preconditions instead of exposing fallbacks as observed", async () => {
    const transport = new HealthTransport();
    transport.failConverterSeal = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(undefined, 1_010, 30);

    expect(
      snapshot.transactionReadAvailability.conversionConfigurationSealed,
    ).toBe(false);
    expect(snapshot.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seal:conversionRoutes",
          status: "unknown",
        }),
      ]),
    );
  });

  it("returns undefined instead of fallback domain values for failed health reads", async () => {
    const transport = new HealthTransport();
    transport.failedReads = new Set([
      "fuelCore.totalSupply",
      "fuelCore.owner",
      "fuelCore.paused",
      "attributeRegistry.manifestCommitment",
      "attributeRegistry.isSealed",
      "canonicalFeeHook.rewardPot",
      "epochConverter.rewardEpochCount",
      "protocolLiquidityVault.queuedWeth",
    ]);
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(
      manifest.roles.owner as `0x${string}`,
      1_010,
      30,
    );

    expect(snapshot.collection.liquidSupplyWei).toBeUndefined();
    expect(snapshot.collection.liquidSupplyFormatted).toBeUndefined();
    expect(snapshot.roles.owners.liquidToken).toBeUndefined();
    expect(snapshot.capabilities.ownerModules.liquidToken).toBe(false);
    expect(snapshot.deployment.manifestCommitment).toBeUndefined();
    expect(snapshot.deployment.seals.attributes).toBeUndefined();
    expect(snapshot.market.rewardPotWeth).toBeUndefined();
    expect(snapshot.market.rewardPotWethFormatted).toBeUndefined();
    expect(snapshot.operations.rewardEpochCount).toBeUndefined();
    expect(snapshot.operations.nextRewardEpochAt).toBeUndefined();
    expect(
      snapshot.operations.protocolOwnedLiquidity.queuedWeth,
    ).toBeUndefined();
    expect(snapshot.pauses.liquidToken).toBeUndefined();
    expect(
      snapshot.health.checks
        .filter((check) => check.id.startsWith("rpc:"))
        .every(
          (check) =>
            !check.observed?.includes("fuelOwner") &&
            !check.observed?.includes("adapter1StockPool"),
        ),
    ).toBe(true);
  });

  it("surfaces truncated claim and event history in operational summaries and health", async () => {
    const transport = new HealthTransport();
    transport.claimScanTruncated = true;
    transport.eventWindowTruncated = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    await expect(reader.readOperationalStatus()).resolves.toMatchObject({
      claimScanTruncated: true,
      eventWindowTruncated: true,
    });
    await expect(
      reader.readHealth(undefined, 1_010, 30),
    ).resolves.toMatchObject({ operations: { historyStatus: "partial" } });
  });

  it("fails queued-track classification closed when operation history is unavailable", async () => {
    const transport = new HealthTransport();
    transport.operationsFail = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(
      manifest.roles.keeper as `0x${string}`,
      1_010,
      30,
    );

    expect(snapshot.operations.historyStatus).toBe("unknown");
    expect(snapshot.operations.trackQueues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          track: "METAc",
          status: "unknown",
          deferred: undefined,
          canConnectedWalletExecute: false,
        }),
      ]),
    );
    expect(snapshot.operations.deferredTrackBudgets).toEqual([]);
  });

  it("keeps event history observed while failed-attempt coverage is partial", async () => {
    const transport = new HealthTransport();
    transport.partialTrackThree = true;
    const reader = createProtocolReader({
      manifest,
      identity: selectIdentityConfiguration("orbit-4444"),
      transport,
      history: transport,
    });

    const snapshot = await reader.readHealth(
      manifest.roles.keeper as `0x${string}`,
      1_010,
      30,
    );

    expect(snapshot.operations.historyStatus).toBe("observed");
    expect(snapshot.operations.trackQueues[2]).toMatchObject({
      track: "METAc",
      status: "unknown",
      attemptHistoryAvailable: false,
      deferred: undefined,
      canConnectedWalletExecute: false,
    });
  });
});
