import { PublicGallery } from "@/components/home/public-gallery";
import {
  FeeRoutingPanel,
  RewardTracksPanel,
  SpecimenPanel,
} from "@/components/home/home-boards";
import { ProtocolSummary } from "@/components/home/protocol-summary";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { applicationCopy } from "@/lib/identity";

/* The home page is a board, not a brochure: a short statement, the specimen,
 * the census, and the two facts that make the product what it is — where the
 * fee goes and which stocks it buys. */
export default function Home() {
  return (
    <PageFrame>
      <header className="grid gap-4 border-b border-line py-6 laptop:grid-cols-12 laptop:items-stretch">
        <div className="flex min-w-0 flex-col justify-center laptop:col-span-7">
          <p className="font-mono text-label font-semibold tracking-[0.14em] text-signal uppercase">
            {applicationCopy.home.eyebrow}
          </p>
          <h1 className="mt-3 max-w-[18ch] font-mono text-hero font-semibold text-balance [overflow-wrap:anywhere]">
            {applicationCopy.home.title}
          </h1>
          <p className="mt-4 max-w-[56ch] text-body text-ink-soft">
            {applicationCopy.home.introduction}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <ButtonLink href="/start" size="lg">
              {applicationCopy.home.primaryAction}
            </ButtonLink>
            <a
              href="#explore"
              className="flex min-h-11 items-center px-3 text-[var(--accent-text)] underline underline-offset-4"
            >
              Explore the collection
            </a>
            <ButtonLink href="/exchange" size="lg" variant="outline">
              {applicationCopy.home.secondaryAction}
            </ButtonLink>
          </div>
        </div>
        <div className="min-w-0 laptop:col-span-5">
          <SpecimenPanel identityId={1204} />
        </div>
      </header>

      <PublicGallery />
      <ProtocolSummary />

      <div className="mt-3 grid gap-3 laptop:grid-cols-2">
        <FeeRoutingPanel />
        <RewardTracksPanel />
      </div>

      <Section
        headingId="how-it-works-heading"
        title={applicationCopy.home.stepsTitle}
      >
        <ol className="grid gap-3 tablet:grid-cols-3">
          {applicationCopy.home.steps.map((step, index) => (
            <li className="min-w-0" key={step.title}>
              <Panel
                meta={<span>{String(index + 1).padStart(2, "0")}</span>}
                title={step.title}
                titleLevel={3}
              >
                <p className="text-body-sm text-ink-soft">{step.body}</p>
              </Panel>
            </li>
          ))}
        </ol>
      </Section>
    </PageFrame>
  );
}
