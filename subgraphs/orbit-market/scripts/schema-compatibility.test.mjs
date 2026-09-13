import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, print, Kind } from "graphql";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const generatorPath = fileURLToPath(
  new URL("./generate-manifest-config.mjs", import.meta.url),
);
const canonicalManifestPath = fileURLToPath(
  new URL("../../../deployments/84532.staging.json", import.meta.url),
);

test("checked generated artifacts match the canonical deployment manifest", () => {
  const result = spawnSync(
    process.execPath,
    [generatorPath, canonicalManifestPath, "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("check mode rejects a manifest that has drifted from generated artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-subgraph-drift-"));
  try {
    const manifest = JSON.parse(
      read("../../../deployments/84532.staging.json"),
    );
    manifest.canonicalPool.poolId = `0x${"ff".repeat(32)}`;
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(
      process.execPath,
      [generatorPath, manifestPath, "--check"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/constants\.ts is stale/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every Messari 1.3.2 field and enum value is preserved with its original GraphQL type", () => {
  const original = parse(read("../vendor/dex-amm-1.3.2.graphql"));
  const extended = parse(read("../schema.graphql"));
  for (const definition of original.definitions) {
    const actual = extended.definitions.find(
      (item) => item.name?.value === definition.name?.value,
    );
    assert.ok(actual, `Missing type ${definition.name.value}`);
    assert.equal(actual.kind, definition.kind);
    for (const field of definition.fields ?? []) {
      const current = actual.fields.find(
        (item) => item.name.value === field.name.value,
      );
      assert.ok(
        current,
        `Missing ${definition.name.value}.${field.name.value}`,
      );
      assert.equal(
        print(current.type),
        print(field.type),
        `${definition.name.value}.${field.name.value}`,
      );
    }
    if (definition.kind === Kind.ENUM_TYPE_DEFINITION) {
      for (const value of definition.values)
        assert.ok(
          actual.values.some((item) => item.name.value === value.name.value),
        );
    }
  }
});
test("canonical addresses and pool match the checked deployment manifest", () => {
  const manifest = JSON.parse(read("../../../deployments/84532.staging.json"));
  const source = read("../src/constants.ts").toLowerCase();
  for (const value of [
    manifest.canonicalPool.poolId,
    manifest.contracts.uniswapV4PoolManager,
    manifest.contracts.fuelCore,
    manifest.contracts.weth,
    manifest.contracts.canonicalMarketRegistry,
    manifest.contracts.protocolLiquidityVault,
    manifest.contracts.continuousClearingAuction,
    ...(manifest.contracts.genesisLiquidityVault === undefined
      ? []
      : [manifest.contracts.genesisLiquidityVault]),
  ])
    assert.ok(source.includes(value.toLowerCase()));
  const yaml = read("../subgraph.yaml").toLowerCase();
  for (const key of [
    "canonicalFeeHook",
    "epochConverter",
    "rewardLedger",
    "protocolLiquidityVault",
    ...(manifest.contracts.genesisLiquidityVault === undefined
      ? []
      : ["genesisLiquidityVault"]),
    ...(manifest.schemaVersion === 3
      ? [
          "continuousClearingAuction",
          "ccaStrategy",
          "ccaLaunchCoordinator",
          "ccaBidEscrowFactory",
        ]
      : []),
  ])
    assert.ok(yaml.includes(manifest.contracts[key].toLowerCase()));
});

test("a v3 manifest generates lifecycle-bound CCA sources", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-subgraph-v3-"));
  try {
    const manifest = JSON.parse(
      read("../../../deployments/84532.staging.json"),
    );
    manifest.schemaVersion = 3;
    manifest.phase = "cca";
    delete manifest.contracts.genesisLiquidityVault;
    Object.assign(manifest.contracts, {
      continuousClearingAuction: "0x000000000000000000000000000000000000a001",
      ccaStrategy: "0x000000000000000000000000000000000000a002",
      ccaLaunchCoordinator: "0x000000000000000000000000000000000000a003",
      ccaBidEscrowFactory: "0x000000000000000000000000000000000000a004",
    });
    manifest.cca = {
      lifecycle: {
        startBlock: "500",
        endBlock: "600",
        claimBlock: "601",
        migrationBlock: "601",
      },
    };
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(
      process.execPath,
      [generatorPath, manifestPath, "--print-yaml"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const yaml = result.stdout.toLowerCase();
    for (const address of [
      manifest.contracts.continuousClearingAuction,
      manifest.contracts.ccaStrategy,
      manifest.contracts.ccaLaunchCoordinator,
      manifest.contracts.ccaBidEscrowFactory,
    ]) {
      assert.ok(yaml.includes(address.toLowerCase()));
    }
    assert.match(
      yaml,
      /name: continuousclearingauction[\s\S]*startblock: 500/u,
    );
    for (const source of [
      "poolmanager",
      "canonicalfeehook",
      "epochconverter",
      "rewardledger",
      "protocolliquidityvault",
    ]) {
      assert.match(
        yaml,
        new RegExp(`name: ${source}[\\s\\S]*startblock: 500`, "u"),
      );
    }
    assert.match(yaml, /name: ccastrategy[\s\S]*startblock: 601/u);
    assert.match(yaml, /name: ccalaunchcoordinator[\s\S]*startblock: 601/u);
    assert.match(yaml, /name: ccabidescrowfactory[\s\S]*startblock: 500/u);
    assert.ok(yaml.includes("templates:"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
