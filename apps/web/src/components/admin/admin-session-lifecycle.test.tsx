/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 84_532,
    status: "connected" as
      "connected" | "connecting" | "disconnected" | "reconnecting",
  },
  logout: vi.fn(),
  pathname: "/status",
  readSession: vi.fn(),
  restorationSettled: true,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

vi.mock("wagmi", () => ({
  useConnection: () => state.connection,
}));

vi.mock("@/providers/wallet-restoration", () => ({
  useWalletRestorationSettled: () => state.restorationSettled,
}));

vi.mock("@/lib/admin-auth-client", () => ({
  AdminClientError: class AdminClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  },
  logoutAdminSession: state.logout,
  readAdminSession: state.readSession,
}));

import { AdminSessionLifecycle } from "./admin-session-lifecycle";
import { AdminClientError } from "@/lib/admin-auth-client";
import {
  ADMIN_SESSION_ENDED_EVENT,
  ADMIN_SESSION_PRESENCE_KEY,
  ADMIN_SESSION_STARTED_EVENT,
  ADMIN_SESSION_STORAGE_KEY,
} from "@/lib/admin-protected-fetch";

const session = {
  address: "0x1111111111111111111111111111111111111111" as const,
  chainId: 84_532 as const,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: `0x${"f".repeat(64)}` as const,
  expiresAt: "2026-08-31T05:15:00.000Z",
  issuedAt: "2026-08-31T05:00:00.000Z",
  observedBlock: {
    hash: `0x${"a".repeat(64)}` as const,
    number: "31000000",
  },
  roles: ["keeper"] as const,
};

describe("root admin session lifecycle", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T05:05:00.000Z"));
    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "connected",
    };
    state.logout.mockReset().mockResolvedValue(undefined);
    state.readSession.mockReset().mockResolvedValue(session);
    state.pathname = "/status";
    state.restorationSettled = true;
    window.localStorage.clear();
    /* Every case here models an operator: a browser that has held an admin
       session. Without the marker the tracker correctly declines to probe on a
       collector path, which is what the last case in this file asserts. */
    window.localStorage.setItem(ADMIN_SESSION_PRESENCE_KEY, "1");
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["admin-protected", "diagnostics"], {
      private: true,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.useRealTimers();
  });

  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalled());
    });
  };

  it("keeps a matching connected wallet session alive on public routes", async () => {
    await render();

    expect(state.logout).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toEqual({ private: true });
  });

  it.each([
    [
      "wallet disconnect",
      {
        address: session.address,
        chainId: session.chainId,
        status: "disconnected",
      },
    ],
    [
      "account switch",
      {
        address: "0x2222222222222222222222222222222222222222",
        chainId: session.chainId,
        status: "connected",
      },
    ],
    [
      "chain switch",
      {
        address: session.address,
        chainId: 1,
        status: "connected",
      },
    ],
  ] as const)(
    "revokes and purges after a public-route %s",
    async (_label, connection) => {
      const ended = vi.fn();
      window.addEventListener(ADMIN_SESSION_ENDED_EVENT, ended);
      await render();

      state.connection = { ...connection };
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <AdminSessionLifecycle />
          </QueryClientProvider>,
        ),
      );
      await act(async () => {
        await vi.waitFor(() =>
          expect(state.logout).toHaveBeenCalledWith(session.csrfToken),
        );
      });

      expect(ended).toHaveBeenCalled();
      expect(
        queryClient.getQueryData(["admin-protected", "diagnostics"]),
      ).toBeUndefined();
      window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, ended);
    },
  );

  it("does not revoke while the wallet connector is restoring", async () => {
    state.connection = { ...state.connection, status: "reconnecting" };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );

    expect(state.readSession).not.toHaveBeenCalled();
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("waits through disconnected hydration and reconnects before validating", async () => {
    state.restorationSettled = false;
    state.connection = { ...state.connection, status: "disconnected" };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    expect(state.readSession).not.toHaveBeenCalled();
    expect(state.logout).not.toHaveBeenCalled();

    state.restorationSettled = true;
    state.connection = { ...state.connection, status: "reconnecting" };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    expect(state.readSession).not.toHaveBeenCalled();

    state.connection = { ...state.connection, status: "connected" };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalledOnce());
    });

    expect(state.logout).not.toHaveBeenCalled();
  });

  it("captures a session created after the root mounted and expires it off-admin", async () => {
    state.readSession
      .mockRejectedValueOnce(new AdminClientError(401, "session_required"))
      .mockResolvedValue(session);
    await render();

    await act(async () => {
      window.dispatchEvent(new Event(ADMIN_SESSION_STARTED_EVENT));
      await vi.waitFor(() =>
        expect(state.readSession).toHaveBeenCalledTimes(2),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    });

    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();
  });

  it("reruns session discovery when sign-in finishes behind an older request", async () => {
    let rejectInitial: (cause: unknown) => void = () => undefined;
    const initial = new Promise<never>((_resolve, reject) => {
      rejectInitial = reject;
    });
    state.readSession.mockReset();
    state.readSession.mockReturnValueOnce(initial).mockResolvedValue(session);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalledOnce());
      window.dispatchEvent(new Event(ADMIN_SESSION_STARTED_EVENT));
      rejectInitial(new AdminClientError(401, "session_required"));
      await vi.waitFor(() =>
        expect(state.readSession).toHaveBeenCalledTimes(2),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    });

    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
  });

  it("purges a protected page when its initial live session check is revoked", async () => {
    const ended = vi.fn();
    state.pathname = "/admin";
    state.readSession.mockRejectedValueOnce(
      new AdminClientError(403, "forbidden"),
    );
    window.addEventListener(ADMIN_SESSION_ENDED_EVENT, ended);

    await render();

    expect(ended).toHaveBeenCalled();
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();
    window.removeEventListener(ADMIN_SESSION_ENDED_EVENT, ended);
  });

  it("purges a public tab when another tab signs out without repeating logout", async () => {
    await render();
    state.logout.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ADMIN_SESSION_STORAGE_KEY,
          newValue: "other-tab-session-end",
        }),
      );
    });

    expect(state.logout).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();
  });

  it("does not resurrect an ended session from an older in-flight read", async () => {
    let resolveInitial: (value: typeof session) => void = () => undefined;
    const initial = new Promise<typeof session>((resolve) => {
      resolveInitial = resolve;
    });
    state.readSession.mockReset().mockReturnValue(initial);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalledOnce());
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ADMIN_SESSION_STORAGE_KEY,
          newValue: "other-tab-session-end",
        }),
      );
    });

    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();

    await act(async () => {
      resolveInitial(session);
      await initial;
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    });

    expect(state.readSession).toHaveBeenCalledOnce();
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("reopens session discovery when start lands before an old check finalizes", async () => {
    let resolveInitial: (value: typeof session) => void = () => undefined;
    const initial = new Promise<typeof session>((resolve) => {
      resolveInitial = resolve;
    });
    state.readSession
      .mockReset()
      .mockReturnValueOnce(initial)
      .mockResolvedValue(session);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalledOnce());
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ADMIN_SESSION_STORAGE_KEY,
          newValue: "other-tab-session-end",
        }),
      );
    });

    await act(async () => {
      resolveInitial(session);
      queueMicrotask(() =>
        window.dispatchEvent(new Event(ADMIN_SESSION_STARTED_EVENT)),
      );
      await initial;
      await vi.waitFor(() =>
        expect(state.readSession).toHaveBeenCalledTimes(2),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    });

    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
  });

  it("purges a tracked session when live revalidation reports revocation", async () => {
    await render();
    state.readSession.mockRejectedValueOnce(
      new AdminClientError(403, "forbidden"),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() =>
        expect(state.readSession).toHaveBeenCalledTimes(2),
      );
    });

    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("preserves a tracked session through a transient revalidation outage", async () => {
    await render();
    state.readSession.mockRejectedValueOnce(
      new AdminClientError(503, "upstream_unavailable"),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() =>
        expect(state.readSession).toHaveBeenCalledTimes(2),
      );
    });

    expect(state.logout).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toEqual({ private: true });
  });

  const renderWithoutWaiting = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionLifecycle />
        </QueryClientProvider>,
      ),
    );

  it("does not probe the admin session for a collector who has never signed in", async () => {
    /* This tracker is mounted for the whole application, so it used to answer
       401 on every collector route the moment any wallet connected -- once per
       page load, relayed upstream to the API, for a visitor with no console
       access at all. */
    window.localStorage.removeItem(ADMIN_SESSION_PRESENCE_KEY);
    state.pathname = "/fleet";

    await renderWithoutWaiting();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(state.readSession).not.toHaveBeenCalled();
  });

  it("still probes on an admin path with no marker, so console access never depends on storage", async () => {
    window.localStorage.removeItem(ADMIN_SESSION_PRESENCE_KEY);
    state.pathname = "/admin/sign-in";

    await renderWithoutWaiting();

    await act(async () => {
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalled());
    });
  });

  it("probes a collector route again once a session has started", async () => {
    window.localStorage.removeItem(ADMIN_SESSION_PRESENCE_KEY);
    state.pathname = "/fleet";

    await renderWithoutWaiting();
    await act(async () => {
      window.dispatchEvent(new Event(ADMIN_SESSION_STARTED_EVENT));
      await vi.waitFor(() => expect(state.readSession).toHaveBeenCalled());
    });
  });
});
