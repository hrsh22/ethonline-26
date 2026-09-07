"use client";

import { useState } from "react";
import {
  decodeRewardFundingResponse,
  PUBLIC_API_PATHS,
  type RewardFundingResponse,
} from "@orbit/config/public-api";
import { Disclosure } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Amount } from "@/components/ui/value";
import { publicApiUrl } from "@/lib/public-api";

export function RewardFundingEvidence({
  result,
}: {
  readonly result: RewardFundingResponse;
}) {
  if (result.state === "unavailable")
    return (
      <p role="status" className="text-body-sm text-ink-soft">
        {result.reason === "budget-exhausted"
          ? "Funding analytics reached today's query allowance. Try again tomorrow."
          : result.reason === "indexing-error"
            ? "The funding index reported an indexing error. Funding totals are unavailable."
            : "Funding analytics is unavailable. Your rewards and claims remain available above."}
      </p>
    );
  const { rewardFundingSummary: summary, _meta: meta } = result.data;
  const age =
    meta.block.timestamp === null
      ? undefined
      : Math.max(
          0,
          Math.floor(result.observedAt / 1000) - meta.block.timestamp,
        );
  return (
    <div className="grid gap-3">
      <p className="text-caption text-ink-soft">
        The Graph · indexed block {meta.block.number.toLocaleString("en-US")}
        {age === undefined
          ? " · index age unavailable"
          : ` · indexed block was ${age.toLocaleString("en-US")} seconds old when checked`}
        . Checked {new Date(result.observedAt).toISOString()}. Chain-head lag is
        unknown.
      </p>
      {summary === null ? (
        <p className="text-body-sm">
          No funding summary has been indexed yet. This is not evidence of a
          zero reward balance.
        </p>
      ) : (
        <>
          <p className="text-body-sm">
            {summary.pool.inputTokens.map((token) => token.symbol).join(" / ")}{" "}
            market · {summary.feeEventCount} fee events ·{" "}
            {summary.conversionCount} conversions indexed.
          </p>
          <DataList>
            <DataRow
              label="Trading fees collected · 3%"
              value={
                <Amount unit="WETH" value={BigInt(summary.totalFeesWeth)} />
              }
            />
            <DataRow
              label="Allocated to rewards · 2%"
              value={
                <Amount unit="WETH" value={BigInt(summary.totalRewardsWeth)} />
              }
            />
            <DataRow
              label="Allocated to liquidity · 0.85%"
              value={
                <Amount
                  unit="WETH"
                  value={BigInt(summary.totalLiquidityWeth)}
                />
              }
            />
            <DataRow
              label="Allocated to creator · 0.15%"
              value={
                <Amount unit="WETH" value={BigInt(summary.totalCreatorWeth)} />
              }
            />
            <DataRow
              label="WETH spent on completed conversions"
              value={
                <Amount
                  unit="WETH"
                  value={BigInt(summary.totalConvertedWeth)}
                />
              }
            />
          </DataList>
          <p className="text-caption text-ink-soft">
            Percentages apply to WETH-side trading volume. Totals use each fee
            event’s exact integer split. Rewards are pooled; an individual swap
            cannot be traced to your claim or a particular reward epoch.
          </p>
          {summary.pool.swaps.length > 0 ? (
            <div>
              <h3 className="text-body-sm font-medium">
                Recent indexed market swaps
              </h3>
              <p className="mt-1 text-caption text-ink-soft">
                Amounts are pool swap deltas before the separate WETH hook fee;
                wallet totals can differ.
              </p>
              <ul className="mt-2 grid gap-2 text-body-sm">
                {summary.pool.swaps.map((swap) => (
                  <li key={swap.id}>
                    <a
                      className="underline underline-offset-4"
                      href={`https://sepolia.basescan.org/tx/${swap.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Amount
                        value={BigInt(swap.amountIn)}
                        decimals={swap.tokenIn.decimals}
                        unit={swap.tokenIn.symbol}
                      />{" "}
                      →{" "}
                      <Amount
                        value={BigInt(swap.amountOut)}
                        decimals={swap.tokenOut.decimals}
                        unit={swap.tokenOut.symbol}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Explicit reads only: opening Rewards or leaving it hidden never schedules Graph queries. */
export function RewardFundingPanel() {
  const [result, setResult] = useState<RewardFundingResponse>();
  const [loading, setLoading] = useState(false);
  const read = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        publicApiUrl(PUBLIC_API_PATHS.analytics.rewardFunding),
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new Error("Analytics unavailable");
      setResult(decodeRewardFundingResponse(await response.json()));
    } catch {
      setResult({
        state: "unavailable",
        reason: "provider-error",
        observedAt: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Disclosure title="Where rewards came from">
      <div className="grid gap-3">
        <p className="text-body-sm text-ink-soft">
          Market activity funds the shared reward pool. These are valueless test
          assets on Base Sepolia. Analytics describes indexed funding activity;
          your claimable balance is shown above.
        </p>
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => {
              void read();
            }}
          >
            {loading
              ? "Loading funding activity…"
              : result === undefined
                ? "Load funding activity"
                : "Refresh funding activity"}
          </Button>
        </div>
        <p className="text-caption text-ink-soft">
          Updated on request, with a two-minute shared cache.
        </p>
        {result === undefined ? null : (
          <RewardFundingEvidence result={result} />
        )}
      </div>
    </Disclosure>
  );
}
