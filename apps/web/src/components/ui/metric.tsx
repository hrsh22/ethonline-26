import { cn } from "@/lib/utils";

/**
 * A board of measured facts.
 *
 * Cells are equal columns separated by hairlines, labels reserve a shared
 * height so a wrapped label never shifts its neighbour's value, and the value
 * is the largest thing in the cell. A board is where a page states what is
 * true right now, so it comes before any explanation of it.
 */
export function MetricGroup({
  children,
  className,
  columns = 3,
  label,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  /** Desktop column count. Collapses to two, then one, on narrow viewports. */
  readonly columns?: 2 | 3 | 4 | 5 | 6;
  /** Names the group, so a summary strip is reachable as a region. */
  readonly label?: string;
}) {
  return (
    <dl
      aria-label={label}
      className={cn(
        "grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-surface)] border border-line bg-line compact:grid-cols-2",
        {
          2: "laptop:grid-cols-2",
          3: "laptop:grid-cols-3",
          4: "laptop:grid-cols-4",
          5: "laptop:grid-cols-5",
          6: "laptop:grid-cols-6",
        }[columns],
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Metric({
  hint,
  label,
  size = "default",
  tone = "default",
  value,
}: {
  readonly hint?: string | undefined;
  readonly label: string;
  readonly size?: "default" | "large" | undefined;
  /** `live` sets the value in signal orange: a number that is moving. */
  readonly tone?: "default" | "live" | undefined;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 bg-surface-1 px-4 py-3">
      <dt className="flex min-h-8 items-start font-mono text-label font-medium tracking-[0.1em] text-ink-faint uppercase">
        {label}
      </dt>
      {/* A balance of one base unit renders eighteen decimals, which is wider
          than a six-column cell. It wraps rather than overflowing. */}
      <dd
        className={cn(
          "mt-1 font-mono font-medium tabular-nums [overflow-wrap:anywhere]",
          size === "large" ? "text-heading" : "text-title",
          tone === "live" ? "text-signal" : "text-ink",
        )}
      >
        {value}
        {/* The hint belongs inside the description. A <div> may wrap a dt/dd
            group inside a <dl>, but only that group: a sibling <p> makes the
            wrapper invalid. */}
        {hint === undefined ? null : (
          <p className="mt-1.5 max-w-[32ch] font-mono text-caption font-normal text-ink-soft">
            {hint}
          </p>
        )}
      </dd>
    </div>
  );
}
