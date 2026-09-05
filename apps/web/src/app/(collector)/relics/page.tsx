import type { Metadata } from "next";

import { RelicsPanel } from "@/components/fleet/relics-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.relics.title,
  description: applicationCopy.relics.introduction,
} satisfies Metadata;

export default function RelicsPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.relics.eyebrow}
        lede={applicationCopy.relics.introduction}
        title={applicationCopy.relics.title}
      />
      <RelicsPanel />
    </PageFrame>
  );
}
