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
  open: vi.fn(),
  disconnect: vi.fn(),
  disconnectStatus: "idle" as "idle" | "pending" | "error" | "success",
  endSession: vi.fn(),
}));

vi.mock("@/providers/wallet-session", () => ({
  useWalletSession: () => ({
    ready: true,
    connecting: false,
    rejected: false,
    modalOpen: false,
    connect: state.open,
    disconnect: state.disconnect,
    disconnectStatus: state.disconnectStatus,
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  isWalletConfigured: true,
  protocolChain: { id: 84_532 },
}));

vi.mock("@/components/admin/admin-session-boundary", () => ({
  useOptionalAdminSession: () => ({ endSession: state.endSession }),
}));

vi.mock("wagmi", () => ({
  useConnection: () => state.connection,
  useDisconnect: () => ({
    mutate: state.disconnect,
    status: state.disconnectStatus,
  }),
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
    state.open.mockReset();
    state.disconnect.mockReset();
    state.disconnectStatus = "idle";
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

  it("shows pending teardown and lets the user retry a failed disconnect", async () => {
    state.disconnect.mockImplementationOnce(() => {
      state.disconnectStatus = "pending";
    });
    await act(async () => root.render(<WalletControl />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Disconnect"]')
        ?.click();
    });
    await act(async () => root.render(<WalletControl />));

    const pending = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Disconnecting wallet"]',
    );
    expect(pending?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Waiting for the wallet session to close.",
    );

    state.disconnectStatus = "error";
    await act(async () => root.render(<WalletControl />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The wallet is still connected. Retry disconnecting.",
    );
    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry disconnect"]',
    );
    expect(retry?.disabled).toBe(false);

    state.disconnect.mockImplementationOnce(() => {
      state.disconnectStatus = "success";
      state.connection = { ...state.connection, status: "disconnected" };
    });
    await act(async () => retry?.click());
    await act(async () => root.render(<WalletControl />));
    expect(container.textContent).toContain("Connect wallet");
    expect(container.querySelector('[role="alert"]')).toBeNull();
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
