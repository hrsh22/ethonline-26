// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExchangeDraft } from "./use-exchange-draft";
vi.mock("./deployment", () => ({
  protocolDeploymentFingerprint: "test-deployment",
}));
let root: Root;
let container: HTMLDivElement;
let draft: ReturnType<typeof useExchangeDraft>;
function Probe({ address }: { address?: string | undefined }) {
  const current = useExchangeDraft(address);
  useEffect(() => {
    draft = current;
  }, [current]);
  return <span>{current.amount}</span>;
}
const render = (address?: string | undefined) =>
  act(async () => root.render(<Probe address={address} />));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("restores input after remount without persisting quotes or approval state", async () => {
  await render("0xA");
  await act(async () => {
    draft.setAmount("0.013");
    draft.setDirection("sell");
    draft.setSettlementMode("native");
  });
  act(() => root.unmount());
  root = createRoot(container);
  await render("0xa");
  expect(draft).toMatchObject({
    amount: "0.013",
    direction: "sell",
    settlementMode: "native",
  });
  expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toEqual({
    amount: "0.013",
    direction: "sell",
    settlementMode: "native",
  });
});
it("carries a visitor draft into first connection and separates later wallets", async () => {
  await render();
  await act(async () => draft.setAmount("0.02"));
  await render("0xa");
  expect(draft.amount).toBe("0.02");
  await render("0xb");
  expect(draft.amount).toBe("");
  await act(async () => draft.setAmount("0.03"));
  await render("0xa");
  expect(draft.amount).toBe("0.02");
  await render("0xb");
  expect(draft.amount).toBe("0.03");
});
it("keeps input usable when browser storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("blocked");
  });
  await render("0xa");
  await act(async () => draft.setAmount("0.004"));
  expect(container.textContent).toBe("0.004");
});
it("discards malformed saved input", async () => {
  sessionStorage.setItem(
    "orbit:trade-draft:v1:test-deployment:0xa",
    JSON.stringify({
      amount: "invalid",
      direction: "buy",
      settlementMode: "wrapped",
    }),
  );
  await render("0xa");
  expect(draft.amount).toBe("");
});
