import type { Metadata } from "next";

import { FleetViews } from "@/components/fleet/fleet-views";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.fleet.title,
  description: applicationCopy.fleet.introduction,
} satisfies Metadata;

export default function FleetPage() {
  return (
    <PageFrame>
      <PageHeading
        className="flex-row flex-wrap items-center justify-between"
        title={applicationCopy.fleet.title}
        actions={
          <ButtonLink href="/exchange" variant="outline">
            Trade
          </ButtonLink>
        }
      />
      <FleetViews />
    </PageFrame>
  );
}
