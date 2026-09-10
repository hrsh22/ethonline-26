import type { Metadata } from "next";

import { FleetHeading, FleetViews } from "@/components/fleet/fleet-views";
import { PageFrame } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.fleet.title,
  description: applicationCopy.fleet.introduction,
} satisfies Metadata;

export default function FleetPage() {
  return (
    <PageFrame className="fleet-page">
      <FleetHeading />
      <FleetViews />
    </PageFrame>
  );
}
