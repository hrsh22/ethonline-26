import { StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { applicationCopy } from "@/lib/identity";

type TrackId = 1 | 2 | 3 | 4;

interface TrackQueueRow {
  readonly track: string;
  readonly trackId: TrackId;
  readonly wethFormatted: string | undefined;
  readonly deferred: boolean | undefined;
  readonly status: "unknown" | "paused" | "retryable" | "clear" | "ready";
}

interface TrackOutcomeRow {
  readonly latest:
    | {
        readonly explanation: string;
      }
    | undefined;
}

/* Five columns on a tablet; below that each row stacks and every cell prints
 * its own column label from `data-label`, so the table stays a table for a
 * reader while a phone gets a readable card. */
const rowGrid =
  "grid gap-x-4 gap-y-1 px-4 py-3 tablet:grid-cols-[minmax(5rem,0.8fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(0,2fr)_minmax(6rem,1fr)] tablet:items-baseline";

const cell =
  "min-w-0 font-mono text-body-sm text-ink tabular-nums [overflow-wrap:anywhere] before:mr-2 before:font-mono before:text-label before:tracking-[0.1em] before:text-ink-faint before:uppercase before:content-[attr(data-label)] tablet:before:hidden";

const columnHeader =
  "font-mono text-label font-medium tracking-[0.1em] text-ink-faint uppercase";

const deferredBudget = (track: TrackQueueRow): string => {
  if (track.deferred === undefined) return applicationCopy.common.notObserved;
  if (!track.deferred) return "0 WETH";
  return `${track.wethFormatted ?? applicationCopy.common.unavailable} WETH`;
};

function QueueRow({
  outcome,
  track,
}: {
  readonly outcome: TrackOutcomeRow | undefined;
  readonly track: TrackQueueRow;
}) {
  return (
    <div className={`${rowGrid} border-t border-line`} role="row">
      <strong
        className="min-w-0 font-mono text-body-sm"
        data-label={applicationCopy.craft.track}
        role="cell"
      >
        <Badge>{track.track}</Badge>
      </strong>
      <span
        className={cell}
        data-label={applicationCopy.operations.queue}
        role="cell"
      >
        {track.wethFormatted === undefined
          ? applicationCopy.common.unavailable
          : `${track.wethFormatted} WETH`}
      </span>
      <span
        className={cell}
        data-label={applicationCopy.operations.deferred}
        role="cell"
      >
        {deferredBudget(track)}
      </span>
      <span
        className={`${cell} text-ink-soft`}
        data-label={applicationCopy.operations.outcome}
        role="cell"
      >
        {outcome?.latest?.explanation ?? applicationCopy.common.notObserved}
      </span>
      <span
        className={`${cell} tracking-[0.08em] uppercase`}
        data-label={applicationCopy.operations.retry}
        role="cell"
      >
        {applicationCopy.status.queue[track.status]}
      </span>
    </div>
  );
}

export function TrackQueueLedger({
  ariaLabel,
  emptyMessage,
  trackOutcomes,
  trackQueues,
}: {
  readonly ariaLabel: string;
  readonly emptyMessage: string;
  readonly trackOutcomes:
    Readonly<Record<TrackId, TrackOutcomeRow>> | undefined;
  readonly trackQueues: readonly TrackQueueRow[];
}) {
  return (
    <>
      <div
        aria-label={ariaLabel}
        className="min-w-0 overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface-1"
        role="table"
      >
        <div
          className={`${rowGrid} hidden bg-surface-2 py-2 tablet:grid`}
          role="row"
        >
          <span className={columnHeader} role="columnheader">
            {applicationCopy.craft.track}
          </span>
          <span className={columnHeader} role="columnheader">
            {applicationCopy.operations.queue}
          </span>
          <span className={columnHeader} role="columnheader">
            {applicationCopy.operations.deferred}
          </span>
          <span className={columnHeader} role="columnheader">
            {applicationCopy.operations.outcome}
          </span>
          <span className={columnHeader} role="columnheader">
            {applicationCopy.operations.retry}
          </span>
        </div>
        {trackQueues.map((track) => (
          <QueueRow
            key={track.trackId}
            outcome={trackOutcomes?.[track.trackId]}
            track={track}
          />
        ))}
      </div>
      {trackQueues.length === 0 ? (
        <StateFeedback
          className="mt-3"
          description={emptyMessage}
          title="No queue activity"
          tone="empty"
        />
      ) : null}
    </>
  );
}
