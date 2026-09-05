import { cn } from "@/lib/utils";

/**
 * The content column of a route.
 *
 * The shell owns the sidebar and status strip; a route owns only this column.
 * One frame means a heading and the boards under it cannot disagree about
 * where the page begins.
 */
export function PageFrame({
  children,
  className,
  id = "main-content",
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly id?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto w-full max-w-[100rem] min-w-0 px-4 pb-16 tablet:px-6",
        className,
      )}
      id={id}
    >
      {children}
    </main>
  );
}

/**
 * A route's opening line: a caps eyebrow, the title, at most one sentence.
 *
 * Routes used to open with three or four lines of protocol explanation before
 * any control. Here the heading is a strip; the boards below it carry the
 * facts.
 */
export function PageHeading({
  actions,
  eyebrow,
  lede,
  title,
}: {
  readonly actions?: React.ReactNode;
  readonly eyebrow?: string | undefined;
  readonly lede?: string | undefined;
  readonly title: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-line py-5 tablet:flex-row tablet:items-end tablet:justify-between">
      <div className="min-w-0 max-w-[60ch]">
        {eyebrow === undefined ? null : (
          <p className="font-mono text-label font-semibold tracking-[0.14em] text-signal uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1.5 font-mono text-display font-semibold text-balance text-ink">
          {title}
        </h1>
        {lede === undefined ? null : (
          <p className="mt-2 text-body text-ink-soft">{lede}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-none flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
