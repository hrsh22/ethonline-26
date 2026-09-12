import Link from "next/link";
import { CraftArt } from "@/components/ui/craft-art";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";

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
        <figure className="relative grid min-w-0 place-items-center overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_center,var(--surface-3),var(--canvas))]">
          <CraftArt
            className="aspect-square w-full max-w-[34rem]"
            identityId={23}
            track={collectionManifestArtifact.entries[22]!.track}
            kind="transient"
          />
          <figcaption className="absolute bottom-5 flex w-full items-center justify-between px-6 text-body-sm text-ink-soft">
            <span>Identity #0023</span>
            <Link
              href="/fleet/23?from=explore"
              className="underline underline-offset-4"
            >
              Meet this identity →
            </Link>
          </figcaption>
        </figure>
      </section>
      <section
        aria-labelledby="collecting-loop"
        className="space-y-8 border-t border-line py-10"
      >
        <h2
          id="collecting-loop"
          className="font-display text-display font-semibold"
        >
          From first Discovery to forever.
        </h2>
        <ol className="grid gap-8 tablet:grid-cols-3">
          <li className="space-y-3">
            <span className="font-mono text-caption text-ink-faint">
              01 · BUY
            </span>
            <h3 className="text-title font-semibold">Start with FUEL</h3>
            <p className="max-w-[38ch] text-body text-ink-soft">
              Each whole FUEL you hold pairs with one Grounded Craft.
            </p>
          </li>
          <li className="space-y-3">
            <span className="font-mono text-caption text-ink-faint">
              02 · DISCOVER
            </span>
            <h3 className="text-title font-semibold">Meet your craft</h3>
            <p className="max-w-[38ch] text-body text-ink-soft">
              A random Discovery reveals its identity, reward track and tier in
              your Fleet.
            </p>
          </li>
          <li className="space-y-3">
            <span className="font-mono text-caption text-ink-faint">
              03 · LAUNCH
            </span>
            <h3 className="text-title font-semibold">Keep a favorite</h3>
            <p className="max-w-[38ch] text-body text-ink-soft">
              Launch burns one FUEL to make that craft a permanent Orbiter. Its
              identity stays the same.
            </p>
          </li>
        </ol>
        <p className="max-w-[74ch] text-body text-ink-soft">
          Trading fees fund the collection’s reward tracks. Rewards attach to
          each craft and can be claimed by its eligible owner.{" "}
          <Link href="/learn#rules" className="underline underline-offset-4">
            See how rewards work →
          </Link>
        </p>
      </section>
    </PageFrame>
  );
}
