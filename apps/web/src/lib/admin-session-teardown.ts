"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { logoutAdminSession } from "@/lib/admin-auth-client";
import {
  ADMIN_SESSION_ENDED_EVENT,
  ADMIN_SESSION_INVALIDATED_EVENT,
  ADMIN_SESSION_STARTED_EVENT,
  ADMIN_SESSION_STORAGE_KEY,
  forgetAdminSessionPresence,
  markAdminSessionPresent,
} from "@/lib/admin-protected-fetch";

/**
 * Explicit admin access states shared by the root lifetime tracker and the
 * protected navigation boundary. `closing` covers the window between an
 * originating end event and its single server logout; `ended` is terminal
 * until a new session is established.
 */
export type AdminSessionAccessState =
  "unknown" | "restoring" | "active" | "closing" | "ended";

/** How a teardown was initiated, which decides what it is allowed to emit. */
export type AdminSessionEndOrigin =
  /** This tab ended the session: broadcast, announce, and revoke on the server. */
  | "originating"
  /** Another tab or this tab's peer controller already ended it: local only. */
  | "responding";

interface CloseOptions {
  /** Defaults to `"originating"`. */
  readonly origin?: AdminSessionEndOrigin;
  /** Suppress the cross-tab ping when the caller already sent one. */
  readonly broadcast?: boolean;
}

/**
 * Signals other tabs that admin access ended. Writing then removing the key
 * keeps the ping observable without leaving session evidence in storage.
 */
export const broadcastAdminSessionEnd = (): void => {
  try {
    window.localStorage.setItem(
      ADMIN_SESSION_STORAGE_KEY,
      `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
    );
    window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Local teardown stays authoritative when browser storage is unavailable.
  }
};

/** Announces that a new admin session is established in this tab. */
export const publishAdminSessionStarted = (): void => {
  /* Before the event, so a listener that revalidates immediately already sees
     the marker it gates on. */
  markAdminSessionPresent();
  window.dispatchEvent(new Event(ADMIN_SESSION_STARTED_EVENT));
};

const isSessionEndPing = (event: StorageEvent): boolean =>
  event.key === ADMIN_SESSION_STORAGE_KEY && event.newValue !== null;

export interface AdminSessionTeardown {
  /** Current explicit access state. */
  readonly accessState: () => AdminSessionAccessState;
  /** Monotonic counter that invalidates in-flight session reads. */
  readonly generation: () => number;
  /** Records a non-terminal state. Ignored once closing or ended. */
  readonly observe: (state: "unknown" | "restoring" | "active") => void;
  /**
   * Purges local admin state and moves to `ended`. Idempotent: repeated calls
   * neither re-broadcast nor re-announce.
   */
  readonly closeLocalAccess: (options?: CloseOptions) => void;
  /**
   * Ends the session locally and revokes it on the server exactly once per
   * originating end event. Concurrent callers share the same promise.
   */
  readonly endSession: (
    csrfToken: string,
    options?: CloseOptions,
  ) => Promise<void>;
  /** Runs `onExpired` when the session expires. Replaces any pending timer. */
  readonly scheduleExpiry: (expiresAt: string, onExpired: () => void) => void;
  readonly clearExpiry: () => void;
  /** Invalidates in-flight session reads without changing access state. */
  readonly invalidateReads: () => void;
  /** Reopens access after a new session is established. */
  readonly reopen: () => void;
}

/**
 * Owns the security-sensitive half of admin teardown that both the root
 * lifecycle and the protected boundary need: access state, query cancellation
 * and cache purge, cross-tab broadcast, single-logout coordination, and the
 * expiry timer. Consumers layer their own concerns (lifetime revalidation,
 * navigation) on top without duplicating any of this.
 */
export const useAdminSessionTeardown = (
  onLocalTeardown?: () => void,
): AdminSessionTeardown => {
  const queryClient = useQueryClient();
  const stateRef = useRef<AdminSessionAccessState>("unknown");
  const generationRef = useRef(0);
  const expiryTimerRef = useRef<number | undefined>(undefined);
  const logoutRef = useRef<Promise<void> | undefined>(undefined);
  const teardownRef = useRef(onLocalTeardown);

  useEffect(() => {
    teardownRef.current = onLocalTeardown;
  });

  const clearExpiry = useCallback(() => {
    if (expiryTimerRef.current === undefined) return;
    window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = undefined;
  }, []);

  const closeLocalAccess = useCallback(
    (options: CloseOptions = {}) => {
      const origin = options.origin ?? "originating";
      if (stateRef.current === "ended") return;
      stateRef.current = "ended";
      generationRef.current += 1;
      /* Whatever ended it -- this tab, a peer, or expiry -- there is no longer
         a session here to revalidate. */
      forgetAdminSessionPresence();
      clearExpiry();
      teardownRef.current?.();
      void queryClient.cancelQueries();
      queryClient.clear();
      if (origin !== "originating") return;
      if (options.broadcast !== false) broadcastAdminSessionEnd();
      window.dispatchEvent(new Event(ADMIN_SESSION_ENDED_EVENT));
    },
    [clearExpiry, queryClient],
  );

  const endSession = useCallback(
    (csrfToken: string, options: CloseOptions = {}): Promise<void> => {
      if (logoutRef.current !== undefined) return logoutRef.current;
      stateRef.current = "closing";
      closeLocalAccess(options);
      const revoking = logoutAdminSession(csrfToken)
        .catch(() => {
          // The same-origin route clears the host cookie even when upstream
          // revocation is unavailable. Access stays closed for later checks.
        })
        .finally(() => {
          if (logoutRef.current === revoking) logoutRef.current = undefined;
        });
      logoutRef.current = revoking;
      return revoking;
    },
    [closeLocalAccess],
  );

  const scheduleExpiry = useCallback(
    (expiresAt: string, onExpired: () => void) => {
      clearExpiry();
      const remaining = Date.parse(expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        onExpired();
        return;
      }
      expiryTimerRef.current = window.setTimeout(
        onExpired,
        Math.min(remaining, 2_147_483_647),
      );
    },
    [clearExpiry],
  );

  const observe = useCallback((state: "unknown" | "restoring" | "active") => {
    if (stateRef.current === "closing" || stateRef.current === "ended") return;
    stateRef.current = state;
  }, []);

  const invalidateReads = useCallback(() => {
    generationRef.current += 1;
  }, []);

  const reopen = useCallback(() => {
    stateRef.current = "unknown";
    generationRef.current += 1;
  }, []);

  const accessState = useCallback(() => stateRef.current, []);
  const generation = useCallback(() => generationRef.current, []);

  useEffect(() => clearExpiry, [clearExpiry]);

  // A stable controller identity keeps consumer callbacks and effects from
  // re-running on every render, which would re-issue session reads.
  return useMemo(
    () => ({
      accessState,
      generation,
      observe,
      closeLocalAccess,
      endSession,
      scheduleExpiry,
      clearExpiry,
      invalidateReads,
      reopen,
    }),
    [
      accessState,
      clearExpiry,
      closeLocalAccess,
      endSession,
      generation,
      invalidateReads,
      observe,
      reopen,
      scheduleExpiry,
    ],
  );
};

export interface AdminSessionSignalHandlers {
  /** Another tab ended the session. Teardown here must stay local. */
  readonly onExternalEnd?: () => void;
  /** A peer controller in this tab announced the end. Local teardown only. */
  readonly onEnded?: () => void;
  /** A protected request observed 401/403. */
  readonly onInvalidated?: () => void;
  /** A new session was established. */
  readonly onStarted?: () => void;
}

/**
 * Wires the shared session-end signal set. Both consumers subscribe through
 * this seam so cross-tab, in-tab, invalidation, and establishment handling
 * cannot drift apart.
 */
export const useAdminSessionSignals = (
  handlers: AdminSessionSignalHandlers,
): void => {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (isSessionEndPing(event)) handlersRef.current.onExternalEnd?.();
    };
    const onEnded = () => handlersRef.current.onEnded?.();
    const onInvalidated = () => handlersRef.current.onInvalidated?.();
    const onStarted = () => handlersRef.current.onStarted?.();
    window.addEventListener("storage", onStorage);
    window.addEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    window.addEventListener(ADMIN_SESSION_INVALIDATED_EVENT, onInvalidated);
    window.addEventListener(ADMIN_SESSION_STARTED_EVENT, onStarted);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
      window.removeEventListener(
        ADMIN_SESSION_INVALIDATED_EVENT,
        onInvalidated,
      );
      window.removeEventListener(ADMIN_SESSION_STARTED_EVENT, onStarted);
    };
  }, []);
};

export interface AdminSessionPresenceHandlers {
  readonly onRecheck: () => void;
  /** Fired for a BFCache restore so the consumer can veil protected UI. */
  readonly onRestoredFromCache?: () => void;
}

/**
 * Shared focus/visibility/BFCache revalidation triggers.
 */
export const useAdminSessionPresence = (
  handlers: AdminSessionPresenceHandlers,
): void => {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onFocus = () => handlersRef.current.onRecheck();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible")
        handlersRef.current.onRecheck();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) handlersRef.current.onRestoredFromCache?.();
      handlersRef.current.onRecheck();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
};

/**
 * Runs an access re-check whenever the guarded surface becomes eligible, and
 * again whenever eligibility is regained. Consumers express eligibility with
 * their own wallet/deployment predicates; the recheck itself stays here so
 * both consumers share one activation path.
 */
export const useAdminSessionActivation = (
  eligible: boolean,
  onActivate: () => void,
): void => {
  const activateRef = useRef(onActivate);

  useEffect(() => {
    activateRef.current = onActivate;
  });

  useEffect(() => {
    if (!eligible) return;
    activateRef.current();
  }, [eligible]);
};
