"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CraftArt } from "@/components/ui/craft-art";
import { identity } from "@/lib/identity";

const stories: Record<number, string> = {
  4441: "Station One keeps a berth above the night side. Its paired arrays turn toward first light as arriving craft approach.",
  4442: "Station Two is the crossing point. Four arrays frame a working hub where departing craft make their final checks.",
  4443: "Station Three marks the edge of the traffic lanes. Six arrays welcome craft returning from the long way around.",
  4444: "The Observatory gathers distant light. Below its open aperture, a small dish keeps a narrow connection to home.",
};

export function RelicPreview({ identityId }: { readonly identityId: number }) {
  const [lit, setLit] = useState(false);
  return (
    <div className="flex min-w-0 flex-col items-center gap-3 p-4">
      <CraftArt
        className="h-auto w-64 max-w-full"
        identityId={identityId}
        kind="relic"
        lit={lit}
        label={`Identity ${identityId}, ${lit ? "Orbiter" : "Grounded"}`}
      />
      <div
        className="flex max-w-full flex-wrap justify-center gap-1 rounded-lg border border-line p-1"
        aria-label="Appearance"
      >
        <Button
          size="sm"
          variant={lit ? "ghost" : "secondary"}
          aria-pressed={!lit}
          onClick={() => setLit(false)}
        >
          Grounded
        </Button>
        <Button
          size="sm"
          variant={lit ? "secondary" : "ghost"}
          aria-pressed={lit}
          onClick={() => setLit(true)}
        >
          Orbiter
        </Button>
      </div>
      {identity.key === "orbit-4444" ? (
        <p className="text-body-sm text-ink-soft">{stories[identityId]}</p>
      ) : null}
    </div>
  );
}
