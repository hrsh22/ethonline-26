import { readFileSync } from "node:fs";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const Ajv2020 = Ajv2020Module.default;

type CcaTestnetDefaults = {
  readonly minimumWethRaisedWei: string;
  readonly graduationSafetyMarginWethWei: string;
  readonly issuanceSteps: readonly {
    readonly mpsPerBlock: number;
    readonly blockCount: number;
  }[];
};

const defaultsPath = "../../docs/economics/cca-testnet-defaults.json";
const schemaPath = "../../docs/economics/cca-testnet-defaults.schema.json";

const readJson = <Value>(path: string): Value =>
  JSON.parse(readFileSync(path, "utf8")) as Value;

describe("CCA Base Sepolia demo defaults", () => {
  it("validate against their schema and encode a six-hour schedule with a graduation margin", () => {
    const defaults = readJson<CcaTestnetDefaults>(defaultsPath);
    const validate = new Ajv2020({ allErrors: true }).compile(
      readJson<object>(schemaPath),
    );

    expect(validate(defaults), JSON.stringify(validate.errors)).toBe(true);
    expect(defaults.issuanceSteps).toEqual([
      { mpsPerBlock: 926, blockCount: 10_000 },
      { mpsPerBlock: 925, blockCount: 800 },
    ]);
    expect(
      defaults.issuanceSteps.reduce(
        (blocks, step) => blocks + step.blockCount,
        0,
      ),
    ).toBe(10_800);
    expect(
      defaults.issuanceSteps.reduce(
        (millionths, step) => millionths + step.mpsPerBlock * step.blockCount,
        0,
      ),
    ).toBe(10_000_000);
    expect(BigInt(defaults.graduationSafetyMarginWethWei)).toBeGreaterThan(0n);
    expect(
      BigInt(defaults.minimumWethRaisedWei) +
        BigInt(defaults.graduationSafetyMarginWethWei),
    ).toBe(10_000_000_000_000_000_001n);
  });
});
