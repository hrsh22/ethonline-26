"use client";

import {
  FleetCraftCard,
  type FleetCraft,
  trackIndexFor,
} from "@/components/fleet/fleet-craft-card";
import { CraftArt } from "@/components/ui/craft-art";
import { cn } from "@/lib/utils";

const identityLabel = (craft: FleetCraft) =>
  `${craft.stateLabel} #${craft.identityId}, ${craft.rewardTrack}, ${craft.rarityTier}`;

/** One selected holding with a compact selector made from actual wallet data. */
export function FleetHangar({
  craft,
  returnTo,
  selectedId,
  onSelect,
}: {
  readonly craft: readonly FleetCraft[];
  readonly returnTo: string;
  readonly selectedId: string;
  readonly onSelect: (identityId: number) => void;
}) {
  const selected =
    craft.find((entry) => entry.identityId === Number(selectedId)) ?? craft[0];

  if (selected === undefined) return null;

  return (
    <section
      aria-labelledby="fleet-hangar-heading"
      className="grid min-w-0 gap-3 laptop:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)]"
      data-fleet-hangar
    >
      <h2 className="sr-only" id="fleet-hangar-heading">
        Choose a craft to inspect
      </h2>
      <ul
        aria-label="Choose a craft"
        className="flex min-w-0 snap-x gap-2 overflow-x-auto pb-1 laptop:max-h-[42rem] laptop:flex-col laptop:overflow-y-auto laptop:overflow-x-hidden laptop:pr-1"
      >
        {craft.map((entry) => {
          const active = entry.identityId === selected.identityId;
          return (
            <li
              className="min-w-36 snap-start laptop:min-w-0"
              key={entry.identityId}
            >
              <button
                aria-label={identityLabel(entry)}
                aria-pressed={active}
                className={cn(
                  "grid min-h-24 w-full min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-[var(--radius-control)] border bg-canvas p-2 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:border-line-strong focus-visible:ring-3 focus-visible:ring-ring motion-reduce:transition-none laptop:grid-cols-1 laptop:justify-items-center laptop:text-center",
                  active
                    ? "border-[var(--accent-border)] bg-surface-2 text-ink"
                    : "border-line text-ink-soft",
                )}
                data-craft-id={entry.identityId}
                onClick={() => onSelect(entry.identityId)}
                type="button"
              >
                <CraftArt
                  className="size-14"
                  decorative
                  identityId={entry.identityId}
                  kind={
                    entry.identityId > 4440
                      ? "relic"
                      : entry.permanent
                        ? "permanent"
                        : "transient"
                  }
                  lit={entry.permanent}
                  track={trackIndexFor(entry.rewardTrack)}
                />
                <span className="min-w-0">
                  <span className="block font-mono text-body-sm font-semibold tabular-nums text-ink">
                    #{String(entry.identityId).padStart(4, "0")}
                  </span>
                  <span className="block truncate text-caption">
                    {entry.stateLabel}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0 laptop:sticky laptop:top-24 laptop:self-start">
        <FleetCraftCard craft={selected} returnTo={returnTo} />
      </div>
    </section>
  );
}
