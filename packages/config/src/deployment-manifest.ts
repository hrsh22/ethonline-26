import { ParseResult, Schema } from "effect";
import {
  encodeAbiParameters,
  keccak256,
  sha256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { collectionManifestHash } from "./collection-manifest.js";

const EvmAddress = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/));
const Bytes32 = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{64}$/));
const NonZeroEvmAddress = EvmAddress.pipe(
  Schema.filter((value) => /[1-9a-f]/i.test(value.slice(2))),
);
const NonZeroBytes32 = Bytes32.pipe(
  Schema.filter((value) => /[1-9a-f]/i.test(value.slice(2))),
);
const ZeroBytes32 = Schema.Literal(
  "0x0000000000000000000000000000000000000000000000000000000000000000",
);
const PositiveDecimal = Schema.String.pipe(Schema.pattern(/^[1-9][0-9]*$/));
const MetadataLocation = Schema.String.pipe(Schema.minLength(1));
const TransactionName = Schema.String.pipe(Schema.pattern(/^step[0-9]{3}$/));
const Transactions = Schema.Record({
  key: TransactionName,
  value: NonZeroBytes32,
}).pipe(
  Schema.filter((transactions) => {
    const names = Object.keys(transactions).sort();
    return (
      names.length > 0 &&
      names.every(
        (name, index) => name === `step${index.toString().padStart(3, "0")}`,
      )
    );
  }),
);

const SharedVenueContracts = {
  mockAaplc: NonZeroEvmAddress,
  mockGooglc: NonZeroEvmAddress,
  mockMetac: NonZeroEvmAddress,
  mockNvdac: NonZeroEvmAddress,
  testConversionVenue: NonZeroEvmAddress,
  uniswapV4PoolManager: NonZeroEvmAddress,
} as const;

const SelfFundedVenueContracts = Schema.Struct({
  ...SharedVenueContracts,
  selfFundedTestUsdc: NonZeroEvmAddress,
  selfFundedTestWeth: NonZeroEvmAddress,
});

const OfficialVenueContracts = Schema.Struct({
  ...SharedVenueContracts,
  circleTestUsdc: NonZeroEvmAddress,
  officialWeth: NonZeroEvmAddress,
});

const ProtocolContracts = Schema.Struct({
  aaplcConversionAdapter: NonZeroEvmAddress,
  attributeRegistry: NonZeroEvmAddress,
  canonicalFeeHook: NonZeroEvmAddress,
  canonicalHookDeployer: NonZeroEvmAddress,
  canonicalMarketRegistry: NonZeroEvmAddress,
  canonicalRouter: NonZeroEvmAddress,
  claimGate: NonZeroEvmAddress,
  discoveryAdapter: NonZeroEvmAddress,
  epochConverter: NonZeroEvmAddress,
  fuelCore: NonZeroEvmAddress,
  fuelMirror: NonZeroEvmAddress,
  genesisLiquidityVault: NonZeroEvmAddress,
  googlcConversionAdapter: NonZeroEvmAddress,
  metacConversionAdapter: NonZeroEvmAddress,
  metadataRenderer: NonZeroEvmAddress,
  mockAaplc: NonZeroEvmAddress,
  mockGooglc: NonZeroEvmAddress,
  mockMetac: NonZeroEvmAddress,
  mockNvdac: NonZeroEvmAddress,
  nvdacConversionAdapter: NonZeroEvmAddress,
  protocolLiquidityVault: NonZeroEvmAddress,
  recoveryAuthority: NonZeroEvmAddress,
  rewardLedger: NonZeroEvmAddress,
  testConversionVenue: NonZeroEvmAddress,
  uniswapV4PoolManager: NonZeroEvmAddress,
  usdc: NonZeroEvmAddress,
  weth: NonZeroEvmAddress,
});

const VerifiedConversionPoolSchema = Schema.Struct({
  poolId: NonZeroBytes32,
  currency0: NonZeroEvmAddress,
  currency1: NonZeroEvmAddress,
  fee: Schema.Number.pipe(Schema.int(), Schema.between(1, 1_000_000)),
  tickSpacing: Schema.Number.pipe(Schema.int(), Schema.between(1, 32_767)),
  hooks: EvmAddress,
  seedSqrtPriceX96: PositiveDecimal,
  activeLiquidity: PositiveDecimal,
});

const ConversionPools = Schema.Struct({
  wethUsdc: VerifiedConversionPoolSchema,
  aaplc: VerifiedConversionPoolSchema,
  googlc: VerifiedConversionPoolSchema,
  metac: VerifiedConversionPoolSchema,
  nvdac: VerifiedConversionPoolSchema,
});

const VenueDeploymentManifestPrefix = {
  $schema: Schema.Literal("./schema.json"),
  schemaVersion: Schema.Literal(1),
  chainId: Schema.Literal(84532),
  network: Schema.Literal("base-sepolia"),
  conversionPools: ConversionPools,
} as const;

const SelfFundedVenueDeploymentManifestSchema = Schema.Struct({
  ...VenueDeploymentManifestPrefix,
  contracts: SelfFundedVenueContracts,
});

const OfficialVenueDeploymentManifestSchema = Schema.Struct({
  ...VenueDeploymentManifestPrefix,
  contracts: OfficialVenueContracts,
});

const VenueDeploymentManifestSchema = Schema.Union(
  SelfFundedVenueDeploymentManifestSchema,
  OfficialVenueDeploymentManifestSchema,
);

const VerifiedCanonicalPoolSchema = Schema.Struct({
  poolId: NonZeroBytes32,
  currency0: NonZeroEvmAddress,
  currency1: NonZeroEvmAddress,
  fee: Schema.Literal(8_388_608),
  tickSpacing: Schema.Literal(60),
  hooks: NonZeroEvmAddress,
  seedSqrtPriceX96: PositiveDecimal,
  activeLiquidity: PositiveDecimal,
});

const ProtocolDeploymentManifestPrefix = {
  $schema: Schema.Literal("./schema.json"),
  schemaVersion: Schema.Literal(2),
} as const;

const ProtocolDeploymentManifestBody = {
  phase: Schema.Literal("launched"),
  contracts: ProtocolContracts,
  roles: Schema.Struct({
    owner: NonZeroEvmAddress,
    /**
     * Owns the mutable modules. A multisig belongs here so governance is
     * separate from the hot keeper and executor keys. Optional so an existing
     * manifest stays valid; absent means it equals `owner`.
     */
    governanceOwner: Schema.optional(NonZeroEvmAddress),
    guardian: NonZeroEvmAddress,
    recoveryAuthority: NonZeroEvmAddress,
    keeper: NonZeroEvmAddress,
    liquidityExecutor: NonZeroEvmAddress,
    creator: NonZeroEvmAddress,
  }),
  /**
   * Each mutable module's actual owner. A single nominal owner hid that they
   * are independent, so health could not verify them and a partial handover
   * would go unnoticed.
   */
  moduleOwners: Schema.optional(
    Schema.Struct({
      liquidToken: NonZeroEvmAddress,
      rewardLedger: NonZeroEvmAddress,
      epochConverter: NonZeroEvmAddress,
      marketRegistry: NonZeroEvmAddress,
      protocolLiquidityVault: NonZeroEvmAddress,
    }),
  ),
  /**
   * Each module's outstanding ownership nomination, or the zero address where
   * there is none. Ownership is two-step, so a governed deployment ends with
   * the deployer still owning every module and the handover only offered.
   * Recording `moduleOwners` alone therefore cannot distinguish a handover that
   * was never offered from one offered to the wrong address, and whoever holds
   * a nomination can take the module by accepting it. Zero is a meaningful
   * value here, so these are plain addresses rather than non-zero ones.
   */
  modulePendingOwners: Schema.optional(
    Schema.Struct({
      liquidToken: EvmAddress,
      rewardLedger: EvmAddress,
      epochConverter: EvmAddress,
      marketRegistry: EvmAddress,
      protocolLiquidityVault: EvmAddress,
    }),
  ),
  /**
   * The exact alternative venues this deployment blocked, each with the label
   * it carried in the deployment inputs. The blocklist is frozen at launch, so
   * this is the complete and final inventory for the deployment and health can
   * name which venue drifted rather than printing a bare hash.
   *
   * Codehash blocking reaches singleton venues and shared-implementation pairs.
   * It cannot reach Uniswap V3 style pools, which embed their token pair and
   * fee as immutables and so have one codehash per pool, nor Uniswap V4 pools,
   * which have no address of their own at all. See ADR 0002.
   */
  blockedVenues: Schema.optional(
    Schema.Array(
      Schema.Struct({
        label: Schema.String.pipe(Schema.minLength(1)),
        codehash: NonZeroBytes32,
      }),
    ).pipe(Schema.minItems(1)),
  ),
  /**
   * The claim policy this deployment bound, and who may change eligibility.
   * `always-allow` cannot deny, so a browser wallet cannot exercise the denied
   * path; `configurable` can, and names its authorized administrator.
   */
  claimPolicy: Schema.optional(
    Schema.Struct({
      mode: Schema.Literal("always-allow", "configurable"),
      implementationCodehash: NonZeroBytes32,
      administrator: EvmAddress,
    }),
  ),
  identity: Schema.Struct({
    key: Schema.Literal("orbit-4444", "neutral-test"),
    manifestHash: NonZeroBytes32,
    metadataRenderer: NonZeroEvmAddress,
    metadataLocations: Schema.Struct({
      transient: MetadataLocation,
      permanent: MetadataLocation,
      basketRelic: MetadataLocation,
      indicatorRelic: MetadataLocation,
    }),
  }),
  conversionPools: ConversionPools,
  canonicalPool: VerifiedCanonicalPoolSchema,
  seals: Schema.Struct({
    attributes: Schema.Literal(true),
    canonicalMarket: Schema.Literal(true),
    conversionRoutes: Schema.Literal(true),
    feeDestinations: Schema.Literal(true),
    discoveryExemptions: Schema.Literal(true),
    metadata: Schema.Literal(true),
  }),
  launch: Schema.Struct({
    blockNumber: PositiveDecimal,
    transactionHash: NonZeroBytes32,
  }),
  transactions: Transactions,
} as const;

const AnvilProtocolDeploymentManifestSchema = Schema.Struct({
  ...ProtocolDeploymentManifestPrefix,
  chainId: Schema.Literal(31_337),
  network: Schema.Literal("anvil"),
  ...ProtocolDeploymentManifestBody,
});

const BaseSepoliaProtocolDeploymentManifestSchema = Schema.Struct({
  ...ProtocolDeploymentManifestPrefix,
  chainId: Schema.Literal(84_532),
  network: Schema.Literal("base-sepolia"),
  ...ProtocolDeploymentManifestBody,
});

const ProtocolDeploymentStagingManifestBody = {
  ...ProtocolDeploymentManifestBody,
  launch: Schema.Struct({
    blockNumber: Schema.Literal("0"),
    transactionHash: ZeroBytes32,
  }),
  transactions: Schema.Struct({ pending: ZeroBytes32 }),
} as const;

const AnvilProtocolDeploymentStagingManifestSchema = Schema.Struct({
  ...ProtocolDeploymentManifestPrefix,
  chainId: Schema.Literal(31_337),
  network: Schema.Literal("anvil"),
  ...ProtocolDeploymentStagingManifestBody,
});

const BaseSepoliaProtocolDeploymentStagingManifestSchema = Schema.Struct({
  ...ProtocolDeploymentManifestPrefix,
  chainId: Schema.Literal(84_532),
  network: Schema.Literal("base-sepolia"),
  ...ProtocolDeploymentStagingManifestBody,
});

type VenueDeploymentManifest =
  | typeof SelfFundedVenueDeploymentManifestSchema.Type
  | typeof OfficialVenueDeploymentManifestSchema.Type;
export type ProtocolDeploymentManifest =
  | typeof AnvilProtocolDeploymentManifestSchema.Type
  | typeof BaseSepoliaProtocolDeploymentManifestSchema.Type;
export type ProtocolDeploymentStagingManifest =
  | typeof AnvilProtocolDeploymentStagingManifestSchema.Type
  | typeof BaseSepoliaProtocolDeploymentStagingManifestSchema.Type;
export type DeploymentManifest =
  VenueDeploymentManifest | ProtocolDeploymentManifest;

export class DeploymentManifestValidationError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    const uniqueFields = [...new Set(fields)];
    super(
      `Invalid deployment manifest field${uniqueFields.length === 1 ? "" : "s"}: ${uniqueFields.join(", ")}`,
    );
    this.name = "DeploymentManifestValidationError";
    this.fields = uniqueFields;
  }
}

const transactionSemanticIssueFields = (
  manifest: ProtocolDeploymentManifest,
): readonly string[] => {
  const entries = Object.entries(manifest.transactions).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const fields: string[] = [];
  const namesByHash = new Map<string, string[]>();
  for (const [name, transactionHash] of entries) {
    const normalizedHash = transactionHash.toLowerCase();
    namesByHash.set(normalizedHash, [
      ...(namesByHash.get(normalizedHash) ?? []),
      name,
    ]);
  }
  for (const names of namesByHash.values()) {
    if (names.length > 1) {
      fields.push(...names.map((name) => `transactions.${name}`));
    }
  }
  const terminalEntry = entries.at(-1);
  if (
    terminalEntry === undefined ||
    terminalEntry[1].toLowerCase() !==
      manifest.launch.transactionHash.toLowerCase()
  ) {
    fields.push("launch.transactionHash");
    if (terminalEntry !== undefined) {
      fields.push(`transactions.${terminalEntry[0]}`);
    }
  }
  return fields;
};

const normalizedAddress = (address: string): string => address.toLowerCase();

const addressPairMatchesCanonicalOrder = (
  actual0: string,
  actual1: string,
  expected0: string,
  expected1: string,
): boolean => {
  const normalizedExpected0 = normalizedAddress(expected0);
  const normalizedExpected1 = normalizedAddress(expected1);
  const [expectedCurrency0, expectedCurrency1] =
    BigInt(normalizedExpected0) < BigInt(normalizedExpected1)
      ? [normalizedExpected0, normalizedExpected1]
      : [normalizedExpected1, normalizedExpected0];
  return (
    normalizedAddress(actual0) === expectedCurrency0 &&
    normalizedAddress(actual1) === expectedCurrency1
  );
};

const contractUniquenessIssueFields = (
  contracts: Record<string, string>,
): readonly string[] => {
  const namesByAddress = new Map<string, string[]>();
  for (const [name, address] of Object.entries(contracts)) {
    const normalized = normalizedAddress(address);
    namesByAddress.set(normalized, [
      ...(namesByAddress.get(normalized) ?? []),
      name,
    ]);
  }
  return [...namesByAddress.values()]
    .filter((names) => names.length > 1)
    .flatMap((names) => names.map((name) => `contracts.${name}`));
};

type ManifestWithConversionPools =
  DeploymentManifest | ProtocolDeploymentStagingManifest;

interface V4PoolKeyEvidence {
  readonly poolId: string;
  readonly currency0: string;
  readonly currency1: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: string;
}

const computedV4PoolId = (pool: V4PoolKeyEvidence): string =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [
        pool.currency0 as Address,
        pool.currency1 as Address,
        pool.fee,
        pool.tickSpacing,
        pool.hooks as Address,
      ],
    ),
  );

const poolIdSemanticIssueFields = (
  pool: V4PoolKeyEvidence,
  fieldPrefix: string,
): readonly string[] =>
  pool.poolId.toLowerCase() === computedV4PoolId(pool).toLowerCase()
    ? []
    : [`${fieldPrefix}.poolId`];

const conversionPoolSemanticIssueFields = (
  manifest: ManifestWithConversionPools,
): readonly string[] => {
  const contracts = manifest.contracts;
  const settlementAssets =
    "weth" in contracts
      ? { weth: contracts.weth, usdc: contracts.usdc }
      : "selfFundedTestWeth" in contracts
        ? {
            weth: contracts.selfFundedTestWeth,
            usdc: contracts.selfFundedTestUsdc,
          }
        : { weth: contracts.officialWeth, usdc: contracts.circleTestUsdc };
  const expectedPairs = {
    wethUsdc: [settlementAssets.weth, settlementAssets.usdc],
    aaplc: [settlementAssets.usdc, contracts.mockAaplc],
    googlc: [settlementAssets.usdc, contracts.mockGooglc],
    metac: [settlementAssets.usdc, contracts.mockMetac],
    nvdac: [settlementAssets.usdc, contracts.mockNvdac],
  } as const;
  const fields: string[] = [];
  for (const poolName of Object.keys(expectedPairs) as Array<
    keyof typeof expectedPairs
  >) {
    const pool = manifest.conversionPools[poolName];
    const [expected0, expected1] = expectedPairs[poolName];
    fields.push(
      ...poolIdSemanticIssueFields(pool, `conversionPools.${poolName}`),
    );
    if (
      !addressPairMatchesCanonicalOrder(
        pool.currency0,
        pool.currency1,
        expected0,
        expected1,
      )
    ) {
      fields.push(
        `conversionPools.${poolName}.currency0`,
        `conversionPools.${poolName}.currency1`,
      );
    }
    if (pool.hooks !== "0x0000000000000000000000000000000000000000") {
      fields.push(`conversionPools.${poolName}.hooks`);
    }
  }
  return fields;
};

const protocolCrossFieldSemanticIssueFields = (
  manifest: ProtocolDeploymentManifest | ProtocolDeploymentStagingManifest,
): readonly string[] => {
  const fields: string[] = [
    ...poolIdSemanticIssueFields(manifest.canonicalPool, "canonicalPool"),
  ];
  if (
    normalizedAddress(manifest.contracts.recoveryAuthority) !==
    normalizedAddress(manifest.roles.recoveryAuthority)
  ) {
    fields.push("contracts.recoveryAuthority", "roles.recoveryAuthority");
  }
  if (
    normalizedAddress(manifest.contracts.metadataRenderer) !==
    normalizedAddress(manifest.identity.metadataRenderer)
  ) {
    fields.push("contracts.metadataRenderer", "identity.metadataRenderer");
  }
  if (manifest.identity.manifestHash !== collectionManifestHash) {
    fields.push("identity.manifestHash");
  }
  if (
    !addressPairMatchesCanonicalOrder(
      manifest.canonicalPool.currency0,
      manifest.canonicalPool.currency1,
      manifest.contracts.fuelCore,
      manifest.contracts.weth,
    )
  ) {
    fields.push("canonicalPool.currency0", "canonicalPool.currency1");
  }
  if (
    normalizedAddress(manifest.canonicalPool.hooks) !==
    normalizedAddress(manifest.contracts.canonicalFeeHook)
  ) {
    fields.push("canonicalPool.hooks", "contracts.canonicalFeeHook");
  }
  fields.push(...governanceSemanticIssueFields(manifest));
  return fields;
};

const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Governance and claim-policy records that decode individually but describe an
 * incoherent deployment together. The deploy script maintains each of these
 * invariants when it writes a manifest; the schema has to enforce them so a
 * hand-edited or partially re-recorded manifest cannot claim a state no
 * deployment can produce.
 */
const governanceSemanticIssueFields = (
  manifest: ProtocolDeploymentManifest | ProtocolDeploymentStagingManifest,
): readonly string[] => [
  ...moduleOwnershipSemanticIssueFields(manifest),
  ...claimPolicySemanticIssueFields(manifest.claimPolicy),
];

const moduleOwnershipSemanticIssueFields = (
  manifest: ProtocolDeploymentManifest | ProtocolDeploymentStagingManifest,
): readonly string[] => {
  const fields: string[] = [];
  if (
    manifest.modulePendingOwners !== undefined &&
    manifest.moduleOwners === undefined
  ) {
    // A nomination record without an owner record cannot be verified against
    // anything; the two are written together.
    fields.push("modulePendingOwners", "moduleOwners");
  }
  for (const [module, pending] of Object.entries(
    manifest.modulePendingOwners ?? {},
  )) {
    const owner = manifest.moduleOwners?.[
      module as keyof NonNullable<typeof manifest.moduleOwners>
    ] as string | undefined;
    if (
      owner !== undefined &&
      normalizedAddress(pending) !== normalizedAddress(ZERO_EVM_ADDRESS) &&
      normalizedAddress(pending) === normalizedAddress(owner)
    ) {
      // TwoStepOwnable rejects nominating the current owner, so a manifest
      // recording one describes a chain state that cannot exist.
      fields.push(`modulePendingOwners.${module}`);
    }
  }
  return fields;
};

const claimPolicySemanticIssueFields = (
  policy: ProtocolDeploymentManifest["claimPolicy"],
): readonly string[] => {
  if (policy === undefined) return [];
  const administratorIsZero =
    normalizedAddress(policy.administrator) ===
    normalizedAddress(ZERO_EVM_ADDRESS);
  // The deploy script records the zero administrator for always-allow -- that
  // gate has no administrator at all -- and a real address for configurable,
  // whose whole point is a named administrator.
  if (policy.mode === "configurable" && administratorIsZero) {
    return ["claimPolicy.administrator"];
  }
  if (policy.mode === "always-allow" && !administratorIsZero) {
    return ["claimPolicy.administrator", "claimPolicy.mode"];
  }
  return [];
};

const sharedSemanticIssueFields = (
  manifest: ManifestWithConversionPools,
): readonly string[] => [
  ...contractUniquenessIssueFields(
    manifest.contracts as Record<string, string>,
  ),
  ...conversionPoolSemanticIssueFields(manifest),
  ...(manifest.schemaVersion === 2
    ? protocolCrossFieldSemanticIssueFields(manifest)
    : []),
];

export const validateDeploymentManifestSemantics = <
  Manifest extends DeploymentManifest,
>(
  manifest: Manifest,
): Manifest => {
  const fields = [
    ...sharedSemanticIssueFields(manifest),
    ...(manifest.schemaVersion === 2
      ? transactionSemanticIssueFields(manifest)
      : []),
  ];
  if (fields.length > 0) {
    throw new DeploymentManifestValidationError(fields);
  }
  return manifest;
};

const sanitizeManifestDecode =
  <Manifest>(
    decode: (input: unknown) => Manifest,
  ): ((input: unknown) => Manifest) =>
  (input) => {
    try {
      return decode(input);
    } catch (error) {
      if (!ParseResult.isParseError(error)) {
        throw new DeploymentManifestValidationError(["manifest"]);
      }
      const fields = ParseResult.ArrayFormatter.formatIssueSync(
        error.issue,
      ).map(({ path }) =>
        path.length === 0 ? "manifest" : path.map(String).join("."),
      );
      throw new DeploymentManifestValidationError(fields);
    }
  };

const exactParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const decodeVenueDeploymentManifestStructure = sanitizeManifestDecode(
  Schema.decodeUnknownSync(VenueDeploymentManifestSchema, exactParseOptions),
);
const decodeSelfFundedVenueDeploymentManifestStructure = sanitizeManifestDecode(
  Schema.decodeUnknownSync(
    SelfFundedVenueDeploymentManifestSchema,
    exactParseOptions,
  ),
);
const decodeOfficialVenueDeploymentManifestStructure = sanitizeManifestDecode(
  Schema.decodeUnknownSync(
    OfficialVenueDeploymentManifestSchema,
    exactParseOptions,
  ),
);
const decodeAnvilProtocolDeploymentManifestStructure = sanitizeManifestDecode(
  Schema.decodeUnknownSync(
    AnvilProtocolDeploymentManifestSchema,
    exactParseOptions,
  ),
);
const decodeBaseSepoliaProtocolDeploymentManifestStructure =
  sanitizeManifestDecode(
    Schema.decodeUnknownSync(
      BaseSepoliaProtocolDeploymentManifestSchema,
      exactParseOptions,
    ),
  );
const decodeAnvilProtocolDeploymentStagingManifestStructure =
  sanitizeManifestDecode(
    Schema.decodeUnknownSync(
      AnvilProtocolDeploymentStagingManifestSchema,
      exactParseOptions,
    ),
  );
const decodeBaseSepoliaProtocolDeploymentStagingManifestStructure =
  sanitizeManifestDecode(
    Schema.decodeUnknownSync(
      BaseSepoliaProtocolDeploymentStagingManifestSchema,
      exactParseOptions,
    ),
  );

const inputRecord = (input: unknown): Record<string, unknown> | undefined =>
  typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;

const selectedProtocolDeploymentMode = (
  input: Record<string, unknown>,
): "anvil" | "base-sepolia" => {
  if (input.chainId === 31_337) return "anvil";
  if (input.chainId === 84_532) return "base-sepolia";
  if (input.network === "anvil") return "anvil";
  if (input.network === "base-sepolia") return "base-sepolia";
  throw new DeploymentManifestValidationError(["chainId", "network"]);
};

const decodeProtocolDeploymentManifestStructure = (
  input: unknown,
): ProtocolDeploymentManifest => {
  const record = inputRecord(input);
  if (record === undefined) {
    throw new DeploymentManifestValidationError(["manifest"]);
  }
  if (record.schemaVersion !== 2) {
    throw new DeploymentManifestValidationError(["schemaVersion"]);
  }
  return selectedProtocolDeploymentMode(record) === "anvil"
    ? decodeAnvilProtocolDeploymentManifestStructure(input)
    : decodeBaseSepoliaProtocolDeploymentManifestStructure(input);
};

const decodeProtocolDeploymentStagingManifestStructure = (
  input: unknown,
): ProtocolDeploymentStagingManifest => {
  const record = inputRecord(input);
  if (record === undefined) {
    throw new DeploymentManifestValidationError(["manifest"]);
  }
  if (record.schemaVersion !== 2) {
    throw new DeploymentManifestValidationError(["schemaVersion"]);
  }
  return selectedProtocolDeploymentMode(record) === "anvil"
    ? decodeAnvilProtocolDeploymentStagingManifestStructure(input)
    : decodeBaseSepoliaProtocolDeploymentStagingManifestStructure(input);
};

const decodeSelectedVenueDeploymentManifestStructure = (
  input: unknown,
  record: Record<string, unknown>,
): DeploymentManifest => {
  const contracts = inputRecord(record.contracts);
  if (contracts === undefined) {
    return decodeVenueDeploymentManifestStructure(input);
  }
  const selfFundedMode =
    "selfFundedTestUsdc" in contracts || "selfFundedTestWeth" in contracts;
  const officialMode =
    "circleTestUsdc" in contracts || "officialWeth" in contracts;
  if (selfFundedMode && !officialMode) {
    return decodeSelfFundedVenueDeploymentManifestStructure(input);
  }
  if (officialMode && !selfFundedMode) {
    return decodeOfficialVenueDeploymentManifestStructure(input);
  }
  return decodeVenueDeploymentManifestStructure(input);
};

const decodeDeploymentManifestStructure = (
  input: unknown,
): DeploymentManifest => {
  const record = inputRecord(input);
  if (record === undefined) {
    throw new DeploymentManifestValidationError(["manifest"]);
  }
  if (record.schemaVersion === 2) {
    return decodeProtocolDeploymentManifestStructure(input);
  }
  if (record.schemaVersion !== 1) {
    throw new DeploymentManifestValidationError(["schemaVersion"]);
  }
  return decodeSelectedVenueDeploymentManifestStructure(input, record);
};

const validateProtocolDeploymentStagingManifestSemantics = (
  manifest: ProtocolDeploymentStagingManifest,
): ProtocolDeploymentStagingManifest => {
  const fields = sharedSemanticIssueFields(manifest);
  if (fields.length > 0) {
    throw new DeploymentManifestValidationError(fields);
  }
  return manifest;
};

export const decodeDeploymentManifest = (input: unknown): DeploymentManifest =>
  validateDeploymentManifestSemantics(decodeDeploymentManifestStructure(input));

export const decodeProtocolDeploymentManifest = (
  input: unknown,
): ProtocolDeploymentManifest =>
  validateDeploymentManifestSemantics(
    decodeProtocolDeploymentManifestStructure(input),
  );

export const isProtocolDeploymentManifest = (
  input: unknown,
): input is ProtocolDeploymentManifest => {
  try {
    decodeProtocolDeploymentManifest(input);
    return true;
  } catch {
    return false;
  }
};

export const decodeProtocolDeploymentStagingManifest = (
  input: unknown,
): ProtocolDeploymentStagingManifest =>
  validateProtocolDeploymentStagingManifestSemantics(
    decodeProtocolDeploymentStagingManifestStructure(input),
  );

export const deploymentManifestFingerprint = (
  manifest: DeploymentManifest,
): Hex => sha256(stringToHex(JSON.stringify(manifest)));
