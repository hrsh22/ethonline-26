import type { Metadata } from "next";

import { FaucetPanel } from "@/components/faucet/faucet-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.faucet.title,
  description: applicationCopy.faucet.introduction,
} satisfies Metadata;

export default function FaucetPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.faucet.eyebrow}
        lede={applicationCopy.faucet.lede}
        title={applicationCopy.faucet.title}
      />
      <FaucetPanel />
    </PageFrame>
  );
}
