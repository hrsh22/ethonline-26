import { describe, expect, it } from "vitest";

import { sqrtPriceAtTick } from "../src/v4-math.js";

describe("Uniswap v4 integer math", () => {
  it("ports the audited TickMath price boundary exactly", () => {
    expect(sqrtPriceAtTick(0)).toBe(79_228_162_514_264_337_593_543_950_336n);
    expect(sqrtPriceAtTick(1)).toBe(79_232_123_823_359_799_118_286_999_568n);
    expect(sqrtPriceAtTick(-1)).toBe(79_224_201_403_219_477_170_569_942_574n);
    expect(sqrtPriceAtTick(-887_272)).toBe(4_295_128_739n);
    expect(sqrtPriceAtTick(887_272)).toBe(
      1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n,
    );
  });
});
