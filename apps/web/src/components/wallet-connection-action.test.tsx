/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const events = vi.hoisted(
  () => new Set<(event: { data: { event: string } }) => void>(),
);
vi.mock("@reown/appkit/react", () => ({
  modal: {
    subscribeEvents: (
      listener: (event: { data: { event: string } }) => void,
    ) => {
      events.add(listener);
      return () => events.delete(listener);
    },
  },
}));
import { WalletConnectionAction } from "./wallet-connection-action";

beforeEach(() => {
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
    await act(() =>
      root.render(
        <>
          <WalletConnectionAction onContinue={() => undefined}>
            Connect wallet
          </WalletConnectionAction>
          <button>Other control</button>
        </>,
      ),
    );
    const trigger = container.querySelectorAll("button")[0]!;
    const other = container.querySelectorAll("button")[1]!;
    trigger.focus();
    await act(() => trigger.click());
    trigger.blur();
    if (scenario === "other-focus") other.focus();
    if (scenario === "unmounted") await act(() => root.render(null));
    await act(() => {
      events.forEach((listener) =>
        listener({ data: { event: "MODAL_CLOSE" } }),
      );
      frame.forEach((callback) => callback(0));
    });
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
  await act(() =>
    root.render(
      <>
        <WalletConnectionAction onContinue={() => undefined}>
          Header connect
        </WalletConnectionAction>
        <WalletConnectionAction onContinue={() => undefined}>
          Page connect
        </WalletConnectionAction>
      </>,
    ),
  );
  const [first, latest] = container.querySelectorAll("button");
  first!.focus();
  await act(() => first!.click());
  latest!.focus();
  await act(() => latest!.click());
  latest!.blur();
  await act(() => {
    events.forEach((listener) => listener({ data: { event: "MODAL_CLOSE" } }));
    frames.forEach((callback) => callback(0));
  });
  expect(document.activeElement).toBe(latest);
});
