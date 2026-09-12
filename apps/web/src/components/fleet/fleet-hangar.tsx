"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

import {
  FleetCraftCard,
  fleetStateLabel,
  type FleetCraft,
} from "@/components/fleet/fleet-craft-card";
import { FleetCraftArt } from "@/components/fleet/fleet-craft-art";
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
  const [view, setView] = useState<"grid" | "hangar">();
  const grid = (view ?? (craft.length > 6 ? "grid" : "hangar")) === "grid";
  const selected =
    craft.find((entry) => entry.identityId === Number(selectedId)) ?? craft[0];

  if (selected === undefined) return null;

  return (
    <>
      {craft.length > 1 ? (
        <div
          role="group"
          aria-label="Collection layout"
          className="mt-4 flex gap-1"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={!grid}
            onClick={() => setView("hangar")}
          >
            Hangar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={grid}
            onClick={() => setView("grid")}
          >
            Grid
          </Button>
        </div>
      ) : null}
      {grid ? (
        <section aria-label="Collection grid" className="fleet-grid">
          {craft.map((entry) => (
            <FleetCraftCard
              key={entry.identityId}
              craft={entry}
              returnTo={returnTo}
            />
          ))}
        </section>
      ) : (
        <section
          aria-labelledby="fleet-hangar-heading"
          className={
            craft.length === 1
              ? "fleet-hangar fleet-hangar-single"
              : "fleet-hangar"
          }
          data-fleet-hangar
        >
          <h2 className="sr-only" id="fleet-hangar-heading">
            Choose a craft to inspect
          </h2>
          {craft.length > 1 ? (
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
                      {entry.identityId > 4440 ? (
                        <CraftArt
                          className="fleet-selector-art"
                          decorative
                          identityId={entry.identityId}
                          kind="relic"
                          lit={entry.permanent}
                        />
                      ) : (
                        <FleetCraftArt
                          className="fleet-selector-art"
                          decorative
                          identityId={entry.identityId}
                          permanent={entry.permanent}
                          rewardTrack={entry.rewardTrack}
                        />
                      )}
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
          ) : null}
          <div className="min-w-0">
            <FleetCraftCard craft={selected} returnTo={returnTo} />
          </div>
        </section>
      )}
    </>
  );
}
