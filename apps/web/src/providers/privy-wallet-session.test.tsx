/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  authReady: true,
  walletsReady: true,
  isOpen: false,
  connect: vi.fn(),
  logout: vi.fn(),
  disconnect: vi.fn(),
  connections: [{ connector: { uid: "selected" } }],
  callbacks: undefined as
    undefined | { onSuccess: () => void; onError: (error?: string) => void },
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: sdk.authReady, logout: sdk.logout }),
  useWallets: () => ({ ready: sdk.walletsReady }),
  useModalStatus: () => ({ isOpen: sdk.isOpen }),
  useConnectOrCreateWallet: (callbacks: typeof sdk.callbacks) => {
    sdk.callbacks = callbacks;
    return { connectOrCreateWallet: sdk.connect };
  },
}));
vi.mock("wagmi", () => ({
  useDisconnect: () => ({ mutateAsync: sdk.disconnect }),
  useConnections: () => sdk.connections,
}));
import { PrivyWalletSession } from "./privy-wallet-session";
import { useWalletSession, type WalletSession } from "./wallet-session";

let session: WalletSession;
function Probe() {
  const value = useWalletSession();
  useEffect(() => {
    session = value;
  }, [value]);
  return null;
}
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sdk.authReady = true;
  sdk.walletsReady = true;
  sdk.isOpen = false;
  sdk.connections = [{ connector: { uid: "selected" } }];
  sdk.connect.mockReset();
  sdk.logout.mockReset().mockResolvedValue(undefined);
  sdk.disconnect.mockReset().mockResolvedValue(undefined);
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(() => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});
const render = () =>
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <PrivyWalletSession>
          <Probe />
        </PrivyWalletSession>
      </QueryClientProvider>,
    ),
  );
it("waits for both SDK restoration stages before opening the chooser", async () => {
  sdk.walletsReady = false;
  await render();
  await act(() => session.connect());
  expect(sdk.connect).not.toHaveBeenCalled();
  sdk.walletsReady = true;
  await render();
  await act(() => session.connect());
  expect(sdk.connect).toHaveBeenCalledOnce();
  expect(session.connecting).toBe(true);
  await act(() => sdk.callbacks?.onSuccess());
  expect(session.connecting).toBe(false);
});
it.each(["throw", "callback"])(
  "allows retry after a chooser %s failure",
  async (failure) => {
    await render();
    if (failure === "throw")
      sdk.connect.mockImplementationOnce(() => {
        throw new Error("unavailable");
      });
    await act(() => session.connect());
    if (failure === "callback") await act(() => sdk.callbacks?.onError());
    expect(session.rejected).toBe(true);
    expect(session.connecting).toBe(false);
    await act(() => session.connect());
    expect(session.rejected).toBe(false);
    expect(sdk.connect).toHaveBeenCalledTimes(2);
  },
);
it("logs out of Privy before disconnecting the active transaction account", async () => {
  await render();
  await act(async () => session.disconnect());
  expect(sdk.logout).toHaveBeenCalledOnce();
  expect(sdk.disconnect).toHaveBeenCalledOnce();
  expect(sdk.logout.mock.invocationCallOrder[0]).toBeLessThan(
    sdk.disconnect.mock.invocationCallOrder[0]!,
  );
});
it("preserves the active account when logout fails so disconnect can be retried", async () => {
  sdk.logout.mockRejectedValueOnce(new Error("offline"));
  await render();
  await act(async () => session.disconnect());
  expect(sdk.disconnect).not.toHaveBeenCalled();
  await act(async () => session.disconnect());
  expect(sdk.disconnect).toHaveBeenCalledOnce();
});

it("disconnects every restored connector so an alternate wallet cannot stay active", async () => {
  const first = { uid: "selected" };
  const second = { uid: "also-restored" };
  sdk.connections = [{ connector: first }, { connector: second }];
  await render();
  await act(async () => session.disconnect());
  expect(sdk.disconnect.mock.calls).toEqual([
    [{ connector: first }],
    [{ connector: second }],
  ]);
});

it("treats dismissing the chooser as cancellation instead of a wallet failure", async () => {
  await render();
  await act(() => session.connect());
  await act(() => sdk.callbacks?.onError("exited_auth_flow"));
  expect(session.connecting).toBe(false);
  expect(session.rejected).toBe(false);
});
