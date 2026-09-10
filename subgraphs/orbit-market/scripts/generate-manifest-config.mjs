import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const directory = fileURLToPath(new URL("..", import.meta.url));
const arguments_ = process.argv.slice(2);
const check = arguments_.includes("--check");
const printYaml = arguments_.includes("--print-yaml");
const manifestArgument = arguments_.find(
  (argument) => !argument.startsWith("--"),
);
const manifestPath = resolve(
  directory,
  manifestArgument ??
    process.env.ORBIT_DEPLOYMENT_MANIFEST ??
    "../../deployments/84532.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 2 && manifest.schemaVersion !== 3) {
  throw new Error(
    "The market subgraph requires a protocol manifest (v2 or v3)",
  );
}

const source = ({
  name,
  contract,
  abi = name,
  startBlock,
  entities,
  handlers,
  file = "mapping",
}) => `  - kind: ethereum/contract
    name: ${name}
    network: ${manifest.network}
    source:
      address: "${manifest.contracts[contract]}"
      abi: ${abi}
      startBlock: ${startBlock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities: [${entities.join(", ")}]
      abis:
        - name: ${abi}
          file: ./abis/${abi}.json
      eventHandlers:
${handlers.map(([event, handler]) => `        - event: ${event}\n          handler: ${handler}`).join("\n")}
      file: ./src/${file}.ts`;

const legacyStartBlock =
  manifest.schemaVersion === 3
    ? BigInt(manifest.cca.lifecycle.startBlock)
    : BigInt(manifest.launch.blockNumber) > 1_000n
      ? BigInt(manifest.launch.blockNumber) - 1_000n
      : 0n;
const marketEntities = ["LiquidityPool", "Swap", "RewardFundingSummary"];
const dataSources = [
  source({
    name: "PoolManager",
    contract: "uniswapV4PoolManager",
    startBlock: legacyStartBlock,
    entities: marketEntities,
    handlers: [
      [
        "Swap(indexed bytes32,indexed address,int128,int128,uint160,uint128,int24,uint24)",
        "handleSwap",
      ],
      [
        "ModifyLiquidity(indexed bytes32,indexed address,int24,int24,int256,bytes32)",
        "handleModifyLiquidity",
      ],
      [
        "Donate(indexed bytes32,indexed address,uint256,uint256)",
        "handleDonate",
      ],
    ],
  }),
  source({
    name: "CanonicalFeeHook",
    contract: "canonicalFeeHook",
    startBlock: legacyStartBlock,
    entities: marketEntities,
    handlers: [
      [
        "FeeAccrued(indexed address,uint256,uint256,uint256,uint256,uint256)",
        "handleFee",
      ],
    ],
  }),
  source({
    name: "EpochConverter",
    contract: "epochConverter",
    startBlock: legacyStartBlock,
    entities: marketEntities,
    handlers: [
      [
        "RewardEpochOpened(indexed uint256,uint256,uint256,uint256)",
        "handleEpoch",
      ],
      [
        "TrackExecuted(indexed uint8,uint256,uint256,uint256)",
        "handleConversion",
      ],
    ],
  }),
  source({
    name: "RewardLedger",
    contract: "rewardLedger",
    startBlock: legacyStartBlock,
    entities: marketEntities,
    handlers: [
      [
        "RewardNotified(indexed uint8,indexed address,uint256,uint256,uint256,uint256)",
        "handleDistribution",
      ],
      [
        "RewardClaimed(indexed address,indexed uint16,indexed uint8,uint256)",
        "handleClaim",
      ],
    ],
  }),
  ...(manifest.schemaVersion === 2
    ? [
        source({
          name: "GenesisLiquidityVault",
          contract: "genesisLiquidityVault",
          startBlock: legacyStartBlock,
          entities: marketEntities,
          handlers: [
            [
              "GenesisLiquiditySeeded(indexed bytes32,uint128,uint256,uint256,int24,int24)",
              "handleGenesis",
            ],
          ],
        }),
      ]
    : []),
  source({
    name: "ProtocolLiquidityVault",
    contract: "protocolLiquidityVault",
    startBlock: legacyStartBlock,
    entities: marketEntities,
    handlers: [
      [
        "ProtocolLiquidityAdded(indexed uint256,indexed bytes32,uint256,uint256,uint256,uint256,int24,int24,uint128)",
        "handleLiquidity",
      ],
    ],
  }),
  ...(manifest.schemaVersion === 3
    ? [
        source({
          name: "ContinuousClearingAuction",
          contract: "continuousClearingAuction",
          startBlock: BigInt(manifest.cca.lifecycle.startBlock),
          entities: [
            "AuctionBidSubmission",
            "AuctionBidExit",
            "AuctionTokenClaim",
          ],
          handlers: [
            [
              "BidSubmitted(indexed uint256,indexed address,uint256,uint128)",
              "handleBidSubmitted",
            ],
            [
              "BidExited(indexed uint256,indexed address,uint256,uint256)",
              "handleBidExited",
            ],
            [
              "TokensClaimed(indexed uint256,indexed address,uint256)",
              "handleTokensClaimed",
            ],
          ],
          file: "cca-mapping",
        }),
        source({
          name: "CcaStrategy",
          contract: "ccaStrategy",
          startBlock: BigInt(manifest.cca.lifecycle.migrationBlock),
          entities: ["CcaMigration", "CcaMigrationFailure", "CcaFundsRecovery"],
          handlers: [
            [
              "Migrated(indexed address,(indexed address,address,uint24,int24,address),uint160,bytes)",
              "handleMigrated",
            ],
            ["MigrationFailed(indexed address,bytes)", "handleMigrationFailed"],
            [
              "FundsRecovered(indexed address,indexed address,uint256)",
              "handleFundsRecovered",
            ],
          ],
          file: "cca-mapping",
        }),
        source({
          name: "CcaLaunchCoordinator",
          contract: "ccaLaunchCoordinator",
          startBlock: BigInt(manifest.cca.lifecycle.migrationBlock),
          entities: ["CcaActivation"],
          handlers: [["FuelActivated(indexed address)", "handleFuelActivated"]],
          file: "cca-mapping",
        }),
        source({
          name: "CcaBidEscrowFactory",
          contract: "ccaBidEscrowFactory",
          startBlock: BigInt(manifest.cca.lifecycle.startBlock),
          entities: ["CcaEscrow"],
          handlers: [
            [
              "EscrowDeployed(indexed address,indexed address)",
              "handleEscrowDeployed",
            ],
          ],
          file: "cca-mapping",
        }),
      ]
    : []),
];

const yaml = await format(
  `specVersion: 1.3.0
indexerHints:
  prune: auto
schema:
  file: ./schema.graphql
dataSources:
${dataSources.join("\n")}
templates:
  - kind: ethereum/contract
    name: CcaBidEscrow
    network: ${manifest.network}
    source:
      abi: CcaBidEscrow
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities: [CcaEscrow, CcaEscrowWithdrawal]
      abis:
        - name: CcaBidEscrow
          file: ./abis/CcaBidEscrow.json
      eventHandlers:
        - event: Withdrawal(indexed address,indexed address,uint256)
          handler: handleEscrowWithdrawal
      file: ./src/escrow-mapping.ts
`,
  { parser: "yaml" },
);

const lower = (value) => value.toLowerCase();
const constants = await format(
  `export const POOL =
  "${lower(manifest.canonicalPool.poolId)}";
export const MANAGER = "${lower(manifest.contracts.uniswapV4PoolManager)}";
export const PROTOCOL = "${lower(manifest.contracts.canonicalMarketRegistry)}";
export const FUEL = "${lower(manifest.contracts.fuelCore)}";
export const WETH = "${lower(manifest.contracts.weth)}";
export const ROUTER = "${lower(manifest.contracts.canonicalRouter)}";
export const GENESIS_VAULT = "${lower(manifest.contracts.genesisLiquidityVault ?? "0x0000000000000000000000000000000000000000")}";
export const LIQUIDITY_VAULT = "${lower(manifest.contracts.protocolLiquidityVault)}";
`,
  { parser: "typescript" },
);

if (printYaml) {
  process.stdout.write(yaml);
} else {
  for (const [relativePath, content] of [
    ["subgraph.yaml", yaml],
    ["src/constants.ts", constants],
  ]) {
    const outputPath = resolve(directory, relativePath);
    if (check) {
      if (readFileSync(outputPath, "utf8") !== content) {
        throw new Error(`${relativePath} is stale for ${manifestPath}`);
      }
    } else {
      writeFileSync(outputPath, content);
    }
  }
}
