"use client";

import { Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { FleetPanel } from "@/components/fleet/fleet-panel";
import { AccessNotice } from "@/components/access-notice";
import { StateFeedback } from "@/components/state-feedback";
import { ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page";
import { Amount } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

const RewardsPanel = dynamic(() =>
  import("@/components/rewards/rewards-panel").then(
    (module) => module.RewardsPanel,
  ),
);
const RewardProgressPanel = dynamic(() =>
  import("@/components/rewards/reward-progress-panel").then(
    (module) => module.RewardProgressPanel,
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
      <RewardProgressPanel />
      <RewardsPanel />
      <StockBalancesPanel />
    </>
  );
}

function FleetView() {
  const { walletRead } = useProtocolClient();
  const params = useSearchParams();
  const rewards = params?.get("view") === "rewards";
  const collectionParams = new URLSearchParams(params?.toString());
  collectionParams.delete("view");
  const rewardParams = new URLSearchParams(collectionParams);
  rewardParams.set("view", "rewards");
  // A wallet may still hold claimed stock rewards after transferring its craft.
  const showTabs = walletRead.status === "loaded";
  return (
    <>
      {showTabs ? (
        <nav aria-label="My Fleet views" className="fleet-tabs">
          <Link
            href={
              collectionParams.size ? `/fleet?${collectionParams}` : "/fleet"
            }
            aria-current={!rewards ? "page" : undefined}
            className="fleet-tab"
          >
            Collection
          </Link>
          <Link
            href={`/fleet?${rewardParams}`}
            aria-current={rewards ? "page" : undefined}
            className="fleet-tab"
          >
            Rewards
          </Link>
          <FleetBalance />
        </nav>
      ) : null}
      {rewards ? <FleetRewards /> : <FleetPanel />}
    </>
  );
}

export function FleetHeading() {
  const { walletRead } = useProtocolClient();
  const hasCraft =
    walletRead.status === "loaded" &&
    (walletRead.snapshot.collectibles.transient.length > 0 ||
      walletRead.snapshot.collectibles.permanent.length > 0 ||
      walletRead.snapshot.collectibles.pendingDiscovery.count > 0);
  return (
    <PageHeading
      className="fleet-page-heading flex-row flex-wrap items-center justify-between"
      title={applicationCopy.fleet.title}
      actions={
        hasCraft ? (
          <ButtonLink href="/exchange" variant="outline">
            Buy FUEL
          </ButtonLink>
        ) : undefined
      }
    />
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

function FleetBalance() {
  const { walletRead } = useProtocolClient();
  if (walletRead.status !== "loaded") return null;
  return (
    <span
      className="fleet-balance"
      aria-label={
        walletRead.stale ? "Last verified FUEL balance" : "FUEL balance"
      }
    >
      <Amount
        value={walletRead.snapshot.liquidToken.rawWei}
        unit={applicationCopy.exchange.token}
      />
      {walletRead.stale ? <span> · updating</span> : null}
    </span>
  );
}
