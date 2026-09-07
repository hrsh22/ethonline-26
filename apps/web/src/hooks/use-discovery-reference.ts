"use client";

import { useEffect, useSyncExternalStore } from "react";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

const changed = "orbit:discovery-reference";
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(changed, notify);
  };
};
const read = (key: string | undefined) => {
  try {
    return key === undefined ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** A reference to observed work, never permission to send or repeat it. */
export function useDiscoveryReference(
  protocol: ReturnType<typeof useProtocolClient>,
) {
  const key =
    protocol.address === undefined
      ? undefined
      : `orbit:discovery-reference:v1:${protocolDeploymentFingerprint}:${protocol.address.toLowerCase()}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const batch =
    protocol.walletRead.status === "loaded"
      ? protocol.walletRead.snapshot.collectibles.pendingDiscovery.batch
      : undefined;
  const requestId = batch?.vrfRequestId.toString();
  useEffect(() => {
    if (
      key === undefined ||
      requestId === undefined ||
      !/^\d{1,78}$/.test(requestId)
    )
      return;
    try {
      if (localStorage.getItem(key) === requestId) return;
      localStorage.setItem(key, requestId);
      window.dispatchEvent(new Event(changed));
    } catch {
      /* Current evidence remains visible if storage is unavailable. */
    }
  }, [key, requestId]);
  return (
    requestId ?? (raw !== null && /^\d{1,78}$/.test(raw) ? raw : undefined)
  );
}
