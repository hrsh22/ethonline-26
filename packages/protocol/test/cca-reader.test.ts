import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import {
  decodeProtocolDeploymentManifest,
  type ProtocolDeploymentManifest,
} from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  createProtocolReader,
  type ContractReadRequest,
  type ContractReadResult,
  type ContractReadResults,
  type ProtocolReadTransport,
} from "../src/reader.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const beneficiary = address("beef");
const escrow = address("cafe");

const legacyManifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);

const ccaManifest = (() => {
  const source = structuredClone(legacyManifest) as unknown as Record<
    string,
    unknown
  >;
  const contracts = source.contracts as Record<string, unknown>;
  delete contracts.genesisLiquidityVault;
  Object.assign(contracts, {
    ccaBidEscrowFactory: address("a001"),
    ccaBidValidationHook: address("a002"),
    ccaCanonicalLaunchReadiness: address("a003"),
    ccaCreate2Deployer: address("a00c"),
    ccaLaunchFunding: address("a00d"),
    ccaLaunchCoordinator: address("a004"),
    ccaRecoverySeeder: address("a005"),
    ccaStrategy: address("a006"),
    continuousClearingAuction: address("a007"),
    continuousClearingAuctionFactory: address("a008"),
    liquidityLauncher: address("a00e"),
    permanentPositionRecipient: address("a009"),
    permit2: address("a00a"),
    uniswapV4PositionManager: address("a00b"),
  });
  const canonicalPool = structuredClone(
    source.canonicalPool as Record<string, unknown>,
  );
  canonicalPool.seedSqrtPriceX96 = "0";
  canonicalPool.activeLiquidity = "0";
  source.schemaVersion = 3;
  source.phase = "cca";
  source.canonicalPool = canonicalPool;
  source.cca = {
    provenance: {
      continuousClearingAuction: {
        commit: "a56d42231e7bf048136d9d88fa61e8518c10c5ff",
        version: "v2.1.0",
      },
      liquidityLauncher: {
        commit: "873cbb23c5019a795193c5ad561edff2f78ba5a3",
        version: "v3.0.0",
      },
      lbpStrategy: {
        commit: "873cbb23c5019a795193c5ad561edff2f78ba5a3",
        version: "v3.1.0",
      },
    },
    economics: {
      totalFuelSupply: "4444000000000000000000",
      auctionSupply: "3000000000000000000000",
      liquidityReserve: "1444000000000000000000",
      minimumRaise: "1000000000000000000",
      floorPriceQ96: "9903520314283042199192993792",
      tickSpacingQ96: "618970019642690137449562112",
    },
    lifecycle: {
      startBlock: "100",
      endBlock: "110",
      claimBlock: "111",
      migrationBlock: "111",
    },
  };
  return decodeProtocolDeploymentManifest(source);
})();

class CcaTransport implements ProtocolReadTransport {
  chainReads = 0;

  constructor(private readonly manifest: ProtocolDeploymentManifest) {}

  async getChainId() {
    this.chainReads += 1;
    return this.manifest.chainId;
  }

  async getBlock() {
    return {
      hash: `0x${"11".repeat(32)}` as const,
      number: 105n,
      timestamp: 1_000n,
    };
  }

  async getBytecode() {
    return "0x01" as const;
  }

  private read(request: ContractReadRequest): ContractReadResult {
    if (this.manifest.schemaVersion !== 3) {
      throw new Error("CCA reads must not execute for a v2 manifest");
    }
    const key = `${request.contract}.${request.functionName}`;
    const values = new Map<string, unknown>([
      ["continuousClearingAuction.token", this.manifest.contracts.fuelCore],
      ["continuousClearingAuction.currency", this.manifest.contracts.weth],
      [
        "continuousClearingAuction.totalSupply",
        BigInt(this.manifest.cca.economics.auctionSupply),
      ],
      [
        "continuousClearingAuction.tokensRecipient",
        this.manifest.contracts.ccaRecoverySeeder,
      ],
      [
        "continuousClearingAuction.fundsRecipient",
        this.manifest.contracts.ccaStrategy,
      ],
      [
        "continuousClearingAuction.validationHook",
        this.manifest.contracts.ccaBidValidationHook,
      ],
      ["continuousClearingAuction.startBlock", 100n],
      ["continuousClearingAuction.endBlock", 110n],
      ["continuousClearingAuction.claimBlock", 111n],
      [
        "continuousClearingAuction.floorPrice",
        BigInt(this.manifest.cca.economics.floorPriceQ96),
      ],
      [
        "continuousClearingAuction.tickSpacing",
        BigInt(this.manifest.cca.economics.tickSpacingQ96),
      ],
      ["continuousClearingAuction.isGraduated", false],
      ["continuousClearingAuction.clearingPrice", 12n],
      ["continuousClearingAuction.currencyRaised", 34n],
      ["continuousClearingAuction.totalCleared", 56n],
      ["continuousClearingAuction.remainingSupply", 78n],
      ["continuousClearingAuction.nextBidId", 9n],
      ["continuousClearingAuction.lastCheckpointedBlock", 104n],
      [
        "continuousClearingAuction.bids",
        {
          startBlock: 101n,
          startCumulativeMps: 2,
          exitedBlock: 0n,
          maxPrice: 12n,
          owner: escrow,
          amountQ96: 34n,
          tokensFilled: 5n,
        },
      ],
      ["ccaLaunchCoordinator.fuel", this.manifest.contracts.fuelCore],
      [
        "ccaLaunchCoordinator.readiness",
        this.manifest.contracts.ccaCanonicalLaunchReadiness,
      ],
      [
        "ccaLaunchCoordinator.escrowFactory",
        this.manifest.contracts.ccaBidEscrowFactory,
      ],
      ["ccaLaunchCoordinator.configurationSealed", true],
      ["ccaLaunchCoordinator.activated", false],
      ["ccaCanonicalLaunchReadiness.isReady", true],
      ["ccaRecoverySeeder.seeded", false],
      ["fuelCore.launched", false],
      ["ccaBidEscrowFactory.escrowOf", escrow],
      ["ccaBidEscrowFactory.predictEscrow", escrow],
      ["ccaBidEscrowFactory.isEscrow", true],
      ["ccaBidEscrowFactory.beneficiaryOf", beneficiary],
      ["fuelCore.isDiscoveryExempt", true],
      ["fuelCore.isProtectedAccount", true],
      ["fuelCore.balanceOf", 80n],
      ["weth.balanceOf", 20n],
      ["weth.allowance", 100n],
      ["permit2.allowance", [90n, 2_000n, 3n]],
    ]);
    if (values.has(key)) return { status: "success", value: values.get(key) };
    const publicHealthValues = new Map<string, unknown>([
      ["totalSupply", 4_444n * 10n ** 18n],
      ["permanentCount", 0],
      ["totalTransientCount", 0],
      ["totalPendingDiscoveryCount", 0n],
      ["availableIdentityCount", 4_444],
      ["manifestCommitment", this.manifest.identity.manifestHash],
      ["paused", false],
      ["rewardNotificationsPaused", false],
      ["launched", false],
      ["TOTAL_FEE_BPS", 300n],
      ["rewardPot", 0n],
      ["liquidityPot", 0n],
      ["creatorPot", 0n],
      ["rewardEpochCount", 0n],
      ["queuedWeth", 0n],
      ["permanentlyLockedWeth", 0n],
      ["liquidityCycleCount", 0n],
      ["trackQueue", 0n],
      ["totalLiability", 0n],
      ["rewardToken", this.manifest.contracts.mockAaplc],
    ]);
    if (request.functionName === "balanceOf") {
      return { status: "success", value: 0n };
    }
    if (publicHealthValues.has(request.functionName)) {
      return {
        status: "success",
        value: publicHealthValues.get(request.functionName),
      };
    }
    throw new Error(`Unhandled CCA read ${key}`);
  }

  async readMany<const Requests extends readonly ContractReadRequest[]>(
    requests: Requests,
  ): Promise<ContractReadResults<Requests>> {
    return requests.map((request) =>
      this.read(request),
    ) as ContractReadResults<Requests>;
  }

  async permanentIdentityIds() {
    return [];
  }

  async quoteExactInput() {
    return [0n, 0n] as const;
  }

  async canonicalMarketState() {
    return {
      sqrtPriceX96: 0n,
      tick: 0,
      protocolFee: 0,
      lpFee: 0,
      activeLiquidity: 0n,
    };
  }
}

const readerFor = (
  manifest: ProtocolDeploymentManifest,
  transport: CcaTransport,
) =>
  createProtocolReader({
    manifest,
    identity: selectIdentityConfiguration(manifest.identity.key),
    transport,
  });

describe("CCA protocol reader", () => {
  it("does not report the intentionally closed pre-migration market as a launch failure", async () => {
    const snapshot = await readerFor(
      ccaManifest,
      new CcaTransport(ccaManifest),
    ).readPublicStatus(1_000, 30, { includeRewardHistory: false });

    expect(
      snapshot.health.checks.find((check) => check.id === "value:launched"),
    ).toBeUndefined();
  });

  it("does not bind the Anvil-only CREATE2 deployer when Base omits it", () => {
    const source = structuredClone(ccaManifest) as unknown as Record<
      string,
      unknown
    >;
    source.chainId = 84_532;
    source.network = "base-sepolia";
    delete (source.contracts as Record<string, unknown>).ccaCreate2Deployer;
    const baseManifest = source as unknown as ProtocolDeploymentManifest;

    const contracts = readerFor(
      baseManifest,
      new CcaTransport(baseManifest),
    ).contracts;
    expect("ccaCreate2Deployer" in contracts).toBe(false);
  });

  it("preserves v2 readers with an explicit unsupported result", async () => {
    const transport = new CcaTransport(legacyManifest);
    const reader = readerFor(legacyManifest, transport);

    await expect(reader.readCcaAuction()).resolves.toEqual({
      supported: false,
      schemaVersion: 2,
    });
    await expect(reader.readCcaReadiness()).resolves.toEqual({
      supported: false,
      schemaVersion: 2,
    });
    await expect(reader.readCcaEscrow(beneficiary)).resolves.toEqual({
      supported: false,
      schemaVersion: 2,
    });
    expect(transport.chainReads).toBe(0);
  });

  it("reads auction configuration and lifecycle state at one block", async () => {
    const reader = readerFor(ccaManifest, new CcaTransport(ccaManifest));
    const snapshot = await reader.readCcaAuction();

    expect(reader.contracts.liquidityLauncher.address).toBe(address("a00e"));
    expect(reader.contracts.ccaCreate2Deployer.address).toBe(address("a00c"));
    expect(reader.contracts.ccaLaunchFunding.address).toBe(address("a00d"));
    expect(snapshot).toMatchObject({
      supported: true,
      observedBlock: 105n,
      phase: "active",
      configurationMatchesManifest: true,
      graduated: false,
      finalized: false,
      clearingPriceQ96: 12n,
      currencyRaised: 34n,
      tokensCleared: 56n,
      tokensRemaining: 78n,
      bidCount: 9n,
    });
  });

  it("reports launch and beneficiary escrow readiness", async () => {
    const reader = readerFor(ccaManifest, new CcaTransport(ccaManifest));

    await expect(reader.readCcaReadiness()).resolves.toMatchObject({
      supported: true,
      coordinatorConfigured: true,
      poolReady: true,
      recoverySeeded: false,
      activated: false,
      fuelLaunched: false,
      readyToActivate: true,
      marketOpen: false,
    });
    await expect(reader.readCcaEscrow(beneficiary)).resolves.toMatchObject({
      supported: true,
      beneficiary,
      escrow,
      deployed: true,
      registered: true,
      beneficiaryMatches: true,
      discoveryExempt: true,
      protected: true,
      escrowReady: true,
      readyToBid: true,
      wethPermit2Allowance: 100n,
      wethPermit2Approved: true,
      permit2AuctionAllowance: {
        amount: 90n,
        expiration: 2_000n,
        nonce: 3n,
      },
      permit2AuctionApproved: true,
      fuelBalance: 80n,
      currencyBalance: 20n,
      fuelWithdrawalAvailable: false,
      currencyWithdrawalAvailable: true,
    });
  });

  it("reads an indexed bid at the pinned auction block", async () => {
    await expect(
      readerFor(ccaManifest, new CcaTransport(ccaManifest)).readCcaBid(7n),
    ).resolves.toMatchObject({
      supported: true,
      observedBlock: 105n,
      bidId: 7n,
      bid: {
        owner: escrow,
        maxPrice: 12n,
        tokensFilled: 5n,
      },
    });
  });
});
