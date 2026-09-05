import type { Metadata } from "next";

import { FleetPanel } from "@/components/fleet/fleet-panel";
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
        eyebrow={applicationCopy.fleet.eyebrow}
        lede={applicationCopy.fleet.introduction}
        title={applicationCopy.fleet.title}
      />
      <FleetPanel />
    </PageFrame>
  );
}
