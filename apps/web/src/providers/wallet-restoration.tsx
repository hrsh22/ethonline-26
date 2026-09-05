"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConfig, useConnection } from "wagmi";

interface PersistHydrationStore {
  readonly hasHydrated: () => boolean;
  readonly onFinishHydration: (listener: () => void) => () => void;
  readonly onHydrate: (listener: () => void) => () => void;
}

const WalletRestorationContext = createContext(false);
const RECONNECT_GRACE_MILLISECONDS = 10_000;

const persistHydrationStore = (
  config: ReturnType<typeof useConfig>,
): PersistHydrationStore =>
  (
    config._internal.store as unknown as {
      readonly persist: PersistHydrationStore;
    }
  ).persist;

export function WalletRestorationBoundary({
  children,
}: {
  readonly children: ReactNode;
}) {
  const config = useConfig();
  const connection = useConnection();
  const hydration = persistHydrationStore(config);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeStart = hydration.onHydrate(listener);
      const unsubscribeFinish = hydration.onFinishHydration(listener);
      return () => {
        unsubscribeStart();
        unsubscribeFinish();
      };
    },
    [hydration],
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    hydration.hasHydrated,
    () => false,
  );
  const [connectedDuringMount, setConnectedDuringMount] = useState(
    connection.status === "connected",
  );
  const [reconnectGraceElapsed, setReconnectGraceElapsed] = useState(false);

  useEffect(() => {
    if (connection.status === "connected" && !connectedDuringMount) {
      const timer = window.setTimeout(() => setConnectedDuringMount(true), 0);
      return () => window.clearTimeout(timer);
    }
    if (
      !hydrated ||
      connection.status !== "disconnected" ||
      connectedDuringMount ||
      reconnectGraceElapsed
    ) {
      return;
    }
    const timer = window.setTimeout(
      () => setReconnectGraceElapsed(true),
      RECONNECT_GRACE_MILLISECONDS,
    );
    return () => window.clearTimeout(timer);
  }, [
    connectedDuringMount,
    connection.status,
    hydrated,
    reconnectGraceElapsed,
  ]);

  const settled =
    connection.status === "connected" ||
    (hydrated &&
      connection.status === "disconnected" &&
      (connectedDuringMount || reconnectGraceElapsed));

  return (
    <WalletRestorationContext value={settled}>
      {children}
    </WalletRestorationContext>
  );
}

export const useWalletRestorationSettled = (): boolean =>
  useContext(WalletRestorationContext);
