import type { Metadata } from "next";

import { RewardsPanel } from "@/components/rewards/rewards-panel";
import { StockBalancesPanel } from "@/components/rewards/stock-balances-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.rewards.title,
  description: applicationCopy.rewards.introduction,
} satisfies Metadata;

export default function RewardsPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.rewards.eyebrow}
        lede={applicationCopy.rewards.introduction}
        title={applicationCopy.rewards.title}
      />
      <StockBalancesPanel />
      <RewardsPanel />
    </PageFrame>
  );
}
