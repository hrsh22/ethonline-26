import Image from "next/image";

import { ButtonLink } from "@/components/ui/button";
import { PageFrame } from "@/components/ui/page";
import { applicationCopy, identity } from "@/lib/identity";

export default function Home() {
  return (
    <PageFrame>
      <section className="grid items-center gap-8 py-10 laptop:min-h-[38rem] laptop:grid-cols-2 laptop:gap-12">
        <div className="min-w-0 space-y-6">
          <p className="text-body text-ink-soft">
            {identity.brand} · 4,444 identities
          </p>
          <h1 className="max-w-[14ch] font-display text-hero font-semibold text-balance">
            {applicationCopy.home.title}
          </h1>
          <p className="max-w-[46ch] text-lede text-ink-soft">
            {applicationCopy.home.introduction}
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/exchange" size="lg">
              {applicationCopy.home.secondaryAction}
            </ButtonLink>
            <ButtonLink href="/explore" size="lg" variant="ghost">
              Explore the collection
            </ButtonLink>
          </div>
        </div>
        <figure className="min-w-0">
          <Image
            alt={applicationCopy.home.heroAlt}
            src={applicationCopy.home.heroAsset}
            width={1024}
            height={1024}
            sizes="(min-width: 1024px) 50vw, 100vw"
            preload
            className="aspect-square w-full rounded-[var(--radius-surface)] object-cover"
          />
          <figcaption className="mt-3 text-caption text-ink-soft">
            Editorial artwork · browse identities in Explore
          </figcaption>
        </figure>
      </section>
    </PageFrame>
  );
}
