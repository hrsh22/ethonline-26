import { StateFeedback } from "@/components/state-feedback";
import { cn } from "@/lib/utils";

/**
 * The plate a chart is drawn on, and the states where drawing one is a lie.
 *
 * The audited market surface rendered full-height candlestick and line charts
 * for two observations: a 300px plot containing two hairlines, and a "growth"
 * chart that was a single straight segment between two dots. Both read as a
 * broken chart rather than as a short history, and neither said which it was.
 *
 * So the decision lives here, once:
 *
 * - No observations: no plot. A chart of nothing is not a chart.
 * - Fewer than it takes to show a shape: the values still render, because they
 *   are real and hiding them would be worse, but the reason is stated above
 *   the plot — a reader must not mistake a two-point line for a trend.
 * - Enough: the full plot.
 */
export function ChartFrame({
  action,
  caption,
  children,
  className,
  emptyDescription,
  emptyTitle,
  label,
  minimumForShape = 3,
  observations,
  sparseDescription,
  sparseTitle,
}: {
  readonly action?: React.ReactNode;
  /** What the figure shows, below the plot. */
  readonly caption: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  /** Names the figure for assistive technology. */
  readonly label: string;
  readonly minimumForShape?: number;
  readonly observations: number;
  /** Why a short history cannot be read as a trend. */
  readonly sparseDescription: string;
  /**
   * Names the short-history state. Separate from `emptyTitle` on purpose: the
   * candle plate reused "No indexed swaps yet" for both, so a range holding
   * two plotted swaps announced that it held none.
   */
  readonly sparseTitle: string;
}) {
  if (observations === 0) {
    return (
      <StateFeedback
        action={action}
        className={className}
        description={emptyDescription}
        title={emptyTitle}
        tone="empty"
      />
    );
  }

  const sparse = observations < minimumForShape;

  return (
    <figure aria-label={label} className={cn("m-0", className)}>
      {sparse ? (
        <div className="mb-4">
          <StateFeedback
            compact
            description={sparseDescription}
            title={sparseTitle}
            tone="partial"
          />
        </div>
      ) : null}
      {/* The plate does not constrain the plot's height. A chart sizes itself
          from its own viewBox, so a clamp here crops observations rather than
          scaling them — and a notice that claims a short history is shown
          while the plate hides it is a worse defect than the one being fixed.
          The notice carries the message; the plot keeps its own size. */}
      <div
        className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-[var(--chart-surface)]"
        data-sparse={sparse || undefined}
      >
        {children}
      </div>
      <figcaption className="mt-3 text-body-sm text-ink-soft">
        {caption}
      </figcaption>
    </figure>
  );
}
