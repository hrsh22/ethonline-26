import { cn } from "@/lib/utils";

/**
 * A titled region of a route: a caps heading on a rule, then its boards.
 * Sections are separated by rule and space, not by becoming boxes, so a page
 * reads as one instrument rather than a stack of tiles.
 */
export function Section({
  children,
  className,
  description,
  headingId,
  level = 2,
  meta,
  title,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly description?: string | undefined;
  readonly headingId?: string;
  /** Kept explicit so a route can never skip a heading level. */
  readonly level?: 2 | 3;
  readonly meta?: React.ReactNode;
  readonly title: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={headingId}
      className={cn("mt-8 first:mt-5", className)}
    >
      <div className="flex flex-col gap-1 border-b border-line-strong pb-2 tablet:flex-row tablet:items-baseline tablet:justify-between tablet:gap-6">
        <div className="min-w-0">
          <Heading
            className="font-heading text-title font-semibold text-ink"
            id={headingId}
          >
            {title}
          </Heading>
          {description === undefined ? null : (
            <p className="mt-1 max-w-[64ch] text-body-sm text-ink-soft">
              {description}
            </p>
          )}
        </div>
        {meta === undefined ? null : (
          <div className="flex flex-none items-baseline gap-4 text-caption text-ink-faint">
            {meta}
          </div>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
