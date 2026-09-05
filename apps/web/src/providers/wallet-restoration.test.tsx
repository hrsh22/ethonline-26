/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const value = {
    connection: {
      status: "disconnected" as
        "connected" | "connecting" | "disconnected" | "reconnecting",
    },
    hydrated: false,
    finishListeners: new Set<() => void>(),
    startListeners: new Set<() => void>(),
  };
  const hydration = {
    hasHydrated: () => value.hydrated,
    onFinishHydration: (listener: () => void) => {
      value.finishListeners.add(listener);
      return () => value.finishListeners.delete(listener);
    },
    onHydrate: (listener: () => void) => {
      value.startListeners.add(listener);
      return () => value.startListeners.delete(listener);
    },
  };
  return Object.assign(value, {
    config: { _internal: { store: { persist: hydration } } },
  });
});

vi.mock("wagmi", () => ({
  useConfig: () => state.config,
  useConnection: () => state.connection,
}));

import {
  useWalletRestorationSettled,
  WalletRestorationBoundary,
} from "./wallet-restoration";

function RestorationProbe() {
  return useWalletRestorationSettled() ? "settled" : "restoring";
}

describe("wallet restoration boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    state.connection = { status: "disconnected" };
    state.hydrated = false;
    state.finishListeners.clear();
    state.startListeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () =>
      root.render(
        <WalletRestorationBoundary>
          <RestorationProbe />
        </WalletRestorationBoundary>,
      ),
    );
  };

  it("does not settle a disconnected wallet until hydration and reconnection finish", async () => {
    await render();
    expect(container.textContent).toBe("restoring");

    state.connection = { status: "reconnecting" };
    await act(async () => {
      for (const listener of state.startListeners) listener();
      await render();
    });
    expect(container.textContent).toBe("restoring");

    state.hydrated = true;
    await act(async () => {
      for (const listener of state.finishListeners) listener();
    });
    expect(container.textContent).toBe("restoring");

    state.connection = { status: "connected" };
    await render();
    expect(container.textContent).toBe("settled");
  });

  it("keeps an initially disconnected wallet restoring during the reconnect grace period", async () => {
    vi.useFakeTimers();
    state.hydrated = true;
    try {
      await render();

      expect(container.textContent).toBe("restoring");

      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(container.textContent).toBe("settled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats disconnection as final after a connection was established", async () => {
    state.hydrated = true;
    state.connection = { status: "connected" };
    await render();

    state.connection = { status: "disconnected" };
    await render();

    expect(container.textContent).toBe("settled");
  });

  it("recovers when a wallet connects after persistence hydration fails", async () => {
    state.connection = { status: "connected" };
    await render();

    expect(container.textContent).toBe("settled");
  });
});
