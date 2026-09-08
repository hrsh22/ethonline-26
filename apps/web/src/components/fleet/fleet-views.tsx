"use client";

import { Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { FleetPanel } from "@/components/fleet/fleet-panel";
import { AccessNotice } from "@/components/access-notice";
import { StateFeedback } from "@/components/state-feedback";
import { useProtocolClient } from "@/providers/protocol-client-provider";

const RewardsPanel = dynamic(() =>
  import("@/components/rewards/rewards-panel").then(
    (module) => module.RewardsPanel,
  ),
);
const StockBalancesPanel = dynamic(() =>
  import("@/components/rewards/stock-balances-panel").then(
    (module) => module.StockBalancesPanel,
  ),
);

function FleetRewards() {
  const { walletRead } = useProtocolClient();
  if (walletRead.status !== "loaded") return <AccessNotice />;
  return (
    <>
      <RewardsPanel />
      <StockBalancesPanel />
    </>
  );
}

function FleetView() {
  const params = useSearchParams();
  const rewards = params?.get("view") === "rewards";
  const collectionParams = new URLSearchParams(params?.toString());
  collectionParams.delete("view");
  const rewardParams = new URLSearchParams(collectionParams);
  rewardParams.set("view", "rewards");
  return (
    <>
      <nav
        aria-label="My Fleet views"
        className="my-5 flex gap-6 border-b border-line"
      >
        <Link
          href={collectionParams.size ? `/fleet?${collectionParams}` : "/fleet"}
          aria-current={!rewards ? "page" : undefined}
          className={`flex min-h-11 items-center border-b-2 text-body ${!rewards ? "border-signal text-signal" : "border-transparent text-ink-soft"}`}
        >
          Collection
        </Link>
        <Link
          href={`/fleet?${rewardParams}`}
          aria-current={rewards ? "page" : undefined}
          className={`flex min-h-11 items-center border-b-2 text-body ${rewards ? "border-signal text-signal" : "border-transparent text-ink-soft"}`}
        >
          Rewards
        </Link>
      </nav>
      {rewards ? <FleetRewards /> : <FleetPanel />}
    </>
  );
}

export function FleetViews() {
  return (
    <Suspense
      fallback={
        <StateFeedback
          title="Loading My Fleet"
          description="Opening your collection."
          tone="loading"
        />
      }
    >
      <FleetView />
    </Suspense>
  );
}
