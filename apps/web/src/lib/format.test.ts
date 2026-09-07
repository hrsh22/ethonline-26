import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import {
  formatAddress,
  formatBasisPoints,
  formatCount,
  formatPercent,
  formatRate,
  formatTokenAmount,
} from "./format";

const wei = (value: string) => parseUnits(value, 18);

describe("formatTokenAmount", () => {
  it("rounds remaining requirements upward without losing their exact value or hiding tiny amounts", () => {
    for (const value of [
      wei("0.928063001893924137"),
      wei("0.911324785315306868"),
      wei("0.999999999999999999"),
      1n,
      0n,
    ]) {
      const formatted = formatTokenAmount(value, { rounding: "ceil" });
      expect(
        parseUnits(formatted.display.replaceAll(",", ""), 18),
      ).toBeGreaterThanOrEqual(value);
      expect(parseUnits(formatted.exact, 18)).toBe(value);
    }
    expect(
      formatTokenAmount(wei("0.928063001893924137"), { rounding: "ceil" })
        .display,
    ).toBe("0.92807");
    expect(
      formatTokenAmount(wei("0.911324785315306868"), { rounding: "ceil" })
        .display,
    ).toBe("0.91133");
    expect(
      formatTokenAmount(1n, { rounding: "ceil", maximumFractionDigits: 6 })
        .display,
    ).toBe("0.000001");
  });

  it("shortens the exact decimal expansions the routes used to print raw", () => {
    // The three values that appeared unreadable on /exchange and /market.
    expect(formatTokenAmount(wei("0.005750386365257872")).display).toBe(
      "0.0057504",
    );
    expect(formatTokenAmount(wei("0.021071499999999999")).display).toBe(
      "0.021071",
    );
    expect(formatTokenAmount(wei("0.003718500000000005")).display).toBe(
      "0.0037185",
    );
  });

  it("never reports zero for a nonzero balance", () => {
    // A fixed six-digit truncation rendered this as exactly "0", so a real
    // destination-locked balance read as empty on the public status surface.
    const tiny = formatTokenAmount(wei("0.0000001234"));
    expect(tiny.display).toBe("0.0000001234");

    // Even a single base unit survives.
    expect(formatTokenAmount(1n).display).toBe("0.000000000000000001");
  });

  it("reports a bound instead of a false zero when the ceiling is tighter than the value", () => {
    const clamped = formatTokenAmount(wei("0.0000001234"), {
      maximumFractionDigits: 4,
    });
    expect(clamped.display).toBe("< 0.0001");
    expect(clamped.abbreviated).toBe(true);
    expect(clamped.exact).toBe("0.0000001234");
  });

  it("keeps a fixed fraction once the value reaches one, and groups thousands", () => {
    expect(formatTokenAmount(wei("3.421812345")).display).toBe("3.4218");
    expect(formatTokenAmount(wei("12345.6789123")).display).toBe("12,345.6789");
  });

  it("pads to a minimum fraction so a column of values stays aligned", () => {
    const padded = [wei("1"), wei("0.5"), wei("12")].map(
      (value) => formatTokenAmount(value, { minimumFractionDigits: 4 }).display,
    );
    expect(padded).toEqual(["1.0000", "0.5000", "12.0000"]);
    expect(formatTokenAmount(0n, { minimumFractionDigits: 4 }).display).toBe(
      "0.0000",
    );
  });

  it("rounds half up rather than truncating", () => {
    // Truncation would report 0.021071 for both; only the second should round
    // down, and a value just over the boundary has to round up.
    expect(formatTokenAmount(wei("0.0210715")).display).toBe("0.021072");
    expect(formatTokenAmount(wei("0.0210714")).display).toBe("0.021071");
  });

  it("carries the exact value and says whether the display dropped precision", () => {
    const abbreviated = formatTokenAmount(wei("0.005750386365257872"));
    expect(abbreviated.exact).toBe("0.005750386365257872");
    expect(abbreviated.abbreviated).toBe(true);

    const whole = formatTokenAmount(wei("2.5"));
    expect(whole.exact).toBe("2.5");
    expect(whole.abbreviated).toBe(false);
  });

  it("respects a token's own precision", () => {
    // USDC-style six-decimal token: the display cannot invent more precision.
    expect(
      formatTokenAmount(parseUnits("1.234567", 6), { decimals: 6 }).display,
    ).toBe("1.2346");
    expect(formatTokenAmount(1n, { decimals: 6 }).display).toBe("0.000001");
  });

  it("formats zero and negatives", () => {
    expect(formatTokenAmount(0n).display).toBe("0");
    expect(formatTokenAmount(-wei("1234.5")).display).toBe("-1,234.5");
    expect(formatTokenAmount(-wei("0.005750386365257872")).display).toBe(
      "-0.0057504",
    );
  });
});

describe("formatCount", () => {
  it("groups thousands and never abbreviates", () => {
    expect(formatCount(4442).display).toBe("4,442");
    expect(formatCount(46_295_712n).display).toBe("46,295,712");
    expect(formatCount(0).display).toBe("0");
    expect(formatCount(4442).abbreviated).toBe(false);
  });
});

describe("formatRate", () => {
  it("keeps significant digits for the smallest values the market reports", () => {
    expect(formatRate(wei("0.005750386365257872")).display).toBe("0.0057504");
  });
});

describe("formatAddress", () => {
  it("elides the middle and keeps the full address for copying", () => {
    const formatted = formatAddress(
      "0x2f4C1bE5a9D8e7F60a1B2c3D4e5F60718293A4b5",
    );
    expect(formatted.display).toBe("0x2f4C…A4b5");
    expect(formatted.exact).toBe("0x2f4C1bE5a9D8e7F60a1B2c3D4e5F60718293A4b5");
    expect(formatted.abbreviated).toBe(true);
  });

  it("leaves a short identifier intact", () => {
    expect(formatAddress("0x2f4C1bE5").display).toBe("0x2f4C1bE5");
    expect(formatAddress("0x2f4C1bE5").abbreviated).toBe(false);
  });
});

describe("formatPercent and formatBasisPoints", () => {
  it("renders a stable two-digit percentage", () => {
    expect(formatPercent(0.03).display).toBe("3.00%");
    expect(formatBasisPoints(300).display).toBe("3.00%");
    expect(formatBasisPoints(85).display).toBe("0.85%");
    expect(formatBasisPoints(1250).display).toBe("12.50%");
  });
});
