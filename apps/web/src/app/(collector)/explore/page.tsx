import type { Metadata } from "next";
import { PublicGallery } from "@/components/home/public-gallery";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame, PageHeading } from "@/components/ui/page";

export const metadata = {
  title: "Explore",
  description: "Browse the collection and inspect each identity.",
} satisfies Metadata;

export default function ExplorePage() {
  return (
    <PageFrame>
      <PageHeading
        title="Explore"
        actions={
          <ButtonLink href="/relics" variant="outline">
            Explore relics
          </ButtonLink>
        }
      />
      <PublicGallery />
    </PageFrame>
  );
}
