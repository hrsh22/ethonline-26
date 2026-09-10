import type { Metadata } from "next";

import { AuctionPanel } from "@/components/auction/auction-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";

export const metadata = {
  title: "Auction",
  description:
    "Bid for the launch allocation and recover each settled delivery.",
} satisfies Metadata;

export default function AuctionPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow="Launch allocation"
        lede="Set the most you will pay. The final clearing price applies to the tokens your bid receives."
        title="Auction"
      />
      <AuctionPanel />
    </PageFrame>
  );
}
