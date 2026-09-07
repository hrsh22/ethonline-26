"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Age an observation locally; expiry never starts a network request. */
export const useObservationExpiry = (
  expiresAt: number | undefined,
): boolean => {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (expiresAt === undefined) return () => undefined;
      const remaining = expiresAt - Date.now() + 1;
      if (remaining <= 0) return () => undefined;
      const timer = setTimeout(notify, remaining);
      return () => clearTimeout(timer);
    },
    [expiresAt],
  );
  return useSyncExternalStore(
    subscribe,
    () => expiresAt === undefined || Date.now() > expiresAt,
    () => false,
  );
};
