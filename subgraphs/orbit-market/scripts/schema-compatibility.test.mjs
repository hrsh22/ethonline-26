import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, print, Kind } from "graphql";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
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
  const manifest = JSON.parse(read("../../../deployments/84532.json"));
  const source = read("../src/constants.ts").toLowerCase();
  for (const value of [
    manifest.canonicalPool.poolId,
    manifest.contracts.uniswapV4PoolManager,
    manifest.contracts.fuelCore,
    manifest.contracts.weth,
    manifest.contracts.canonicalMarketRegistry,
    manifest.contracts.genesisLiquidityVault,
    manifest.contracts.protocolLiquidityVault,
  ])
    assert.ok(source.includes(value.toLowerCase()));
  const yaml = read("../subgraph.yaml").toLowerCase();
  for (const key of [
    "canonicalFeeHook",
    "epochConverter",
    "rewardLedger",
    "genesisLiquidityVault",
    "protocolLiquidityVault",
  ])
    assert.ok(yaml.includes(manifest.contracts[key].toLowerCase()));
});
