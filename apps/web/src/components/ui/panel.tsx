import { cn } from "@/lib/utils";

/** A bordered container with an optional heading and footer. */
export function Panel({
  children,
  className,
  bodyClassName,
  footer,
  meta,
  title,
  titleId,
  titleLevel = 2,
  tone = "default",
}: {
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
  readonly bodyClassName?: string | undefined;
  readonly footer?: React.ReactNode;
  readonly meta?: React.ReactNode;
  readonly title?: string | undefined;
  readonly titleId?: string | undefined;
  /**
   * Explicit, because a panel's correct level depends on where it sits: 2
   * directly under a page heading, 3 inside a section.
   */
  readonly titleLevel?: 2 | 3;
  /** `live` marks a panel holding an owned or in-flight state with the signal hairline. */
  readonly tone?: "default" | "live";
}) {
  const Title = titleLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-surface)] border bg-surface-1",
        tone === "live" ? "border-[var(--accent-border)]" : "border-line",
        className,
      )}
      data-panel
    >
      {title === undefined && meta === undefined ? null : (
        <div className="flex min-h-12 items-center justify-between gap-4 px-5 pt-4 pb-1">
          {title === undefined ? (
            <span />
          ) : (
            <Title
              className="font-heading text-title-sm font-semibold text-ink"
              id={titleId}
            >
              {title}
            </Title>
          )}
          {meta === undefined ? null : (
            <div className="flex min-w-0 flex-none items-center gap-3 text-caption text-ink-soft">
              {meta}
            </div>
          )}
        </div>
      )}
      <div className={cn("flex-1 p-5", bodyClassName)}>{children}</div>
      {footer === undefined ? null : (
        <div className="border-t border-line px-4 py-3">{footer}</div>
      )}
    </div>
  );
}

/** A recessed input group or block of facts inside a panel. */
export function Well({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
