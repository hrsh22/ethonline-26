import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createRewardFundingService,
  openGraphQueryBudget,
  REWARD_FUNDING_QUERY,
} from "../src/graph-analytics.js";
const poolId = `0x${"a".repeat(64)}`;
const data = {
  _meta: {
    block: { number: 100, hash: null, timestamp: 100 },
    deployment: "QmDeployment",
    hasIndexingErrors: false,
  },
  rewardFundingSummary: null,
};
const setup = (body: unknown = { data }) => {
  let now = 200_000;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(body));
  const reserve = vi.fn(() => true);
  const service = createRewardFundingService({
    queryUrl: "https://api.studio.thegraph.com/query/123/orbit/v1",
    poolId,
    reserve,
    now: () => now,
    fetcher,
  });
  return {
    service,
    fetcher,
    reserve,
    advance: () => {
      now += 120_000;
    },
  };
};
describe("reward funding query", () => {
  it("deduplicates concurrent reads, caches for two minutes and fixes query and pool", async () => {
    const { service, fetcher, reserve, advance } = setup();
    const [first, second] = await Promise.all([service.read(), service.read()]);
    expect(first.state).toBe("available");
    expect(second).toBe(first);
    await service.read();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      query: REWARD_FUNDING_QUERY,
      variables: { poolId },
    });
    advance();
    await service.read();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    [
      { data: { ...data, _meta: { ...data._meta, hasIndexingErrors: true } } },
      "indexing-error",
    ],
    [
      { data, errors: [{ message: "private upstream message" }] },
      "provider-error",
    ],
    [
      { data: { ...data, _meta: { ...data._meta, block: { number: -1 } } } },
      "provider-error",
    ],
    [
      { data: { ...data, rewardFundingSummary: { totalFeesWeth: "-1" } } },
      "provider-error",
    ],
  ])(
    "fails closed on invalid or partial Graph responses",
    async (body, reason) => {
      const { service, fetcher } = setup(body);
      expect(await service.read()).toMatchObject({
        state: "unavailable",
        reason,
      });
      await service.read();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("caches provider failure without leaking its error", async () => {
    const { service, fetcher } = setup();
    fetcher.mockRejectedValue(new Error("secret"));
    expect(await service.read()).toEqual({
      state: "unavailable",
      reason: "provider-error",
      observedAt: 200_000,
    });
    await service.read();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not query when the durable allowance is exhausted", async () => {
    const { service, reserve, fetcher } = setup();
    reserve.mockReturnValue(false);
    expect(await service.read()).toMatchObject({ reason: "budget-exhausted" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("persists the daily 2000-query cap across restarts and resets by UTC date", () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-graph-"));
    const path = join(dir, "budget.sqlite");
    const now = Date.UTC(2026, 8, 8);
    let budget = openGraphQueryBudget(path);
    try {
      for (let i = 0; i < 2000; i++) expect(budget.reserve(now)).toBe(true);
      expect(budget.reserve(now)).toBe(false);
      budget.close();
      budget = openGraphQueryBudget(path);
      expect(budget.reserve(now)).toBe(false);
      expect(budget.reserve(now + 86_400_000)).toBe(true);
    } finally {
      budget.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("accepts exact event allocations and rejects mismatched pools or arithmetic", async () => {
  const token = { id: `0x${"a".repeat(40)}`, symbol: "WETH", decimals: 18 };
  const summary = {
    id: poolId,
    totalFeesWeth: "3",
    totalRewardsWeth: "2",
    totalLiquidityWeth: "1",
    totalCreatorWeth: "0",
    totalConvertedWeth: "1",
    feeEventCount: 1,
    conversionCount: 1,
    lastEventBlock: "100",
    lastEventTimestamp: "100",
    pool: {
      id: poolId,
      inputTokens: [token, { ...token, symbol: "FUEL" }],
      swaps: [],
    },
  };
  expect(
    (
      await setup({
        data: { ...data, rewardFundingSummary: summary },
      }).service.read()
    ).state,
  ).toBe("available");
  for (const invalid of [
    { ...summary, totalFeesWeth: "4" },
    { ...summary, id: `0x${"b".repeat(64)}` },
    { ...summary, lastEventBlock: "101" },
  ]) {
    expect(
      await setup({
        data: { ...data, rewardFundingSummary: invalid },
      }).service.read(),
    ).toMatchObject({ state: "unavailable", reason: "provider-error" });
  }
});
