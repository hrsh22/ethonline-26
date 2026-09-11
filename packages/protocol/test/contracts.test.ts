import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  decodeProtocolDeploymentManifest,
  type ProtocolDeploymentManifest,
} from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";

import { createProtocolContracts, protocolAbis } from "../src/contracts.js";
import {
  createProtocolTransactionPreparer,
  type TransactionRuntimeContext,
} from "../src/transactions.js";

const localManifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
if (localManifest.schemaVersion !== 2) {
  throw new Error("Expected the local historical deployment manifest");
}

describe("manifest-bound contract clients", () => {
  it("keeps every typed ABI fragment pinned to the compiled Foundry ABI", () => {
    const artifacts = {
      fuelCore: "FuelCore.sol/FuelCore.json",
      fuelMirror: "FuelMirror.sol/FuelMirror.json",
      attributeRegistry: "AttributeRegistry.sol/AttributeRegistry.json",
      rewardLedger: "RewardLedger.sol/RewardLedger.json",
      // The typed ABI is the union of what the application may call across
      // both policies. ConfigurableClaimGate is the superset - it also
      // implements isClaimAllowed - and the *deployed* implementation is
      // verified separately by the claim-policy health check.
      claimGate: "ConfigurableClaimGate.sol/ConfigurableClaimGate.json",
      discoveryAdapter:
        "QuotronDiscoveryAdapter.sol/QuotronDiscoveryAdapter.json",
      epochConverter: "EpochConverter.sol/EpochConverter.json",
      canonicalMarketRegistry:
        "CanonicalMarketRegistry.sol/CanonicalMarketRegistry.json",
      canonicalFeeHook: "CanonicalFeeHook.sol/CanonicalFeeHook.json",
      canonicalRouter: "CanonicalRouter.sol/CanonicalRouter.json",
      canonicalHookDeployer:
        "CanonicalHookDeployer.sol/CanonicalHookDeployer.json",
      protocolLiquidityVault:
        "ProtocolLiquidityVault.sol/ProtocolLiquidityVault.json",
      genesisLiquidityVault:
        "GenesisLiquidityVault.sol/GenesisLiquidityVault.json",
      continuousClearingAuction:
        "ContinuousClearingAuction.sol/ContinuousClearingAuction.json",
      continuousClearingAuctionFactory:
        "ContinuousClearingAuctionFactory.sol/ContinuousClearingAuctionFactory.json",
      ccaBidEscrowFactory: "CcaBidEscrowFactory.sol/CcaBidEscrowFactory.json",
      ccaBidValidationHook:
        "CcaBidValidationHook.sol/CcaBidValidationHook.json",
      ccaLaunchCoordinator:
        "CcaLaunchCoordinator.sol/CcaLaunchCoordinator.json",
      ccaCanonicalLaunchReadiness:
        "CcaCanonicalLaunchReadiness.sol/CcaCanonicalLaunchReadiness.json",
      ccaRecoverySeeder: "CcaRecoverySeeder.sol/CcaRecoverySeeder.json",
      permanentPositionRecipient:
        "PermanentPositionRecipient.sol/PermanentPositionRecipient.json",
      ccaStrategy: "LBPStrategy.sol/LBPStrategy.json",
      permit2: [
        "IAllowanceTransfer.sol/IAllowanceTransfer.default.json",
        "IAllowanceTransfer.sol/IAllowanceTransfer.cca_via_ir.json",
        "IAllowanceTransfer.sol/IAllowanceTransfer.json",
        "interfaces/IAllowanceTransfer.sol/IAllowanceTransfer.json",
      ],
      uniswapV4PoolManager: "PoolManager.sol/PoolManager.json",
      metadataRenderer:
        "PlaceholderMetadataRenderer.sol/PlaceholderMetadataRenderer.json",
      testConversionVenue: "TestConversionVenue.sol/TestConversionVenue.json",
      usdc: "MockUSDC.sol/MockUSDC.json",
      weth: "MockWETH.sol/MockWETH.json",
      mockAaplc: "MockStock.sol/MockStock.json",
      mockGooglc: "MockStock.sol/MockStock.json",
      mockMetac: "MockStock.sol/MockStock.json",
      mockNvdac: "MockStock.sol/MockStock.json",
      aaplcConversionAdapter:
        "SepoliaV4ConversionAdapter.sol/SepoliaV4ConversionAdapter.json",
      googlcConversionAdapter:
        "SepoliaV4ConversionAdapter.sol/SepoliaV4ConversionAdapter.json",
      metacConversionAdapter:
        "SepoliaV4ConversionAdapter.sol/SepoliaV4ConversionAdapter.json",
      nvdacConversionAdapter:
        "SepoliaV4ConversionAdapter.sol/SepoliaV4ConversionAdapter.json",
    } as const;
    const signature = (entry: {
      type: string;
      name?: string;
      inputs?: readonly { type: string }[];
    }) =>
      `${entry.type}:${entry.name ?? ""}(${(entry.inputs ?? []).map((input) => input.type).join(",")})`;

    for (const [name, abi] of Object.entries(protocolAbis)) {
      if (abi.length === 0) continue;
      const configuredArtifact = artifacts[name as keyof typeof artifacts];
      const artifactPaths =
        typeof configuredArtifact === "string"
          ? [configuredArtifact]
          : configuredArtifact;
      const artifactPath =
        artifactPaths.find((candidate) =>
          existsSync(`../contracts/out/${candidate}`),
        ) ?? artifactPaths[0];
      const artifact = JSON.parse(
        readFileSync(`../contracts/out/${artifactPath}`, "utf8"),
      ) as {
        abi: Array<{
          type: string;
          name?: string;
          inputs?: Array<{ type: string }>;
        }>;
      };
      const compiled = new Set(
        artifact.abi
          .filter(
            (entry) => entry.type === "function" || entry.type === "event",
          )
          .map(signature),
      );
      for (const entry of abi) {
        if (entry.type === "function" || entry.type === "event") {
          expect(compiled, `${name} ${signature(entry)}`).toContain(
            signature(entry),
          );
        }
      }
    }
  });

  it("changes every transaction and query target through one manifest seam", () => {
    const first = createProtocolContracts(localManifest);
    const switched = {
      ...structuredClone(localManifest),
      contracts: Object.fromEntries(
        Object.entries(localManifest.contracts).map(
          ([name, current], index) => [
            name,
            `0x${(BigInt(current) + BigInt(index + 1)).toString(16).padStart(40, "0")}`,
          ],
        ),
      ),
    } as unknown as ProtocolDeploymentManifest;
    const second = createProtocolContracts(switched);

    expect(first.fuelCore.address).toBe(localManifest.contracts.fuelCore);
    expect(second.fuelCore.address).toBe(switched.contracts.fuelCore);
    expect(
      Object.keys(first).every(
        (key) =>
          first[key as keyof typeof first].address !==
          second[key as keyof typeof second].address,
      ),
    ).toBe(true);
    expect(first.fuelCore.abi.some((entry) => entry.type === "function")).toBe(
      true,
    );

    const runtime = {
      connectedChainId: localManifest.chainId,
      currentBlock: 100n,
      currentTimestamp: 1_000n,
      connectedWallet: localManifest.roles.owner as `0x${string}`,
      roles: {
        owners: {
          liquidToken: localManifest.roles.owner as `0x${string}`,
          rewards: localManifest.roles.owner as `0x${string}`,
          converter: localManifest.roles.owner as `0x${string}`,
          liquidity: localManifest.roles.owner as `0x${string}`,
        },
        guardian: localManifest.roles.guardian as `0x${string}`,
        recoveryAuthority: localManifest.roles
          .recoveryAuthority as `0x${string}`,
        keeper: localManifest.roles.keeper as `0x${string}`,
        liquidityExecutor: localManifest.roles
          .liquidityExecutor as `0x${string}`,
        creator: localManifest.roles.creator as `0x${string}`,
      },
      launched: true,
      sealed: true,
      liquidityConfigurationSealed: true,
      pauses: {
        liquidToken: false,
        rewards: false,
        converter: false,
        liquidity: false,
      },
      rewardPotWeth: 1n * 10n ** 18n,
      creatorPotWeth: 0n,
      nextRewardEpochAt: 0n,
      trackQueues: { 1: 1n, 2: 0n, 3: 0n, 4: 0n },
      trackAttemptHistoryAvailable: { 1: true, 2: true, 3: true, 4: true },
      retryableTracks: new Set<1 | 2 | 3 | 4>(),
      ownedTransientIdentityIds: new Set<number>(),
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
    } as const satisfies TransactionRuntimeContext;
    const firstPrepare = createProtocolTransactionPreparer({
      manifest: localManifest,
      identity: selectIdentityConfiguration(localManifest.identity.key),
    });
    const secondPrepare = createProtocolTransactionPreparer({
      manifest: switched,
      identity: selectIdentityConfiguration(switched.identity.key),
    });
    expect(firstPrepare({ type: "claim", identityIds: [42] }, runtime).to).toBe(
      localManifest.contracts.rewardLedger,
    );
    expect(
      secondPrepare({ type: "claim", identityIds: [42] }, runtime).to,
    ).toBe(switched.contracts.rewardLedger);
  });

  it("fails closed when a required protocol target is absent", () => {
    const contracts = { ...localManifest.contracts };
    delete (contracts as Record<string, string>).rewardLedger;
    const incomplete = {
      ...structuredClone(localManifest),
      contracts,
    } as unknown as ProtocolDeploymentManifest;

    expect(() => createProtocolContracts(incomplete)).toThrow(
      "Missing protocol contract rewardLedger",
    );
  });

  it("fails closed when the selected identity adapter does not match the manifest", () => {
    expect(() =>
      createProtocolTransactionPreparer({
        manifest: localManifest,
        identity: selectIdentityConfiguration("neutral-test"),
      }),
    ).toThrow("does not match deployment");
  });
});
