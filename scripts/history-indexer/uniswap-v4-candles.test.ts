import { describe, expect, it, vi } from "vitest";

import { createUniswapV4CandleSource } from "./uniswap-v4-candles.ts";

const poolId = `0x${"ab".repeat(32)}` as const;
const liquidToken = `0x${"11".repeat(20)}` as const;
const settlementToken = `0x${"22".repeat(20)}` as const;

const graphResponse = (overrides: Record<string, unknown> = {}) => ({
  data: {
    pool: {
      id: poolId,
      token0: { id: liquidToken },
      token1: { id: settlementToken },
    },
    poolHourDatas: [
      {
        periodStartUnix: "1699999200",
        open: "200",
        high: "250",
        low: "100",
        close: "125",
      },
    ],
    swaps: [
      { timestamp: "1700000100" },
      { timestamp: "1700000000" },
      { timestamp: "1699999900" },
    ],
    _meta: { block: { number: 123_456 }, hasIndexingErrors: false },
    ...overrides,
  },
});

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

const sourceWith = (
  fetcher: typeof fetch,
  overrides: Partial<Parameters<typeof createUniswapV4CandleSource>[0]> = {},
) =>
  createUniswapV4CandleSource({
    bearerToken: "server-only-token",
    cacheMilliseconds: 60_000,
    currency0: liquidToken,
    currency1: settlementToken,
    fetcher,
    liquidToken,
    nowMilliseconds: () => 1_000,
    poolId,
    timeoutMilliseconds: 5_000,
    url: new URL("https://subgraph.example/query"),
    ...overrides,
  });

describe("Uniswap v4 candle source", () => {
  it("normalizes official token0 OHLC into WETH per liquid token", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer server-only-token",
      });
      expect(String(init?.body)).toContain(poolId);
      return response(graphResponse());
    });
    const source = sourceWith(fetcher);

    const [first, concurrent] = await Promise.all([
      source.readLatest(),
      source.readLatest(),
    ]);
    const cached = await source.readLatest();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(concurrent);
    expect(cached).toEqual(first);
    expect(first).toMatchObject({
      source: "uniswap-v4-subgraph",
      state: "available",
      indexedThroughBlock: 123_456n,
      candles: [
        {
          intervalStart: 1_699_999_200n,
          intervalEnd: 1_700_002_800n,
          openWethPerLiquidTokenX18: 5_000_000_000_000_000n,
          highWethPerLiquidTokenX18: 10_000_000_000_000_000n,
          lowWethPerLiquidTokenX18: 4_000_000_000_000_000n,
          closeWethPerLiquidTokenX18: 8_000_000_000_000_000n,
          swapCount: 3,
        },
      ],
    });
  });

  it("uses the official OHLC directly when WETH is currency0", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response(
        graphResponse({
          pool: {
            id: poolId,
            token0: { id: settlementToken },
            token1: { id: liquidToken },
          },
          poolHourDatas: [
            {
              periodStartUnix: "1699999200",
              open: "0.005",
              high: "0.006",
              low: "0.004",
              close: "0.0055",
            },
          ],
          swaps: [{ timestamp: "1700000100" }],
        }),
      ),
    );
    const source = sourceWith(fetcher, {
      currency0: settlementToken,
      currency1: liquidToken,
    });

    await expect(source.readLatest()).resolves.toMatchObject({
      candles: [
        {
          openWethPerLiquidTokenX18: 5_000_000_000_000_000n,
          highWethPerLiquidTokenX18: 6_000_000_000_000_000n,
          lowWethPerLiquidTokenX18: 4_000_000_000_000_000n,
          closeWethPerLiquidTokenX18: 5_500_000_000_000_000n,
        },
      ],
    });
  });

  it("rejects a feed that does not prove the configured pool identity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response(
        graphResponse({
          pool: {
            id: `0x${"cd".repeat(32)}`,
            token0: { id: liquidToken },
            token1: { id: settlementToken },
          },
        }),
      ),
    );

    await expect(sourceWith(fetcher).readLatest()).rejects.toThrow(
      "pool identity",
    );
  });
});
