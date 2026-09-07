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
    <div className="flex flex-col items-center gap-3 p-4">
      <CraftArt
        className="h-auto w-40 max-w-full"
        identityId={identityId}
        kind="relic"
        lit={lit}
        label={`Identity ${identityId}, illustrative ${lit ? "Orbiter" : "Grounded"} preview`}
      />
      <Button variant="outline" aria-pressed={lit} onClick={() => setLit(!lit)}>
        {lit ? "Preview Grounded" : "Preview Orbiter"}
      </Button>
      <p className="text-caption text-ink-soft">
        Preview only. No transaction.
      </p>
      {identity.key === "orbit-4444" ? (
        <p className="text-body-sm text-ink-soft">{stories[identityId]}</p>
      ) : null}
      <details className="text-caption text-ink-soft">
        <summary className="min-h-11 cursor-pointer py-3">
          About this artwork
        </summary>
        Web illustration and fictional story. Decorative details carry no reward
        benefits. Wallet artwork uses the sealed metadata.
      </details>
    </div>
  );
}
