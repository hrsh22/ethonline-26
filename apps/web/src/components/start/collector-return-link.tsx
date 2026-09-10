"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { collectorReturnDestination } from "@/lib/navigation";

function ValidatedReturnLink({
  fallbackToTrade,
  primary,
}: {
  readonly fallbackToTrade: boolean;
  readonly primary: boolean;
}) {
  const requested = collectorReturnDestination(
    useSearchParams()?.get("returnTo"),
  );
  const destination =
    requested ??
    (fallbackToTrade
      ? ({ href: "/exchange", label: "Trade" } as const)
      : undefined);
  if (destination === undefined) return null;
  return (
    <ButtonLink
      href={destination.href}
      size={primary ? undefined : "sm"}
      variant={primary ? undefined : "outline"}
    >
      {requested === undefined
        ? "Buy $FUEL on Trade"
        : `Return to ${destination.label}`}
    </ButtonLink>
  );
}

export function CollectorReturnLink({
  fallbackToTrade = false,
  primary = false,
}: {
  readonly fallbackToTrade?: boolean;
  readonly primary?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <ValidatedReturnLink
        fallbackToTrade={fallbackToTrade}
        primary={primary}
      />
    </Suspense>
  );
}
