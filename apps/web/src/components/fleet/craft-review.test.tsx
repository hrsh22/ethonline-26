/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ protocol: undefined as unknown }));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => state.protocol,
}));
vi.mock("@/hooks/use-collectible-read", () => ({
  useCollectibleRead: () => ({
    data: undefined,
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "unknown" }),
}));
import { CraftDetailPanel } from "./craft-detail-panel";
const recipient = "0x0000000000000000000000000000000000000123";
const makeProtocol = (permanent = false) => ({
  accessState: "ready",
  address: "0x0000000000000000000000000000000000000042",
  chainId: 84532,
  transaction: { status: "idle" },
  execute: vi.fn(),
  walletSynchronizing: false,
  walletRead: {
    status: "loaded",
    snapshot: {
      liquidToken: { rawWei: 2n * 10n ** 18n },
      collectibles: {
        transient: permanent
          ? []
          : [
              {
                identityId: 42,
                stateLabel: "Grounded Craft",
                rewardTrack: "AAPLc",
                pendingRewards: [],
              },
            ],
        permanent: permanent
          ? [
              {
                identityId: 42,
                stateLabel: "Orbiter",
                rewardTrack: "AAPLc",
                pendingRewards: [],
              },
            ]
          : [],
        permanentHoldingsStatus: "complete",
      },
    },
  },
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = () =>
  act(async () => root.render(<CraftDetailPanel identityId={42} />));
const click = async (name: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (el) => el.textContent === name,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
};
const enterRecipient = async () => {
  if (!document.querySelector("#craft-transfer-recipient")) {
    await click("Transfer collectible");
  }
  const input = document.querySelector<HTMLInputElement>(
    "#craft-transfer-recipient",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, recipient);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
it("names the exact Launch and network in its review and clears acknowledgement when the wallet changes", async () => {
  const current = makeProtocol();
  state.protocol = current;
  await render();
  await click("Review Launch");
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("Grounded Craft #42");
  expect(dialog.textContent).toContain("Base Sepolia");
  expect(dialog.textContent).toContain("1 $FUEL");
  await act(async () =>
    dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  state.protocol = { ...current, address: recipient };
  await render();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(current.execute).not.toHaveBeenCalled();
});
it.each([false, true])(
  "reviews full recipient and %s permanent consequences before transfer",
  async (permanent) => {
    const current = makeProtocol(permanent);
    state.protocol = current;
    await render();
    await enterRecipient();
    await click("Review transfer");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain(recipient);
    expect(dialog.textContent).toContain("#42");
    expect(dialog.textContent).toContain("Base Sepolia");
    expect(dialog.textContent).toContain(
      permanent ? "Pending Rewards" : "1 $FUEL",
    );
    expect(current.execute).not.toHaveBeenCalled();
    await click("Back");
    expect(
      document.querySelector<HTMLInputElement>("#craft-transfer-recipient")!
        .value,
    ).toBe(recipient);
    await click("Review transfer");
    await click("Confirm transfer");
    expect(current.execute).toHaveBeenCalledWith(
      { type: "direct-collectible-transfer", identityId: 42, recipient },
      expect.any(String),
    );
  },
);
it("invalidates an open transfer review on a wallet change", async () => {
  const current = makeProtocol();
  state.protocol = current;
  await render();
  await enterRecipient();
  await click("Review transfer");
  state.protocol = { ...current, address: recipient };
  await render();
  await click("Confirm transfer");
  expect(current.execute).not.toHaveBeenCalled();
});
