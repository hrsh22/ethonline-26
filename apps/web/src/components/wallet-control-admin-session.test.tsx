/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 84_532,
    status: "connected" as "connected" | "disconnected",
  },
  disconnect: vi.fn(),
  endSession: vi.fn(),
}));

vi.mock("@reown/appkit/react", () => ({
  modal: { open: vi.fn() },
}));

vi.mock("@/lib/wagmi", () => ({
  isReownConfigured: true,
  protocolChain: { id: 84_532 },
}));

vi.mock("@/components/admin/admin-session-boundary", () => ({
  useOptionalAdminSession: () => ({ endSession: state.endSession }),
}));

vi.mock("wagmi", () => ({
  useConnection: () => state.connection,
  useDisconnect: () => ({ mutate: state.disconnect }),
  useSwitchChain: () => ({ mutate: vi.fn() }),
}));

import { WalletControl } from "./wallet-control";

describe("admin wallet disconnect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    state.disconnect.mockReset();
    state.endSession.mockReset();
    state.endSession.mockResolvedValue(undefined);
    state.connection = {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 84_532,
      status: "connected",
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("ends the server session before disconnecting the operator wallet", async () => {
    await act(async () => root.render(<WalletControl />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    expect(state.endSession).toHaveBeenCalledOnce();
    expect(state.disconnect).toHaveBeenCalledOnce();
    expect(state.endSession.mock.invocationCallOrder[0]).toBeLessThan(
      state.disconnect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("offers explicit sign-out without disconnecting a connected wallet", async () => {
    await act(async () => root.render(<WalletControl />));
    const signOut = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sign out",
    );

    await act(async () => {
      signOut?.click();
      await Promise.resolve();
    });

    expect(signOut).toBeDefined();
    expect(state.endSession).toHaveBeenCalledOnce();
    expect(state.disconnect).not.toHaveBeenCalled();
  });

  it("keeps an explicit admin sign-out available when the wallet is disconnected", async () => {
    state.connection = { ...state.connection, status: "disconnected" };
    await act(async () => root.render(<WalletControl />));
    const signOut = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sign out",
    );

    await act(async () => {
      signOut?.click();
      await Promise.resolve();
    });

    expect(signOut).toBeDefined();
    expect(state.endSession).toHaveBeenCalledOnce();
    expect(state.disconnect).not.toHaveBeenCalled();
  });
});
