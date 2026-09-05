import {
  deploymentManifestFingerprint,
  type ProtocolDeploymentManifest,
} from "@orbit/config/deployment-manifest";
import type { Address, Hex } from "viem";

export interface HistoryIndexConfiguration {
  readonly chainId: number;
  readonly network: ProtocolDeploymentManifest["network"];
  readonly launchBlock: bigint;
  readonly manifestFingerprint: Hex;
  readonly manifestCommitment: Hex;
  readonly canonicalPool: {
    readonly poolId: Hex;
    readonly currency0: Address;
    readonly currency1: Address;
  };
  readonly sources: {
    readonly poolManager: Address;
    readonly canonicalFeeHook: Address;
    readonly protocolLiquidityVault: Address;
    readonly epochConverter: Address;
    readonly fuelCore: Address;
    readonly rewardLedger: Address;
  };
  readonly batchBlocks: bigint;
  readonly confirmationBlocks: bigint;
  readonly overlapBlocks: bigint;
  readonly rpcConcurrency: number;
  readonly retryMaximumAttempts: number;
  readonly retryBaseDelayMilliseconds: number;
  readonly maximumPageSize: number;
  readonly cursorSnapshotRetention: number;
}

export const validateHistoryIndexConfiguration = (
  configuration: HistoryIndexConfiguration,
): HistoryIndexConfiguration => {
  if (configuration.batchBlocks <= configuration.overlapBlocks) {
    throw new RangeError(
      "HISTORY_BATCH_BLOCKS must be greater than HISTORY_REORG_OVERLAP_BLOCKS",
    );
  }
  return configuration;
};

const contractAddress = (
  manifest: ProtocolDeploymentManifest,
  name: keyof ProtocolDeploymentManifest["contracts"],
): Address => {
  const address = manifest.contracts[name];
  return address as Address;
};

export const deriveHistoryIndexConfiguration = (
  manifest: ProtocolDeploymentManifest,
): HistoryIndexConfiguration => ({
  chainId: manifest.chainId,
  network: manifest.network,
  launchBlock: BigInt(manifest.launch.blockNumber),
  manifestFingerprint: deploymentManifestFingerprint(manifest),
  manifestCommitment: manifest.identity.manifestHash as Hex,
  canonicalPool: {
    poolId: manifest.canonicalPool.poolId as Hex,
    currency0: manifest.canonicalPool.currency0 as Address,
    currency1: manifest.canonicalPool.currency1 as Address,
  },
  sources: {
    poolManager: contractAddress(manifest, "uniswapV4PoolManager"),
    canonicalFeeHook: contractAddress(manifest, "canonicalFeeHook"),
    protocolLiquidityVault: contractAddress(manifest, "protocolLiquidityVault"),
    epochConverter: contractAddress(manifest, "epochConverter"),
    fuelCore: contractAddress(manifest, "fuelCore"),
    rewardLedger: contractAddress(manifest, "rewardLedger"),
  },
  batchBlocks: 2_000n,
  confirmationBlocks: 2n,
  overlapBlocks: 64n,
  rpcConcurrency: 4,
  retryMaximumAttempts: 5,
  retryBaseDelayMilliseconds: 250,
  maximumPageSize: 100,
  cursorSnapshotRetention: 10_000,
});
