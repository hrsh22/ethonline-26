import type { Metadata } from "next";

import { MarketDashboard } from "@/components/market/market-dashboard";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.market.title,
  description: applicationCopy.market.introduction,
} satisfies Metadata;

export default function MarketPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.market.eyebrow}
        lede={applicationCopy.market.lede}
        title={applicationCopy.market.title}
      />
      <MarketDashboard />
    </PageFrame>
  );
}
