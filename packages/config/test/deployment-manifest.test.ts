import { readFileSync } from "node:fs";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import * as deploymentManifestModule from "../src/deployment-manifest.js";
import {
  decodeDeploymentManifest,
  deploymentManifestFingerprint,
  decodeProtocolDeploymentManifest,
  decodeProtocolDeploymentStagingManifest,
  isProtocolDeploymentManifest,
  type DeploymentManifest,
  validateDeploymentManifestSemantics,
} from "../src/deployment-manifest.js";

const Ajv2020 = Ajv2020Module.default;

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}`;
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}`;

const ccaManifest = (): Record<string, unknown> => {
  const legacy = JSON.parse(
    readFileSync("../../deployments/31337.json", "utf8"),
  ) as Record<string, unknown>;
  const contracts = structuredClone(
    legacy.contracts as Record<string, unknown>,
  );
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
    legacy.canonicalPool as Record<string, unknown>,
  );
  canonicalPool.seedSqrtPriceX96 = "0";
  canonicalPool.activeLiquidity = "0";
  return {
    ...legacy,
    schemaVersion: 3,
    phase: "cca",
    contracts,
    canonicalPool,
    cca: {
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
    },
  };
};

const nonCanonicalCaseVariants = (canonicalHash: string): readonly string[] => [
  `0x${canonicalHash.slice(2).toUpperCase()}`,
  `0x${canonicalHash
    .slice(2)
    .replace(/[a-f]/g, (digit, offset) =>
      offset % 2 === 0 ? digit.toUpperCase() : digit,
    )}`,
];

const venueManifest = (
  provenance: "self-funded" | "official",
): Record<string, unknown> => {
  const protocol = JSON.parse(
    readFileSync("../../deployments/84532.json", "utf8"),
  ) as Record<string, unknown>;
  const contracts = protocol.contracts as Record<string, string>;
  return {
    $schema: "./schema.json",
    schemaVersion: 1,
    chainId: 84_532,
    network: "base-sepolia",
    contracts: {
      mockAaplc: contracts.mockAaplc,
      mockGooglc: contracts.mockGooglc,
      mockMetac: contracts.mockMetac,
      mockNvdac: contracts.mockNvdac,
      testConversionVenue: contracts.testConversionVenue,
      uniswapV4PoolManager: contracts.uniswapV4PoolManager,
      ...(provenance === "self-funded"
        ? {
            selfFundedTestUsdc: contracts.usdc,
            selfFundedTestWeth: contracts.weth,
          }
        : {
            circleTestUsdc: contracts.usdc,
            officialWeth: contracts.weth,
          }),
    },
    conversionPools: protocol.conversionPools,
  };
};

const setPath = (
  source: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> => {
  const candidate = structuredClone(source);
  let target = candidate;
  for (const segment of path.slice(0, -1)) {
    target = target[segment] as Record<string, unknown>;
  }
  target[path.at(-1)!] = value;
  return candidate;
};

const deletePath = (
  source: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> => {
  const candidate = structuredClone(source);
  let target = candidate;
  for (const segment of path.slice(0, -1)) {
    target = target[segment] as Record<string, unknown>;
  }
  delete target[path.at(-1)!];
  return candidate;
};

const objectAtPath = (
  source: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> => {
  let target = source;
  for (const segment of path) {
    target = target[segment] as Record<string, unknown>;
  }
  return target;
};

const swapPoolCurrencies = (
  source: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> => {
  const candidate = structuredClone(source);
  const pool = objectAtPath(candidate, path);
  const currency0 = pool.currency0;
  pool.currency0 = pool.currency1;
  pool.currency1 = currency0;
  return candidate;
};

const swapPoolFields = (
  source: Record<string, unknown>,
  path: readonly string[],
  left: string,
  right: string,
): Record<string, unknown> => {
  const candidate = structuredClone(source);
  const pool = objectAtPath(candidate, path);
  [pool[left], pool[right]] = [pool[right], pool[left]];
  return candidate;
};

/**
 * Root keys a complete protocol manifest may omit. Everything else must be
 * rejected when dropped, which is what the corpus below enforces.
 */
const optionalProtocolManifestKeys = new Set([
  "moduleOwners",
  "modulePendingOwners",
  "claimPolicy",
  "blockedVenues",
]);

/**
 * Optional by design: a deployment that never configured a separate governance
 * owner, a deniable claim policy, or a venue inventory records none of these,
 * and the Anvil manifest is exactly that. Requiring them would invalidate every
 * manifest written before they existed, so both validators must accept their
 * absence rather than the corpus asserting rejection.
 */
const expectOptionalRootKey = (
  validateJsonSchema: (candidate: unknown) => boolean,
  name: string,
  manifest: Record<string, unknown>,
  key: string,
): void => {
  // The owner and nomination records are written together and the semantic
  // validator rejects one without the other, so the acceptance check drops
  // the pair rather than fabricating the incoherent single-record manifest.
  const withoutKey =
    key === "moduleOwners" || key === "modulePendingOwners"
      ? deletePath(deletePath(manifest, ["moduleOwners"]), [
          "modulePendingOwners",
        ])
      : deletePath(manifest, [key]);
  expect(
    () => decodeDeploymentManifest(withoutKey),
    `${name} without root.${key}`,
  ).not.toThrow();
  expect(
    validateJsonSchema(withoutKey),
    `${name} without root.${key}: portable schema`,
  ).toBe(true);
};

/** Nested keys a complete protocol manifest may omit. */
const optionalProtocolManifestPaths = new Set(["roles.governanceOwner"]);

/**
 * Every nested key of a complete protocol manifest that must be rejected when
 * dropped, plus an unexpected key at each level. `roles.governanceOwner` is
 * exempt: it is absent whenever a deployment has no separate governance signer,
 * which means it equals `roles.owner`, so requiring it would invalidate every
 * ungoverned deployment.
 */
const nestedProtocolMutations = (
  baseProtocol: Record<string, unknown>,
): ReadonlyArray<{ name: string; candidate: unknown }> => {
  const mutations: Array<{ name: string; candidate: unknown }> = [];
  for (const path of [
    ["roles"],
    ["identity"],
    ["identity", "metadataLocations"],
    ["canonicalPool"],
    ["seals"],
    ["launch"],
  ] as const) {
    for (const key of Object.keys(objectAtPath(baseProtocol, path))) {
      const name = [...path, key].join(".");
      if (optionalProtocolManifestPaths.has(name)) {
        expect(
          () =>
            decodeDeploymentManifest(deletePath(baseProtocol, [...path, key])),
          `v2 protocol without ${name}`,
        ).not.toThrow();
        continue;
      }
      mutations.push({
        name: `v2 protocol missing ${name}`,
        candidate: deletePath(baseProtocol, [...path, key]),
      });
    }
    mutations.push({
      name: `v2 protocol extra ${[...path, "secretSentinel"].join(".")}`,
      candidate: setPath(
        baseProtocol,
        [...path, "secretSentinel"],
        "must-not-survive",
      ),
    });
  }
  return mutations;
};

const deploymentManifestFixtures = (): ReadonlyArray<{
  readonly name: string;
  readonly manifest: Record<string, unknown>;
}> => [
  { name: "v1 self-funded venue", manifest: venueManifest("self-funded") },
  { name: "v1 official venue", manifest: venueManifest("official") },
  {
    name: "v2 Anvil protocol",
    manifest: JSON.parse(
      readFileSync("../../deployments/31337.json", "utf8"),
    ) as Record<string, unknown>,
  },
  {
    name: "checked Base Sepolia protocol",
    manifest: JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>,
  },
  { name: "v3 Anvil CCA protocol", manifest: ccaManifest() },
  {
    name: "v3 Base Sepolia CCA protocol",
    manifest: (() => {
      const manifest = ccaManifest();
      manifest.chainId = 84_532;
      manifest.network = "base-sepolia";
      delete (manifest.contracts as Record<string, unknown>).ccaCreate2Deployer;
      return manifest;
    })(),
  },
];

describe("governance record coherence", () => {
  const baseManifest = () =>
    JSON.parse(readFileSync("../../deployments/84532.json", "utf8")) as Record<
      string,
      unknown
    >;

  it("rejects a nomination record without an owner record", () => {
    expect(() =>
      decodeDeploymentManifest(deletePath(baseManifest(), ["moduleOwners"])),
    ).toThrow(/modulePendingOwners/u);
  });

  it("rejects a module nominated to its own current owner", () => {
    const manifest = baseManifest();
    const owners = manifest.moduleOwners as Record<string, string>;
    const pending = manifest.modulePendingOwners as Record<string, string>;
    pending.rewardLedger = owners.rewardLedger!;
    expect(() => decodeDeploymentManifest(manifest)).toThrow(
      /modulePendingOwners.rewardLedger/u,
    );
  });

  it("rejects a configurable claim policy with the zero administrator", () => {
    const manifest = baseManifest();
    const policy = manifest.claimPolicy as Record<string, unknown>;
    policy.mode = "configurable";
    policy.administrator = "0x0000000000000000000000000000000000000000";
    expect(() => decodeDeploymentManifest(manifest)).toThrow(
      /claimPolicy.administrator/u,
    );
  });

  it("rejects an always-allow policy naming an administrator", () => {
    const manifest = baseManifest();
    const policy = manifest.claimPolicy as Record<string, unknown>;
    policy.mode = "always-allow";
    policy.administrator = address("97");
    expect(() => decodeDeploymentManifest(manifest)).toThrow(
      /claimPolicy.mode/u,
    );
  });
});

describe("Base Sepolia deployment manifest", () => {
  it("decodes a fresh CCA v3 manifest while retaining historical v2 decoding", () => {
    const fresh = decodeProtocolDeploymentManifest(ccaManifest());
    const historical = decodeProtocolDeploymentManifest(
      JSON.parse(
        readFileSync("../../deployments/31337.json", "utf8"),
      ) as unknown,
    );

    expect(fresh.schemaVersion).toBe(3);
    if (fresh.schemaVersion !== 3) throw new Error("expected CCA manifest");
    expect(fresh.phase).toBe("cca");
    expect(fresh.contracts.continuousClearingAuction).toBe(address("a007"));
    expect(fresh.contracts.liquidityLauncher).toBe(address("a00e"));
    if (!("ccaCreate2Deployer" in fresh.contracts)) {
      throw new Error("expected local CREATE2 deployer");
    }
    expect(fresh.contracts.ccaCreate2Deployer).toBe(address("a00c"));
    expect(fresh.contracts.ccaLaunchFunding).toBe(address("a00d"));
    expect(fresh.canonicalPool.seedSqrtPriceX96).toBe("0");
    expect(fresh.canonicalPool.activeLiquidity).toBe("0");
    expect(fresh.cca.economics.auctionSupply).toBe("3000000000000000000000");
    expect(fresh.cca.provenance.continuousClearingAuction.version).toBe(
      "v2.1.0",
    );
    expect(fresh.cca.provenance.lbpStrategy.version).toBe("v3.1.0");
    expect(historical.schemaVersion).toBe(2);
    if (historical.schemaVersion !== 2) throw new Error("expected v2 manifest");
    expect(historical.contracts.genesisLiquidityVault).toBeDefined();
  });

  it("rejects incoherent CCA economics and lifecycle evidence", () => {
    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(ccaManifest(), ["cca", "economics", "auctionSupply"], "1"),
      ),
    ).toThrow(/cca\.economics\.auctionSupply/u);
    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(ccaManifest(), ["cca", "lifecycle", "claimBlock"], "110"),
      ),
    ).toThrow(/cca\.lifecycle\.claimBlock/u);
    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(ccaManifest(), ["canonicalPool", "activeLiquidity"], "1"),
      ),
    ).toThrow(/canonicalPool\.activeLiquidity/u);
    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(
          ccaManifest(),
          ["cca", "provenance", "lbpStrategy", "commit"],
          "1111111111111111111111111111111111111111",
        ),
      ),
    ).toThrow(/cca\.provenance\.lbpStrategy\.commit/u);
  });

  it("allows Base Sepolia to omit the local-only CREATE2 deployer", () => {
    const base = ccaManifest();
    base.chainId = 84_532;
    base.network = "base-sepolia";
    delete (base.contracts as Record<string, unknown>).ccaCreate2Deployer;

    const decoded = decodeProtocolDeploymentManifest(base);
    expect(decoded.schemaVersion).toBe(3);
    if (decoded.schemaVersion !== 3) throw new Error("expected CCA manifest");
    expect("ccaCreate2Deployer" in decoded.contracts).toBe(false);

    const anvil = ccaManifest();
    delete (anvil.contracts as Record<string, unknown>).ccaCreate2Deployer;
    expect(() => decodeProtocolDeploymentManifest(anvil)).toThrow(
      /ccaCreate2Deployer/u,
    );
  });

  it("keeps legacy genesis custody out of the exact CCA contract inventory", () => {
    const fresh = ccaManifest();
    const contracts = fresh.contracts as Record<string, unknown>;
    contracts.genesisLiquidityVault = address("afff");
    expect(() => decodeProtocolDeploymentManifest(fresh)).toThrow(
      /genesisLiquidityVault/u,
    );
  });

  it("has a stable full-deployment fingerprint distinct from the collection commitment", () => {
    const manifest = decodeDeploymentManifest(
      JSON.parse(
        readFileSync("../../deployments/84532.json", "utf8"),
      ) as unknown,
    );
    // Pinned to the checked deployment, so an unintended edit to the manifest
    // is caught. A genuine redeployment changes it, and updating it is part of
    // recording that deployment.
    expect(deploymentManifestFingerprint(manifest)).toBe(
      "0x4acaf587773a454e20de450530d53fe35ae1e62dc90c01806ae528c715c3aeaa",
    );
    if (!isProtocolDeploymentManifest(manifest)) {
      throw new Error("expected a Base Sepolia protocol deployment");
    }
    expect(deploymentManifestFingerprint(manifest)).not.toBe(
      manifest.identity.manifestHash,
    );
    expect(
      deploymentManifestFingerprint({
        ...manifest,
        roles: { ...manifest.roles, keeper: address("98") },
      }),
    ).not.toBe(deploymentManifestFingerprint(manifest));
  });

  it("exposes only safe manifest validation interfaces", () => {
    for (const unsafeExport of [
      "DeploymentManifestSchema",
      "ProtocolDeploymentManifestSchema",
      "ProtocolDeploymentStagingManifestSchema",
      "VenueDeploymentManifestSchema",
      "SelfFundedVenueDeploymentManifestSchema",
      "OfficialVenueDeploymentManifestSchema",
      "AnvilProtocolDeploymentManifestSchema",
      "BaseSepoliaProtocolDeploymentManifestSchema",
      "VerifiedConversionPoolSchema",
      "VerifiedCanonicalPoolSchema",
    ]) {
      expect(deploymentManifestModule).not.toHaveProperty(unsafeExport);
    }
  });

  it("decodes venue-only input through the public runtime boundary", () => {
    const launched = decodeDeploymentManifest(
      JSON.parse(
        readFileSync("../../deployments/84532.json", "utf8"),
      ) as unknown,
    );
    expect(launched.chainId).toBe(84_532);
  });

  it("activates application protocol reads only for a launched manifest", () => {
    const launched: unknown = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    );
    if (typeof launched !== "object" || launched === null) {
      throw new Error("expected a Base Sepolia deployment manifest object");
    }
    const launchedRecord = launched as Record<string, unknown>;
    const venueOnly: unknown = {
      $schema: "./schema.json",
      schemaVersion: 1,
      chainId: launchedRecord.chainId,
      network: launchedRecord.network,
      contracts: launchedRecord.contracts,
      conversionPools: launchedRecord.conversionPools,
    };

    expect(isProtocolDeploymentManifest(venueOnly)).toBe(false);
    expect(isProtocolDeploymentManifest(launched)).toBe(true);
  });

  it("decodes the launched self-funded venue and all five verified pools", () => {
    const checkedManifest: unknown = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    );
    const manifest = decodeProtocolDeploymentManifest(checkedManifest);

    expect(manifest.chainId).toBe(84532);
    expect(Object.keys(manifest.contracts)).toEqual([
      "aaplcConversionAdapter",
      "attributeRegistry",
      "canonicalFeeHook",
      "canonicalHookDeployer",
      "canonicalMarketRegistry",
      "canonicalRouter",
      "ccaBidEscrowFactory",
      "ccaBidValidationHook",
      "ccaCanonicalLaunchReadiness",
      "ccaLaunchFunding",
      "ccaLaunchCoordinator",
      "ccaRecoverySeeder",
      "ccaStrategy",
      "claimGate",
      "continuousClearingAuction",
      "continuousClearingAuctionFactory",
      "discoveryAdapter",
      "epochConverter",
      "fuelCore",
      "fuelMirror",
      "googlcConversionAdapter",
      "liquidityLauncher",
      "metacConversionAdapter",
      "metadataRenderer",
      "mockAaplc",
      "mockGooglc",
      "mockMetac",
      "mockNvdac",
      "nvdacConversionAdapter",
      "permanentPositionRecipient",
      "permit2",
      "protocolLiquidityVault",
      "recoveryAuthority",
      "rewardLedger",
      "testConversionVenue",
      "uniswapV4PoolManager",
      "uniswapV4PositionManager",
      "usdc",
      "weth",
    ]);
    expect(Object.keys(manifest.conversionPools)).toEqual([
      "wethUsdc",
      "aaplc",
      "googlc",
      "metac",
      "nvdac",
    ]);
    expect(manifest.contracts.uniswapV4PoolManager).toBe(
      "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
    );
    const wethUsdcPool = manifest.conversionPools.wethUsdc;
    if (!wethUsdcPool) throw new Error("missing confirmed WETH/USDC pool");
    expect(wethUsdcPool.currency0).toBe(manifest.contracts.usdc);
    expect(wethUsdcPool.currency1).toBe(manifest.contracts.weth);
    for (const pool of Object.values(manifest.conversionPools)) {
      expect(pool.fee).toBe(4_444);
      expect(pool.tickSpacing).toBe(11);
      expect(pool.hooks).toBe("0x0000000000000000000000000000000000000000");
      expect(BigInt(pool.seedSqrtPriceX96)).toBeGreaterThan(0n);
      expect(BigInt(pool.activeLiquidity)).toBeGreaterThan(0n);
    }
  });

  it("rejects unverified or incomplete pool output", () => {
    expect(() =>
      decodeDeploymentManifest({
        schemaVersion: 1,
        chainId: 84532,
        network: "base-sepolia",
        contracts: {},
        conversionPools: {
          wethUsdc: {
            poolId: "0xdeadbeef",
          },
        },
      }),
    ).toThrow();
  });

  it("decodes a launched local protocol manifest with every sealed boundary", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/31337.json", "utf8"),
    ) as Record<string, unknown>;
    const launched = decodeProtocolDeploymentManifest(checkedManifest);

    expect(launched.phase).toBe("launched");
    expect(launched.seals.metadata).toBe(true);
    expect(BigInt(launched.launch.blockNumber)).toBeGreaterThan(0n);
  });

  it("decodes the emitted empty-chain Anvil launch and its confirmed transaction map", () => {
    const checkedManifest: unknown = JSON.parse(
      readFileSync("../../deployments/31337.json", "utf8"),
    );
    const manifest = decodeProtocolDeploymentManifest(checkedManifest);

    expect(manifest.chainId).toBe(31_337);
    expect(manifest.network).toBe("anvil");
    expect(manifest.identity.key).toBe("orbit-4444");
    expect(Object.keys(manifest.contracts).length).toBeGreaterThan(20);
    expect(Object.keys(manifest.conversionPools)).toHaveLength(5);
    expect(Object.keys(manifest.transactions).length).toBeGreaterThan(0);
    expect(manifest.launch.transactionHash).not.toBe(hash("0"));
    expect(BigInt(manifest.launch.blockNumber)).toBeGreaterThan(0n);
  });

  it("keeps the exact internal staging artifact outside the public manifest boundary", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/31337.json", "utf8"),
    ) as Record<string, unknown>;
    const stagingManifest = setPath(
      setPath(checkedManifest, ["launch", "blockNumber"], "0"),
      ["launch", "transactionHash"],
      hash("0"),
    );
    stagingManifest.transactions = { pending: hash("0") };

    expect(() => decodeProtocolDeploymentManifest(stagingManifest)).toThrow();
    expect(
      decodeProtocolDeploymentStagingManifest(stagingManifest).transactions,
    ).toEqual({ pending: hash("0") });
    expect(() =>
      decodeProtocolDeploymentStagingManifest(
        setPath(stagingManifest, ["transactions", "step000"], hash("1")),
      ),
    ).toThrow();
    expect(() =>
      decodeProtocolDeploymentStagingManifest(
        setPath(stagingManifest, ["contracts", "rewardLedgre"], address("1")),
      ),
    ).toThrow();
  });

  it("rejects unexpected fields instead of silently stripping them", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const contracts = checkedManifest.contracts as Record<string, unknown>;

    expect(() =>
      decodeDeploymentManifest({
        ...checkedManifest,
        unexpectedSecret: "must-not-survive",
      }),
    ).toThrow(/unexpectedSecret/);
    expect(() =>
      decodeDeploymentManifest({
        ...checkedManifest,
        contracts: { ...contracts, rewardLedgre: contracts.rewardLedger },
      }),
    ).toThrow(/rewardLedgre/);
  });

  it("requires the exact public venue provenance and pool key sets", () => {
    for (const provenance of ["self-funded", "official"] as const) {
      const complete = venueManifest(provenance);
      expect(decodeDeploymentManifest(complete).schemaVersion).toBe(1);

      const missingPool = structuredClone(complete);
      delete (missingPool.conversionPools as Record<string, unknown>).nvdac;
      expect(() => decodeDeploymentManifest(missingPool)).toThrow(/nvdac/);

      const extraPool = structuredClone(complete);
      (extraPool.conversionPools as Record<string, unknown>).other = (
        extraPool.conversionPools as Record<string, unknown>
      ).aaplc;
      expect(() => decodeDeploymentManifest(extraPool)).toThrow(/other/);
    }
  });

  it("requires a nonempty contiguous stepNNN transaction key set", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const transactions = checkedManifest.transactions as Record<
      string,
      unknown
    >;

    const invalidName = structuredClone(checkedManifest);
    invalidName.transactions = { launch: transactions.step000 };
    expect(() => decodeProtocolDeploymentManifest(invalidName)).toThrow(
      /launch/,
    );

    const missingMiddle = structuredClone(checkedManifest);
    delete (missingMiddle.transactions as Record<string, unknown>).step010;
    expect(() => decodeProtocolDeploymentManifest(missingMiddle)).toThrow(
      /transactions/,
    );

    const reversed = structuredClone(checkedManifest);
    reversed.transactions = Object.fromEntries(
      Object.entries(transactions).reverse(),
    );
    expect(decodeProtocolDeploymentManifest(reversed).transactions).toEqual(
      reversed.transactions,
    );
  });

  it("binds launch evidence to the unique terminal deployment transaction", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/31337.json", "utf8"),
    ) as Record<string, unknown>;
    const transactions = checkedManifest.transactions as Record<
      string,
      unknown
    >;
    const transactionNames = Object.keys(transactions).sort();
    const terminalName = transactionNames.at(-1)!;

    const missingTerminal = deletePath(checkedManifest, [
      "transactions",
      terminalName,
    ]);
    expect(() => decodeProtocolDeploymentManifest(missingTerminal)).toThrow(
      /launch.transactionHash|transactions/,
    );

    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(checkedManifest, ["launch", "transactionHash"], hash("f")),
      ),
    ).toThrow(/launch.transactionHash|transactions/);

    const duplicateHash = setPath(
      checkedManifest,
      ["transactions", "step001"],
      transactions.step000,
    );
    expect(() => decodeProtocolDeploymentManifest(duplicateHash)).toThrow(
      /transactions.step000|transactions.step001/,
    );
  });

  it("binds protocol and conversion evidence to the declared contracts", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const contracts = checkedManifest.contracts as Record<string, unknown>;
    const protocolMutations = [
      {
        path: ["contracts", "recoveryAuthority"],
        value: address("dead"),
        field: "contracts.recoveryAuthority",
      },
      {
        path: ["identity", "metadataRenderer"],
        value: contracts.claimGate,
        field: "identity.metadataRenderer",
      },
      {
        path: ["canonicalPool", "currency0"],
        value: contracts.usdc,
        field: "canonicalPool.currency0",
      },
      {
        path: ["canonicalPool", "hooks"],
        value: contracts.claimGate,
        field: "canonicalPool.hooks",
      },
      {
        path: ["conversionPools", "wethUsdc", "currency0"],
        value: contracts.mockAaplc,
        field: "conversionPools.wethUsdc.currency0",
      },
      {
        path: ["conversionPools", "aaplc", "currency1"],
        value: contracts.mockGooglc,
        field: "conversionPools.aaplc.currency1",
      },
      {
        path: ["conversionPools", "nvdac", "hooks"],
        value: contracts.claimGate,
        field: "conversionPools.nvdac.hooks",
      },
      {
        path: ["contracts", "fuelMirror"],
        value: contracts.fuelCore,
        field: "contracts.fuelMirror",
      },
    ] as const;

    for (const mutation of protocolMutations) {
      expect(() =>
        decodeProtocolDeploymentManifest(
          setPath(checkedManifest, mutation.path, mutation.value),
        ),
      ).toThrow(new RegExp(mutation.field.replaceAll(".", "\\.")));
    }

    for (const provenance of ["self-funded", "official"] as const) {
      const manifest = venueManifest(provenance);
      const venueContracts = manifest.contracts as Record<string, unknown>;
      expect(() =>
        decodeDeploymentManifest(
          setPath(
            manifest,
            ["conversionPools", "metac", "currency0"],
            venueContracts.mockNvdac,
          ),
        ),
      ).toThrow(/conversionPools.metac.currency0/);
    }
  });

  it("binds every pool identifier to its declared V4 PoolKey", () => {
    for (const { name, manifest } of deploymentManifestFixtures()) {
      const swappedPoolIds = structuredClone(manifest);
      const conversionPools = swappedPoolIds.conversionPools as Record<
        string,
        Record<string, unknown>
      >;
      [conversionPools.wethUsdc!.poolId, conversionPools.aaplc!.poolId] = [
        conversionPools.aaplc!.poolId,
        conversionPools.wethUsdc!.poolId,
      ];
      expect(
        () => decodeDeploymentManifest(swappedPoolIds),
        `${name}: swapped conversion pool ids`,
      ).toThrow(/conversionPools\.(wethUsdc|aaplc)\.poolId/);

      if (manifest.schemaVersion === 2) {
        expect(
          () =>
            decodeProtocolDeploymentManifest(
              setPath(manifest, ["canonicalPool", "poolId"], hash("f")),
            ),
          `${name}: arbitrary canonical pool id`,
        ).toThrow(/canonicalPool\.poolId/);
      }
    }
  });

  it("binds identity provenance to the canonical collection manifest", () => {
    for (const { name, manifest } of deploymentManifestFixtures().filter(
      ({ manifest }) => manifest.schemaVersion === 2,
    )) {
      const canonicalHash = objectAtPath(manifest, ["identity"])
        .manifestHash as string;
      for (const [variantName, manifestHash] of [
        ["arbitrary same-type", hash("f")],
        ["uppercase canonical", nonCanonicalCaseVariants(canonicalHash)[0]],
        ["mixed-case canonical", nonCanonicalCaseVariants(canonicalHash)[1]],
      ] as const) {
        const candidate = setPath(
          manifest,
          ["identity", "manifestHash"],
          manifestHash,
        );
        expect(
          () =>
            validateDeploymentManifestSemantics(
              candidate as DeploymentManifest,
            ),
          `${name}: ${variantName}: shared semantics`,
        ).toThrow(/identity\.manifestHash/);
        expect(
          () => decodeProtocolDeploymentManifest(candidate),
          `${name}: ${variantName}: public decoder`,
        ).toThrow(/identity\.manifestHash/);
      }
    }
  });

  it("requires canonical Uniswap currency ordering for every declared pool", () => {
    for (const { name, manifest } of deploymentManifestFixtures()) {
      for (const poolName of [
        "wethUsdc",
        "aaplc",
        "googlc",
        "metac",
        "nvdac",
      ]) {
        expect(
          () =>
            decodeDeploymentManifest(
              swapPoolCurrencies(manifest, ["conversionPools", poolName]),
            ),
          `${name}: ${poolName}`,
        ).toThrow(new RegExp(`conversionPools\\.${poolName}\\.currency`));
      }
      if (manifest.schemaVersion === 2) {
        expect(
          () =>
            decodeProtocolDeploymentManifest(
              swapPoolCurrencies(manifest, ["canonicalPool"]),
            ),
          `${name}: canonical pool`,
        ).toThrow(/canonicalPool.currency/);
      }
    }
  });

  it("rejects fee and tick-spacing swaps that invalidate pool provenance", () => {
    for (const { name, manifest } of deploymentManifestFixtures()) {
      for (const poolName of [
        "wethUsdc",
        "aaplc",
        "googlc",
        "metac",
        "nvdac",
      ]) {
        expect(
          () =>
            decodeDeploymentManifest(
              swapPoolFields(
                manifest,
                ["conversionPools", poolName],
                "fee",
                "tickSpacing",
              ),
            ),
          `${name}: ${poolName}`,
        ).toThrow(new RegExp(`conversionPools\\.${poolName}\\.poolId`));
      }
    }
  });

  it("rejects zero sentinels where deployment evidence must be positive", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const zeroAddress = address("0");
    const zeroHash = hash("0");
    const mutations = [
      { path: ["contracts", "fuelCore"], value: zeroAddress },
      { path: ["roles", "owner"], value: zeroAddress },
      { path: ["identity", "manifestHash"], value: zeroHash },
      { path: ["identity", "metadataRenderer"], value: zeroAddress },
      { path: ["conversionPools", "wethUsdc", "poolId"], value: zeroHash },
      {
        path: ["conversionPools", "wethUsdc", "currency0"],
        value: zeroAddress,
      },
      {
        path: ["conversionPools", "wethUsdc", "seedSqrtPriceX96"],
        value: "0",
      },
      {
        path: ["conversionPools", "wethUsdc", "activeLiquidity"],
        value: "0",
      },
      { path: ["canonicalPool", "poolId"], value: zeroHash },
      { path: ["canonicalPool", "currency0"], value: zeroAddress },
      { path: ["canonicalPool", "hooks"], value: zeroAddress },
      { path: ["launch", "blockNumber"], value: "0" },
      { path: ["launch", "transactionHash"], value: zeroHash },
      { path: ["transactions", "step000"], value: zeroHash },
    ] as const;

    for (const mutation of mutations) {
      expect(() =>
        decodeProtocolDeploymentManifest(
          setPath(checkedManifest, mutation.path, mutation.value),
        ),
      ).toThrow();
    }

    expect(
      decodeProtocolDeploymentManifest(checkedManifest).conversionPools.wethUsdc
        .hooks,
    ).toBe(zeroAddress);
  });

  it("reports only failing paths and never echoes malformed configuration", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const secretSentinel = "private-key-sentinel-must-never-be-echoed";
    const candidate = setPath(
      checkedManifest,
      ["contracts", "fuelCore"],
      secretSentinel,
    );

    try {
      decodeProtocolDeploymentManifest(candidate);
      throw new Error("expected the malformed manifest to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("contracts.fuelCore");
      expect(message).not.toContain(secretSentinel);
    }
  });

  it("reports diagnostics only from the selected manifest variant", () => {
    const baseProtocol = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const secretSentinel = "selected-branch-secret-sentinel";

    try {
      decodeProtocolDeploymentManifest(
        setPath(baseProtocol, ["contracts", "fuelCore"], secretSentinel),
      );
      throw new Error("expected malformed Base protocol input to fail");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("contracts.fuelCore");
      expect(message).not.toContain("chainId");
      expect(message).not.toContain("network");
      expect(message).not.toContain(secretSentinel);
    }

    const officialVenue = venueManifest("official");
    try {
      decodeDeploymentManifest(
        setPath(officialVenue, ["contracts", "circleTestUsdc"], secretSentinel),
      );
      throw new Error("expected malformed official venue input to fail");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("contracts.circleTestUsdc");
      expect(message).not.toContain("selfFundedTestUsdc");
      expect(message).not.toContain(secretSentinel);
    }

    expect(() => decodeProtocolDeploymentManifest(officialVenue)).toThrow(
      /schemaVersion/,
    );
  });

  it("identifies the discriminant fields when chain and network are swapped", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;

    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(checkedManifest, ["chainId"], 31_337),
      ),
    ).toThrow(/chainId|network/);
  });

  it("runs the same complete and exact-key corpus through Effect and JSON Schema", () => {
    const validateJsonSchema = new Ajv2020({ allErrors: true }).compile(
      JSON.parse(
        readFileSync("../../deployments/schema.json", "utf8"),
      ) as object,
    );
    const completeManifests = deploymentManifestFixtures();
    const rejected: Array<{ name: string; candidate: unknown }> = [];

    for (const { name, manifest } of completeManifests) {
      expect(() => decodeDeploymentManifest(manifest), name).not.toThrow();
      expect(validateJsonSchema(manifest), name).toBe(true);

      for (const key of Object.keys(manifest)) {
        if (optionalProtocolManifestKeys.has(key)) {
          expectOptionalRootKey(validateJsonSchema, name, manifest, key);
          continue;
        }
        rejected.push({
          name: `${name} missing root.${key}`,
          candidate: deletePath(manifest, [key]),
        });
      }
      for (const key of Object.keys(objectAtPath(manifest, ["contracts"]))) {
        rejected.push({
          name: `${name} missing contracts.${key}`,
          candidate: deletePath(manifest, ["contracts", key]),
        });
      }
      for (const poolName of Object.keys(
        objectAtPath(manifest, ["conversionPools"]),
      )) {
        rejected.push({
          name: `${name} missing conversionPools.${poolName}`,
          candidate: deletePath(manifest, ["conversionPools", poolName]),
        });
        for (const field of Object.keys(
          objectAtPath(manifest, ["conversionPools", poolName]),
        )) {
          rejected.push({
            name: `${name} missing conversionPools.${poolName}.${field}`,
            candidate: deletePath(manifest, [
              "conversionPools",
              poolName,
              field,
            ]),
          });
        }
        rejected.push({
          name: `${name} extra conversionPools.${poolName}.secretSentinel`,
          candidate: setPath(
            manifest,
            ["conversionPools", poolName, "secretSentinel"],
            "must-not-survive",
          ),
        });
      }
      for (const path of [
        [] as const,
        ["contracts"] as const,
        ["conversionPools"] as const,
      ]) {
        rejected.push({
          name: `${name} extra ${[...path, "secretSentinel"].join(".")}`,
          candidate: setPath(
            manifest,
            [...path, "secretSentinel"],
            "must-not-survive",
          ),
        });
      }
    }

    rejected.push(
      ...completeManifests
        .filter(({ manifest }) => manifest.schemaVersion === 2)
        .flatMap(({ name, manifest }) => {
          const canonicalHash = objectAtPath(manifest, ["identity"])
            .manifestHash as string;
          return [
            {
              name: `${name} arbitrary identity manifest hash`,
              candidate: setPath(
                manifest,
                ["identity", "manifestHash"],
                hash("f"),
              ),
            },
            ...nonCanonicalCaseVariants(canonicalHash).map(
              (manifestHash, index) => ({
                name: `${name} noncanonical-case identity manifest hash ${index}`,
                candidate: setPath(
                  manifest,
                  ["identity", "manifestHash"],
                  manifestHash,
                ),
              }),
            ),
          ];
        }),
    );

    const baseProtocol = completeManifests[2]!.manifest;
    rejected.push(...nestedProtocolMutations(baseProtocol));

    rejected.push(
      { name: "null manifest", candidate: null },
      { name: "array manifest", candidate: [] },
      { name: "empty manifest", candidate: {} },
      {
        name: "swapped chain and network types",
        candidate: setPath(
          setPath(baseProtocol, ["chainId"], "base-sepolia"),
          ["network"],
          84_532,
        ),
      },
      {
        name: "mismatched protocol chain and network",
        candidate: setPath(baseProtocol, ["chainId"], 84_532),
      },
      {
        name: "mismatched venue chain",
        candidate: setPath(completeManifests[0]!.manifest, ["chainId"], 31_337),
      },
      {
        name: "unsupported schema version",
        candidate: setPath(baseProtocol, ["schemaVersion"], 3),
      },
      {
        name: "malformed contract address",
        candidate: setPath(baseProtocol, ["contracts", "fuelCore"], "0x1234"),
      },
      {
        name: "zero contract address",
        candidate: setPath(
          baseProtocol,
          ["contracts", "fuelCore"],
          address("0"),
        ),
      },
      {
        name: "zero role address",
        candidate: setPath(baseProtocol, ["roles", "owner"], address("0")),
      },
      {
        name: "zero pool id",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "poolId"],
          hash("0"),
        ),
      },
      {
        name: "pool decimal encoded as number",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "activeLiquidity"],
          1,
        ),
      },
      {
        name: "pool decimal with a leading zero",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "activeLiquidity"],
          "01",
        ),
      },
      {
        name: "negative pool decimal",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "activeLiquidity"],
          "-1",
        ),
      },
      {
        name: "floating pool fee",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "fee"],
          4_444.5,
        ),
      },
      {
        name: "zero pool fee",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "fee"],
          0,
        ),
      },
      {
        name: "out-of-range pool fee",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "fee"],
          1_000_001,
        ),
      },
      {
        name: "out-of-range pool tick spacing",
        candidate: setPath(
          baseProtocol,
          ["conversionPools", "wethUsdc", "tickSpacing"],
          0,
        ),
      },
      {
        name: "empty metadata location",
        candidate: setPath(
          baseProtocol,
          ["identity", "metadataLocations", "transient"],
          "",
        ),
      },
      {
        name: "zero launch block",
        candidate: setPath(baseProtocol, ["launch", "blockNumber"], "0"),
      },
      {
        name: "zero launch hash",
        candidate: setPath(
          baseProtocol,
          ["launch", "transactionHash"],
          hash("0"),
        ),
      },
      {
        name: "empty transaction map",
        candidate: setPath(baseProtocol, ["transactions"], {}),
      },
      {
        name: "deleted middle transaction step",
        candidate: deletePath(baseProtocol, ["transactions", "step010"]),
      },
      {
        name: "misspelled transaction step",
        candidate: setPath(baseProtocol, ["transactions"], {
          step00O: hash("1"),
        }),
      },
      {
        name: "zero transaction hash",
        candidate: setPath(
          baseProtocol,
          ["transactions", "step000"],
          hash("0"),
        ),
      },
    );

    const effectAccepts = (candidate: unknown): boolean => {
      try {
        decodeDeploymentManifest(candidate);
        return true;
      } catch {
        return false;
      }
    };
    for (const { name, candidate } of rejected) {
      expect(effectAccepts(candidate), `${name}: Effect`).toBe(false);
      expect(validateJsonSchema(candidate), `${name}: JSON Schema`).toBe(false);
    }
  });

  it("keeps generated transaction adjacency exact in the portable schema", () => {
    const schema = JSON.parse(
      readFileSync("../../deployments/schema.json", "utf8"),
    ) as Record<string, unknown>;
    const validateJsonSchema = new Ajv2020({ allErrors: true }).compile(schema);
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const missingMiddle = deletePath(checkedManifest, [
      "transactions",
      "step010",
    ]);

    expect(() => decodeDeploymentManifest(missingMiddle)).toThrow(
      /transactions/,
    );
    expect(validateJsonSchema(missingMiddle)).toBe(false);
    expect(
      objectAtPath(schema, ["$defs", "transactions", "dependentRequired"])
        .step010,
    ).toEqual(["step009"]);
    expect(
      objectAtPath(schema, ["$defs", "transactions", "dependentRequired"])
        .step999,
    ).toEqual(["step998"]);
  });

  it("applies one shared semantic validator after portable JSON Schema validation", () => {
    const validateJsonSchema = new Ajv2020({ allErrors: true }).compile(
      JSON.parse(
        readFileSync("../../deployments/schema.json", "utf8"),
      ) as object,
    );
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/84532.json", "utf8"),
    ) as Record<string, unknown>;
    const contracts = checkedManifest.contracts as Record<string, unknown>;
    const transactions = checkedManifest.transactions as Record<
      string,
      unknown
    >;
    const terminalName = Object.keys(transactions).sort().at(-1)!;
    const poolNames = ["wethUsdc", "aaplc", "googlc", "metac", "nvdac"];
    const semanticMutations: Array<{
      name: string;
      candidate: Record<string, unknown>;
    }> = [
      {
        name: "missing terminal transaction",
        candidate: deletePath(checkedManifest, ["transactions", terminalName]),
      },
      {
        name: "launch hash mismatch",
        candidate: setPath(
          checkedManifest,
          ["launch", "transactionHash"],
          hash("f"),
        ),
      },
      {
        name: "duplicate transaction hash",
        candidate: setPath(
          checkedManifest,
          ["transactions", "step001"],
          transactions.step000,
        ),
      },
      {
        name: "recovery authority mismatch",
        candidate: setPath(
          checkedManifest,
          ["contracts", "recoveryAuthority"],
          address("dead"),
        ),
      },
      {
        name: "metadata renderer mismatch",
        candidate: setPath(
          checkedManifest,
          ["identity", "metadataRenderer"],
          contracts.claimGate,
        ),
      },
      {
        name: "canonical pool asset mismatch",
        candidate: setPath(
          checkedManifest,
          ["canonicalPool", "currency0"],
          contracts.usdc,
        ),
      },
      {
        name: "canonical hook mismatch",
        candidate: setPath(
          checkedManifest,
          ["canonicalPool", "hooks"],
          contracts.claimGate,
        ),
      },
      {
        name: "conversion asset mismatch",
        candidate: setPath(
          checkedManifest,
          ["conversionPools", "googlc", "currency0"],
          contracts.mockAaplc,
        ),
      },
      {
        name: "conversion hook mismatch",
        candidate: setPath(
          checkedManifest,
          ["conversionPools", "metac", "hooks"],
          contracts.claimGate,
        ),
      },
      {
        name: "duplicate contract address",
        candidate: setPath(
          checkedManifest,
          ["contracts", "fuelMirror"],
          contracts.fuelCore,
        ),
      },
    ];

    for (const { name, manifest } of deploymentManifestFixtures()) {
      const swappedPoolIds = structuredClone(manifest);
      const conversionPools = swappedPoolIds.conversionPools as Record<
        string,
        Record<string, unknown>
      >;
      [conversionPools.wethUsdc!.poolId, conversionPools.aaplc!.poolId] = [
        conversionPools.aaplc!.poolId,
        conversionPools.wethUsdc!.poolId,
      ];
      semanticMutations.push({
        name: `${name}: swapped conversion pool ids`,
        candidate: swappedPoolIds,
      });

      for (const poolName of poolNames) {
        semanticMutations.push(
          {
            name: `${name}: ${poolName} currency swap`,
            candidate: swapPoolCurrencies(manifest, [
              "conversionPools",
              poolName,
            ]),
          },
          {
            name: `${name}: ${poolName} fee/tick swap`,
            candidate: swapPoolFields(
              manifest,
              ["conversionPools", poolName],
              "fee",
              "tickSpacing",
            ),
          },
        );
      }

      if (manifest.schemaVersion === 2) {
        semanticMutations.push(
          {
            name: `${name}: arbitrary canonical pool id`,
            candidate: setPath(
              manifest,
              ["canonicalPool", "poolId"],
              hash("f"),
            ),
          },
          {
            name: `${name}: canonical currency swap`,
            candidate: swapPoolCurrencies(manifest, ["canonicalPool"]),
          },
        );
      }
    }

    for (const { name, candidate } of semanticMutations) {
      expect(validateJsonSchema(candidate), `${name}: portable schema`).toBe(
        true,
      );
      expect(
        () =>
          validateDeploymentManifestSemantics(candidate as DeploymentManifest),
        `${name}: shared semantics`,
      ).toThrow();
      expect(
        () => decodeDeploymentManifest(candidate),
        `${name}: public decoder`,
      ).toThrow();
    }
  });

  it("rejects a launched protocol manifest with an unsealed boundary", () => {
    const checkedManifest = JSON.parse(
      readFileSync("../../deployments/31337.json", "utf8"),
    ) as Record<string, unknown>;

    expect(() =>
      decodeProtocolDeploymentManifest(
        setPath(checkedManifest, ["seals", "conversionRoutes"], false),
      ),
    ).toThrow(/seals.conversionRoutes/);
  });
});
