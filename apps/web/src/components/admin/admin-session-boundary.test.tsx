/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const replace = vi.fn();
  const refresh = vi.fn();
  return {
    connection: {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 84_532,
      status: "connected" as
        "connected" | "connecting" | "disconnected" | "reconnecting",
    },
    authorize: vi.fn(),
    logout: vi.fn(),
    pathname: "/admin/diagnostics",
    readSession: vi.fn(),
    restorationSettled: true,
    replace,
    refresh,
    router: { replace, refresh },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => state.router,
}));

vi.mock("wagmi", () => ({
  useConnection: () => state.connection,
}));

vi.mock("@/providers/wallet-restoration", () => ({
  useWalletRestorationSettled: () => state.restorationSettled,
}));

vi.mock("@/lib/deployment", () => ({
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
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
  authorizeAdminAction: state.authorize,
  logoutAdminSession: state.logout,
  readAdminSession: state.readSession,
}));

import {
  AdminSessionBoundary,
  useOptionalAdminSession,
} from "./admin-session-boundary";
import { AdminActionAuthorizationDeniedError } from "@/lib/admin-action-authorization";
import { AdminClientError } from "@/lib/admin-auth-client";
import { ADMIN_SESSION_STARTED_EVENT } from "@/lib/admin-protected-fetch";

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

describe("admin session boundary", () => {
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
      chainId: 84_532,
      status: "connected",
    };
    state.pathname = "/admin/diagnostics";
    state.restorationSettled = true;
    for (const mock of [
      state.authorize,
      state.logout,
      state.readSession,
      state.replace,
      state.refresh,
    ]) {
      mock.mockReset();
    }
    state.logout.mockResolvedValue(undefined);
    state.authorize.mockResolvedValue({ authorized: true });
    state.readSession.mockResolvedValue(session);
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
          <AdminSessionBoundary session={session}>
            <main>Private diagnostics</main>
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );
  };

  it("keeps matching wallet and session state available", async () => {
    await render();

    expect(container.textContent).toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("announces an established live boundary exactly once", async () => {
    const started = vi.fn();
    window.addEventListener(ADMIN_SESSION_STARTED_EVENT, started);

    await render();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(started).toHaveBeenCalledOnce();
    window.removeEventListener(ADMIN_SESSION_STARTED_EVENT, started);
  });

  it("rejects a replaced live session with a different CSRF token", async () => {
    state.readSession.mockResolvedValue({
      ...session,
      csrfToken: "d".repeat(32),
    });

    await render();

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
  });

  it("revokes a server session when wallet restoration has settled as disconnected", async () => {
    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "disconnected",
    };

    await render();

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
  });

  it("veils during wallet restoration and reveals only the matching reconnected account", async () => {
    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "reconnecting",
    };
    await render();
    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();

    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "connected",
    };
    await render();

    expect(container.textContent).toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("does not revoke the pre-hydration disconnected state before wallet restoration", async () => {
    state.restorationSettled = false;
    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "disconnected",
    };
    await render();

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();

    state.restorationSettled = true;
    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "reconnecting",
    };
    await render();
    expect(state.logout).not.toHaveBeenCalled();

    state.connection = {
      address: session.address,
      chainId: session.chainId,
      status: "connected",
    };
    await render();

    expect(container.textContent).toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("never commits a session from a different deployment", async () => {
    const committed = vi.fn();
    function PrivateProbe() {
      useLayoutEffect(committed, []);
      return <main>Private diagnostics</main>;
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionBoundary
            session={{
              ...session,
              deploymentFingerprint: `0x${"e".repeat(64)}`,
            }}
          >
            <PrivateProbe />
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );

    expect(committed).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).toHaveBeenCalled();
  });

  it("never commits protected children for an already-mismatched wallet", async () => {
    const committed = vi.fn();
    function PrivateProbe() {
      useLayoutEffect(committed, []);
      return <main>Private diagnostics</main>;
    }
    state.connection = {
      ...state.connection,
      address: "0x2222222222222222222222222222222222222222",
    };
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionBoundary session={session}>
            <PrivateProbe />
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(committed).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();
    expect(state.replace).toHaveBeenCalledWith(
      "/admin/sign-in?next=%2Fadmin%2Fdiagnostics",
    );
    expect(state.refresh).toHaveBeenCalled();
  });

  it.each([
    [
      "chain change",
      { address: session.address, chainId: 1, status: "connected" },
    ],
    [
      "wallet disconnect",
      {
        address: session.address,
        chainId: session.chainId,
        status: "disconnected",
      },
    ],
  ] as const)(
    "veils private UI after a post-mount %s",
    async (_label, next) => {
      await render();
      state.connection = {
        address: next.address,
        chainId: next.chainId,
        status: next.status,
      };

      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <AdminSessionBoundary session={session}>
              <main>Private diagnostics</main>
            </AdminSessionBoundary>
          </QueryClientProvider>,
        ),
      );

      expect(container.textContent).not.toContain("Private diagnostics");
      expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    },
  );

  it("removes access as soon as the server session expires", async () => {
    await render();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    });

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    expect(state.replace).toHaveBeenCalled();
  });

  it("authorizes an exact action with the current session CSRF token", async () => {
    function AuthorizedAction() {
      const admin = useOptionalAdminSession();
      return (
        <button
          onClick={() =>
            void admin
              ?.authorizeAction({ type: "open-reward-epoch" })
              .catch(() => undefined)
          }
          type="button"
        >
          Open epoch
        </button>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionBoundary session={session}>
            <AuthorizedAction />
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(state.authorize).toHaveBeenCalledWith(
      { type: "open-reward-epoch" },
      session.csrfToken,
    );
  });

  it("preserves a valid console session when only one action is forbidden", async () => {
    const rejected = vi.fn();
    state.authorize.mockRejectedValueOnce(
      new AdminClientError(403, "forbidden"),
    );
    function DeniedAction() {
      const admin = useOptionalAdminSession();
      return (
        <button
          onClick={() =>
            void admin
              ?.authorizeAction({ type: "open-reward-epoch" })
              .catch(rejected)
          }
          type="button"
        >
          Open epoch
        </button>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionBoundary session={session}>
            <DeniedAction />
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce());
    });

    expect(state.readSession).toHaveBeenCalledTimes(2);
    expect(state.logout).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Open epoch");
    expect(rejected.mock.calls[0]?.[0]).toMatchObject({
      action: { type: "open-reward-epoch" },
      name: "AdminActionAuthorizationDeniedError",
    });
    expect(rejected.mock.calls[0]?.[0]).toBeInstanceOf(
      AdminActionAuthorizationDeniedError,
    );
  });

  it("ends a forbidden action session when live revalidation says it was revoked", async () => {
    function RevokedAction() {
      const admin = useOptionalAdminSession();
      return (
        <button
          onClick={() =>
            void admin
              ?.authorizeAction({ type: "open-reward-epoch" })
              .catch(() => undefined)
          }
          type="button"
        >
          Open epoch
        </button>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionBoundary session={session}>
            <RevokedAction />
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );

    state.authorize.mockRejectedValueOnce(
      new AdminClientError(403, "forbidden"),
    );
    state.readSession.mockRejectedValueOnce(
      new AdminClientError(403, "forbidden"),
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await vi.waitFor(() => expect(state.logout).toHaveBeenCalledOnce());
    });

    expect(container.textContent).not.toContain("Open epoch");
  });

  it("ends the session immediately when action authorization is unauthenticated", async () => {
    state.authorize.mockRejectedValueOnce(
      new AdminClientError(401, "session_required"),
    );
    function ExpiredAction() {
      const admin = useOptionalAdminSession();
      return (
        <button
          onClick={() =>
            void admin
              ?.authorizeAction({ type: "open-reward-epoch" })
              .catch(() => undefined)
          }
          type="button"
        >
          Open epoch
        </button>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AdminSessionBoundary session={session}>
            <ExpiredAction />
          </AdminSessionBoundary>
        </QueryClientProvider>,
      ),
    );

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(state.readSession).toHaveBeenCalledOnce();
    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    expect(container.textContent).not.toContain("Open epoch");
  });

  it("ends the session when any protected data request reports revocation", async () => {
    await render();

    await act(async () => {
      window.dispatchEvent(new Event("orbit:admin-session-invalidated"));
      await Promise.resolve();
    });

    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    expect(container.textContent).not.toContain("Private diagnostics");
  });

  it("removes cached access when another tab ends the admin session", async () => {
    await render();

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "orbit:admin-session-ended-at",
          newValue: "other-tab-session-end",
        }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(
      queryClient.getQueryData(["admin-protected", "diagnostics"]),
    ).toBeUndefined();
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("closes locally when the root lifecycle reports a final session end", async () => {
    await render();

    await act(async () => {
      window.dispatchEvent(new Event("orbit:admin-session-ended"));
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();
    expect(state.replace).toHaveBeenCalledWith(
      "/admin/sign-in?next=%2Fadmin%2Fdiagnostics",
    );
  });

  it("veils a BFCache restore synchronously and reveals it only after revalidation", async () => {
    await render();
    let resolveSession: (value: typeof session) => void = () => undefined;
    const revalidation = new Promise<typeof session>((resolve) => {
      resolveSession = resolve;
    });
    state.readSession.mockReturnValueOnce(revalidation);

    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });

    expect(container.textContent).not.toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession(session);
      await revalidation;
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Private diagnostics");
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("keeps the current session through a transient focus revalidation outage", async () => {
    await render();
    state.readSession.mockRejectedValueOnce(
      new AdminClientError(503, "upstream_unavailable"),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(state.logout).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Private diagnostics");
  });
});
