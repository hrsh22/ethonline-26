"use client";

import {
  useConnectOrCreateWallet,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useMutation } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useConnections, useDisconnect } from "wagmi";

import { WalletSessionContext } from "./wallet-session";

/** Privy owns login; wagmi owns the selected transaction account. */
export function PrivyWalletSession({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { ready: authReady, logout } = usePrivy();
  const { ready: walletsReady } = useWallets();
  const { isOpen } = useModalStatus();
  const { mutateAsync: disconnectWallet } = useDisconnect();
  const connections = useConnections();
  const [connecting, setConnecting] = useState(false);
  const [rejected, setRejected] = useState(false);
  const attempted = useRef(false);
  const wasOpen = useRef(false);
  const ready = authReady && walletsReady;
  const { connectOrCreateWallet } = useConnectOrCreateWallet({
    onSuccess: () => {
      attempted.current = false;
      setConnecting(false);
      setRejected(false);
    },
    onError: (error) => {
      if (!attempted.current) return;
      attempted.current = false;
      setConnecting(false);
      setRejected(error !== "exited_auth_flow");
    },
  });

  useEffect(() => {
    const closed = wasOpen.current && !isOpen;
    wasOpen.current = isOpen;
    if (!closed) return;
    const timer = window.setTimeout(() => setConnecting(false), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const disconnect = useMutation({
    mutationFn: async () => {
      // Logout removes embedded-wallet access. Clear every restored connector:
      // disconnecting only the selected one makes wagmi select another account.
      // Each connector's disconnect marker also prevents automatic reconnection
      // on reload when an extension retains its account grant.
      await logout();
      for (const { connector } of connections) {
        await disconnectWallet({ connector });
      }
    },
  });

  const connect = useCallback(() => {
    if (!ready || isOpen) return;
    attempted.current = true;
    setConnecting(true);
    setRejected(false);
    try {
      connectOrCreateWallet();
    } catch {
      attempted.current = false;
      setConnecting(false);
      setRejected(true);
    }
  }, [connectOrCreateWallet, isOpen, ready]);

  return (
    <WalletSessionContext
      value={{
        ready,
        connecting,
        rejected,
        modalOpen: isOpen,
        disconnectStatus: disconnect.status,
        connect,
        disconnect: () => disconnect.mutate(),
      }}
    >
      {children}
    </WalletSessionContext>
  );
}
