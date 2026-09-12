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
const storedReference = (raw: string | null) =>
  raw !== null && /^\d{1,78}$/.test(raw) ? raw : undefined;
const completedDiscovery = (
  wallet: ReturnType<typeof useProtocolClient>["walletRead"],
) =>
  wallet.status === "loaded" &&
  !wallet.stale &&
  wallet.snapshot.collectibles.pendingDiscovery.count === 0;

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
  const wallet = protocol.walletRead;
  const pending =
    wallet.status === "loaded"
      ? wallet.snapshot.collectibles.pendingDiscovery
      : undefined;
  // A public route deliberately drops wallet reads. Retire the saved work
  // when a fresh wallet read proves completion, before that route transition.
  const completed = completedDiscovery(wallet);
  const batch = pending?.batch;
  const requestId = batch?.vrfRequestId.toString();
  useEffect(() => {
    if (key !== undefined && completed) {
      try {
        if (localStorage.getItem(key) === null) return;
        localStorage.removeItem(key);
        window.dispatchEvent(new Event(changed));
      } catch {
        /* A fresh zero still suppresses the reference in this render. */
      }
      return;
    }
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
  }, [completed, key, requestId]);
  if (completed) return undefined;
  return requestId ?? storedReference(raw);
}
