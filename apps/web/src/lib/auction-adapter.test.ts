import { describe, expect, it } from "vitest";

import { snapAuctionPriceQ96 } from "./auction-adapter";

const Q96 = 1n << 96n;

describe("CCA auction adapter", () => {
  it("rounds a decimal ceiling up to the published Q96 tick grid", () => {
    const spacing = Q96 / 1_000n;
    const floor = 5n * spacing;
    expect(snapAuctionPriceQ96("0.006", floor, spacing)).toBe(floor + spacing);
    expect(snapAuctionPriceQ96("0.006000000000000001", floor, spacing)).toBe(
      floor + 2n * spacing,
    );
  });

  it("moves a floor-or-lower ceiling to the first bid-valid tick", () => {
    const spacing = Q96 / 1_000n;
    const floor = 5n * spacing;
    expect(snapAuctionPriceQ96("0.004", floor, spacing)).toBe(floor + spacing);
    expect(() => snapAuctionPriceQ96("0.1.2", floor, spacing)).toThrow(
      /maximum price/i,
    );
  });
});
