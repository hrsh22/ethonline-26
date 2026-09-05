import { describe, expect, it } from "vitest";

import { selectIdentityConfiguration } from "@orbit/config/identity";
import { createIndexedHistoryReaders } from "@orbit/protocol/history";
import { createCanonicalMarketHistoryReader } from "@orbit/protocol/market-history";

import { protocolDeploymentManifests } from "../src/generated/deployment-manifests";
import { historyFixtureResponse } from "./fixtures";

describe("browser history responses through the public reader", () => {
  it("provides a coherent checkpoint and empty canonical pages", async () => {
    const reader = createIndexedHistoryReaders({
      basePath: "https://history.test/v1/history",
      fetcher: async (input) => historyFixtureResponse(new URL(String(input))),
      identity: selectIdentityConfiguration("orbit-4444"),
      manifest: protocolDeploymentManifests.staging,
    });
    const status = await reader.status();
    expect(status.status.state).toBe("complete");
    const request = {
      fromBlock: status.manifest.launchBlock,
      toBlock: status.snapshot.blockNumber!,
      limit: 100,
    };
    for (const read of [
      reader.market.swaps,
      reader.market.fees,
      reader.protocol.liquidityCycles,
    ]) {
      const page = await read(request);
      expect(page.items).toEqual([]);
      expect(page.snapshot).toEqual(status.snapshot);
      expect(page.status.requested).toEqual({
        fromBlock: request.fromBlock,
        toBlock: request.toBlock,
      });
      expect(page.page.hasMore).toBe(false);
    }
    expect(await reader.market.candles!()).toEqual({
      source: "uniswap-v4-subgraph",
      state: "unconfigured",
    });
  });

  it("reads two priced minutes from canonical swaps and matched fees", async () => {
    const identity = selectIdentityConfiguration("orbit-4444");
    const manifest = protocolDeploymentManifests.staging;
    const history = createIndexedHistoryReaders({
      basePath: "https://history.test/v1/history",
      fetcher: async (input) =>
        historyFixtureResponse(new URL(String(input)), true),
      identity,
      manifest,
    });
    const market = await createCanonicalMarketHistoryReader({
      history,
      identity,
      manifest,
    }).readLatest();
    expect(market.status.state).toBe("complete");
    expect(market.candles).toHaveLength(2);
    expect(market.candles[0]?.closeWethPerLiquidTokenX18).toBe(
      1_000_000_000_000_000_000n,
    );
    expect(market.feeMatching).toEqual({
      state: "complete",
      matchedSwapCount: 2,
      unmatchedSwapCount: 0,
      unmatchedFeeCount: 0,
    });
  });
});
