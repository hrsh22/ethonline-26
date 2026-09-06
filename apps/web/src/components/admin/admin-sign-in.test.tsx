/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminChallengeMessage } from "@orbit/config/admin-auth";

const state = vi.hoisted(() => ({
  challenge: vi.fn(),
  connection: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 84_532,
    status: "disconnected" as
      "connected" | "connecting" | "disconnected" | "reconnecting",
  },
  currentConnection: vi.fn(),
  modalOpen: vi.fn(),
  logout: vi.fn(),
  modalSubscriber: undefined as
    ((event: { readonly data: unknown }) => void) | undefined,
  modalSubscribe: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  sign: vi.fn(),
  switchError: false,
  switchPending: false,
  switchChain: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@reown/appkit/react", () => ({
  modal: { open: state.modalOpen, subscribeEvents: state.modalSubscribe },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, refresh: state.refresh }),
}));

vi.mock("wagmi", () => ({
  useConnection: () => state.connection,
  useSignMessage: () => ({ mutateAsync: state.sign }),
  useSwitchChain: () => ({
    isError: state.switchError,
    isPending: state.switchPending,
    mutate: state.switchChain,
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  currentWalletConnection: () => state.currentConnection(),
  isReownConfigured: true,
  protocolChain: { id: 84_532 },
}));

vi.mock("@/lib/deployment", () => ({
  deploymentEnvironment: { chainLabel: "Base Sepolia" },
  protocolDeploymentFingerprint: `0x${"f".repeat(64)}`,
}));

vi.mock("@/lib/admin-auth-client", () => ({
  AdminClientError: class AdminClientError extends Error {
    constructor(readonly status: number) {
      super("admin client error");
    }
  },
  requestAdminChallenge: state.challenge,
  logoutAdminSession: state.logout,
  verifyAdminSignature: state.verify,
}));

import { AdminSignIn } from "./admin-sign-in";

const session = {
  address: state.connection.address,
  chainId: 84_532,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: `0x${"f".repeat(64)}`,
  expiresAt: "2026-08-31T05:15:00.000Z",
  issuedAt: "2026-08-31T05:00:00.000Z",
  observedBlock: { hash: `0x${"a".repeat(64)}`, number: "31000000" },
  roles: ["keeper"],
};

const validChallenge = () => {
  const issuedAt = new Date(Date.now() - 60_000);
  const expirationTime = new Date(Date.now() + 300_000);
  return {
    expiresAt: expirationTime.toISOString(),
    message: createAdminChallengeMessage({
      address: state.connection.address as `0x${string}`,
      appOrigin: window.location.origin,
      deploymentFingerprint: `0x${"f".repeat(64)}` as `0x${string}`,
      expirationTime,
      issuedAt,
      nonce: "a".repeat(64),
    }),
  };
};

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("public admin sign-in", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    state.connection = {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 84_532,
      status: "disconnected",
    };
    state.currentConnection
      .mockReset()
      .mockImplementation(() => state.connection);
    state.switchError = false;
    state.switchPending = false;
    state.modalSubscriber = undefined;
    state.modalSubscribe
      .mockReset()
      .mockImplementation(
        (subscriber: (event: { readonly data: unknown }) => void) => {
          state.modalSubscriber = subscriber;
          return vi.fn();
        },
      );
    for (const mock of [
      state.challenge,
      state.modalOpen,
      state.logout,
      state.replace,
      state.refresh,
      state.sign,
      state.switchChain,
      state.verify,
    ]) {
      mock.mockReset();
    }
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
      root.render(<AdminSignIn next="/admin/diagnostics" />),
    );
  };

  it("keeps the public surface focused on connection and explains the signature", async () => {
    await render();

    expect(container.textContent).toContain("Operator sign-in");
    expect(container.textContent).toContain("Connect wallet");
    expect(container.textContent).toContain(
      "This signature is not a transaction",
    );
    expect(container.textContent).toContain("Base Sepolia");
    expect(
      container.querySelector('a[href="#main-content"]')?.textContent,
    ).toContain("Skip to main content");
    expect(
      container.querySelector("[data-wallet-state='disconnected']"),
    ).not.toBeNull();
    expect(container.querySelector("[data-shell='admin']")).toBeNull();
  });

  it("explains why connection is disabled while a wallet is connecting", async () => {
    state.connection = { ...state.connection, status: "connecting" };
    await render();

    const button = container.querySelector("button");
    const reasonId = button?.getAttribute("aria-describedby");

    expect(
      container.querySelector("[data-wallet-state='connecting']"),
    ).not.toBeNull();
    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(button?.textContent).toContain("Connecting wallet");
    expect(button?.textContent).not.toContain("Restoring wallet");
    expect(reasonId).toBe("admin-wallet-connection-reason");
    expect(container.querySelector(`#${reasonId}`)?.textContent).toContain(
      "connection finishes",
    );
  });

  it("labels restoration separately from a new wallet connection", async () => {
    state.connection = { ...state.connection, status: "reconnecting" };
    await render();

    const button = container.querySelector("button");
    const reasonId = button?.getAttribute("aria-describedby");

    expect(button?.textContent).toContain("Restoring wallet");
    expect(container.textContent).toContain("Restoring wallet session");
    expect(container.querySelector(`#${reasonId}`)?.textContent).toContain(
      "previous wallet session is restored",
    );
  });

  it("announces a wallet modal rejection emitted after an attempted connection", async () => {
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Connect wallet"),
    );
    await act(async () => button?.click());
    await act(async () =>
      state.modalSubscriber?.({
        data: {
          event: "USER_REJECTED",
          properties: { message: "User declined connection" },
        },
      }),
    );

    expect(document.activeElement).toBe(button);
    expect(state.modalOpen).toHaveBeenCalledWith({ view: "Connect" });
    expect(
      container.querySelector("[data-wallet-state='rejected']"),
    ).not.toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Wallet connection was not completed",
    );
  });

  it("switches a connected wallet to the only accepted network", async () => {
    state.connection = { ...state.connection, chainId: 1, status: "connected" };
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Switch to Base Sepolia"),
    );
    await act(async () => button?.click());

    expect(state.switchChain).toHaveBeenCalledWith({ chainId: 84_532 });
    expect(state.challenge).not.toHaveBeenCalled();
  });

  it("makes network switching and rejection explicit", async () => {
    state.connection = { ...state.connection, chainId: 1, status: "connected" };
    state.switchPending = true;
    await render();

    const switchingButton = container.querySelector("button");
    const reasonId = switchingButton?.getAttribute("aria-describedby");
    expect(
      container.querySelector("[data-wallet-state='switching']"),
    ).not.toBeNull();
    expect(switchingButton?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector(`#${reasonId}`)?.textContent).toContain(
      "network request finishes",
    );

    state.switchPending = false;
    state.switchError = true;
    await render();

    expect(
      container.querySelector("[data-wallet-state='rejected']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Network switch was not completed");
    expect(container.textContent).not.toContain("admin client error");
  });

  it("announces signing and verification as separate protected steps", async () => {
    const challenge = deferred<ReturnType<typeof validChallenge>>();
    const signature = deferred<`0x${string}`>();
    const verification = deferred<typeof session>();
    state.connection = { ...state.connection, status: "connected" };
    state.challenge.mockReturnValue(challenge.promise);
    state.sign.mockReturnValue(signature.promise);
    state.verify.mockReturnValue(verification.promise);
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-admin-sign-in-state='requesting']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Preparing authority challenge");

    await act(async () => {
      challenge.resolve(validChallenge());
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-admin-sign-in-state='signing']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Approve the signature request");
    expect(button?.getAttribute("aria-describedby")).toBe(
      "admin-sign-in-reason",
    );

    await act(async () => {
      signature.resolve("0x1234");
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-admin-sign-in-state='verifying']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Checking current onchain roles");

    await act(async () => verification.resolve(session));
  });

  it("creates a server session from one scoped wallet signature", async () => {
    const started = vi.fn();
    window.addEventListener("orbit:admin-session-started", started);
    state.connection = { ...state.connection, status: "connected" };
    const challenge = validChallenge();
    state.challenge.mockResolvedValue(challenge);
    state.sign.mockResolvedValue("0x1234");
    state.verify.mockResolvedValue(session);
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => {
      button?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(state.challenge).toHaveBeenCalledWith(state.connection.address);
    expect(state.sign).toHaveBeenCalledWith({
      account: state.connection.address,
      message: challenge.message,
    });
    expect(state.verify).toHaveBeenCalledWith({
      message: challenge.message,
      signature: "0x1234",
    });
    expect(started).toHaveBeenCalledOnce();
    expect(state.replace).toHaveBeenCalledWith("/admin/diagnostics");
    expect(state.refresh).toHaveBeenCalled();
    window.removeEventListener("orbit:admin-session-started", started);
  });

  it("rejects a session issued for a different web deployment", async () => {
    state.connection = { ...state.connection, status: "connected" };
    state.challenge.mockResolvedValue(validChallenge());
    state.sign.mockResolvedValue("0x1234");
    state.verify.mockResolvedValue({
      ...session,
      deploymentFingerprint: `0x${"e".repeat(64)}`,
    });
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => {
      button?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(state.replace).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-admin-sign-in-state='rejected']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("could not be completed");
    expect(container.querySelector("[role='alert']")).not.toBeNull();
  });

  it("does not sign or verify a rejected server challenge", async () => {
    state.connection = { ...state.connection, status: "connected" };
    const challenge = validChallenge();
    state.challenge.mockResolvedValue({
      ...challenge,
      message: challenge.message.replace("Chain ID: 84532", "Chain ID: 1"),
    });
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => {
      button?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(state.sign).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Admin sign-in was stopped because the server challenge was invalid. Refresh and try again.",
    );
  });

  it("does not sign when the connected account changes while the challenge is pending", async () => {
    state.connection = { ...state.connection, status: "connected" };
    const challenge = validChallenge();
    let resolveChallenge!: (value: typeof challenge) => void;
    state.challenge.mockReturnValue(
      new Promise((resolve) => {
        resolveChallenge = resolve;
      }),
    );
    await render();

    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => button?.click());

    state.connection = {
      address: "0x2222222222222222222222222222222222222222",
      chainId: 84_532,
      status: "connected",
    };
    await render();
    await act(async () => {
      resolveChallenge(challenge);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(state.sign).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Admin sign-in was stopped because the connected wallet or network changed.",
    );
  });

  it("does not verify when the account changes while signing", async () => {
    state.connection = { ...state.connection, status: "connected" };
    state.challenge.mockResolvedValue(validChallenge());
    let resolveSign!: (value: `0x${string}`) => void;
    state.sign.mockReturnValue(
      new Promise((resolve) => (resolveSign = resolve)),
    );
    await render();
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => button?.click());
    state.connection = { ...state.connection, chainId: 1 };
    await render();
    await act(async () => resolveSign("0x1234"));
    expect(state.verify).not.toHaveBeenCalled();
  });

  it("tears down a created session when the account changes during verification", async () => {
    state.connection = { ...state.connection, status: "connected" };
    state.challenge.mockResolvedValue(validChallenge());
    state.sign.mockResolvedValue("0x1234");
    let resolveVerify!: (value: typeof session) => void;
    state.verify.mockReturnValue(
      new Promise((resolve) => (resolveVerify = resolve)),
    );
    state.logout.mockResolvedValue(undefined);
    await render();
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => button?.click());
    state.connection = { ...state.connection, status: "disconnected" };
    await render();
    await act(async () => resolveVerify(session));
    expect(state.logout).toHaveBeenCalledWith(session.csrfToken);
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("publishes synchronously after the final live-state check", async () => {
    state.connection = { ...state.connection, status: "connected" };
    state.challenge.mockResolvedValue(validChallenge());
    state.sign.mockResolvedValue("0x1234");
    state.verify.mockResolvedValue(session);
    let reads = 0;
    const originalConnection = state.connection;
    const currentConnection = vi.fn(() => {
      reads += 1;
      if (reads === 3) {
        queueMicrotask(() => {
          state.connection = { ...originalConnection, status: "disconnected" };
        });
      }
      return state.connection;
    });
    state.currentConnection = currentConnection;
    state.replace.mockImplementation(() => {
      expect(state.connection.status).toBe("connected");
    });
    await render();
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => {
      button?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(state.replace).toHaveBeenCalledOnce();
  });

  it("does not continue a pending challenge after unmount", async () => {
    state.connection = { ...state.connection, status: "connected" };
    const challenge = validChallenge();
    let resolveChallenge!: (value: typeof challenge) => void;
    state.challenge.mockReturnValue(
      new Promise((resolve) => (resolveChallenge = resolve)),
    );
    await render();
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Sign in to admin"),
    );
    await act(async () => button?.click());
    act(() => root.unmount());
    await act(async () => resolveChallenge(challenge));
    expect(state.sign).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
