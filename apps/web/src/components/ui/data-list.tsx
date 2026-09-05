import { cn } from "@/lib/utils";

/**
 * A list of label/value pairs separated by hairlines: a term on the left, a
 * typeset value on the right, aligned down a shared edge so a reader scans the
 * column rather than re-finding each number.
 */
export function DataList({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  /* A container, not a media, query: the same list appears in a full-width
   * panel and inside a 300px card, and only its own width decides whether a
   * term and its value fit on one line. */
  return <dl className={cn("@container w-full", className)}>{children}</dl>;
}

export function DataRow({
  label,
  note,
  tone = "default",
  value,
}: {
  readonly label: string;
  readonly note?: string | undefined;
  readonly tone?: "default" | "live";
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 @min-[20rem]:flex-row @min-[20rem]:items-baseline @min-[20rem]:justify-between @min-[20rem]:gap-6">
      <dt className="font-mono text-body-sm text-ink-soft">{label}</dt>
      <dd
        className={cn(
          "flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-body-sm tabular-nums [overflow-wrap:anywhere] @min-[20rem]:justify-end @min-[20rem]:text-right",
          tone === "live" ? "text-signal" : "text-ink",
        )}
      >
        {value}
        {note === undefined ? null : (
          <span className="text-caption text-ink-faint">{note}</span>
        )}
      </dd>
    </div>
  );
}
