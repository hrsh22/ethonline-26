"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useConnection } from "wagmi";

import { AdminClientError, readAdminSession } from "@/lib/admin-auth-client";
import {
  adminSessionMayExist,
  markAdminSessionPresent,
} from "@/lib/admin-protected-fetch";
import type { AdminSessionDTO } from "@/lib/admin-session-contract";
import {
  useAdminSessionPresence,
  useAdminSessionSignals,
  useAdminSessionTeardown,
} from "@/lib/admin-session-teardown";
import { useWalletRestorationSettled } from "@/providers/wallet-restoration";

type WalletConnection = ReturnType<typeof useConnection>;
type WalletConnectionState = Pick<
  WalletConnection,
  "address" | "chainId" | "status"
>;

const connectionRestoring = (connection: WalletConnectionState): boolean =>
  connection.status === "connecting" || connection.status === "reconnecting";

const sessionMatchesConnection = (
  session: AdminSessionDTO,
  connection: WalletConnectionState,
): boolean =>
  connection.status === "connected" &&
  connection.address !== undefined &&
  connection.chainId === session.chainId &&
  connection.address.toLowerCase() === session.address.toLowerCase();

const isAdminPath = (pathname: string): boolean =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const isProtectedAdminPath = (pathname: string): boolean =>
  pathname !== "/admin/sign-in" && isAdminPath(pathname);

/**
 * Whether a session read could tell this tab anything.
 *
 * The tracker is mounted for the whole application so a wallet change anywhere
 * ends a session, but it used to probe unconditionally: every collector route
 * answered 401 the moment any wallet connected, once per page load and relayed
 * upstream to the API, for visitors with no console access at all. Every admin
 * path still probes, so no console behaviour depends on the marker.
 */
const revalidationWarranted = (tracked: boolean, pathname: string): boolean =>
  tracked || isAdminPath(pathname) || adminSessionMayExist();

const sessionReadEndedAccess = (
  cause: unknown,
  hadSession: boolean,
  pathname: string,
): boolean =>
  cause instanceof AdminClientError &&
  (cause.status === 401 || cause.status === 403) &&
  (hadSession || isProtectedAdminPath(pathname));

/**
 * Tracks admin session lifetime for the whole application. It owns
 * revalidation and wallet/session agreement; every teardown effect is
 * delegated to the shared seam so it cannot drift from the protected
 * boundary's copy.
 */
export function AdminSessionLifecycle() {
  const connection = useConnection();
  const pathname = usePathname();
  const restorationSettled = useWalletRestorationSettled();
  const connectionRef = useRef<WalletConnectionState>({
    address: connection.address,
    chainId: connection.chainId,
    status: connection.status,
  });
  const sessionRef = useRef<AdminSessionDTO | undefined>(undefined);
  const checkRef = useRef<Promise<void> | undefined>(undefined);

  const forgetSession = useCallback(() => {
    sessionRef.current = undefined;
  }, []);
  const teardown = useAdminSessionTeardown(forgetSession);

  const accessEnded = useCallback(
    () => teardown.accessState() === "ended",
    [teardown],
  );

  const endSession = useCallback(
    (session: AdminSessionDTO, broadcast = true): Promise<void> =>
      teardown.endSession(session.csrfToken, { broadcast }),
    [teardown],
  );

  const trackSession = useCallback(
    (session: AdminSessionDTO) => {
      sessionRef.current = session;
      teardown.observe("active");
      teardown.scheduleExpiry(
        session.expiresAt,
        () => void endSession(session),
      );
    },
    [endSession, teardown],
  );

  const readIsStale = useCallback(
    (observedGeneration: number): boolean =>
      accessEnded() || observedGeneration !== teardown.generation(),
    [accessEnded, teardown],
  );

  const runSessionCheck = useCallback(async (): Promise<void> => {
    let observedGeneration: number;
    do {
      if (accessEnded()) return;
      observedGeneration = teardown.generation();
      let session: AdminSessionDTO;
      try {
        session = await readAdminSession();
      } catch (cause) {
        if (readIsStale(observedGeneration)) continue;
        if (
          sessionReadEndedAccess(
            cause,
            sessionRef.current !== undefined,
            pathname,
          )
        ) {
          teardown.closeLocalAccess({ broadcast: false });
        }
        continue;
      }
      if (readIsStale(observedGeneration)) continue;
      const latestConnection = connectionRef.current;
      if (connectionRestoring(latestConnection)) {
        trackSession(session);
        continue;
      }
      if (!sessionMatchesConnection(session, latestConnection)) {
        await endSession(session);
        continue;
      }
      trackSession(session);
    } while (observedGeneration !== teardown.generation());
  }, [accessEnded, endSession, pathname, readIsStale, teardown, trackSession]);

  const validateSession = useCallback(
    (queueAfterCurrent = false): Promise<void> => {
      if (queueAfterCurrent) teardown.invalidateReads();
      if (
        accessEnded() ||
        !restorationSettled ||
        connectionRestoring(connectionRef.current)
      ) {
        teardown.observe(restorationSettled ? "unknown" : "restoring");
        return Promise.resolve();
      }
      if (!revalidationWarranted(sessionRef.current !== undefined, pathname)) {
        teardown.observe("unknown");
        return Promise.resolve();
      }
      if (checkRef.current !== undefined) return checkRef.current;
      const checking = runSessionCheck().finally(() => {
        if (checkRef.current === checking) checkRef.current = undefined;
      });
      checkRef.current = checking;
      return checking;
    },
    [accessEnded, pathname, restorationSettled, runSessionCheck, teardown],
  );

  useEffect(() => {
    const currentConnection: WalletConnectionState = {
      address: connection.address,
      chainId: connection.chainId,
      status: connection.status,
    };
    connectionRef.current = currentConnection;
    if (!restorationSettled || connectionRestoring(currentConnection)) return;
    const session = sessionRef.current;
    if (
      session !== undefined &&
      !sessionMatchesConnection(session, currentConnection)
    ) {
      void endSession(session);
      return;
    }
    void validateSession();
  }, [
    connection.address,
    connection.chainId,
    connection.status,
    endSession,
    restorationSettled,
    validateSession,
  ]);

  useAdminSessionSignals({
    onStarted: () => {
      /* Being told a session started is itself proof one exists, whoever
         dispatched the signal. Recording it here means the revalidation below
         is never gated out, and `publishAdminSessionStarted` also writes it so
         other tabs see the marker before their next check. */
      markAdminSessionPresent();
      teardown.reopen();
      const pending = checkRef.current;
      if (pending === undefined) {
        void validateSession();
        return;
      }
      const retryIfUntracked = () => {
        if (!accessEnded() && sessionRef.current === undefined) {
          void validateSession();
        }
      };
      void pending.then(retryIfUntracked, retryIfUntracked);
    },
    onInvalidated: () => void validateSession(true),
    onEnded: () => teardown.closeLocalAccess({ origin: "responding" }),
    onExternalEnd: () => teardown.closeLocalAccess({ broadcast: false }),
  });

  useAdminSessionPresence({ onRecheck: () => void validateSession() });

  return null;
}
