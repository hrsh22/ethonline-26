import type { Metadata } from "next";

import { OnboardingPanel } from "@/components/start/onboarding-panel";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";

export const metadata = {
  title: applicationCopy.onboarding.title,
  description: applicationCopy.onboarding.introduction,
} satisfies Metadata;

export default function StartPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow={applicationCopy.onboarding.eyebrow}
        lede={applicationCopy.onboarding.lede}
        title={applicationCopy.onboarding.title}
      />
      <OnboardingPanel />
    </PageFrame>
  );
}
