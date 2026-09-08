"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";

function ReturnLink() {
  const destination = useSearchParams()?.get("returnTo");
  if (destination !== "/start" && destination !== "/fleet") return null;
  return (
    <ButtonLink href="/fleet" size="sm" variant="outline">
      Return to Fleet
    </ButtonLink>
  );
}

export function CollectorReturnLink() {
  return (
    <Suspense fallback={null}>
      <ReturnLink />
    </Suspense>
  );
}
