/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ protocol: undefined as unknown }));
vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "unknown" }),
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => state.protocol,
}));
vi.mock("@/components/access-notice", async (original) => ({
  ...(await original<typeof import("@/components/access-notice")>()),
  AccessNotice: () => null,
}));
import { RewardsPanel } from "./rewards-panel";

const craft = (identityId: number, tracks = ["AAPLc"]) => ({
  identityId,
  stateLabel: "Orbiter",
  rewardTrack: tracks[0],
  claimEligible: true,
  pendingRewardsStatus: "observed",
  claimEligibilityStatus: "observed",
  pendingRewards: tracks.map((track) => ({ track, rawTokenUnits: 10n ** 18n })),
});
const protocol = (permanent: ReturnType<typeof craft>[]) => ({
  accessState: "ready",
  execute: vi.fn(),
  retry: vi.fn(),
  transaction: { status: "idle" },
  walletRead: {
    status: "loaded",
    snapshot: {
      partialFailures: [],
      collectibles: { permanentHoldingsStatus: "complete", permanent },
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
const render = () => act(async () => root.render(<RewardsPanel />));
const click = async (name: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (entry) => entry.textContent === name,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
};
it("reviews one Station as four labeled assets before submitting its identity", async () => {
  const current = protocol([
    craft(4441, ["AAPLc", "GOOGLc", "METAc", "NVDAc"]),
  ]);
  state.protocol = current;
  await render();
  await click("Claim eligible rewards");
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("1 identity in this claim");
  for (const track of ["AAPLc", "GOOGLc", "METAc", "NVDAc"])
    expect(dialog?.textContent).toContain(`1${track}`);
  await click("Identities included in this claim");
  expect(dialog?.textContent).toContain("#4441");
  expect(current.execute).not.toHaveBeenCalled();
  await click("Confirm claim");
  expect(current.execute).toHaveBeenCalledWith(
    { type: "claim", identityIds: [4441] },
    "Claim eligible rewards",
  );
});
it("reviews exactly the first 64 identities and explains the remainder", async () => {
  const current = protocol(
    Array.from({ length: 65 }, (_, index) => craft(index + 1)),
  );
  state.protocol = current;
  await render();
  await click("Claim eligible rewards");
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("64 identities in this claim");
  expect(dialog?.textContent).toContain("64AAPLc");
  expect(dialog?.textContent).toContain("1 more eligible identity remains");
  expect(dialog?.textContent).not.toContain("#65");
  await click("Confirm claim");
  expect(current.execute).toHaveBeenCalledWith(
    {
      type: "claim",
      identityIds: Array.from({ length: 64 }, (_, index) => index + 1),
    },
    "Claim eligible rewards",
  );
});

it("requires another review when the selected rewards change", async () => {
  const current = protocol([craft(42)]);
  state.protocol = current;
  await render();
  await click("Claim eligible rewards");
  const next = protocol([
    {
      ...craft(42),
      pendingRewards: [{ track: "AAPLc", rawTokenUnits: 2n * 10n ** 18n }],
    },
  ]);
  state.protocol = next;
  await render();
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain(
    "Rewards changed. Close this review and review the updated claim.",
  );
  await click("Confirm claim");
  expect(current.execute).not.toHaveBeenCalled();
  expect(next.execute).not.toHaveBeenCalled();
});

it("excludes unread identities and recovers their claim without another wallet action", async () => {
  const current = protocol([
    craft(42),
    { ...craft(43), pendingRewardsStatus: "unavailable", pendingRewards: [] },
  ]);
  state.protocol = current;
  await render();
  expect(container.textContent).toContain("Rewards unavailable for #43");
  await click("Claim eligible rewards");
  let dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("1 identity in this claim");
  expect(dialog?.textContent).toContain("Known rewards only");
  await click("Cancel");
  state.protocol = protocol([craft(42), craft(43)]);
  await render();
  expect(container.textContent).not.toContain("Rewards unavailable for #43");
  await click("Claim eligible rewards");
  dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("2 identities in this claim");
  expect(dialog?.textContent).toContain("2AAPLc");
});

it("locks an open claim when the active wallet no longer has the reviewed identities", async () => {
  state.protocol = protocol([craft(42)]);
  await render();
  await click("Claim eligible rewards");
  const next = protocol([]);
  state.protocol = next;
  await render();
  await click("Confirm claim");
  expect(next.execute).not.toHaveBeenCalled();
});
