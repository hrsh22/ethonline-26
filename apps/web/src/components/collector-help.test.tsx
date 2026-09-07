/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ protocol: {} as unknown }));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => state.protocol,
}));
vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "offline", data: { observedAt: 1000 } }),
}));
import { CollectorHelp } from "./collector-help";
it("copies only current public support context after an explicit action", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const hash = `0x${"a".repeat(64)}`;
  state.protocol = {
    walletRead: { status: "failed", error: new Error("secret-provider-key") },
    transaction: {
      status: "outcome-unknown",
      hash,
      label: "Launch",
      message: "secret-wallet-response",
    },
    address: "unrelated-wallet-address",
  };
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CollectorHelp topic="transaction" />));
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/learn#help-transaction",
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Copy support details")
        ?.click(),
    );
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain(hash);
    expect(copied).toContain("outcome-unknown");
    expect(copied).toContain("84532");
    expect(copied).not.toContain("secret");
    expect(copied).not.toContain("unrelated-wallet");
    expect(container.textContent).toContain("Support details copied");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
