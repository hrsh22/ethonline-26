import type { LiquidityCycleHistory } from "@orbit/protocol/market-history";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { derivePoolGrowthPoints, PoolGrowthChart } from "./pool-growth-chart";

const weth = 10n ** 18n;

const cycle = (
  cycleNumber: bigint,
  permanentlyLockedWeth: bigint,
  blockNumber: bigint,
): LiquidityCycleHistory => ({
  cycleNumber,
  blockNumber,
  blockTimestamp: 1_700_000_000n + blockNumber,
  transactionHash: `0x${cycleNumber.toString().padStart(64, "0")}`,
  pulledWeth: 10n * weth,
  consumedWeth: 8n * weth,
  queuedWeth: 2n * weth,
  permanentlyLockedWeth,
  tickLower: -120,
  tickUpper: -60,
  liquidity: 1_234n,
});

describe("Protocol-Owned Liquidity growth chart", () => {
  it("sorts complete indexed cycles and adds an explicitly projected queue", () => {
    const points = derivePoolGrowthPoints({
      cycles: [cycle(2n, 20n, 22n), cycle(1n, 8n, 11n)],
      currentLockedWeth: 20n,
      pendingWeth: 5n,
    });

    expect(
      points.map(({ label, permanentlyLockedWeth, projected }) => ({
        label,
        permanentlyLockedWeth,
        projected,
      })),
    ).toEqual([
      {
        label: "Start",
        permanentlyLockedWeth: 0n,
        projected: false,
      },
      {
        label: "Cycle 1",
        permanentlyLockedWeth: 8n,
        projected: false,
      },
      {
        label: "Cycle 2",
        permanentlyLockedWeth: 20n,
        projected: false,
      },
      {
        label: "Locked + pipeline",
        permanentlyLockedWeth: 25n,
        projected: true,
      },
    ]);
    expect(points[1]).toMatchObject({
      blockNumber: 11n,
      consumedWeth: 8n * weth,
      queuedWeth: 2n * weth,
      tickLower: -120,
      tickUpper: -60,
      liquidity: 1_234n,
    });
  });

  it("renders an accessible chart and every exact cycle field", () => {
    const points = derivePoolGrowthPoints({
      cycles: [cycle(1n, 1_000_000_000_000_000_000n, 4_444n)],
      currentLockedWeth: 1_000_000_000_000_000_000n,
      pendingWeth: 500_000_000_000_000_000n,
    });
    const html = renderToStaticMarkup(<PoolGrowthChart points={points} />);

    expect(html).toContain('role="img"');
    expect(html).toContain('data-series="actual"');
    expect(html).toContain('data-series="projection"');
    expect(html.match(/data-axis-value/gu)).toHaveLength(2);
    expect(html).toContain("Show exact chart data");
    expect(html).toContain("Cycle 1");
    expect(html).toContain("4444");
    expect(html).toContain("1.5 WETH");
    expect(html).toContain("8 WETH");
    expect(html).toContain("2 WETH");
    expect(html).toContain("-120 to -60");
    expect(html).toContain("1234");
    expect(html).toMatch(/<table[\s>]/u);
  });

  it("keeps the value axis clear of the plot it labels", () => {
    const points = derivePoolGrowthPoints({
      cycles: [1n, 2n, 3n].map((index) => cycle(index, index * 10n, 4_444n)),
      currentLockedWeth: 30n,
      pendingWeth: 5n,
    });
    const html = renderToStaticMarkup(<PoolGrowthChart points={points} />);

    // Every axis label starts to the right of the rightmost observation.
    // End-anchoring them at the plot edge drew them over the final point.
    const labelXs = [...html.matchAll(/data-axis-value[^>]*\bx="(\d+)"/gu)].map(
      (match) => Number(match[1]),
    );
    const pointXs = [...html.matchAll(/<circle[^>]*cx="(\d+)"/gu)].map(
      (match) => Number(match[1]),
    );
    expect(labelXs).toHaveLength(2);
    expect(pointXs.length).toBeGreaterThan(1);
    expect(Math.min(...labelXs)).toBeGreaterThan(Math.max(...pointXs));
  });

  it("does not invent a zero baseline when a partial index begins after cycle one", () => {
    const points = derivePoolGrowthPoints({
      cycles: [cycle(4n, 40n, 44n), cycle(5n, 50n, 55n)],
      currentLockedWeth: 50n,
      pendingWeth: 0n,
    });

    expect(points.map((point) => point.label)).toEqual(["Cycle 4", "Cycle 5"]);
  });

  it("retains every exact detail when partial history contains one later cycle", () => {
    const points = derivePoolGrowthPoints({
      cycles: [cycle(4n, 40n, 44n)],
      currentLockedWeth: undefined,
      pendingWeth: undefined,
    });
    const html = renderToStaticMarkup(<PoolGrowthChart points={points} />);

    expect(html).toContain("Show exact chart data");
    expect(html).toContain("Cycle 4");
    expect(html).toContain("44");
    expect(html).toContain("8 WETH");
    expect(html).toContain("2 WETH");
    expect(html).toContain("-120 to -60");
    expect(html).toContain("1234");
  });

  it("does not project an unobserved liquidity queue as zero", () => {
    const points = derivePoolGrowthPoints({
      cycles: [cycle(1n, 8n, 11n)],
      currentLockedWeth: 8n,
      pendingWeth: undefined,
    });

    expect(points.every((point) => !point.projected)).toBe(true);
  });
});
