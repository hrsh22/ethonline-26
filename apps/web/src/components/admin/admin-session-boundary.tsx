"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useConnection } from "wagmi";

import type { AdminActionAuthorizationRequest } from "@orbit/config/admin-auth";

import {
  AdminClientError,
  authorizeAdminAction,
  readAdminSession,
} from "@/lib/admin-auth-client";
import { AdminActionAuthorizationDeniedError } from "@/lib/admin-action-authorization";
import {
  safeAdminReturnPath,
  type AdminSessionDTO,
} from "@/lib/admin-session-contract";
import {
  publishAdminSessionStarted,
  useAdminSessionActivation,
  useAdminSessionPresence,
  useAdminSessionSignals,
  useAdminSessionTeardown,
} from "@/lib/admin-session-teardown";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
import { useWalletRestorationSettled } from "@/providers/wallet-restoration";

interface AdminSessionContextValue {
  readonly authorizeAction: (
    action: AdminActionAuthorizationRequest,
  ) => Promise<void>;
  readonly endSession: () => Promise<void>;
  readonly session: AdminSessionDTO;
}

const AdminSessionContext = createContext<AdminSessionContextValue | undefined>(
  undefined,
);

const sameSession = (left: AdminSessionDTO, right: AdminSessionDTO): boolean =>
  left.address.toLowerCase() === right.address.toLowerCase() &&
  left.chainId === right.chainId &&
  left.deploymentFingerprint === right.deploymentFingerprint &&
  left.csrfToken === right.csrfToken &&
  left.issuedAt === right.issuedAt &&
  left.expiresAt === right.expiresAt;

type WalletConnection = ReturnType<typeof useConnection>;

const connectionIsRestoring = (
  connection: WalletConnection,
  restorationSettled: boolean,
): boolean =>
  !restorationSettled ||
  connection.status === "connecting" ||
  connection.status === "reconnecting";

/** A connected wallet must still match the session's actor and chain. */
const connectionIsInvalid = (
  connection: WalletConnection,
  session: AdminSessionDTO,
): boolean => {
  if (connection.status === "disconnected") return true;
  if (connection.status !== "connected") return false;
  return (
    connection.chainId !== session.chainId ||
    connection.address.toLowerCase() !== session.address.toLowerCase()
  );
};

const sessionMatchesDeployment = (session: AdminSessionDTO): boolean =>
  protocolDeploymentFingerprint !== undefined &&
  session.deploymentFingerprint === protocolDeploymentFingerprint;

export const useOptionalAdminSession = ():
  AdminSessionContextValue | undefined => useContext(AdminSessionContext);

/**
 * Guards protected admin navigation. It owns deployment/session agreement and
 * the return to sign-in; broadcast, cache purge, logout coordination, and the
 * expiry timer come from the shared teardown seam.
 */
export function AdminSessionBoundary({
  children,
  session,
}: {
  readonly children: React.ReactNode;
  readonly session: AdminSessionDTO;
}) {
  const connection = useConnection();
  const pathname = usePathname();
  const router = useRouter();
  const restorationSettled = useWalletRestorationSettled();
  const establishmentPublished = useRef(false);
  const [available, setAvailable] = useState(false);
  const deploymentInvalid = !sessionMatchesDeployment(session);

  const veilProtectedSurface = useCallback(() => setAvailable(false), []);
  const teardown = useAdminSessionTeardown(veilProtectedSurface);

  const accessClosed = useCallback(() => {
    const state = teardown.accessState();
    return state === "closing" || state === "ended";
  }, [teardown]);

  const returnToSignIn = useCallback(() => {
    const next = encodeURIComponent(safeAdminReturnPath(pathname));
    router.replace(`/admin/sign-in?next=${next}`);
    router.refresh();
  }, [pathname, router]);

  const endSession = useCallback(async (): Promise<void> => {
    if (accessClosed()) return;
    try {
      await teardown.endSession(session.csrfToken);
    } finally {
      // Navigation still removes the protected surface if transport fails.
      returnToSignIn();
    }
  }, [accessClosed, returnToSignIn, session.csrfToken, teardown]);

  const closeFromExternalEnd = useCallback(() => {
    if (accessClosed()) return;
    teardown.closeLocalAccess({ origin: "responding" });
    returnToSignIn();
  }, [accessClosed, returnToSignIn, teardown]);

  const sessionStatus = useCallback(async (): Promise<
    "current" | "invalid" | "unavailable"
  > => {
    try {
      const current = await readAdminSession();
      return sessionMatchesDeployment(current) && sameSession(current, session)
        ? "current"
        : "invalid";
    } catch (cause) {
      return cause instanceof AdminClientError &&
        (cause.status === 401 || cause.status === 403)
        ? "invalid"
        : "unavailable";
    }
  }, [session]);

  const authorizeAction = useCallback(
    async (action: AdminActionAuthorizationRequest): Promise<void> => {
      try {
        await authorizeAdminAction(action, session.csrfToken);
      } catch (cause) {
        if (cause instanceof AdminClientError && cause.status === 401) {
          await endSession();
        } else if (cause instanceof AdminClientError && cause.status === 403) {
          if ((await sessionStatus()) === "invalid") await endSession();
          throw new AdminActionAuthorizationDeniedError(action);
        }
        throw cause;
      }
    },
    [endSession, session.csrfToken, sessionStatus],
  );

  const connectionRestoring = connectionIsRestoring(
    connection,
    restorationSettled,
  );
  const connectionInvalid = connectionIsInvalid(connection, session);
  const accessEligible =
    !connectionInvalid && !connectionRestoring && !deploymentInvalid;

  const revalidate = useCallback(async () => {
    if (accessClosed()) return;
    const status = await sessionStatus();
    if (status === "invalid") {
      await endSession();
      return;
    }
    if (status !== "current" || accessClosed()) return;
    teardown.observe("active");
    setAvailable(true);
    if (!establishmentPublished.current) {
      establishmentPublished.current = true;
      publishAdminSessionStarted();
    }
  }, [accessClosed, endSession, sessionStatus, teardown]);

  useEffect(() => {
    if (!connectionRestoring && connectionInvalid) void endSession();
  }, [connectionInvalid, connectionRestoring, endSession]);

  useEffect(() => {
    teardown.scheduleExpiry(session.expiresAt, () => void endSession());
    return teardown.clearExpiry;
  }, [endSession, session.expiresAt, teardown]);

  useEffect(() => {
    if (deploymentInvalid) void endSession();
  }, [deploymentInvalid, endSession]);

  useAdminSessionActivation(accessEligible, () => void revalidate());

  useAdminSessionSignals({
    onInvalidated: () => void endSession(),
    onEnded: closeFromExternalEnd,
    onExternalEnd: closeFromExternalEnd,
  });

  useAdminSessionPresence({
    onRecheck: () => void revalidate(),
    onRestoredFromCache: () => flushSync(() => setAvailable(false)),
  });

  if (!available || !accessEligible) return null;
  return (
    <AdminSessionContext value={{ authorizeAction, endSession, session }}>
      {children}
    </AdminSessionContext>
  );
}
