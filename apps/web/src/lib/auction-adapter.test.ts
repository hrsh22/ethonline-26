import { describe, expect, it } from "vitest";

import { snapAuctionPriceQ96 } from "./auction-adapter";

const Q96 = 1n << 96n;

describe("CCA auction adapter", () => {
  it("accepts a displayed auction tick without raising its ceiling", () => {
    const spacing = Q96 / 1_000n;
    const floor = 5n * spacing;
    expect(snapAuctionPriceQ96("0.006", floor, spacing)).toBe(floor + spacing);
    expect(() => snapAuctionPriceQ96("0.0060001", floor, spacing)).toThrow(
      /valid price increment/i,
    );
  });

  it("rejects prices that are not an exact displayed auction tick", () => {
    const spacing = Q96 / 1_000n;
    const floor = 5n * spacing;
    expect(() => snapAuctionPriceQ96("0.004", floor, spacing)).toThrow(
      /maximum price/i,
    );
    expect(() => snapAuctionPriceQ96("0.0051", floor, spacing)).toThrow(
      /valid price increment/i,
    );
    expect(() => snapAuctionPriceQ96("0.1.2", floor, spacing)).toThrow(
      /maximum price/i,
    );
  });
});
