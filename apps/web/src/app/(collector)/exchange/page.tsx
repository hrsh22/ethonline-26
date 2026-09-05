import type { Metadata } from "next";

import { ExchangePanel } from "@/components/trade/exchange-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.exchange.title,
  description: applicationCopy.exchange.introduction,
} satisfies Metadata;

export default function ExchangePage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.exchange.eyebrow}
        lede={applicationCopy.exchange.lede}
        title={applicationCopy.exchange.title}
      />
      <ExchangePanel />
    </PageFrame>
  );
}
