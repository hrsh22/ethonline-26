"use client";

import { useEffect, useRef } from "react";
import { protocolDeploymentFingerprint } from "@/lib/deployment";

/** A local presentation marker, scoped to one identity and confirmed outcome. */
export function useCompletionReveal({
  owner,
  identityId,
  operationId,
  kind,
  message,
}: {
  readonly owner: string;
  readonly identityId: number;
  readonly operationId: string;
  readonly kind: "delivery" | "launch";
  readonly message: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const announcement = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const key = `orbit:collector-reveal:v1:${protocolDeploymentFingerprint}:${owner.toLowerCase()}:${kind}:${identityId}`;
    try {
      if (localStorage.getItem(key) === operationId) return;
      localStorage.setItem(key, operationId);
    } catch {
      return;
    }
    if (announcement.current !== null)
      announcement.current.textContent = message;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    element.animate?.([{ opacity: 0.5 }, { opacity: 1 }], {
      duration: 400,
      easing: "ease-out",
    });
  }, [identityId, kind, message, operationId, owner]);
  return { ref, announcement };
}
