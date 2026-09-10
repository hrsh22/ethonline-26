/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ modalOpen: false }));
vi.mock("@/providers/wallet-session", () => ({
  useWalletSession: () => session,
}));
import { WalletConnectionAction } from "./wallet-connection-action";

beforeEach(() => {
  session.modalOpen = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each(["return", "other-focus", "unmounted"] as const)(
  "handles chooser close with %s without moving unrelated focus",
  async (scenario) => {
    const frame: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame.push(callback);
      return frame.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const content = () => (
      <>
        <WalletConnectionAction onContinue={() => undefined}>
          Connect wallet
        </WalletConnectionAction>
        <button>Other control</button>
      </>
    );
    await act(() => root.render(content()));
    const trigger = container.querySelectorAll("button")[0]!;
    const other = container.querySelectorAll("button")[1]!;
    trigger.focus();
    await act(() => trigger.click());
    session.modalOpen = true;
    await act(() => root.render(content()));
    trigger.blur();
    if (scenario === "other-focus") other.focus();
    if (scenario === "unmounted") await act(() => root.render(null));
    session.modalOpen = false;
    if (scenario !== "unmounted") await act(() => root.render(content()));
    await act(() => frame.forEach((callback) => callback(0)));
    expect(document.activeElement).toBe(
      scenario === "return"
        ? trigger
        : scenario === "other-focus"
          ? other
          : document.body,
    );
  },
);

it("returns to the latest initiator when an earlier connect attempt never opened", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const content = () => (
    <>
      <WalletConnectionAction onContinue={() => undefined}>
        Header connect
      </WalletConnectionAction>
      <WalletConnectionAction onContinue={() => undefined}>
        Page connect
      </WalletConnectionAction>
    </>
  );
  await act(() => root.render(content()));
  const [first, latest] = container.querySelectorAll("button");
  first!.focus();
  await act(() => first!.click());
  latest!.focus();
  await act(() => latest!.click());
  session.modalOpen = true;
  await act(() => root.render(content()));
  latest!.blur();
  session.modalOpen = false;
  await act(() => root.render(content()));
  await act(() => frames.forEach((callback) => callback(0)));
  expect(document.activeElement).toBe(latest);
});
