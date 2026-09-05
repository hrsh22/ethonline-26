/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("@/lib/admin-auth-client", () => ({
  logoutAdminSession: state.logout,
}));

import {
  ADMIN_SESSION_ENDED_EVENT,
  ADMIN_SESSION_INVALIDATED_EVENT,
  ADMIN_SESSION_STARTED_EVENT,
  ADMIN_SESSION_STORAGE_KEY,
} from "@/lib/admin-protected-fetch";
import {
  useAdminSessionSignals,
  useAdminSessionTeardown,
  type AdminSessionSignalHandlers,
  type AdminSessionTeardown,
} from "./admin-session-teardown";

const CSRF = "c".repeat(32);

describe("shared admin session teardown", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let controller: AdminSessionTeardown;
  let localTeardowns: number;

  const Probe = ({ onLocalTeardown }: { onLocalTeardown: () => void }) => {
    controller = useAdminSessionTeardown(onLocalTeardown);
    return null;
  };

  const SignalProbe = ({
    handlers,
  }: {
    readonly handlers: AdminSessionSignalHandlers;
  }) => {
    useAdminSessionSignals(handlers);
    return null;
  };

  const mount = async (node: React.ReactNode) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
      ),
    );
  };

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.logout.mockReset();
    state.logout.mockResolvedValue(undefined);
    localTeardowns = 0;
    container = document.createElement("div");
    document.body.append(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    root = createRoot(container);
    await mount(<Probe onLocalTeardown={() => (localTeardowns += 1)} />);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("starts in an unknown state and records non-terminal observations", () => {
    expect(controller.accessState()).toBe("unknown");
    act(() => controller.observe("restoring"));
    expect(controller.accessState()).toBe("restoring");
    act(() => controller.observe("active"));
    expect(controller.accessState()).toBe("active");
  });

  it("moves through closing to ended for an originating end", async () => {
    const states: string[] = [];
    state.logout.mockImplementation(async () => {
      states.push(controller.accessState());
    });
    act(() => controller.observe("active"));
    await act(async () => {
      await controller.endSession(CSRF);
    });
    expect(states).toEqual(["ended"]);
    expect(controller.accessState()).toBe("ended");
    expect(state.logout).toHaveBeenCalledWith(CSRF);
  });

  it("refuses to leave the ended state through observations", () => {
    act(() => controller.closeLocalAccess());
    act(() => controller.observe("active"));
    expect(controller.accessState()).toBe("ended");
  });

  it("reopens only through an explicit new session", () => {
    act(() => controller.closeLocalAccess());
    const endedGeneration = controller.generation();
    act(() => controller.reopen());
    expect(controller.accessState()).toBe("unknown");
    expect(controller.generation()).toBeGreaterThan(endedGeneration);
  });

  it("purges local state and runs consumer teardown exactly once", () => {
    const cancel = vi.spyOn(queryClient, "cancelQueries");
    const clear = vi.spyOn(queryClient, "clear");
    act(() => controller.closeLocalAccess());
    act(() => controller.closeLocalAccess());
    expect(localTeardowns).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("broadcasts and announces once for an originating end", () => {
    const announced: Event[] = [];
    const onEnded = (event: Event) => announced.push(event);
    const writes: (string | null)[] = [];
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((_key, value) => void writes.push(value));
    window.addEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    act(() => controller.closeLocalAccess());
    act(() => controller.closeLocalAccess());
    window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    expect(writes).toHaveLength(1);
    expect(announced).toHaveLength(1);
    setItem.mockRestore();
  });

  it("keeps a responding end local so cross-tab teardown cannot loop", () => {
    const announced: Event[] = [];
    const onEnded = (event: Event) => announced.push(event);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    window.addEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    act(() => controller.closeLocalAccess({ origin: "responding" }));
    window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    expect(announced).toHaveLength(0);
    expect(setItem).not.toHaveBeenCalled();
    expect(controller.accessState()).toBe("ended");
    expect(localTeardowns).toBe(1);
    setItem.mockRestore();
  });

  it("suppresses only the broadcast when the caller already sent one", () => {
    const announced: Event[] = [];
    const onEnded = (event: Event) => announced.push(event);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    window.addEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    act(() => controller.closeLocalAccess({ broadcast: false }));
    window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, onEnded);
    expect(setItem).not.toHaveBeenCalled();
    expect(announced).toHaveLength(1);
    setItem.mockRestore();
  });

  it("still tears down locally when browser storage is unavailable", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    act(() => controller.closeLocalAccess());
    expect(controller.accessState()).toBe("ended");
    expect(localTeardowns).toBe(1);
    setItem.mockRestore();
  });

  it("issues one server logout per originating end event", async () => {
    let release: (() => void) | undefined;
    state.logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = controller.endSession(CSRF);
      second = controller.endSession(CSRF);
    });
    expect(first).toBe(second);
    expect(state.logout).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
      await first;
    });
    expect(state.logout).toHaveBeenCalledTimes(1);
  });

  it("stays closed when the server logout call fails", async () => {
    state.logout.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await controller.endSession(CSRF);
    });
    expect(controller.accessState()).toBe("ended");
  });

  it("ends immediately for an already expired session", () => {
    const expired = vi.fn();
    act(() =>
      controller.scheduleExpiry(
        new Date(Date.now() - 1).toISOString(),
        expired,
      ),
    );
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("ends immediately for an unparseable expiry", () => {
    const expired = vi.fn();
    act(() => controller.scheduleExpiry("not-a-date", expired));
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("runs the expiry callback when the session lifetime elapses", () => {
    const expired = vi.fn();
    act(() =>
      controller.scheduleExpiry(
        new Date(Date.now() + 60_000).toISOString(),
        expired,
      ),
    );
    expect(expired).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending expiry when access closes", () => {
    const expired = vi.fn();
    act(() =>
      controller.scheduleExpiry(
        new Date(Date.now() + 60_000).toISOString(),
        expired,
      ),
    );
    act(() => controller.closeLocalAccess());
    act(() => void vi.advanceTimersByTime(120_000));
    expect(expired).not.toHaveBeenCalled();
  });

  it("invalidates in-flight reads without changing access state", () => {
    act(() => controller.observe("active"));
    const before = controller.generation();
    act(() => controller.invalidateReads());
    expect(controller.generation()).toBe(before + 1);
    expect(controller.accessState()).toBe("active");
  });

  it("keeps a stable controller identity across renders", async () => {
    const first = controller;
    await mount(<Probe onLocalTeardown={() => (localTeardowns += 1)} />);
    expect(controller).toBe(first);
  });

  it("routes every session signal to the shared subscriber", async () => {
    const handlers = {
      onEnded: vi.fn(),
      onExternalEnd: vi.fn(),
      onInvalidated: vi.fn(),
      onStarted: vi.fn(),
    };
    await mount(<SignalProbe handlers={handlers} />);
    act(() => {
      window.dispatchEvent(new Event(ADMIN_SESSION_ENDED_EVENT));
      window.dispatchEvent(new Event(ADMIN_SESSION_INVALIDATED_EVENT));
      window.dispatchEvent(new Event(ADMIN_SESSION_STARTED_EVENT));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ADMIN_SESSION_STORAGE_KEY,
          newValue: "1",
        }),
      );
    });
    expect(handlers.onEnded).toHaveBeenCalledTimes(1);
    expect(handlers.onInvalidated).toHaveBeenCalledTimes(1);
    expect(handlers.onStarted).toHaveBeenCalledTimes(1);
    expect(handlers.onExternalEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated storage writes and the removal half of the ping", async () => {
    const handlers = { onExternalEnd: vi.fn() };
    await mount(<SignalProbe handlers={handlers} />);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "unrelated", newValue: "1" }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ADMIN_SESSION_STORAGE_KEY,
          newValue: null,
        }),
      );
    });
    expect(handlers.onExternalEnd).not.toHaveBeenCalled();
  });
});
