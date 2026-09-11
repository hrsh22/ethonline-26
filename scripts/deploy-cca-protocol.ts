import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  toFunctionSelector,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type Transaction,
} from "viem";
import {
  decodeProtocolDeploymentManifest,
  type ProtocolDeploymentManifestV3,
} from "@orbit/config/deployment-manifest";
import {
  deploymentEnvironmentForName,
  requireDeployableDeploymentEnvironment,
} from "@orbit/config/deployment-environments";
import { Schema } from "effect";
import { collectionManifestHash } from "@orbit/config/collection-manifest";
import {
  selectedIdentityConfiguration,
  selectedIdentityKey,
} from "@orbit/config/identity";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const contractsRoot = join(repositoryRoot, "packages/contracts");
const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const tracks = ["aaplc", "googlc", "metac", "nvdac"] as const;

export const resolveCcaDeploymentEnvironment = (
  chainId: number,
  environmentName: string | undefined,
) => {
  if (chainId === 31_337) return undefined;
  if (environmentName === undefined) {
    throw new Error(
      "DEPLOYMENT_ENVIRONMENT is required for a Base Sepolia CCA deployment",
    );
  }
  const target = requireDeployableDeploymentEnvironment(
    deploymentEnvironmentForName(environmentName),
  );
  if (target.chainId !== chainId) {
    throw new Error(
      `Deployment environment ${target.name} does not match chain ${chainId}`,
    );
  }
  return target;
};
type Infrastructure = {
  poolManager: Address;
  positionManager: Address;
  permit2: Address;
  ccaFactory?: Address;
  liquidityLauncher?: Address;
  lbpStrategy?: Address;
};
export interface CcaInput {
  infrastructure: Infrastructure;
  roles: {
    deploymentOwner: Address;
    governanceOwner: Address;
    creator: Address;
    guardian: Address;
    keeper: Address;
    liquidityExecutor: Address;
    recoveryCosigner: Address;
  };
  identity: Record<string, string>;
  discovery: { nativeFundingWei: string };
  auction: {
    reserveSupply: string;
    minimumRaise: string;
    floorPriceQ96: string;
    auctionTickSpacingQ96: string;
    startBlock: number;
    endBlock: number;
    claimBlock: number;
    migrationBlock: number;
    poolTickSpacing: number;
    auctionSteps: Hex;
    distributionSalt: Hex;
    testnetEconomicsConfirmed: boolean;
  };
  blockedVenueCodehashes: Hex[];
}
const EvmAddressSchema = Schema.String.pipe(
  Schema.filter((value): value is Address => /^0x[0-9a-fA-F]{40}$/.test(value)),
);
const NonZeroAddressSchema = EvmAddressSchema.pipe(
  Schema.filter((value) => value.toLowerCase() !== zeroAddress),
);
const DecimalSchema = Schema.String.pipe(
  Schema.pattern(/^[1-9][0-9]*$/),
  Schema.filter((value) => BigInt(value) < 1n << 256n),
);
const Bytes32Schema = Schema.String.pipe(
  Schema.filter((value): value is Hex => /^0x[0-9a-fA-F]{64}$/.test(value)),
);
const BlockSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, Number.MAX_SAFE_INTEGER),
);
const CcaInputSchema = Schema.Struct({
  infrastructure: Schema.Struct({
    poolManager: NonZeroAddressSchema,
    positionManager: NonZeroAddressSchema,
    permit2: NonZeroAddressSchema,
    ccaFactory: Schema.optionalWith(EvmAddressSchema, { exact: true }),
    liquidityLauncher: Schema.optionalWith(EvmAddressSchema, { exact: true }),
    lbpStrategy: Schema.optionalWith(EvmAddressSchema, { exact: true }),
  }),
  roles: Schema.Struct({
    deploymentOwner: NonZeroAddressSchema,
    governanceOwner: NonZeroAddressSchema,
    creator: NonZeroAddressSchema,
    guardian: NonZeroAddressSchema,
    keeper: NonZeroAddressSchema,
    liquidityExecutor: NonZeroAddressSchema,
    recoveryCosigner: NonZeroAddressSchema,
  }),
  identity: Schema.Record({ key: Schema.String, value: Schema.String }),
  discovery: Schema.Struct({ nativeFundingWei: DecimalSchema }),
  auction: Schema.Struct({
    reserveSupply: DecimalSchema,
    minimumRaise: DecimalSchema,
    floorPriceQ96: DecimalSchema,
    auctionTickSpacingQ96: DecimalSchema,
    startBlock: BlockSchema,
    endBlock: BlockSchema,
    claimBlock: BlockSchema,
    migrationBlock: BlockSchema,
    poolTickSpacing: Schema.Literal(60),
    auctionSteps: Schema.String.pipe(
      Schema.filter((value): value is Hex =>
        /^0x(?:[0-9a-fA-F]{16})+$/.test(value),
      ),
    ),
    distributionSalt: Bytes32Schema,
    testnetEconomicsConfirmed: Schema.Boolean,
  }),
  blockedVenueCodehashes: Schema.Array(
    Bytes32Schema.pipe(Schema.filter((value) => value !== zeroHash)),
  ),
});
const officialInfrastructure: Required<Infrastructure> = {
  poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
  positionManager: "0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80",
  permit2,
  ccaFactory: "0x000000001F26a0044BaA66024e7b6599c61963F8",
  liquidityLauncher: "0x00004c4ccc709Ef590F7C81102C0689F0263D4e9",
  lbpStrategy: "0xB06428b62c259eE982cE3D9BED47391dC9A5E000",
};
function validateInfrastructureInput(input: CcaInput, chainId: number): void {
  insist(
    input.infrastructure.permit2.toLowerCase() === permit2.toLowerCase(),
    "Canonical Permit2 is required",
  );
  if (chainId === 31_337) {
    for (const field of [
      "ccaFactory",
      "liquidityLauncher",
      "lbpStrategy",
    ] as const) {
      insist(
        input.infrastructure[field] === undefined ||
          input.infrastructure[field] === zeroAddress,
        "Local CCA factory/launcher/strategy must be freshly deployed",
      );
    }
    return;
  }
  insist(chainId === 84_532, "Unsupported deployment chain");
  for (const [name, expected] of Object.entries(officialInfrastructure)) {
    insist(
      input.infrastructure[name as keyof Infrastructure]?.toLowerCase() ===
        expected.toLowerCase(),
      `Base Sepolia infrastructure.${name} differs from the pinned official deployment`,
    );
  }
  insist(
    input.auction.testnetEconomicsConfirmed,
    "Explicit testnet economics confirmation is required",
  );
  insist(
    input.roles.recoveryCosigner.toLowerCase() !==
      input.roles.deploymentOwner.toLowerCase(),
    "Recovery cosigner must differ from deployment owner",
  );
}
function validateEconomicsInput(
  input: CcaInput,
  chainId: number,
  head: bigint,
): void {
  const a = input.auction;
  insist(
    BigInt(a.reserveSupply) < 4_444n * 10n ** 18n &&
      BigInt(a.minimumRaise) < 1n << 128n,
    "Auction supply or minimum raise exceeds supported bounds",
  );
  insist(
    BigInt(a.floorPriceQ96) % BigInt(a.auctionTickSpacingQ96) === 0n,
    "Auction floor must be aligned to its price tick",
  );
  insist(
    BigInt(a.startBlock) >= head + (chainId === 84_532 ? 128n : 1n),
    "Insufficient auction setup lead",
  );
  insist(
    a.endBlock > a.startBlock &&
      a.claimBlock > a.endBlock &&
      a.migrationBlock > a.endBlock &&
      a.migrationBlock <= a.claimBlock,
    "Invalid auction lifecycle ordering",
  );
  let duration = 0n;
  let issuance = 0n;
  for (let offset = 2; offset < a.auctionSteps.length; offset += 16) {
    const rate = BigInt(`0x${a.auctionSteps.slice(offset, offset + 6)}`);
    const blocks = BigInt(`0x${a.auctionSteps.slice(offset + 6, offset + 16)}`);
    insist(blocks > 0n, "Auction issuance steps must have positive durations");
    duration += blocks;
    issuance += rate * blocks;
  }
  insist(
    duration === BigInt(a.endBlock - a.startBlock) && issuance === 10_000_000n,
    "Auction issuance schedule does not cover the full supply and duration",
  );
}
export function validateCcaInput(
  value: unknown,
  chainId: number,
  head: bigint,
): CcaInput {
  const decoded = Schema.decodeUnknownSync(CcaInputSchema, {
    onExcessProperty: "error",
  })(value);
  const input: CcaInput = {
    ...decoded,
    blockedVenueCodehashes: [...decoded.blockedVenueCodehashes],
  };
  const identity = selectedCcaIdentity();
  insist(
    Object.keys(input.identity).length === Object.keys(identity).length,
    "Deployment identity fields differ from the selected identity",
  );
  for (const [field, expected] of Object.entries(identity)) {
    insist(
      input.identity[field] === expected,
      `Deployment identity.${field} differs from the selected identity`,
    );
  }
  validateInfrastructureInput(input, chainId);
  validateEconomicsInput(input, chainId, head);
  insist(
    new Set(input.blockedVenueCodehashes.map((hash) => hash.toLowerCase()))
      .size === input.blockedVenueCodehashes.length,
    "Duplicate blocked venue codehash",
  );
  return input;
}

interface Composition {
  chainId: number;
  deploymentBlock: number;
  contracts: Record<string, Address>;
  infrastructure: Infrastructure;
  freshInfrastructure: {
    weth: Address;
    usdc: Address;
    testConversionVenue: Address;
    testConversionVenueCodehash: Hex;
    vrfBootstrap: Address;
    vrfCoordinator: Address;
    vrfSubscriptionId: string;
  };
  conversionAdapters: Address[];
  stockTokens: Address[];
  auction: CcaInput["auction"] & {
    totalSupply: string;
    auctionSupply: string;
    poolId: Hex;
    currency0: Address;
    currency1: Address;
    poolFee: number;
  };
  ccaSourceCommit: string;
  liquidityLauncherSourceCommit: string;
}
interface Broadcast {
  transactions: { hash: Hex }[];
  receipts: { transactionHash: Hex; status: string }[];
}
interface History {
  transactions: Transaction[];
  hashes: Hex[];
  terminalBlock: bigint;
  creations: Set<string>;
}
const readJson = <Value>(path: string): Value =>
  JSON.parse(readFileSync(path, "utf8")) as Value;
function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function contractAt(contracts: Record<string, Address>, name: string): Address {
  const value = contracts[name];
  insist(value, `Missing contract ${name}`);
  return value;
}

export function canonicalContracts(
  raw: Pick<
    Composition,
    "contracts" | "infrastructure" | "conversionAdapters" | "stockTokens"
  > & {
    freshInfrastructure: Pick<
      Composition["freshInfrastructure"],
      "weth" | "usdc" | "testConversionVenue"
    >;
  },
): Record<string, Address> {
  const aliases: Record<string, string> = {
    liquidToken: "fuelCore",
    collectible: "fuelMirror",
    marketRegistry: "canonicalMarketRegistry",
    claimPolicy: "claimGate",
    ccaFactory: "continuousClearingAuctionFactory",
    ccaAuction: "continuousClearingAuction",
    lbpStrategy: "ccaStrategy",
    ccaEscrowFactory: "ccaBidEscrowFactory",
    ccaValidationHook: "ccaBidValidationHook",
    ccaReadiness: "ccaCanonicalLaunchReadiness",
  };
  const contracts = Object.fromEntries(
    Object.entries(raw.contracts).map(([key, address]) => [
      aliases[key] ?? key,
      address,
    ]),
  );
  Object.assign(contracts, {
    uniswapV4PoolManager: raw.infrastructure.poolManager,
    uniswapV4PositionManager: raw.infrastructure.positionManager,
    permit2: raw.infrastructure.permit2,
    weth: raw.freshInfrastructure.weth,
    usdc: raw.freshInfrastructure.usdc,
    testConversionVenue: raw.freshInfrastructure.testConversionVenue,
  });
  tracks.forEach((track, index) => {
    const stock = raw.stockTokens[index];
    const adapter = raw.conversionAdapters[index];
    insist(stock && adapter, `Missing ${track} conversion route`);
    contracts[`mock${track[0]!.toUpperCase()}${track.slice(1)}`] = stock;
    contracts[`${track}ConversionAdapter`] = adapter;
  });
  return contracts;
}

function callReader(client: PublicClient, blockNumber: bigint) {
  return async function read<Value>(
    address: Address,
    signature: string,
    args: readonly unknown[] = [],
  ): Promise<Value> {
    const functionName = /^function (\w+)/.exec(signature)?.[1];
    insist(functionName, `Invalid read signature ${signature}`);
    return (await client.readContract({
      address,
      abi: parseAbi([signature]),
      functionName,
      args,
      blockNumber,
    })) as Value;
  };
}
type Reader = ReturnType<typeof callReader>;
async function ownership(read: Reader, contracts: Record<string, Address>) {
  const names = {
    liquidToken: "fuelCore",
    rewardLedger: "rewardLedger",
    epochConverter: "epochConverter",
    marketRegistry: "canonicalMarketRegistry",
    protocolLiquidityVault: "protocolLiquidityVault",
  };
  const result = await Promise.all(
    Object.entries(names).map(async ([name, contract]) => {
      const address = contractAt(contracts, contract);
      return [
        name,
        await read<Address>(address, "function owner() view returns (address)"),
        await read<Address>(
          address,
          "function pendingOwner() view returns (address)",
        ),
      ] as const;
    }),
  );
  return {
    moduleOwners: Object.fromEntries(
      result.map(([name, owner]) => [name, owner]),
    ),
    modulePendingOwners: Object.fromEntries(
      result.map(([name, , pending]) => [name, pending]),
    ),
  };
}
async function conversionPools(read: Reader, raw: Composition) {
  const pairs = [
    ["wethUsdc", raw.freshInfrastructure.weth, raw.freshInfrastructure.usdc],
    ...tracks.map(
      (track, i) =>
        [track, raw.freshInfrastructure.usdc, raw.stockTokens[i]!] as const,
    ),
  ] as const;
  const entries = await Promise.all(
    pairs.map(async ([name, left, right]) => {
      const [poolId, key, price, liquidity] = await read<
        readonly [
          Hex,
          {
            currency0: Address;
            currency1: Address;
            fee: number;
            tickSpacing: number;
            hooks: Address;
          },
          bigint,
          bigint,
        ]
      >(
        raw.freshInfrastructure.testConversionVenue,
        "function verifiedPoolConfiguration(address,address) view returns (bytes32,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160,uint128)",
        [left, right],
      );
      return [
        name,
        {
          poolId,
          ...key,
          seedSqrtPriceX96: price.toString(),
          activeLiquidity: liquidity.toString(),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}
async function verifyPending(
  read: Reader,
  raw: Composition,
  contracts: Record<string, Address>,
  history: History,
): Promise<void> {
  const fuel = contractAt(contracts, "fuelCore");
  const statuses = await Promise.all([
    read<boolean>(fuel, "function launched() view returns (bool)"),
    read<boolean>(
      contractAt(contracts, "ccaLaunchFunding"),
      "function funded() view returns (bool)",
    ),
    read<Address>(fuel, "function owner() view returns (address)"),
    read<bigint>(fuel, "function totalSupply() view returns (uint256)"),
  ]);
  insist(
    !statuses[0] && statuses[1],
    "CCA deployment is not freshly funded and pending",
  );
  insist(
    statuses[2].toLowerCase() ===
      contractAt(contracts, "ccaLaunchCoordinator").toLowerCase(),
    "Fuel ownership was not transferred to the coordinator",
  );
  insist(
    statuses[3].toString() === raw.auction.totalSupply,
    "Fresh supply differs from the composition",
  );
  insist(
    history.terminalBlock < BigInt(raw.auction.startBlock),
    "Auction started before deployment completed",
  );
  const fundingTransactions = history.transactions.filter(
    (tx) =>
      tx.to?.toLowerCase() ===
        contractAt(contracts, "ccaLaunchFunding").toLowerCase() &&
      tx.input.startsWith(toFunctionSelector("fund(bytes)")),
  );
  insist(
    fundingTransactions.length === 1,
    "Exactly one atomic funding transaction is required",
  );
  const slot = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [raw.auction.poolId, 6n],
    ),
  );
  const state = await Promise.all(
    [slot, toHex(BigInt(slot) + 3n, { size: 32 })].map((key) =>
      read<Hex>(
        raw.infrastructure.poolManager,
        "function extsload(bytes32) view returns (bytes32)",
        [key],
      ),
    ),
  );
  insist(
    state.every((value) => value === zeroHash),
    "Canonical market was initialized before auction settlement",
  );
}
async function verifySeals(
  read: Reader,
  contracts: Record<string, Address>,
): Promise<void> {
  const entries = [
    ["attributeRegistry", "isSealed"],
    ["canonicalMarketRegistry", "isSealed"],
    ["epochConverter", "configurationSealed"],
    ["protocolLiquidityVault", "configurationSealed"],
  ] as const;
  await Promise.all(
    entries.map(async ([name, getter]) =>
      insist(
        await read<boolean>(
          contractAt(contracts, name),
          `function ${getter}() view returns (bool)`,
        ),
        `${name} is not sealed`,
      ),
    ),
  );
}
async function verifyCreations(
  client: PublicClient,
  contracts: Record<string, Address>,
  history: History,
  chainId: number,
): Promise<void> {
  const internal = new Set([
    "fuelMirror",
    "canonicalFeeHook",
    "discoveryAdapter",
    "ccaStrategy",
    "continuousClearingAuction",
    "permit2",
    "uniswapV4PoolManager",
    "uniswapV4PositionManager",
  ]);
  if (chainId === 84_532)
    [
      "uniswapV4PoolManager",
      "uniswapV4PositionManager",
      "liquidityLauncher",
      "continuousClearingAuctionFactory",
    ].forEach((name) => internal.add(name));
  for (const [name, address] of Object.entries(contracts)) {
    const code = await client.getCode({
      address,
      blockNumber: history.terminalBlock,
    });
    insist(code && code !== "0x", `${name} has no deployed runtime`);
    if (!internal.has(name))
      insist(
        history.creations.has(address.toLowerCase()),
        `No confirmed creation receipt for ${name}`,
      );
  }
}

export async function reconcileBroadcasts(
  client: PublicClient,
  paths: readonly string[],
  sender: Address,
): Promise<History> {
  const artifacts = paths.map((path) => readJson<Broadcast>(path));
  const hashes = artifacts.flatMap((artifact) =>
    artifact.transactions.map((tx) => tx.hash),
  );
  insist(
    hashes.length > 0 &&
      new Set(hashes.map((hash) => hash.toLowerCase())).size === hashes.length,
    "Broadcast transaction hashes are empty or duplicated",
  );
  for (const artifact of artifacts) {
    const receipts = new Map(
      artifact.receipts.map((receipt) => [
        receipt.transactionHash.toLowerCase(),
        receipt,
      ]),
    );
    insist(
      receipts.size === artifact.transactions.length &&
        artifact.transactions.every(
          (tx) => receipts.get(tx.hash.toLowerCase())?.status === "0x1",
        ),
      "Broadcast artifact has missing or unsuccessful receipts",
    );
  }
  const transactions: Transaction[] = [];
  const creations = new Set<string>();
  let terminalBlock = 0n;
  for (const hash of hashes) {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    insist(
      tx.hash.toLowerCase() === hash.toLowerCase() &&
        receipt.transactionHash.toLowerCase() === hash.toLowerCase(),
      "RPC transaction hash mismatch",
    );
    insist(
      receipt.status === "success" && tx.blockNumber === receipt.blockNumber,
      "Onchain receipt is missing, reverted, or inconsistent",
    );
    insist(
      tx.from.toLowerCase() === sender.toLowerCase(),
      "Deployment transaction sender mismatch",
    );
    const previous = transactions.at(-1);
    insist(
      previous === undefined || tx.nonce === previous.nonce + 1,
      "Deployment transaction nonces are not contiguous",
    );
    transactions.push(tx);
    terminalBlock = receipt.blockNumber;
    if (receipt.contractAddress)
      creations.add(receipt.contractAddress.toLowerCase());
  }
  return { transactions, hashes, terminalBlock, creations };
}

async function finalizeManifest(
  client: PublicClient,
  input: CcaInput,
  raw: Composition,
  history: History,
): Promise<ProtocolDeploymentManifestV3> {
  const contracts = canonicalContracts(raw);
  const read = callReader(client, history.terminalBlock);
  await verifyPending(read, raw, contracts, history);
  await verifySeals(read, contracts);
  await verifyCreations(client, contracts, history, raw.chainId);
  const owners = await ownership(read, contracts);
  const pools = await conversionPools(read, raw);
  const claimCode = await client.getCode({
    address: contractAt(contracts, "claimGate"),
    blockNumber: history.terminalBlock,
  });
  insist(claimCode, "Claim policy runtime is missing");
  const blocked = [
    raw.freshInfrastructure.testConversionVenueCodehash,
    ...input.blockedVenueCodehashes,
  ];
  await Promise.all(
    blocked.map(async (hash) =>
      insist(
        await read<boolean>(
          contractAt(contracts, "fuelCore"),
          "function isBlockedVenueCodehash(bytes32) view returns (bool)",
          [hash],
        ),
        `Venue ${hash} was not blocked`,
      ),
    ),
  );
  const manifest = {
    $schema: "./schema.json",
    schemaVersion: 3,
    phase: "cca",
    chainId: raw.chainId,
    network: raw.chainId === 31_337 ? "anvil" : "base-sepolia",
    contracts,
    roles: {
      owner: input.roles.deploymentOwner,
      governanceOwner: input.roles.governanceOwner,
      guardian: input.roles.guardian,
      recoveryAuthority: contractAt(contracts, "recoveryAuthority"),
      keeper: input.roles.keeper,
      liquidityExecutor: input.roles.liquidityExecutor,
      creator: input.roles.creator,
    },
    ...owners,
    blockedVenues: blocked.map((codehash, i) => ({
      label:
        i === 0 ? "orbit-sealed-route-test-venue" : `configured-venue-${i}`,
      codehash,
    })),
    claimPolicy: {
      mode: "always-allow",
      implementationCodehash: keccak256(claimCode),
      administrator: zeroAddress,
    },
    identity: {
      key: input.identity.key ?? selectedIdentityKey,
      manifestHash: collectionManifestHash,
      metadataRenderer: contractAt(contracts, "metadataRenderer"),
      metadataLocations: {
        transient: input.identity.transientImage,
        permanent: input.identity.permanentImage,
        basketRelic: input.identity.basketRelicImage,
        indicatorRelic: input.identity.indicatorRelicImage,
      },
    },
    conversionPools: pools,
    canonicalPool: {
      poolId: raw.auction.poolId,
      currency0: raw.auction.currency0,
      currency1: raw.auction.currency1,
      fee: raw.auction.poolFee,
      tickSpacing: raw.auction.poolTickSpacing,
      hooks: contractAt(contracts, "canonicalFeeHook"),
      seedSqrtPriceX96: "0",
      activeLiquidity: "0",
    },
    seals: {
      attributes: true,
      canonicalMarket: true,
      conversionRoutes: true,
      feeDestinations: true,
      discoveryExemptions: true,
      metadata: true,
    },
    launch: {
      blockNumber: history.terminalBlock.toString(),
      transactionHash: history.hashes.at(-1),
    },
    transactions: Object.fromEntries(
      history.hashes.map((hash, i) => [
        `step${i.toString().padStart(3, "0")}`,
        hash,
      ]),
    ),
    cca: {
      provenance: {
        continuousClearingAuction: {
          commit: raw.ccaSourceCommit,
          version: "v2.1.0",
        },
        liquidityLauncher: {
          commit: raw.liquidityLauncherSourceCommit,
          version: "v3.0.0",
        },
        lbpStrategy: {
          commit: raw.liquidityLauncherSourceCommit,
          version: "v3.1.0",
        },
      },
      economics: {
        totalFuelSupply: raw.auction.totalSupply,
        auctionSupply: raw.auction.auctionSupply,
        liquidityReserve: raw.auction.reserveSupply,
        minimumRaise: raw.auction.minimumRaise,
        floorPriceQ96: raw.auction.floorPriceQ96,
        tickSpacingQ96: raw.auction.auctionTickSpacingQ96,
      },
      lifecycle: {
        startBlock: String(raw.auction.startBlock),
        endBlock: String(raw.auction.endBlock),
        claimBlock: String(raw.auction.claimBlock),
        migrationBlock: String(raw.auction.migrationBlock),
      },
    },
  };
  const decoded = decodeProtocolDeploymentManifest(manifest);
  insist(decoded.schemaVersion === 3, "Expected a CCA manifest");
  return decoded;
}

function forge(
  script: string,
  rpcUrl: string,
  environment: NodeJS.ProcessEnv,
  broadcast: boolean,
  owner?: Address,
): void {
  const args = [
    "script",
    `script/${script}.s.sol:${script}`,
    "--rpc-url",
    rpcUrl,
    "--rpc-timeout",
    "120",
  ];
  if (owner) args.push("--sender", owner, "--unlocked");
  if (broadcast) args.push("--broadcast", "--slow");
  const result = spawnSync("forge", args, {
    cwd: contractsRoot,
    env: environment,
    stdio: "inherit",
  });
  insist(result.status === 0, `${script} failed (exit ${result.status})`);
}
function broadcastPath(script: string, chain: number): string {
  return join(
    contractsRoot,
    "broadcast",
    `${script}.s.sol`,
    String(chain),
    "run-latest.json",
  );
}

export function selectedCcaIdentity(): Record<string, string> {
  const identity = selectedIdentityConfiguration;
  return {
    key: selectedIdentityKey,
    liquidTokenName: identity.liquidToken.name,
    liquidTokenSymbol: identity.liquidToken.symbol,
    collectibleTokenName: identity.collectibleToken.name,
    collectibleTokenSymbol: identity.collectibleToken.symbol,
    transientCollectible: identity.terms.transientCollectible,
    permanentCollectible: identity.terms.permanentCollectible,
    basketRelic: identity.terms.basketRelic,
    indicatorRelic: identity.terms.indicatorRelic,
    metadataDescription: [
      identity.copy.metadataDescription,
      identity.disclosures.testnet,
      identity.disclosures.placeholderMetadata,
    ].join(" "),
    transientImage: identity.assets.transient,
    permanentImage: identity.assets.permanent,
    basketRelicImage: identity.assets.basketRelic,
    indicatorRelicImage: identity.assets.indicatorRelic,
  };
}

function localInput(
  owner: Address,
  other: Address,
  infrastructure: Infrastructure,
  head: bigint,
): CcaInput {
  const defaults = readJson<{
    liquidityReserveFuelWei: string;
    minimumWethRaisedWei: string;
    floorPriceQ96: string;
    priceTickSpacingQ96: string;
    issuanceSteps: { mpsPerBlock: number; blockCount: number }[];
  }>(join(repositoryRoot, "docs/economics/cca-testnet-defaults.json"));
  const startBlock = Number(head) + 1_000;
  const duration = defaults.issuanceSteps.reduce(
    (sum, step) => sum + step.blockCount,
    0,
  );
  const auctionSteps =
    `0x${defaults.issuanceSteps.map((step) => step.mpsPerBlock.toString(16).padStart(6, "0") + step.blockCount.toString(16).padStart(10, "0")).join("")}` as Hex;
  return {
    infrastructure,
    roles: {
      deploymentOwner: owner,
      governanceOwner: other,
      creator: owner,
      guardian: owner,
      keeper: owner,
      liquidityExecutor: owner,
      recoveryCosigner: other,
    },
    identity: selectedCcaIdentity(),
    discovery: { nativeFundingWei: "1000000000000000000" },
    auction: {
      reserveSupply: defaults.liquidityReserveFuelWei,
      minimumRaise: defaults.minimumWethRaisedWei,
      floorPriceQ96: defaults.floorPriceQ96,
      auctionTickSpacingQ96: defaults.priceTickSpacingQ96,
      startBlock,
      endBlock: startBlock + duration,
      claimBlock: startBlock + duration + 1,
      migrationBlock: startBlock + duration + 1,
      poolTickSpacing: 60,
      auctionSteps,
      distributionSalt: keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          [owner, head],
        ),
      ),
      testnetEconomicsConfirmed: true,
    },
    blockedVenueCodehashes: [],
  };
}
async function startLocalChain(): Promise<{
  process: ChildProcess;
  rpcUrl: string;
}> {
  const port = 22_000 + (process.pid % 10_000);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    "anvil",
    [
      "--silent",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--accounts",
      "3",
      "--balance",
      "10000",
    ],
    { stdio: "ignore" },
  );
  const client = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0 }),
  });
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId();
      return { process: child, rpcUrl };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  child.kill("SIGTERM");
  throw new Error("Local Anvil did not start");
}
async function installLocalPermit2(rpcUrl: string): Promise<void> {
  const source = readFileSync(
    join(
      contractsRoot,
      "lib/liquidity-launcher/lib/permit2/test/utils/DeployPermit2.sol",
    ),
    "utf8",
  );
  const runtime = /hex"([0-9a-f]+)"/.exec(source)?.[1];
  insist(runtime, "Pinned Permit2 runtime was not found");
  const client = createTestClient({ mode: "anvil", transport: http(rpcUrl) });
  await client.setCode({ address: permit2, bytecode: `0x${runtime}` });
}
async function prepareLocal(
  rpcUrl: string,
  directory: string,
): Promise<{ input: CcaInput; artifacts: string[] }> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  insist(
    (await client.getChainId()) === 31_337,
    "Local infrastructure is only supported on Anvil",
  );
  await installLocalPermit2(rpcUrl);
  const [owner, other] = await createWalletClient({
    transport: http(rpcUrl),
  }).getAddresses();
  insist(owner && other, "Two unlocked local accounts are required");
  const infraPath = join(directory, "infrastructure.json");
  forge(
    "DeployLocalCcaInfrastructure",
    rpcUrl,
    {
      ...process.env,
      DEPLOYER_ADDRESS: owner,
      CCA_LOCAL_INFRA_OUTPUT: infraPath,
    },
    true,
    owner,
  );
  const input = localInput(
    owner,
    other,
    readJson<Infrastructure>(infraPath),
    await client.getBlockNumber(),
  );
  return {
    input,
    artifacts: [broadcastPath("DeployLocalCcaInfrastructure", 31_337)],
  };
}

async function prepareInputs(rpcUrl: string, local: boolean, chainId: number) {
  const deploymentTarget = resolveCcaDeploymentEnvironment(
    chainId,
    local ? undefined : process.env.DEPLOYMENT_ENVIRONMENT,
  );
  const localDirectory = local
    ? mkdtempSync(
        join(repositoryRoot, "deployments/.local-deployment-test-cca-"),
      )
    : undefined;
  const output =
    localDirectory === undefined
      ? resolve(
          process.env.CCA_MANIFEST_OUTPUT ??
            deploymentTarget?.manifestPath ??
            "deployments/31337.json",
        )
      : join(localDirectory, `${chainId}.json`);
  const directory = dirname(output);
  const inputPath = local
    ? join(directory, "input.json")
    : process.env.CCA_DEPLOYMENT_INPUT;
  insist(inputPath, "CCA_DEPLOYMENT_INPUT is required");
  insist(
    !existsSync(output),
    `Refusing to overwrite existing deployment manifest ${output}`,
  );
  for (const path of [inputPath, output]) {
    insist(
      resolve(path).startsWith(`${join(repositoryRoot, "deployments")}/`),
      "Foundry deployment input and output must be inside deployments/",
    );
  }
  const paths = {
    directory,
    inputPath: resolve(inputPath),
    output,
    compositionPath: join(
      directory,
      `${output.slice(directory.length + 1).replace(/\.json$/u, "")}.composition.json`,
    ),
  };
  if (!local)
    return {
      ...paths,
      input: readJson<CcaInput>(paths.inputPath),
      artifacts: [] as string[],
    };
  const setup = await prepareLocal(rpcUrl, directory);
  writeJson(inputPath, setup.input);
  return { ...paths, ...setup };
}

async function runDeployment(
  rpcUrl: string,
  local: boolean,
  broadcast: boolean,
): Promise<void> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  insist(
    chainId === 31_337 || chainId === 84_532,
    `Unsupported chain ${chainId}`,
  );
  insist(
    chainId === 31_337 || process.env.DEPLOYER_PRIVATE_KEY,
    "DEPLOYER_PRIVATE_KEY is required to simulate or broadcast Base deployment",
  );
  const setup = await prepareInputs(rpcUrl, local, chainId);
  setup.input = validateCcaInput(
    setup.input,
    chainId,
    await client.getBlockNumber(),
  );
  const environment = {
    ...process.env,
    CCA_DEPLOYMENT_INPUT: setup.inputPath,
    CCA_DEPLOYMENT_OUTPUT: setup.compositionPath,
    DEPLOYER_ADDRESS: setup.input.roles.deploymentOwner,
  };
  forge(
    "DeployCcaProtocol",
    rpcUrl,
    environment,
    broadcast,
    chainId === 31_337 ? setup.input.roles.deploymentOwner : undefined,
  );
  if (!broadcast) {
    process.stdout.write(
      `CCA simulation completed: ${setup.compositionPath}\nNo canonical manifest or transaction claims were produced.\n`,
    );
    return;
  }
  const history = await reconcileBroadcasts(
    client,
    [...setup.artifacts, broadcastPath("DeployCcaProtocol", chainId)],
    setup.input.roles.deploymentOwner,
  );
  const raw = readJson<Composition>(setup.compositionPath);
  insist(raw.chainId === chainId, "Composition chain mismatch");
  const manifest = await finalizeManifest(client, setup.input, raw, history);
  raw.freshInfrastructure.vrfSubscriptionId = (
    await callReader(client, history.terminalBlock)<bigint>(
      raw.freshInfrastructure.vrfBootstrap,
      "function subscriptionId() view returns (uint256)",
    )
  ).toString();
  const firstProtocolHash = readJson<Broadcast>(
    broadcastPath("DeployCcaProtocol", chainId),
  ).transactions[0]?.hash;
  const firstProtocolTransaction = history.transactions.find(
    (transaction) => transaction.hash === firstProtocolHash,
  );
  insist(
    firstProtocolTransaction?.blockNumber,
    "First protocol deployment receipt is missing",
  );
  raw.deploymentBlock = Number(firstProtocolTransaction.blockNumber);
  writeJson(setup.compositionPath, raw);
  writeJson(setup.output, manifest);
  process.stdout.write(
    `Verified fresh CCA ${local ? "local rehearsal" : "deployment"}: ${setup.output}\n${history.hashes.length} confirmed setup transactions; auction pending at ${manifest.contracts.continuousClearingAuction}.\nComposition and exact input retained in ${setup.directory}\n`,
  );
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help")) {
    process.stdout.write(
      "deploy:cca-protocol --local-test | [--broadcast]\nExternal input: RPC_URL, DEPLOYMENT_ENVIRONMENT, CCA_DEPLOYMENT_INPUT, optional CCA_MANIFEST_OUTPUT, DEPLOYER_PRIVATE_KEY (Base). Base Sepolia requires an explicit deployment environment and defaults to that target's canonical manifest path. Without --broadcast, only a composition simulation is written. --local-test creates an isolated Anvil deployment and verifies a v3 manifest.\n",
    );
    return;
  }
  const local = args.includes("--local-test");
  let localChain: Awaited<ReturnType<typeof startLocalChain>> | undefined;
  try {
    if (local) localChain = await startLocalChain();
    const rpcUrl = localChain?.rpcUrl ?? process.env.RPC_URL;
    insist(rpcUrl, "RPC_URL is required");
    await runDeployment(rpcUrl, local, local || args.includes("--broadcast"));
  } finally {
    localChain?.process.kill("SIGTERM");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
