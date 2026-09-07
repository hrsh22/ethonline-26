"use client";

import { createContext, useContext } from "react";

export interface WalletSession {
  readonly ready: boolean;
  readonly connecting: boolean;
  readonly rejected: boolean;
  readonly modalOpen: boolean;
  readonly disconnectStatus: "idle" | "pending" | "success" | "error";
  readonly connect: () => void;
  readonly disconnect: () => void;
}

export const WalletSessionContext = createContext<WalletSession>({
  ready: true,
  connecting: false,
  rejected: false,
  modalOpen: false,
  disconnectStatus: "idle",
  connect: () => undefined,
  disconnect: () => undefined,
});

export const useWalletSession = () => useContext(WalletSessionContext);
