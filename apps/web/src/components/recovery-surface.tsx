import { PageFrame, PageHeading } from "@/components/ui/page";

/**
 * The one recovery pattern: a missing route and a crashed route say what
 * happened in a heading strip and then offer the same two ways out. It is a
 * plain frame rather than a panel because there is no board to draw; the
 * actions are the content.
 */
export function RecoverySurface({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions: React.ReactNode;
  readonly description: string;
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <PageFrame>
      <PageHeading eyebrow={eyebrow} lede={description} title={title} />
      <div className="mt-5 flex flex-wrap items-center gap-2 [&>a]:h-auto [&>a]:max-w-full [&>a]:py-3 [&>a]:whitespace-normal">
        {actions}
      </div>
    </PageFrame>
  );
}
