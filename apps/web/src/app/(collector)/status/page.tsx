import type { Metadata } from "next";

import { StatusPanel } from "@/components/status/status-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.publicStatus.title,
  description: applicationCopy.publicStatus.introduction,
} satisfies Metadata;

export default function StatusPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.publicStatus.eyebrow}
        lede={applicationCopy.publicStatus.introduction}
        title={applicationCopy.publicStatus.title}
      />
      <StatusPanel />
    </PageFrame>
  );
}
