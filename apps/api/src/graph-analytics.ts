import { chmodSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import {
  RewardFundingDataSchema,
  type RewardFundingResponse,
} from "@orbit/config/public-api";
import { configureSqlite } from "@orbit/config/sqlite";
import type { PublicApiConfiguration } from "./configuration.js";

/** Fixed and bounded: callers cannot submit GraphQL or choose deployments. */
export const REWARD_FUNDING_QUERY = `query RewardFunding($poolId: ID!) {
  _meta { block { number hash timestamp } hasIndexingErrors deployment }
  rewardFundingSummary(id: $poolId) {
    id totalFeesWeth totalRewardsWeth totalLiquidityWeth totalCreatorWeth
    totalConvertedWeth feeEventCount conversionCount lastEventBlock lastEventTimestamp
    pool { id inputTokens { id symbol decimals }
      swaps(first: 5, orderBy: timestamp, orderDirection: desc) {
        id hash timestamp amountIn amountOut tokenIn { id symbol decimals } tokenOut { id symbol decimals }
      }
    }
  }
}`;
export interface RewardFundingService {
  readonly read: () => Promise<RewardFundingResponse>;
}

/** Atomic reservation persists failed requests too, including across process restarts. */
export function openGraphQueryBudget(path: string) {
  const database = new DatabaseSync(path);
  configureSqlite(database, "Graph analytics budget", {
    wal: path !== ":memory:",
  });
  if (path !== ":memory:") chmodSync(path, 0o600);
  database.exec(
    "CREATE TABLE IF NOT EXISTS graph_query_budget (day TEXT PRIMARY KEY, requests INTEGER NOT NULL)",
  );
  const reserve =
    database.prepare(`INSERT INTO graph_query_budget(day,requests) VALUES (?,1)
    ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests < 2000 RETURNING requests`);
  return {
    reserve: (now: number): boolean =>
      reserve.get(new Date(now).toISOString().slice(0, 10)) !== undefined,
    close: () => database.close(),
  };
}

function decodeGraphData(body: unknown, poolId: string) {
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    ("errors" in body && body.errors !== undefined)
  )
    throw new Error("Invalid Graph response");
  const data = Schema.decodeUnknownSync(RewardFundingDataSchema)(body.data);
  validateSummary(data, poolId);
  return data;
}
function validateSummary(
  data: typeof RewardFundingDataSchema.Type,
  poolId: string,
) {
  const summary = data.rewardFundingSummary;
  if (summary === null) return;
  if (
    summary.id.toLowerCase() !== poolId.toLowerCase() ||
    summary.pool.id.toLowerCase() !== poolId.toLowerCase() ||
    BigInt(summary.totalFeesWeth) !==
      BigInt(summary.totalRewardsWeth) +
        BigInt(summary.totalLiquidityWeth) +
        BigInt(summary.totalCreatorWeth) ||
    BigInt(summary.lastEventBlock) > BigInt(data._meta.block.number)
  )
    throw new Error("Invalid funding summary");
}

export function createRewardFundingService(options: {
  readonly queryUrl: string;
  readonly poolId: string;
  readonly apiKey?: string;
  readonly reserve: (now: number) => boolean;
  readonly now?: () => number;
  readonly fetcher?: typeof fetch;
}): RewardFundingService {
  const now = options.now ?? Date.now;
  let cache: RewardFundingResponse | undefined;
  let pending: Promise<RewardFundingResponse> | undefined;
  const unavailable = (
    reason: Extract<RewardFundingResponse, { state: "unavailable" }>["reason"],
  ): RewardFundingResponse => ({
    state: "unavailable",
    reason,
    observedAt: now(),
  });
  const fetchData = async (): Promise<RewardFundingResponse> => {
    try {
      if (!options.reserve(now())) return unavailable("budget-exhausted");
      const response = await (options.fetcher ?? fetch)(options.queryUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          ...(options.apiKey === undefined
            ? {}
            : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          query: REWARD_FUNDING_QUERY,
          variables: { poolId: options.poolId },
        }),
      });
      if (!response.ok) return unavailable("provider-error");
      const body: unknown = await response.json();
      const data = decodeGraphData(body, options.poolId);
      if (data._meta.hasIndexingErrors) return unavailable("indexing-error");
      return { state: "available", observedAt: now(), data };
    } catch {
      return unavailable("provider-error");
    }
  };
  return {
    read: () => {
      if (cache !== undefined && now() - cache.observedAt < 120_000)
        return Promise.resolve(cache);
      pending ??= fetchData()
        .then((result) => {
          cache = result;
          return result;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}

export function openGraphAnalyticsRuntime(
  configuration: PublicApiConfiguration,
) {
  const graph = configuration.graphAnalytics;
  if (graph === undefined) return { service: undefined, close: () => {} };
  const manifest = decodeProtocolDeploymentManifest(
    JSON.parse(
      readFileSync(configuration.adminAuth.manifestPath, "utf8"),
    ) as unknown,
  );
  if (manifest.chainId !== 84532)
    throw new Error("Graph reward analytics requires Base Sepolia");
  const budget = openGraphQueryBudget(
    join(
      dirname(configuration.adminAuth.databasePath),
      "graph-analytics.sqlite",
    ),
  );
  return {
    service: createRewardFundingService({
      ...graph,
      poolId: manifest.canonicalPool.poolId,
      reserve: budget.reserve,
    }),
    close: budget.close,
  };
}
