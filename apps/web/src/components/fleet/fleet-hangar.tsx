"use client";

import {
  FleetCraftCard,
  fleetStateLabel,
  type FleetCraft,
} from "@/components/fleet/fleet-craft-card";
import { FleetCraftArt } from "@/components/fleet/fleet-craft-art";
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
      className="fleet-hangar"
      data-fleet-hangar
    >
      <h2 className="sr-only" id="fleet-hangar-heading">
        Choose a craft to inspect
      </h2>
      <ul aria-label="Choose a craft" className="fleet-selector">
        {craft.map((entry) => {
          const active = entry.identityId === selected.identityId;
          return (
            <li className="fleet-selector-item" key={entry.identityId}>
              <button
                aria-label={identityLabel(entry)}
                aria-pressed={active}
                className={cn(
                  "fleet-selector-button",
                  active ? "is-selected" : undefined,
                )}
                data-craft-id={entry.identityId}
                onClick={() => onSelect(entry.identityId)}
                type="button"
              >
                <FleetCraftArt
                  className="fleet-selector-art"
                  decorative
                  identityId={entry.identityId}
                  permanent={entry.permanent}
                  rewardTrack={entry.rewardTrack}
                />
                <span className="min-w-0">
                  <span className="fleet-selector-number">
                    #{String(entry.identityId).padStart(4, "0")}
                  </span>
                  <span className="fleet-selector-caption">
                    {fleetStateLabel(entry)} · {entry.rewardTrack}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0">
        <FleetCraftCard craft={selected} returnTo={returnTo} />
      </div>
    </section>
  );
}
