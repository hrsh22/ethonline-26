import { expect, it } from "vitest";
import { discoveryTargetOutput } from "./discovery-target";
import { EXCHANGE_SLIPPAGE_POLICY } from "./exchange-state";

it.each([
  0n,
  1n,
  10n ** 18n - 1n,
  10n ** 18n,
  1316012613200434547n,
  12345n * 10n ** 18n + 5n,
])("protects the next Discovery threshold at balance %s", (balance) => {
  const output = discoveryTargetOutput(balance);
  const scale = 10000n - BigInt(EXCHANGE_SLIPPAGE_POLICY.toleranceBps);
  const target = (balance / 10n ** 18n + 1n) * 10n ** 18n;
  expect(balance + (output * scale) / 10000n).toBeGreaterThanOrEqual(target);
  expect(balance + ((output - 1n) * scale) / 10000n).toBeLessThan(target);
});
